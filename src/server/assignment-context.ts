import type {Pool} from "pg";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";
import {fetchRepositoryInstruction,githubAppRequest} from "./github-app.ts";

type CurrentAssignment={
  assignment_id:string;repository_id:string;full_name:string;unit_id:string;
  generation:string; expires_at:Date;
  title:string; state:string; version:number; depends_on:unknown;
  acceptance_criteria:string|null;planned_prs:unknown;source_metadata:unknown;external_dependencies:unknown;external_prerequisites:unknown;
  started_at:Date;max_session_seconds:number;max_tool_calls:number;max_tokens:number;
};
type Checkpoint={branch:string|null;head_sha:string|null;state:unknown;created_at:Date};
type ApprovedUnit={
  unit_id:string;title:string;state:string;version:number;depends_on:unknown;acceptance_criteria:string|null;planned_prs:unknown;
  local_unmet:unknown;external_unmet:unknown;owner_blockers:number;
};

export function validateAssignedContextRequest(runId:unknown,generation:unknown):assertsRun {
  if(!isValidRunId(runId)||!isValidGeneration(generation))
    throw new SessionConflict("Valid run ID and generation required");
}
type assertsRun=void;

export function normalizeRepositoryBranches(value:unknown){
  if(!Array.isArray(value))throw new Error("Invalid GitHub branch response");
  const branches=value.slice(0,100).map(item=>{
    if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Invalid GitHub branch record");
    const row=item as Record<string,unknown>,commit=row.commit;
    if(typeof row.name!=="string"||row.name.length<1||row.name.length>255||!commit||typeof commit!=="object"||Array.isArray(commit)||
        typeof (commit as Record<string,unknown>).sha!=="string"||!/^[a-f0-9]{40}$/i.test(String((commit as Record<string,unknown>).sha)))
      throw new Error("Invalid GitHub branch record");
    return {name:row.name,headSha:String((commit as Record<string,unknown>).sha),protected:row.protected===true};
  });
  return {branches,truncated:value.length>100};
}

export function normalizeRepositoryDecision(repository:string,value:{unitId:string|null;adr:string|null;occurredAt:Date}){
  if(!value.adr||!value.unitId||!/^[A-Za-z0-9][A-Za-z0-9._/-]{1,127}$/.test(value.unitId)||
      value.unitId.split("/").some(part=>!part||part==="."||part==="..")||!Number.isFinite(value.occurredAt.getTime()))return null;
  try{
    const url=new URL(value.adr),parts=url.pathname.split("/").filter(Boolean);
    if(url.origin!=="https://github.com"||url.username||url.password||url.search||url.hash||parts.slice(0,2).join("/").toLowerCase()!==repository.toLowerCase()||
        parts[2]!=="blob"||!/^[a-f0-9]{40}$/i.test(parts[3]??"")||
        !/^docs\/(?:decisions|adr)\/[A-Za-z0-9._/-]+\.md$/.test(parts.slice(4).map(decodeURIComponent).join("/")))return null;
    return {unitId:value.unitId,adr:value.adr,acceptedAt:value.occurredAt.toISOString()};
  }catch{return null;}
}

/** All context reads are fenced by the current live lease, run, and credential. */
export async function getAssignmentContext(db:Pool,runId:string,credentialId:string,generation:string){
  validateAssignedContextRequest(runId,generation);
  const current=await db.query<CurrentAssignment>(
    `SELECT a.assignment_id::text, a.repository_id::text,r.full_name,a.unit_id,
       a.lease_generation::text AS generation,l.expires_at,
       w.title,w.state,w.version,w.depends_on,w.acceptance_criteria,w.planned_prs,w.source_metadata,w.external_dependencies,w.external_prerequisites,ar.started_at,
       COALESCE(policy.max_session_seconds,1800) AS max_session_seconds,
       COALESCE(policy.max_tool_calls,100) AS max_tool_calls,COALESCE(policy.max_tokens,100000) AS max_tokens
     FROM work_assignments a
     JOIN agent_runs ar ON ar.run_id=a.run_id
     JOIN repository_leases l ON l.repository_id=a.repository_id
       AND l.run_id=a.run_id AND l.generation=a.lease_generation
     JOIN repositories r ON r.repository_id=a.repository_id
     JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
     LEFT JOIN repository_execution_policy policy ON policy.repository_id=a.repository_id
     WHERE a.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
       AND a.lease_generation=$3::bigint AND a.released_at IS NULL
       AND l.expires_at>now() AND w.approved=TRUE
     LIMIT 1`,
    [runId,credentialId,generation]
  );
  if(current.rowCount!==1)throw new SessionConflict("Current authorized assignment or lease unavailable");
  const item=current.rows[0],api="/repos/"+item.full_name.split("/").map(encodeURIComponent).join("/");
  const [checkpoint,instructions,discussions,units,decisions,repository,branchResponse]=await Promise.all([
    db.query<Checkpoint>(`SELECT branch,head_sha,state,created_at FROM checkpoints WHERE repository_id=$1 AND unit_id=$2 ORDER BY created_at DESC,checkpoint_id DESC LIMIT 1`,[item.repository_id,item.unit_id]),
    fetchRepositoryInstruction(item.full_name,"AGENTS.md"),
    db.query(`SELECT t.thread_id,t.subject,t.status,
      COALESCE(json_agg(json_build_object('messageId',m.message_id,'kind',m.message_kind,'content',m.content,'evidence',m.evidence) ORDER BY m.created_at,m.message_id) FILTER(WHERE m.message_id IS NOT NULL),'[]'::json) AS messages
      FROM coffee_threads t LEFT JOIN coffee_messages m ON m.thread_id=t.thread_id
      WHERE t.repository_id=$1 AND t.unit_id=$2 AND t.status IN ('OPEN','ANSWERED')
      GROUP BY t.thread_id ORDER BY t.updated_at DESC LIMIT 10`,[item.repository_id,item.unit_id]),
    db.query<ApprovedUnit>(`SELECT w.unit_id,w.title,w.state,w.version,w.depends_on,w.acceptance_criteria,w.planned_prs,
      COALESCE((SELECT json_agg(d.id ORDER BY d.id) FROM jsonb_array_elements_text(w.depends_on) d(id)
        LEFT JOIN roadmap_units p ON p.repository_id=w.repository_id AND p.unit_id=d.id
        WHERE p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED')),'[]'::json) AS local_unmet,
      COALESCE((SELECT json_agg(json_build_object('repositoryId',c.prerequisite_repository_id::text,'unitId',c.prerequisite_unit_id)
        ORDER BY c.prerequisite_repository_id,c.prerequisite_unit_id) FROM compatibility_dependencies c
        LEFT JOIN roadmap_units p ON p.repository_id=c.prerequisite_repository_id AND p.unit_id=c.prerequisite_unit_id
        WHERE c.repository_id=w.repository_id AND c.unit_id=w.unit_id
          AND (p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED'))),'[]'::json) AS external_unmet,
      (SELECT COUNT(*)::integer FROM owner_action_dependents d JOIN owner_actions a ON a.action_id=d.action_id
        WHERE d.repository_id=w.repository_id AND (d.unit_id IS NULL OR d.unit_id=w.unit_id)
          AND a.status NOT IN ('VERIFIED','CANCELLED')) AS owner_blockers
      FROM roadmap_units w WHERE w.repository_id=$1 AND w.approved=TRUE ORDER BY w.unit_id LIMIT 1000`,[item.repository_id]),
    db.query<{unitId:string|null;adr:string|null;occurredAt:Date}>(`SELECT details->>'unitId' AS "unitId",details->>'adr' AS adr,occurred_at AS "occurredAt"
      FROM audit_events WHERE repository_id=$1 AND kind='coffee.answer.accepted_in_adr'
      ORDER BY occurred_at DESC,event_id DESC LIMIT 100`,[item.repository_id]),
    githubAppRequest("GET",api),
    githubAppRequest("GET",api+"/branches?per_page=101")
  ]);
  const repo=repository as {default_branch?:unknown};
  if(typeof repo.default_branch!=="string"||repo.default_branch.length<1||repo.default_branch.length>255)
    throw new Error("Invalid GitHub repository context");
  const branches=normalizeRepositoryBranches(branchResponse);
  const approvedUnits=units.rows.map(unit=>({
    unitId:unit.unit_id,title:unit.title,state:unit.state,version:unit.version,dependsOn:unit.depends_on,
    acceptanceCriteria:unit.acceptance_criteria,pullRequests:unit.planned_prs,
    dependencyStatus:{localUnmet:unit.local_unmet,externalUnmet:unit.external_unmet,ownerBlockers:unit.owner_blockers,
      eligible:Array.isArray(unit.local_unmet)&&unit.local_unmet.length===0&&Array.isArray(unit.external_unmet)&&unit.external_unmet.length===0&&unit.owner_blockers===0}
  }));
  const approvedIds=new Set(approvedUnits.map(unit=>unit.unitId));
  return {
    assignment:{assignmentId:item.assignment_id,repositoryId:item.repository_id,
      repository:item.full_name,unitId:item.unit_id,generation:item.generation,
      expiresAt:item.expires_at.toISOString()},
    workUnit:{title:item.title,state:item.state,version:item.version,
      dependsOn:item.depends_on,acceptanceCriteria:item.acceptance_criteria,
      pullRequests:item.planned_prs,externalDependencies:item.external_dependencies,
      externalPrerequisites:item.external_prerequisites,source:item.source_metadata},
    approvedUnits,
    repositoryState:{defaultBranch:repo.default_branch,...branches},
    historicalDecisions:decisions.rows.map(row=>normalizeRepositoryDecision(item.full_name,row)).filter(x=>x!==null&&approvedIds.has(x.unitId)),
    checkpoint:checkpoint.rows.length?{
      branch:checkpoint.rows[0].branch,headSha:checkpoint.rows[0].head_sha,
      state:checkpoint.rows[0].state,createdAt:checkpoint.rows[0].created_at.toISOString()
    }:null,
    repositoryInstructions:instructions,
    executionLimits:{maxSessionSeconds:item.max_session_seconds,maxToolCalls:item.max_tool_calls,maxTokens:item.max_tokens,
      deadlineAt:new Date(item.started_at.getTime()+item.max_session_seconds*1000).toISOString()},
    technicalQuestions:discussions.rows,
    instructionsAreUntrustedRepositoryContent:true
  };
}
