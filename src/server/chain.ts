import type {Pool} from "pg";
import {assignedScope} from "./assignment-scope.ts";
import {SessionConflict} from "./sessions.ts";

/** Advance within the current repository. Never release the repo between PRs. */
export async function advanceAssignedWork(db:Pool,runId:string,credentialId:string,generation:string){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT run_id FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",[runId,credentialId]);
    const scope=await assignedScope(client,runId,credentialId,generation,true);
    const controls=await client.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
    if(controls.rows[0]?.paused)throw new SessionConflict("Owner paused execution");
    const current=await client.query<{state:string}>("SELECT state FROM roadmap_units WHERE repository_id=$1 AND unit_id=$2",[scope.repository_id,scope.unit_id]);
    if(!["MERGED","ACCEPTED"].includes(current.rows[0]?.state))throw new SessionConflict("Current unit needs observed merge evidence before chaining");
    const next=await client.query<{unit_id:string}>(`SELECT w.unit_id FROM roadmap_units w
      WHERE w.repository_id=$1 AND w.unit_id<>$2 AND w.approved=TRUE AND registry_prerequisites_satisfied(w.repository_id,w.unit_id) AND w.state IN ('PENDING','ACTIVE','OPEN_PR','BLOCKED')
      AND (w.state<>'BLOCKED' OR EXISTS(SELECT 1 FROM coffee_threads t JOIN coffee_messages m ON m.thread_id=t.thread_id
        WHERE t.repository_id=w.repository_id AND t.unit_id=w.unit_id AND t.status='ANSWERED' AND m.message_kind='ANSWER' AND jsonb_array_length(m.evidence)>0))
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
      [runId,scope.repository_id,JSON.stringify({from:scope.unit_id,to:id,generation})]);
    await client.query("COMMIT");return {status:"NEXT_UNIT",repository:scope.full_name,unitId:id,generation};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
