import type {Pool} from "pg";
import {workSession} from "../domain/work-session.ts";
import {unitHandoffReport} from "../domain/unit-handoff.ts";
import {REPOSITORY_CONTINUATION_CLAIM_QUERY,claimAssignment} from "./assignment.ts";
import {releaseAssignmentForContinuation,yieldAndClaim} from "./continuation.ts";
import {advanceAssignedWork} from "./chain.ts";
import {createWorkContinuation} from "./next-work.ts";
import {readAssignedPrEvidence} from "./pr-evidence.ts";
import {assertWorkPrerequisites} from "./work-prerequisites.ts";
import {finishIdleSession} from "./idle-session.ts";
import {activationFinishBasis,finishRun,isValidGeneration,isValidRunId,SessionConflict,validateCheckpoint,type ActivationStop,type SessionOutcome} from "./sessions.ts";

export const SESSION_STOP_REASONS=["RUNTIME_LIMIT","RESOURCE_LIMIT","CAPABILITY_UNAVAILABLE","AUTHORITY_LOST"] as const;
export const EARLY_CANCELLATION_FALLBACK="If this activation genuinely must end while useful work remains and the current live tool connection is available, checkpoint truthfully and call boardroom_finish with outcome=CANCELLED on the same run and lease generation BEFORE a final response. This is incomplete early cancellation, not acceptance or evidence of a host limit. Do not cancel to avoid useful work, merge conflicts, pending CI or the 50-minute work target. If no more tool calls can be made, report runEnded=false and the lease as unverified for fenced recovery.";
export type SessionStop={reason:typeof SESSION_STOP_REASONS[number];evidence:string};
/** These are agent-reported hard limits, not independently verified platform facts. */
export function parseSessionStop(value:unknown):SessionStop|undefined{
  if(value===undefined)return undefined;
  if(!value||typeof value!=="object"||Array.isArray(value))throw new SessionConflict("Structured session stop required");
  const row=value as Record<string,unknown>;
  if(!SESSION_STOP_REASONS.includes(row.reason as SessionStop["reason"])||
    typeof row.evidence!=="string"||row.evidence.trim().length<20||row.evidence.length>1000)
    throw new SessionConflict("Record the observed activation-wide error or limit in sessionStop.reason and sessionStop.evidence");
  const result={reason:row.reason as SessionStop["reason"],evidence:row.evidence.trim()};
  validateCheckpoint({state:{sessionStop:result}});
  return result;
}

type CompletionContext={state:string;started_at:Date;max_seconds:number;assignment_id:string|null;unit_id:string|null;
  repository_id:string|null;unit_state:string|null;checkpoint_head:string|null;
  generation:string|null;live:boolean;expires_at:Date|null;paused:boolean;used_tokens:string;max_tokens:number;checkpoint_state:Record<string,unknown>|null};
async function completionContext(db:Pool,runId:string,credentialId:string):Promise<CompletionContext>{
  if(!isValidRunId(runId))throw new SessionConflict("Invalid run ID");
  const result=await db.query<CompletionContext>(`SELECT ar.state,ar.started_at,
    COALESCE(p.max_session_seconds,3300) AS max_seconds,a.assignment_id,a.unit_id,
    a.repository_id::text,w.state AS unit_state,
    (SELECT c.head_sha FROM checkpoints c WHERE c.assignment_id=a.assignment_id AND c.unit_id=a.unit_id
      ORDER BY c.created_at DESC,c.checkpoint_id DESC LIMIT 1) AS checkpoint_head,
    l.expires_at,COALESCE(p.max_tokens,100000) AS max_tokens,
    (SELECT COALESCE(SUM(input_tokens+output_tokens),0)::text FROM usage_events WHERE run_id=ar.run_id) AS used_tokens,
    a.lease_generation::text AS generation,
    COALESCE(l.run_id=ar.run_id AND l.generation=a.lease_generation AND l.expires_at>now(),FALSE) AS live,
    EXISTS(SELECT 1 FROM execution_controls WHERE singleton=TRUE AND paused=TRUE) AS paused,
    (SELECT c.state FROM checkpoints c WHERE c.assignment_id=a.assignment_id AND c.unit_id=a.unit_id
      ORDER BY c.created_at DESC,c.checkpoint_id DESC LIMIT 1) AS checkpoint_state
    FROM agent_runs ar LEFT JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
    LEFT JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
    LEFT JOIN repository_leases l ON l.repository_id=a.repository_id
    LEFT JOIN repository_execution_policy p ON p.repository_id=a.repository_id
    WHERE ar.run_id=$1 AND ar.credential_id=$2`,[runId,credentialId]);
  if(result.rowCount!==1)throw new SessionConflict("Unknown or unauthorized run");
  return result.rows[0];
}
function continuing(state:"RUNNING"|"ADMITTED",context:CompletionContext,leaseReleased:boolean,nextAction:string){
  return {status:"CONTINUE_REQUIRED" as const,state,runEnded:false,leaseReleased,continuationRequired:true,
    workSession:workSession(context.started_at,context.max_seconds),
    nextAction:state==="RUNNING"?nextAction+" "+EARLY_CANCELLATION_FALLBACK:nextAction};
}
async function recordStop(db:Pool,runId:string,stop:SessionStop){
  await db.query("INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.stop_reported',$2::jsonb)",
    [runId,JSON.stringify({...stop,evidenceSource:"AGENT_REPORTED"})]);
}

const currentUnitMessage="Continue the current approved unit: a partial draft and unfinished implementation are not handoff reasons";
/** Require a specific reason to leave a unit. No network observation or agent
 * report grants new write/merge authority; all lease gates still run afterward. */
export async function requireScheduledHandoff(db:Pool,runId:string,credentialId:string,generation:string,
  readEvidence:typeof readAssignedPrEvidence=readAssignedPrEvidence){
  const context=await completionContext(db,runId,credentialId);
  if(context.state!=="RUNNING"||context.generation!==generation||!context.live)
    throw new SessionConflict("Current authorized repository lease unavailable");
  if(context.unit_state==="MERGED"||context.unit_state==="ACCEPTED")return;
  try{await assertWorkPrerequisites(db,context.repository_id!,context.unit_id!);}
  catch(error){
    if(error instanceof SessionConflict&&[
      "Registry external prerequisite unresolved","Approved work-unit prerequisite unresolved",
      "Cross-repository compatibility prerequisite unresolved","Owner action prerequisite unresolved",
      "Technical question prerequisite unresolved or retry evidence consumed"].includes(error.message))return;
    throw error;
  }
  const report=unitHandoffReport(context.checkpoint_state?.unitHandoff);
  if(!report)throw new SessionConflict(currentUnitMessage);
  validateCheckpoint({state:{unitHandoff:report}});
  if(report.reason==="IMPLEMENTATION_COMPLETE_WAITING_CI"){
    const evidence=await readEvidence(db,runId,credentialId,generation,report.prNumber);
    if(evidence.pullRequest.relationship!=="ASSIGNED_WORK"||evidence.pullRequest.headSha!==context.checkpoint_head||
      !["PENDING","NO_CHECKS"].includes(evidence.checks.assessment))
      throw new SessionConflict(currentUnitMessage+"; reconcile current-head CI, fix failing checks or merge when authorized");
  }
  await db.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.unit.handoff_basis',$3::jsonb)",
    [runId,context.repository_id,JSON.stringify({unitId:context.unit_id,generation,report,evidenceSource:"AGENT_REPORTED",currentHeadCiChecked:report.reason==="IMPLEMENTATION_COMPLETE_WAITING_CI"})]);
}

export async function yieldScheduledWork(db:Pool,runId:string,credentialId:string,generation:string,outcome:"BLOCKED"|"YIELDED"|"COMPLETED"){
  const replay=await reconcileScheduledHandoff(db,runId,credentialId,generation);
  if(replay)return replay;
  await requireScheduledHandoff(db,runId,credentialId,generation);
  return yieldAndClaim(db,runId,credentialId,generation,outcome);
}
const advanceCurrentScheduledWork=createWorkContinuation({advance:advanceAssignedWork,handoff:yieldScheduledWork});
export async function advanceScheduledWork(db:Pool,runId:string,credentialId:string,generation:string){
  const replay=await reconcileScheduledHandoff(db,runId,credentialId,generation);
  return replay??advanceCurrentScheduledWork(db,runId,credentialId,generation);
}
/** Release may have committed before the next claim failed. ADMITTED has no
 * current repository lease; reconcile this run instead of demanding old authority. */
async function reconcileScheduledHandoff(db:Pool,runId:string,credentialId:string,generation:string){
  if(!isValidGeneration(generation))throw new SessionConflict("Invalid generation");
  const context=await completionContext(db,runId,credentialId);
  if(context.state!=="ADMITTED"&&!(context.state==="RUNNING"&&context.generation!==generation))return null;
  const prior=await db.query("SELECT 1 FROM work_assignments WHERE run_id=$1 AND lease_generation=$2::bigint AND released_at IS NOT NULL",[runId,generation]);
  if(!prior.rowCount)throw new SessionConflict("Stale or missing assignment");
  const assignment=await claimAssignment(db,runId,credentialId);
  return assignment?{status:"ASSIGNED" as const,assignment,reconciled:true,continuationRequired:true,
    nextAction:"Read the returned assignment context and continue the SAME run. Never use the released generation."}:
    {status:"IDLE" as const,assignment:null,reconciled:true,continuationRequired:false,
      nextAction:"No unattempted eligible work remains; make a bounded Coffee pass and finish_idle."};
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
  const basis=activationFinishBasis(outcome,{startedAt:context.started_at,now:new Date(),maxSessionSeconds:context.max_seconds,
    leaseExpiresAt:context.expires_at??new Date(0),paused:context.paused,usedTokens:Number(context.used_tokens),
    maxTokens:context.max_tokens,checkpointState:context.checkpoint_state});
  if(stop||basis||!context.live){
    if(stop)await recordStop(db,runId,stop);
    const translated:ActivationStop|undefined=stop?{reason:stop.reason==="CAPABILITY_UNAVAILABLE"?"SESSION_TOOLS_UNAVAILABLE":
      stop.reason==="AUTHORITY_LOST"?"AUTHORITY_UNAVAILABLE":stop.reason,detail:stop.evidence}:undefined;
    return {...await finishRun(db,runId,credentialId,generation,outcome,translated),runEnded:true,leaseReleased:true};
  }
  if(!context.checkpoint_state)return continuing("RUNNING",context,false,
    "The 50-minute work window remains open. Save a checkpoint for this unit and call boardroom_advance or boardroom_yield_and_claim. If checkpointing or execution is actually unavailable across the activation, report a structured sessionStop with the observed error; a failed checkpoint must not prevent safe release. Do not issue a final report.");
  try{await requireScheduledHandoff(db,runId,credentialId,generation);}
  catch(error){
    if(error instanceof SessionConflict&&error.message.startsWith(currentUnitMessage))
      return continuing("RUNNING",context,false,error.message+". Keep implementing, testing and updating the same PR. Record unitHandoff only for implementation-complete current-head CI or a concrete external blocker after all unblocked work is done. Do not issue a final report.");
    throw error;
  }
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
