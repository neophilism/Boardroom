import type {Pool} from "pg";
import {actionAge} from "../domain/operational-digest.ts";

export type NotificationAction={
  actionId:string;
  type:string;
  status:string;
  createdAt:Date;
  affectedRepositories:number;
};

export type OwnerActionNotification={
  subject:string;
  body:string;
  reminderDate:string;
  actionCount:number;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actionTypes=new Set(["ACCOUNT","CREDENTIAL","PURCHASE","APPROVAL","HUMAN_INPUT","OTHER"]);
const statuses=new Set(["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"]);

function privateOrigin(value:string):string{
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)
    throw new Error("A private HTTPS Boardroom origin is required");
  return url.origin;
}

export function renderOwnerActionNotification(
  actions:readonly NotificationAction[],observedAt:Date,baseUrl:string
):OwnerActionNotification{
  if(!Number.isFinite(observedAt.getTime()))throw new Error("Valid notification time required");
  const origin=privateOrigin(baseUrl);
  const safe=actions.filter(action=>uuid.test(action.actionId)&&actionTypes.has(action.type)&&
    statuses.has(action.status)&&Number.isFinite(action.createdAt.getTime())&&
    Number.isSafeInteger(action.affectedRepositories)&&action.affectedRepositories>=0
  ).slice(0,250);
  if(!safe.length)throw new Error("At least one valid pending owner action is required");
  const ordered=[...safe].sort((left,right)=>
    left.createdAt.getTime()-right.createdAt.getTime()||left.actionId.localeCompare(right.actionId));
  const lines=ordered.map(action=>{
    const age=actionAge(action.createdAt,observedAt);
    return `- ${age.attention}: ${action.type.replaceAll("_"," ")} / ${action.status.replaceAll("_"," ")} / ${age.days} days / ${action.affectedRepositories} affected / ${origin}/owner-actions/${action.actionId}`;
  });
  return {
    subject:`Boardroom owner actions: ${ordered.length} need attention`,
    body:[
      "Boardroom has consolidated owner actions requiring private review.",
      "Sign in before opening these references. No credential values or request details are included.",
      "",
      ...lines
    ].join("\n"),
    reminderDate:observedAt.toISOString().slice(0,10),
    actionCount:ordered.length
  };
}

export async function queueOwnerActionNotification(
  db:Pool,baseUrl:string,observedAt=new Date()
):Promise<{created:boolean;batchId:string;notification:OwnerActionNotification}|null>{
  const actions=await db.query<NotificationAction>(
    `SELECT a.action_id::text AS "actionId",a.action_type AS type,a.status,a.created_at AS "createdAt",
      (SELECT COUNT(*)::integer FROM owner_action_dependents d WHERE d.action_id=a.action_id) AS "affectedRepositories"
     FROM owner_actions a WHERE a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
     ORDER BY a.created_at,a.action_id LIMIT 250`
  );
  if(!actions.rowCount)return null;
  const notification=renderOwnerActionNotification(actions.rows,observedAt,baseUrl);
  const key="owner-actions:daily:"+notification.reminderDate;
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const inserted=await client.query<{batch_id:string}>(
      `INSERT INTO owner_action_notification_batches(idempotency_key,reminder_date,subject,body,action_count)
       VALUES($1,$2::date,$3,$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING batch_id`,
      [key,notification.reminderDate,notification.subject,notification.body,notification.actionCount]
    );
    let batchId=inserted.rows[0]?.batch_id;
    const created=Boolean(batchId);
    if(!batchId){
      const existing=await client.query<{batch_id:string}>(
        "SELECT batch_id FROM owner_action_notification_batches WHERE idempotency_key=$1",[key]
      );
      batchId=existing.rows[0]?.batch_id;
    }
    if(!batchId)throw new Error("Notification batch unavailable");
    if(created)await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('owner_action.notification_batched',$1::jsonb)",
      [JSON.stringify({batchId,reminderDate:notification.reminderDate,actionCount:notification.actionCount})]
    );
    await client.query("COMMIT");committed=true;
    return {created,batchId,notification};
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
