import type {Pool} from "pg";
import {workSession} from "../domain/work-session.ts";
import {REPOSITORY_CONTINUATION_CLAIM_QUERY} from "./assignment.ts";
import {releaseAssignmentForContinuation} from "./continuation.ts";
import {finishIdleSession} from "./idle-session.ts";
import {finishRun,isValidGeneration,isValidRunId,SessionConflict,validateCheckpoint,type SessionOutcome} from "./sessions.ts";

export const SESSION_STOP_REASONS=["RUNTIME_LIMIT","RESOURCE_LIMIT","CAPABILITY_UNAVAILABLE","AUTHORITY_LOST"] as const;
export type SessionStop={reason:typeof SESSION_STOP_REASONS[number];evidence:string};
/** These are agent-reported hard limits, not independently verified platform facts. */
export function parseSessionStop(value:unknown):SessionStop|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new SessionConflict("Structured session stop required");
  const row=value as Record<string,unknown>;
  if(!SESSION_STOP_REASONS.includes(row.reason as SessionStop["reason"])||
    typeof row.evidence!=="string"||row.evidence.trim().length<12||row.evidence.length>1000)
    throw new SessionConflict("Record the observed activation-wide error or limit in sessionStop.reason and sessionStop.evidence");
  const result={reason:row.reason as SessionStop["reason"],evidence:row.evidence.trim()};
  validateCheckpoint({state:{sessionStop:result}});
  return result;
}

type CompletionContext={state:string;started_at:Date;max_seconds:number;assignment_id:string|null;unit_id:string|null;
  generation:string|null;live:boolean;paused:boolean;checkpoint_state:Record<string,unknown>|null};
async function completionContext(db:Pool,runId:string,credentialId:string):Promise<CompletionContext>{
  if(!isValidRunId(runId))throw new SessionConflict("Invalid run ID");
  const result=await db.query<CompletionContext>(`SELECT ar.state,ar.started_at,
    COALESCE(p.max_session_seconds,3300) AS max_seconds,a.assignment_id,a.unit_id,
    a.lease_generation::text AS generation,
    COALESCE(l.run_id=ar.run_id AND l.generation=a.lease_generation AND l.expires_at>now(),FALSE) AS live,
    EXISTS(SELECT 1 FROM execution_controls WHERE singleton=TRUE AND paused=TRUE) AS paused,
    (SELECT c.state FROM checkpoints c WHERE c.assignment_id=a.assignment_id AND c.unit_id=a.unit_id
      ORDER BY c.created_at DESC,c.checkpoint_id DESC LIMIT 1) AS checkpoint_state
    FROM agent_runs ar LEFT JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
    LEFT JOIN repository_leases l ON l.repository_id=a.repository_id
    LEFT JOIN repository_execution_policy p ON p.repository_id=a.repository_id
    WHERE ar.run_id=$1 AND ar.credential_id=$2`,[runId,credentialId]);
  if(result.rowCount!==1)throw new SessionConflict("Unknown or unauthorized run");
  return result.rows[0];
}
function continuing(state:"RUNNING"|"ADMITTED",context:CompletionContext,leaseReleased:boolean,nextAction:string){
  return {status:"CONTINUE_REQUIRED" as const,state,runEnded:false,leaseReleased,continuationRequired:true,
    workSession:workSession(context.started_at,context.max_seconds),nextAction};
}
async function recordStop(db:Pool,runId:string,stop:SessionStop){
  await db.query("INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.stop_reported',$2::jsonb)",
    [runId,JSON.stringify({...stop,evidenceSource:"AGENT_REPORTED"})]);
}

/** Native MCP completion cannot turn a project handoff into a terminal activation.
 * Release only the old lease; do not acquire a new one for an agent that may exit
 * despite CONTINUE_REQUIRED. The agent must acknowledge by claiming the same run.
 */
export async function finishScheduledRun(db:Pool,runId:string,credentialId:string,generation:string,outcome:SessionOutcome,stopInput?:unknown){
  if(!isValidGeneration(generation))throw new SessionConflict("Invalid generation");
  const context=await completionContext(db,runId,credentialId);
  if(context.state===outcome)return {...await finishRun(db,runId,credentialId,generation,outcome),runEnded:true,leaseReleased:true};
  if(context.state==="ADMITTED"){
    const released=await db.query("SELECT 1 FROM work_assignments WHERE run_id=$1 AND lease_generation=$2::bigint AND released_at IS NOT NULL",[runId,generation]);
    if(!released.rowCount)throw new SessionConflict("Stale or missing assignment");
    return finishScheduledIdle(db,runId,credentialId,stopInput);
  }
  if(context.state!=="RUNNING"||context.generation!==generation)throw new SessionConflict("Stale or missing assignment");
  const stop=parseSessionStop(stopInput??context.checkpoint_state?.sessionStop);
  if(stop||!workSession(context.started_at,context.max_seconds).shouldContinue||!context.live||context.paused){
    if(stop)await recordStop(db,runId,stop);
    return {...await finishRun(db,runId,credentialId,generation,outcome),runEnded:true,leaseReleased:true};
  }
  if(!context.checkpoint_state)return continuing("RUNNING",context,false,
    "The 50-minute work window remains open. Save a checkpoint for this unit and call boardroom_advance or boardroom_yield_and_claim. If checkpointing or execution is actually unavailable across the activation, report a structured sessionStop with the observed error; a failed checkpoint must not prevent safe release. Do not issue a final report.");
  await releaseAssignmentForContinuation(db,runId,credentialId,generation,
    outcome==="COMPLETED"||outcome==="BLOCKED"?outcome:"YIELDED");
  return finishScheduledIdle(db,runId,credentialId);
}

export async function finishScheduledIdle(db:Pool,runId:string,credentialId:string,stopInput?:unknown){
  const context=await completionContext(db,runId,credentialId);
  const stop=parseSessionStop(stopInput);
  if(context.state==="YIELDED")return {...await finishIdleSession(db,runId,credentialId),runEnded:true,leaseReleased:true};
  if(context.state!=="ADMITTED"||context.assignment_id)throw new SessionConflict("Only unassigned admitted sessions can end as idle");
  if(!stop&&!context.paused&&workSession(context.started_at,context.max_seconds).shouldContinue){
    const available=await db.query(REPOSITORY_CONTINUATION_CLAIM_QUERY,[runId]);
    if(available.rowCount){
      await db.query("INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.continuation_required','{}'::jsonb)",[runId]);
      return continuing("ADMITTED",context,true,
        "Your previous repository lease is released, but the activation is NOT finished. Eligible portfolio work remains within the original 50-minute window. Call boardroom_claim with this SAME runId, read the returned context and continue substantive implementation. ASSIGNMENT_REFRESH_PENDING is recoverable, not IDLE. Do not issue a final report. A real activation-wide hard limit requires sessionStop with exact observed evidence.");
    }
  }
  if(stop)await recordStop(db,runId,stop);
  return {...await finishIdleSession(db,runId,credentialId),runEnded:true,leaseReleased:true};
}
