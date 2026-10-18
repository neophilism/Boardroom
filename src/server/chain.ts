import type {Pool} from "pg";
import {assignedScope} from "./assignment-scope.ts";
import {SessionConflict} from "./sessions.ts";
import {TECHNICAL_RECOVERY_ELIGIBLE_SQL} from "./work-recovery.ts";
import {fetchCanonicalRoadmap,fetchPullRequests} from "./github-app.ts";
import {normalizeRoadmap} from "./roadmap-import.ts";
import {evaluateChainMergeEvidence,type CurrentChainUnit} from "./chain-evidence.ts";

/** Advance within the current repository. Never release the repo between PRs. */
export async function advanceAssignedWork(db:Pool,runId:string,credentialId:string,generation:string){
  const initial=await assignedScope(db,runId,credentialId,generation);
  // Completed local units already have authoritative recorded evidence. Avoid
  // unnecessary network traffic and preserve offline database/test semantics.
  const before=await db.query<{state:string;approved:boolean}>(
    "SELECT state,approved FROM roadmap_units WHERE repository_id=$1 AND unit_id=$2",
    [initial.repository_id,initial.unit_id]);
  if(!before.rows[0]?.approved)throw new SessionConflict("Work unit is no longer approved");
  let observed:ReturnType<typeof normalizeRoadmap>|null=null;
  if(!["MERGED","ACCEPTED"].includes(before.rows[0].state)){
    try{
      const [raw,pulls]=await Promise.all([fetchCanonicalRoadmap(initial.full_name),fetchPullRequests(initial.full_name)]);
      observed=normalizeRoadmap(raw,initial.full_name,pulls);
    }catch{throw new SessionConflict("Current GitHub merge evidence unavailable; retry reconciliation");}
  }
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT run_id FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",[runId,credentialId]);
    const scope=await assignedScope(client,runId,credentialId,generation,true);
    const controls=await client.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
    if(controls.rows[0]?.paused)throw new SessionConflict("Owner paused execution");
    if(scope.repository_id!==initial.repository_id||scope.unit_id!==initial.unit_id||scope.full_name!==initial.full_name)
      throw new SessionConflict("Assignment changed during GitHub reconciliation");
    const current=await client.query<CurrentChainUnit & {approved:boolean}>(
      "SELECT state,version,title,acceptance_criteria,depends_on,external_dependencies,external_prerequisites,approved FROM roadmap_units WHERE repository_id=$1 AND unit_id=$2 FOR UPDATE",
      [scope.repository_id,scope.unit_id]);
    if(!current.rows[0]?.approved)throw new SessionConflict("Work unit is no longer approved");
    if(observed){
      let evidence;
      try{evidence=evaluateChainMergeEvidence(observed,scope.unit_id,current.rows[0]);}
      catch{throw new SessionConflict("Verified work plan changed or merge evidence is ambiguous; resynchronize before chaining");}
      if(!evidence.canAdvance)throw new SessionConflict("Current unit needs observed merge evidence before chaining: "+evidence.reason);
      await client.query("UPDATE roadmap_units SET state=$3,planned_prs=$4::jsonb,source_observed_at=now() WHERE repository_id=$1 AND unit_id=$2",
        [scope.repository_id,scope.unit_id,evidence.nextState,JSON.stringify(evidence.pullRequests)]);
      await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.work.merge_reconciled',$3::jsonb)",
        [runId,scope.repository_id,JSON.stringify({unitId:scope.unit_id,generation,reason:evidence.reason,observedStatus:evidence.observedStatus,
          nextState:evidence.nextState,pullRequests:evidence.pullRequests})]);
    }else if(!["MERGED","ACCEPTED"].includes(current.rows[0].state)){
      throw new SessionConflict("Current unit needs observed merge evidence before chaining; retry reconciliation");
    }
    const next=await client.query<{unit_id:string;unit_state:string}>(`SELECT w.unit_id,w.state AS unit_state FROM roadmap_units w
      WHERE w.repository_id=$1 AND w.unit_id<>$2 AND w.approved=TRUE AND registry_prerequisites_satisfied(w.repository_id,w.unit_id) AND w.state IN ('PENDING','ACTIVE','OPEN_PR','BLOCKED')
      AND ${TECHNICAL_RECOVERY_ELIGIBLE_SQL}
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(w.depends_on) d(id)
        LEFT JOIN roadmap_units p ON p.repository_id=w.repository_id AND p.unit_id=d.id WHERE p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED'))
      AND NOT EXISTS(SELECT 1 FROM owner_action_dependents d JOIN owner_actions a ON a.action_id=d.action_id
        WHERE d.repository_id=w.repository_id AND (d.unit_id IS NULL OR d.unit_id=w.unit_id) AND a.status NOT IN ('VERIFIED','CANCELLED'))
      AND NOT EXISTS(SELECT 1 FROM compatibility_dependencies d LEFT JOIN roadmap_units p ON p.repository_id=d.prerequisite_repository_id AND p.unit_id=d.prerequisite_unit_id
        WHERE d.repository_id=w.repository_id AND d.unit_id=w.unit_id AND (p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED')))
      ORDER BY CASE WHEN w.state IN ('ACTIVE','OPEN_PR') THEN 0 ELSE 1 END,w.unit_id LIMIT 1`,[scope.repository_id,scope.unit_id]);
    if(!next.rowCount){await client.query("COMMIT");return {status:"EXHAUSTED",repository:scope.full_name};}
    const id=next.rows[0].unit_id;
    await client.query("UPDATE work_assignments SET unit_id=$1 WHERE assignment_id=$2",[id,scope.assignment_id]);
    await client.query("UPDATE roadmap_units SET state='ACTIVE' WHERE repository_id=$1 AND unit_id=$2 AND state='PENDING'",[scope.repository_id,id]);
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.work.advanced',$3::jsonb)",
      [runId,scope.repository_id,JSON.stringify({from:scope.unit_id,to:id,generation,unitState:next.rows[0].unit_state,
        eligibilityReason:next.rows[0].unit_state==="BLOCKED"?"TECHNICAL_ANSWER_AVAILABLE":"APPROVED_PREREQUISITES_READY"})]);
    await client.query("COMMIT");return {status:"NEXT_UNIT",repository:scope.full_name,unitId:id,generation};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
