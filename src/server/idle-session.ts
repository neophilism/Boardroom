import type {Pool} from "pg";
import {isValidRunId,SessionConflict} from "./sessions.ts";

export type IdleCompletion = {state:"YIELDED";replay:boolean};

/** Close a real admitted run that had no eligible repository and completed a
 * bounded Coffee Corner pass. This never touches an assigned run's lease.
 */
export async function finishIdleSession(db:Pool,runId:string,credentialId:string):Promise<IdleCompletion>{
  if(!isValidRunId(runId))throw new SessionConflict("Invalid run ID");
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const row=await client.query<{state:string}>(
      "SELECT state FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",
      [runId,credentialId]
    );
    if(row.rowCount!==1)throw new SessionConflict("Unknown or unauthorized run");
    if(row.rows[0].state==="YIELDED"){
      await client.query("COMMIT");committed=true;
      return {state:"YIELDED",replay:true};
    }
    if(row.rows[0].state!=="ADMITTED")
      throw new SessionConflict("Only unassigned admitted sessions can end as idle");
    const open=await client.query(
      "SELECT 1 FROM work_assignments WHERE run_id=$1 AND released_at IS NULL LIMIT 1",
      [runId]
    );
    if(open.rowCount)throw new SessionConflict("Run has an assignment; use fenced completion");
    const lease=await client.query(
      "SELECT 1 FROM repository_leases WHERE run_id=$1 LIMIT 1",
      [runId]
    );
    if(lease.rowCount)throw new SessionConflict("Run still holds a lease; use fenced completion");
    const saved=await client.query(
      "UPDATE agent_runs SET state='YIELDED',ended_at=now(),last_seen_at=now() WHERE run_id=$1 AND state='ADMITTED'",
      [runId]
    );
    if(saved.rowCount!==1)throw new SessionConflict("Idle completion raced with assignment");
    await client.query(
      "INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.idle_completed','{}'::jsonb)",
      [runId]
    );
    await client.query("COMMIT");committed=true;
    return {state:"YIELDED",replay:false};
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
