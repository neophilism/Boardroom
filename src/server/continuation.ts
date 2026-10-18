import type {Pool} from "pg";
import {SessionConflict,isValidGeneration,isValidRunId} from "./sessions.ts";
import {claimAssignment} from "./assignment.ts";

/** Relinquish one assignment without ending the authorized agent activation.
 * Previously attempted units in this run are excluded by the continuation
 * claim query, so an owner-blocked PR cannot spin in a tight loop.
 * A replay after release can claim again using the same authorized run.
 */
export async function yieldAndClaim(db:Pool,runId:string,credentialId:string,generation:string,
  outcome:"BLOCKED"|"YIELDED"|"COMPLETED"){
  if(!isValidRunId(runId)||!isValidGeneration(generation))throw new SessionConflict("Invalid session identity");
  const client=await db.connect();
  let released=false;
  try{
    await client.query("BEGIN");
    const run=await client.query<{state:string;started_at:Date}>(
      "SELECT state,started_at FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",
      [runId,credentialId]);
    if(run.rowCount!==1)throw new SessionConflict("Unknown or unauthorized run");
    if(run.rows[0].state!=="RUNNING")throw new SessionConflict("Run is not active");
    const assignment=await client.query<{assignment_id:string;repository_id:string;unit_id:string}>(
      `SELECT assignment_id,repository_id,unit_id FROM work_assignments
       WHERE run_id=$1 AND lease_generation=$2::bigint AND released_at IS NULL FOR UPDATE`,
      [runId,generation]);
    if(assignment.rowCount!==1)throw new SessionConflict("Stale or missing assignment");
    const current=assignment.rows[0];
    const lease=await client.query<{generation:string;run_id:string;expires_at:Date}>(
      "SELECT generation::text,run_id,expires_at FROM repository_leases WHERE repository_id=$1 FOR UPDATE",
      [current.repository_id]);
    if(lease.rowCount!==1||lease.rows[0].run_id!==runId||lease.rows[0].generation!==generation||
       lease.rows[0].expires_at<=new Date())throw new SessionConflict("Current live lease unavailable");
    const pending=await client.query(
      `SELECT 1 FROM github_operations WHERE run_id=$1 AND repository_id=$2
       AND state IN ('INTENDED','UNCERTAIN') LIMIT 1`,[runId,current.repository_id]);
    if(pending.rowCount)throw new SessionConflict("Unreconciled GitHub operations require recovery before release");
    await client.query("UPDATE work_assignments SET outcome=$2,released_at=now() WHERE assignment_id=$1",
      [current.assignment_id,outcome]);
    const freed=await client.query(
      `UPDATE repository_leases SET run_id=NULL,expires_at=NULL,last_heartbeat_at=NULL,assigned_at=NULL
       WHERE repository_id=$1 AND run_id=$2 AND generation=$3::bigint`,
      [current.repository_id,runId,generation]);
    if(freed.rowCount!==1)throw new SessionConflict("Lease release conflicted");
    await client.query("UPDATE agent_runs SET state='ADMITTED',last_seen_at=now() WHERE run_id=$1",[runId]);
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.assignment.yielded',$3::jsonb)",
      [runId,current.repository_id,JSON.stringify({unitId:current.unit_id,generation,outcome})]);
    await client.query("COMMIT");released=true;
  }catch(error){if(!released)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
  // A new claim has its own lease generation. Failure leaves an admitted run
  // that can safely retry boardroom_claim, rather than losing the activation.
  const next=await claimAssignment(db,runId,credentialId);
  return next?{status:"ASSIGNED" as const,assignment:next}:{status:"IDLE" as const,assignment:null};
}
