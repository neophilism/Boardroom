import {timingSafeEqual} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {reconcileGithubOperations} from "./github-operation-ledger.ts";
export type WatchdogReport={examined:number;heldForRecovery:number;renewedMeanwhile:number;ownerRequestsCreated:number};
type Stale={run_id:string;repository_id:string;generation:string;expires_at:Date;native_oauth:boolean};
type Lease={run_id:string|null;generation:string;expires_at:Date|null};

export function authorizedWatchdogToken(value:string|null,secret:string|undefined):boolean{
  if(!secret||!value?.startsWith("Bearer ")||!(/^[A-Za-z0-9_-]{32,256}$/).test(secret))return false;
  const received=value.slice(7);
  if(!(/^[A-Za-z0-9_-]{32,256}$/).test(received))return false;
  const actual=Buffer.from(received),expected=Buffer.from(secret);
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}

/** Mark expired work as RECOVERING. Never release a lease because time elapsed.
 * credentialId is supplied only from an authenticated principal for a bounded
 * arrival recovery pass; maintenance omits it to scan the fleet.
 */
export async function scanStaleSessions(db:Pool,limit=50,credentialId?:string):Promise<WatchdogReport>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid scan limit");
  return recoveryTransaction(db,client=>scanStaleSessionsLocked(client,limit,credentialId));
}

async function recoveryTransaction<T>(db:Pool,operation:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const result=await operation(client);
    await client.query("COMMIT");committed=true;
    return result;
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

/** Caller owns the transaction; admission already holds its credential/run lock. */
export async function scanStaleSessionsLocked(client:PoolClient,limit:number,credentialId?:string):Promise<WatchdogReport>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid scan limit");
  const report:WatchdogReport={examined:0,heldForRecovery:0,renewedMeanwhile:0,ownerRequestsCreated:0};
    const candidates=await client.query<Stale>(
      "SELECT ar.run_id::text AS run_id,l.repository_id::text AS repository_id, " +
      "l.generation::text AS generation,l.expires_at,"+
      "EXISTS (SELECT 1 FROM agent_credentials c JOIN oauth_grants g ON g.credential_id=c.credential_id "+
      "WHERE c.credential_id=ar.credential_id AND c.provider='chatgpt' AND c.enabled=TRUE "+
      "AND c.revoked_at IS NULL AND g.revoked_at IS NULL) AS native_oauth FROM agent_runs ar " +
      "JOIN repository_leases l ON l.run_id=ar.run_id " +
      "WHERE ar.state='RUNNING' AND l.expires_at<=now() "+
      "AND ($2::uuid IS NULL OR ar.credential_id=$2::uuid) ORDER BY l.expires_at ASC " +
      "FOR UPDATE OF ar SKIP LOCKED LIMIT $1",[limit,credentialId??null]);
    report.examined=candidates.rows.length;
    for(const row of candidates.rows){
      // Session finish locks ar before l. Keep that order and defer an in-flight
      // gateway write instead of blocking the complete maintenance pass on it.
      const current=await client.query<Lease>(
        "SELECT run_id::text,generation::text AS generation,expires_at FROM " +
        "repository_leases WHERE repository_id=$1 FOR UPDATE SKIP LOCKED",[row.repository_id]);
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
      report.heldForRecovery++;
      // Native OAuth recovery is a server operation, not an owner task. An
      // unresolved external write remains a technical reconciliation hold.
      if(row.native_oauth)continue;
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
    }
    return report;
}


export type NativeOAuthRecoveryReport={
  examined:number;released:number;heldForAmbiguousWrites:number;renewedMeanwhile:number;
};
type RecoverableOAuthRun={run_id:string;repository_id:string;generation:string;expires_at:Date};
type RecoveryAssignment={assignment_id:string;lease_generation:string};

/** Fully fence a stranded *native Boardroom OAuth* activation without revoking
 * its reusable ChatGPT connection. Never use this for hosted/bearer workers,
 * which may have separate execution processes or non-gateway credentials.
 *
 * Preconditions: scanStaleSessions has marked the run RECOVERING; its lease
 * expired at least 60 seconds ago; a non-revoked named OAuth grant exists; and
 * no recorded external GitHub operation has an unresolved result. A locked
 * lease row serializes fencing against every in-flight Boardroom GitHub write.
 * Old generations and terminal run IDs fail all subsequent gated mutations.
 *
 * Fencing does NOT terminate a ChatGPT conversation or revoke any independent
 * GitHub connector access outside Boardroom. Such access must not be used by
 * scheduled agents; it cannot be proved absent by a database timeout.
 */
export async function recoverFencedOAuthSessions(db:Pool,limit=50,credentialId?:string):Promise<NativeOAuthRecoveryReport>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid recovery limit");
  return recoveryTransaction(db,client=>recoverFencedOAuthSessionsLocked(client,limit,credentialId));
}

/** Reuses admission's transaction so two arrivals cannot skip each other forever. */
export async function recoverFencedOAuthSessionsLocked(client:PoolClient,limit:number,credentialId?:string):Promise<NativeOAuthRecoveryReport>{
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error("Invalid recovery limit");
  const report:NativeOAuthRecoveryReport={examined:0,released:0,heldForAmbiguousWrites:0,renewedMeanwhile:0};
    const candidates=await client.query<RecoverableOAuthRun>(
      "SELECT ar.run_id::text AS run_id,l.repository_id::text AS repository_id,"+
      "l.generation::text AS generation,l.expires_at FROM agent_runs ar "+
      "JOIN agent_credentials c ON c.credential_id=ar.credential_id "+
      "JOIN repository_leases l ON l.run_id=ar.run_id "+
      "WHERE ar.state='RECOVERING' AND l.expires_at<=now()-interval '60 seconds' "+
      "AND ($2::uuid IS NULL OR ar.credential_id=$2::uuid) "+
      "AND c.provider='chatgpt' AND c.enabled=TRUE AND c.revoked_at IS NULL "+
      "AND EXISTS (SELECT 1 FROM oauth_grants g WHERE g.credential_id=c.credential_id AND g.revoked_at IS NULL) "+
      "ORDER BY l.expires_at ASC FOR UPDATE OF ar SKIP LOCKED LIMIT $1",[limit,credentialId??null]);
    report.examined=candidates.rows.length;
    for(const row of candidates.rows){
      const current=await client.query<Lease>(
        "SELECT run_id::text AS run_id,generation::text AS generation,expires_at "+
        "FROM repository_leases WHERE repository_id=$1 FOR UPDATE SKIP LOCKED",[row.repository_id]);
      const lease=current.rows[0];
      if(!lease||lease.run_id!==row.run_id||lease.generation!==row.generation||
         !lease.expires_at||lease.expires_at.getTime()>Date.now()-60000){
        report.renewedMeanwhile++;continue;
      }
      const assignment=await client.query<RecoveryAssignment>(
        "SELECT assignment_id::text AS assignment_id,lease_generation::text AS lease_generation "+
        "FROM work_assignments WHERE run_id=$1 AND repository_id=$2 AND released_at IS NULL FOR UPDATE",
        [row.run_id,row.repository_id]);
      if(assignment.rowCount!==1||assignment.rows[0].lease_generation!==row.generation){
        report.renewedMeanwhile++;continue;
      }
      // External write results that may already have reached GitHub must first
      // be reconciled with current GitHub state, not silently ignored.
      await reconcileGithubOperations(client,row.run_id,row.repository_id);
      const uncertain=await client.query(
        "SELECT 1 FROM github_operations WHERE run_id=$1 AND repository_id=$2 "+
        "AND state IN ('INTENDED','UNCERTAIN') LIMIT 1",[row.run_id,row.repository_id]);
      if(uncertain.rowCount){report.heldForAmbiguousWrites++;continue;}

      const finished=await client.query(
        "UPDATE agent_runs SET state='CANCELLED',ended_at=now() "+
        "WHERE run_id=$1 AND state='RECOVERING'",[row.run_id]);
      if(finished.rowCount!==1){report.renewedMeanwhile++;continue;}
      await client.query(
        "UPDATE work_assignments SET released_at=now(),outcome='CANCELLED' "+
        "WHERE assignment_id=$1 AND released_at IS NULL",[assignment.rows[0].assignment_id]);
      const freed=await client.query(
        "UPDATE repository_leases SET run_id=NULL,expires_at=NULL,last_heartbeat_at=NULL,"+
        "assigned_at=NULL,generation=generation+1 WHERE repository_id=$1 AND "+
        "run_id=$2 AND generation=$3::bigint",[row.repository_id,row.run_id,row.generation]);
      if(freed.rowCount!==1)throw new Error("Fenced OAuth lease changed during recovery");
      await client.query(
        "UPDATE owner_actions SET status='VERIFIED',resolved_at=now(),updated_at=now() "+
        "WHERE action_key=$1 AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')",
        ["boardroom:recovery:"+row.repository_id]);
      await client.query(
        "INSERT INTO audit_events(run_id,repository_id,kind,details) "+
        "VALUES($1,$2,'agent.run.oauth_fenced_and_released',$3::jsonb)",
        [row.run_id,row.repository_id,JSON.stringify({oldGeneration:row.generation,
          credentialPreserved:true,boardroomWriteAuthorityRevoked:true,
          externalExecutionTerminationVerified:false,outsideGithubCredentialsControlled:false})]);
      report.released++;
    }
    return report;
}
