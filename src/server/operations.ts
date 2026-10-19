import type {Pool} from "pg";
import {SessionConflict,isValidRunId,retainUnreconciledLease,ReleaseReconciliationRequired} from "./sessions.ts";

export function parseExecutionPolicy(input:unknown){
  if(!input||typeof input!=="object"||Array.isArray(input))throw new SessionConflict("Policy object required");
  const p=input as Record<string,unknown>;
  if(typeof p.repositoryId!=="string"||!/^[1-9][0-9]{0,18}$/.test(p.repositoryId)||typeof p.autoMerge!=="boolean")
    throw new SessionConflict("Repository and autoMerge required");
  if(!Array.isArray(p.requiredChecks)||p.requiredChecks.length>30||
     p.requiredChecks.some(c=>typeof c!=="string"||c.length<1||c.length>180))throw new SessionConflict("Invalid required check names");
  const requiredChecks=[...new Set(p.requiredChecks as string[])];
  if(p.autoMerge&&!requiredChecks.length)throw new SessionConflict("Automatic merge requires explicit check names");
  // Legacy clients cannot reintroduce human review as a Boardroom-only gate.
  // Required GitHub reviews remain enforceable through GitHub mergeability.
  if(p.minimumReviews!==undefined&&p.minimumReviews!==0)
    throw new SessionConflict("Independent review counts are not a Boardroom merge requirement");
  const limits={} as Record<"maxSessionSeconds"|"maxToolCalls"|"maxTokens",number|null>;
  for(const [name,min,max] of [["maxSessionSeconds",60,14400],["maxToolCalls",1,1000],["maxTokens",1,10000000]] as const){
    const value=p[name];
    if(value!==undefined&&(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max))throw new SessionConflict("Invalid repository execution limit");
    limits[name]=value===undefined?null:value as number;
  }
  return {repositoryId:p.repositoryId,autoMerge:p.autoMerge,requiredChecks,minimumReviews:0,...limits};
}
export async function setExecutionPolicy(db:Pool,input:unknown){
  const p=parseExecutionPolicy(input);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const exists=await client.query("SELECT repository_id FROM repositories WHERE repository_id=$1 FOR UPDATE",[p.repositoryId]);
    if(exists.rowCount!==1)throw new SessionConflict("Repository has not been imported");
    await client.query(`INSERT INTO repository_execution_policy(repository_id,auto_merge,required_checks,minimum_reviews,max_session_seconds,max_tool_calls,max_tokens)
      VALUES($1,$2,$3::jsonb,$4,COALESCE($5,3300),COALESCE($6,100),COALESCE($7,100000)) ON CONFLICT(repository_id) DO UPDATE SET auto_merge=excluded.auto_merge,
      required_checks=excluded.required_checks,minimum_reviews=excluded.minimum_reviews,
      max_session_seconds=COALESCE($5,repository_execution_policy.max_session_seconds),
      max_tool_calls=COALESCE($6,repository_execution_policy.max_tool_calls),
      max_tokens=COALESCE($7,repository_execution_policy.max_tokens),updated_at=now()`,
      [p.repositoryId,p.autoMerge,JSON.stringify(p.requiredChecks),p.minimumReviews,p.maxSessionSeconds,p.maxToolCalls,p.maxTokens]);
    await client.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'owner.execution_policy.changed',$2::jsonb)",[p.repositoryId,JSON.stringify(p)]);
    await client.query("COMMIT");return p;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function setExecutionPaused(db:Pool,paused:boolean){
  if(typeof paused!=="boolean")throw new SessionConflict("paused must be boolean");
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("UPDATE execution_controls SET paused=$1,updated_at=now() WHERE singleton=TRUE",[paused]);
    await client.query("INSERT INTO audit_events(kind,details) VALUES('owner.execution_paused.changed',$1::jsonb)",[JSON.stringify({paused})]);
    await client.query("COMMIT");return {paused};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
/** Revoke and fence before release. The owner must separately attest termination
 * or isolation of any outside execution/credentials which Boardroom cannot see.
 */
export async function recoverRun(db:Pool,runId:string,externalExecutionStopped:boolean){
  if(!isValidRunId(runId)||externalExecutionStopped!==true)throw new SessionConflict("Verify outside execution stopped or isolated before recovery");
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const run=await client.query<{credential_id:string;state:string}>("SELECT credential_id,state FROM agent_runs WHERE run_id=$1 FOR UPDATE",[runId]);
    if(!run.rowCount)throw new SessionConflict("Run not found");
    if(["CANCELLED","COMPLETED","YIELDED","FAILED","BLOCKED"].includes(run.rows[0].state)){
      await client.query("COMMIT");return {state:run.rows[0].state,replay:true};
    }
    const assignment=await client.query<{repository_id:string;lease_generation:string}>(
      "SELECT repository_id,lease_generation::text FROM work_assignments WHERE run_id=$1 AND released_at IS NULL FOR UPDATE",[runId]);
    const repoId=assignment.rows[0]?.repository_id;
    if(repoId){
      const lease=await client.query<{run_id:string;generation:string}>("SELECT run_id::text,generation::text FROM repository_leases WHERE repository_id=$1 FOR UPDATE",[repoId]);
      if(lease.rows[0]?.run_id!==runId||lease.rows[0]?.generation!==assignment.rows[0].lease_generation)
        throw new SessionConflict("Lease superseded; cannot release another run");
      const unresolved=await retainUnreconciledLease(client,runId,repoId,assignment.rows[0].lease_generation,"CANCELLED");
      if(unresolved){
        await client.query("COMMIT");committed=true;
        throw new ReleaseReconciliationRequired(unresolved);
      }
    }
    await client.query("UPDATE agent_credentials SET enabled=FALSE,revoked_at=COALESCE(revoked_at,now()) WHERE credential_id=$1",[run.rows[0].credential_id]);
    await client.query("UPDATE work_assignments SET released_at=now(),outcome='CANCELLED' WHERE run_id=$1 AND released_at IS NULL",[runId]);
    if(repoId)await client.query("UPDATE repository_leases SET run_id=NULL,expires_at=NULL,last_heartbeat_at=NULL,assigned_at=NULL,generation=generation+1 WHERE repository_id=$1 AND run_id=$2",[repoId,runId]);
    await client.query("UPDATE agent_runs SET state='CANCELLED',ended_at=now() WHERE run_id=$1",[runId]);
    if(repoId)await client.query("UPDATE owner_actions SET status='VERIFIED',resolved_at=now(),updated_at=now() WHERE action_key=$1 AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')",["boardroom:recovery:"+repoId]);
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'owner.run.fenced_and_recovered',$3::jsonb)",[runId,repoId??null,JSON.stringify({credentialRevoked:true,externalExecutionStopped:true})]);
    await client.query("COMMIT");return {state:"CANCELLED",replay:false,credentialRevoked:true};
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function operationsOverview(db:Pool){
  const [control,repositories,runs,audit,usage,outbox,repositoryFreshness]=await Promise.all([
    db.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE"),
    db.query(`SELECT r.repository_id::text AS "repositoryId",r.full_name AS "fullName",COALESCE(p.auto_merge,FALSE) AS "autoMerge",
      COALESCE(p.required_checks,'[]'::jsonb) AS "requiredChecks",
      COALESCE(p.max_session_seconds,3300) AS "maxSessionSeconds",COALESCE(p.max_tool_calls,100) AS "maxToolCalls",COALESCE(p.max_tokens,100000) AS "maxTokens"
      FROM repositories r LEFT JOIN repository_execution_policy p ON p.repository_id=r.repository_id WHERE r.enabled=TRUE AND r.archived=FALSE ORDER BY r.full_name`),
    db.query(`SELECT ar.run_id,ar.state,c.label,c.credential_id::text AS "credentialId",ar.provider,ar.started_at,ar.last_seen_at,ar.ended_at,
      r.full_name,a.unit_id FROM agent_runs ar JOIN agent_credentials c ON c.credential_id=ar.credential_id
      LEFT JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL LEFT JOIN repositories r ON r.repository_id=a.repository_id
      ORDER BY ar.started_at DESC LIMIT 100`),
    db.query("SELECT event_id,kind,run_id,repository_id,occurred_at,details FROM audit_events ORDER BY occurred_at DESC LIMIT 100"),
    db.query("SELECT COALESCE(SUM(input_tokens+output_tokens),0)::text AS tokens,COALESCE(SUM(cost_microusd),0)::text AS cost_microusd FROM usage_events WHERE created_at>now()-interval '24 hours'"),
    db.query(`SELECT operation_type AS "operationType",state,COALESCE(last_error_code,'') AS "errorCode",COUNT(*)::integer AS count,
      MIN(created_at) AS "oldestCreatedAt",
      MAX(available_at) AS "latestAvailableAt"
      FROM operation_outbox GROUP BY operation_type,state,last_error_code ORDER BY operation_type,state,last_error_code`),
    db.query(`SELECT r.full_name AS "fullName",s.plan_status AS "planStatus",
      s.last_success_at AS "lastSuccessAt",s.last_attempt_at AS "lastAttemptAt",
      s.last_error AS "lastError"
      FROM repositories r LEFT JOIN repository_sync_status s USING(repository_id)
      WHERE r.enabled=TRUE AND r.archived=FALSE
      ORDER BY s.last_success_at ASC NULLS FIRST,r.full_name LIMIT 30`)
  ]);
  return {paused:control.rows[0]?.paused??true,repositories:repositories.rows,runs:runs.rows,audit:audit.rows,
    last24HoursReportedUsage:usage.rows[0],outbox:outbox.rows,repositoryFreshness:repositoryFreshness.rows,observedAt:new Date().toISOString()};
}
