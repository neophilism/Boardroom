import type {Pool} from "pg";
import {githubAppRequest} from "./github-app.ts";
import {repositoryApiPath} from "./assignment-scope.ts";

export type PendingPrApproval={
  actionId:string;actionKey:string;title:string;instructions:string;
  repository:string|null;repositoryCount:number;
};
export type PrSnapshot={number:number;state:string;merged:boolean;head?:{sha:string}};
export type PrApprovalDisposition="VERIFIED"|"CANCELLED"|null;

/** Only an explicit numbered PR action scoped to precisely one repository is eligible.
 * Generic risk-intent approvals, purchases, credentials, and unknown references are never auto-closed. */
export function parsePrActionReference(action:PendingPrApproval):{repository:string;number:number;head:string|null}|null{
  if(action.repositoryCount!==1||!action.repository||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(action.repository)||
     !action.title.toLowerCase().includes(action.repository.toLowerCase())||
     action.actionKey.startsWith("approval:"))return null;
  const title=action.title.match(/\b(?:pull request|pr)\s*#?\s*([1-9]\d{0,8})\b/i);
  if(!title)return null;
  const key=action.actionKey.match(/(?:^|[-_:])pr[-_]?([1-9]\d{0,8})(?:[-_:]|$)/i);
  if(key&&key[1]!==title[1])return null;
  const statedHead=action.instructions.match(/(?:\bat\s+(?:head\s+)?|\bhead\s+)([a-f0-9]{40})\b/i);
  return {repository:action.repository,number:Number(title[1]),head:statedHead?.[1]?.toLowerCase()??null};
}
export function prApprovalDisposition(pr:PrSnapshot,expectedNumber:number,requestedHead:string|null):PrApprovalDisposition{
  if(pr.number!==expectedNumber||!["open","closed"].includes(pr.state))return null;
  if(pr.merged&&pr.state==="closed")return "VERIFIED";
  if(pr.state==="closed"&&!pr.merged)return "CANCELLED";
  if(requestedHead&&pr.head&&/^[a-f0-9]{40}$/i.test(pr.head.sha)&&pr.head.sha.toLowerCase()!==requestedHead)
    return "CANCELLED";
  return null;
}
type Source=(repository:string,number:number)=>Promise<PrSnapshot>;
const githubSource:Source=async(repo,number)=>githubAppRequest("GET",
  repositoryApiPath(repo)+"/pulls/"+number) as Promise<PrSnapshot>;

/** Run only during authenticated maintenance, in bounded batches and without model usage.
 * An unavailable GitHub response leaves approval OPEN and visible for a retry.
 * Each status change and evidence link is written in one database transaction. */
export async function reconcilePrApprovalActions(db:Pool,source:Source=githubSource){
  const pending=await db.query<PendingPrApproval>(`
    SELECT a.action_id::text AS "actionId",a.action_key AS "actionKey",a.title,a.instructions,
      (SELECT max(r.full_name) FROM owner_action_dependents d JOIN repositories r
        ON r.repository_id=d.repository_id WHERE d.action_id=a.action_id) AS repository,
      (SELECT count(DISTINCT d.repository_id)::integer FROM owner_action_dependents d
        WHERE d.action_id=a.action_id) AS "repositoryCount"
    FROM owner_actions a
    WHERE a.action_type='APPROVAL' AND a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
      AND a.action_key NOT LIKE 'approval:%'
    ORDER BY a.created_at ASC,a.action_id ASC LIMIT 50
  `);
  let verified=0,cancelled=0,unavailable=0;
  for(const a of pending.rows){
    const ref=parsePrActionReference(a);
    if(!ref)continue;
    let pr:PrSnapshot;
    try{pr=await source(ref.repository,ref.number);}
    catch{unavailable++;continue;}
    const next=prApprovalDisposition(pr,ref.number,ref.head);
    if(!next)continue;
    const client=await db.connect();
    try{
      await client.query("BEGIN");
      const updated=await client.query(
        "UPDATE owner_actions SET status=$2,updated_at=now(),resolved_at=now() "+
        "WHERE action_id=$1 AND action_type='APPROVAL' AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') "+
        "RETURNING action_id",[a.actionId,next]);
      if(updated.rowCount===1){
        await client.query(
          "INSERT INTO audit_events(kind,details) VALUES('owner_action.github_pr_reconciled',$1::jsonb)",
          [JSON.stringify({actionId:a.actionId,repository:ref.repository,prNumber:ref.number,
            evidence:"github_pr",outcome:next})]
        );
      }
      await client.query("COMMIT");
      if(updated.rowCount===1){if(next==="VERIFIED")verified++;else cancelled++;}
    }catch{
      await client.query("ROLLBACK");unavailable++;
    }finally{client.release();}
  }
  return {examined:pending.rows.length,verified,cancelled,unavailable};
}
