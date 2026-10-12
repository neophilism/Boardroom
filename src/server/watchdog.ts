import {timingSafeEqual} from "node:crypto";
import type {Pool} from "pg";
export type WatchdogReport={examined:number;heldForRecovery:number;renewedMeanwhile:number;ownerRequestsCreated:number};
type Stale={run_id:string;repository_id:string;generation:string;expires_at:Date};
type Lease={run_id:string|null;generation:string;expires_at:Date|null};

export function authorizedWatchdogToken(value:string|null,secret:string|undefined):boolean{
  if(!secret||!value?.startsWith("Bearer ")||!(/^[A-Za-z0-9_-]{32,256}$/).test(secret))return false;
  const received=value.slice(7);
  if(!(/^[A-Za-z0-9_-]{32,256}$/).test(received))return false;
  const actual=Buffer.from(received),expected=Buffer.from(secret);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

/** Mark expired work as RECOVERING. Never release a lease because time elapsed. */
export async function scanStaleSessions(db:Pool,limit=50):Promise<WatchdogReport>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid scan limit");
  const client=await db.connect();
  let committed=false;
  const report:WatchdogReport={examined:0,heldForRecovery:0,renewedMeanwhile:0,ownerRequestsCreated:0};
  try{
    await client.query("BEGIN");
    const candidates=await client.query<Stale>(
      "SELECT ar.run_id::text AS run_id,l.repository_id::text AS repository_id, " +
      "l.generation::text AS generation,l.expires_at FROM agent_runs ar " +
      "JOIN repository_leases l ON l.run_id=ar.run_id " +
      "WHERE ar.state='RUNNING' AND l.expires_at<=now() ORDER BY l.expires_at ASC " +
      "FOR UPDATE OF ar SKIP LOCKED LIMIT $1",[limit]);
    report.examined=candidates.rows.length;
    for(const row of candidates.rows){
      // Session finish locks ar before l. Lock in this same order; wait for
      // in-flight gateway writes holding the repository lease lock to finish.
      const current=await client.query<Lease>(
        "SELECT run_id::text,generation::text AS generation,expires_at FROM " +
        "repository_leases WHERE repository_id=$1 FOR UPDATE",[row.repository_id]);
      const lease=current.rows[0];
      if(!lease||lease.run_id!==row.run_id||lease.generation!==row.generation||
         !lease.expires_at||lease.expires_at.getTime()>Date.now()){
        report.renewedMeanwhile++;continue;
      }
      const transitioned=await client.query(
        "UPDATE agent_runs SET state='RECOVERING' WHERE run_id=$1 AND state='RUNNING'",
        [row.run_id]);
      if(transitioned.rowCount!==1){report.renewedMeanwhile++;continue;}
      await client.query(
        "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.run.recovery_hold',$3::jsonb)",
        [row.run_id,row.repository_id,JSON.stringify({generation:row.generation,
          expiresAt:row.expires_at.toISOString(),automaticRelease:false})]);
      const key="boardroom:recovery:"+row.repository_id;
      const created=await client.query<{action_id:string}>(
        "INSERT INTO owner_actions(action_key,title,action_type,instructions,requested_permissions,status,source_run_id,price_estimate_cents) " +
        "SELECT $1,'Verify stalled agent termination','HUMAN_INPUT',$2,'[]'::jsonb,'OPEN',$3,0 " +
        "WHERE NOT EXISTS(SELECT 1 FROM owner_actions WHERE action_key=$1 " +
        "AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')) RETURNING action_id",
        [key,"The agent lease expired. Before recovery, verify its execution is stopped or all writes are fenced and any outside GitHub credentials cannot bypass Boardroom. An expired heartbeat alone is insufficient.",row.run_id]);
      if(created.rowCount===1)report.ownerRequestsCreated++;
      const actionId=created.rows[0]?.action_id??(
        await client.query<{action_id:string}>(
          "SELECT action_id FROM owner_actions WHERE action_key=$1 AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') ORDER BY created_at DESC LIMIT 1",
          [key])).rows[0]?.action_id;
      if(actionId)await client.query(
        "INSERT INTO owner_action_dependents(action_id,repository_id,unit_id) VALUES($1,$2,NULL) ON CONFLICT DO NOTHING",
        [actionId,row.repository_id]);
      report.heldForRecovery++;
    }
    await client.query("COMMIT");committed=true;
    return report;
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
