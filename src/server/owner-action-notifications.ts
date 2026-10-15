import {randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {buildOwnerActionNotificationBatch,type OwnerActionNotificationCandidate} from "../domain/owner-action-notification.ts";

export type OwnerNotificationAdapter={
  send(message:{subject:string;text:string}):Promise<{deliveryId:string}>;
};

const deliveryId=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,180}$/;
const apparentSecret=/(?:github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api.?key|secret|token)\s*[:=])/i;

export async function claimOwnerActionNotificationBatch(db:Pool,publicUrl:string,observedAt=new Date()){
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('boardroom.owner-action-notifications'))");
    const result=await client.query<{
      actionId:string;type:string;status:string;createdAt:Date;lastDeliveredAt:Date|null;lastReservedAt:Date|null;
    }>(`SELECT a.action_id::text AS "actionId",a.action_type AS type,a.status,a.created_at AS "createdAt",
      MAX(e.occurred_at) FILTER (WHERE e.kind='owner_action.notification_delivered') AS "lastDeliveredAt",
      MAX(e.occurred_at) FILTER (WHERE e.kind='owner_action.notification_reserved') AS "lastReservedAt"
      FROM owner_actions a LEFT JOIN audit_events e ON e.details->>'actionId'=a.action_id::text
      WHERE a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
      GROUP BY a.action_id ORDER BY a.created_at,a.action_id LIMIT 500`);
    const batch=buildOwnerActionNotificationBatch(result.rows as OwnerActionNotificationCandidate[],publicUrl,observedAt);
    if(!batch){await client.query("COMMIT");committed=true;return null;}
    const batchId=randomUUID();
    for(const actionId of batch.actionIds)await client.query(
      "INSERT INTO audit_events(kind,details,occurred_at) VALUES('owner_action.notification_reserved',$1::jsonb,$2)",
      [JSON.stringify({actionId,batchId}),observedAt]
    );
    await client.query("COMMIT");committed=true;
    return {...batch,batchId};
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

export async function deliverOwnerActionNotifications(
  db:Pool,adapter:OwnerNotificationAdapter,publicUrl:string,observedAt=new Date()
){
  const batch=await claimOwnerActionNotificationBatch(db,publicUrl,observedAt);
  if(!batch)return null;
  try{
    const delivered=await adapter.send({subject:batch.subject,text:batch.text});
    if(!delivered||typeof delivered.deliveryId!=="string"||!deliveryId.test(delivered.deliveryId)||apparentSecret.test(delivered.deliveryId))
      throw new Error("Notification provider returned invalid bounded evidence");
    for(const actionId of batch.actionIds)await db.query(
      "INSERT INTO audit_events(kind,details,occurred_at) VALUES('owner_action.notification_delivered',$1::jsonb,$2)",
      [JSON.stringify({actionId,batchId:batch.batchId,deliveryId:delivered.deliveryId}),observedAt]
    );
    return {batchId:batch.batchId,actionCount:batch.actionIds.length,deliveryId:delivered.deliveryId};
  }catch(error){
    await db.query(
      "INSERT INTO audit_events(kind,details,occurred_at) VALUES('owner_action.notification_failed',$1::jsonb,$2)",
      [JSON.stringify({batchId:batch.batchId,actionCount:batch.actionIds.length}),observedAt]
    );
    throw error;
  }
}
