import type {PoolClient} from "pg";
import {assignedScope} from "./assignment-scope.ts";

/** Called inside the assignment/advance transaction. Rollback removes both. */
export async function queueAssignmentDispatch(db:PoolClient,assignmentId:string,unitId:string){
  await db.query(`INSERT INTO operation_outbox(idempotency_key,operation_type,payload)
    VALUES($1,'assignment_ready',$2::jsonb) ON CONFLICT DO NOTHING`,
    ["assignment:"+assignmentId+":"+unitId,JSON.stringify({assignmentId,unitId})]);
}

/** A durable PostgreSQL inbox, not an external-provider launcher or work grant.
 * The current lease must still authorize delivery. Duplicate dispatch is harmless.
 */
export async function deliverAssignmentDispatch(db:PoolClient,outboxId:string,payload:Record<string,unknown>){
  if(typeof payload.assignmentId!=="string"||!/^[a-f0-9-]{36}$/i.test(payload.assignmentId)||
    typeof payload.unitId!=="string"||payload.unitId.length<1||payload.unitId.length>128)
    throw new Error("Invalid assignment notification");
  // Match lock order with claim/finish; this receipt never extends the lease.
  await db.query(`SELECT l.repository_id FROM repository_leases l JOIN work_assignments a
    ON a.repository_id=l.repository_id AND a.run_id=l.run_id AND a.lease_generation=l.generation
    WHERE a.assignment_id=$1 FOR UPDATE OF l`,[payload.assignmentId]);
  const inserted=await db.query(`INSERT INTO assignment_dispatches(assignment_id,unit_id,outbox_id)
    SELECT a.assignment_id,a.unit_id,$3::uuid FROM work_assignments a
    JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id AND l.generation=a.lease_generation
    JOIN agent_runs ar ON ar.run_id=a.run_id JOIN agent_credentials c ON c.credential_id=ar.credential_id
    JOIN repositories r ON r.repository_id=a.repository_id
    JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
    WHERE a.assignment_id=$1 AND a.unit_id=$2 AND a.released_at IS NULL AND l.expires_at>now()
      AND ar.state='RUNNING' AND c.enabled=TRUE AND c.revoked_at IS NULL
      AND r.enabled=TRUE AND r.archived=FALSE AND w.approved=TRUE
    ON CONFLICT DO NOTHING RETURNING assignment_id`,[payload.assignmentId,payload.unitId,outboxId]);
  return inserted.rowCount===1;
}

/** The existing context consumer can drain its own notification immediately,
 * without waiting for maintenance. Authority is independently revalidated.
 */
export async function receiveAssignmentDispatch(db:PoolClient,runId:string,credentialId:string,generation:string){
  const scope=await assignedScope(db,runId,credentialId,generation,true);
  const queued=await db.query<{outbox_id:string;payload:Record<string,unknown>}>(`SELECT outbox_id,payload FROM operation_outbox
    WHERE idempotency_key=$1 AND operation_type='assignment_ready'`,["assignment:"+scope.assignment_id+":"+scope.unit_id]);
  if(!queued.rows[0])return null; // Older assignments may predate this migration.
  const item=queued.rows[0];
  await deliverAssignmentDispatch(db,item.outbox_id,item.payload);
  await db.query("UPDATE assignment_dispatches SET received_at=COALESCE(received_at,now()) WHERE assignment_id=$1 AND unit_id=$2",[scope.assignment_id,scope.unit_id]);
  await db.query("UPDATE operation_outbox SET state='DONE',completed_at=COALESCE(completed_at,now()),claim_token=NULL,claimed_at=NULL,last_error_code=NULL WHERE outbox_id=$1",[item.outbox_id]);
  return {outboxId:item.outbox_id,received:true};
}
