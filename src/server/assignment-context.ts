import type {Pool} from "pg";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";
import {fetchRepositoryInstruction} from "./github-app.ts";
import {fetchRepositoryBranches} from "./repository-context.ts";

type CurrentAssignment={
  assignment_id:string;repository_id:string;full_name:string;unit_id:string;
  generation:string; expires_at:Date;
  title:string; state:string; version:number; depends_on:unknown;
  acceptance_criteria:string|null;planned_prs:unknown;source_metadata:unknown;external_dependencies:unknown;external_prerequisites:unknown;
  started_at:Date;max_session_seconds:number;max_tool_calls:number;max_tokens:number;
};
type Checkpoint={checkpoint_id:string;unit_id:string|null;branch:string|null;head_sha:string|null;state:unknown;created_at:Date};
type ApprovedUnit={unit_id:string;title:string;state:string;version:number;depends_on:unknown;planned_prs:unknown;acceptance_criteria:string|null};
type Discussion={thread_id:string;subject:string;status:string;updated_at:Date;messages:unknown};

export function validateAssignedContextRequest(runId:unknown,generation:unknown):assertsRun {
  if(!isValidRunId(runId)||!isValidGeneration(generation))
    throw new SessionConflict("Valid run ID and generation required");
}
type assertsRun=void;

function stringArray(value:unknown):string[]{
  return Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
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
  const item=current.rows[0];
  const [checkpoints,units,discussions,instructions,branchSnapshot]=await Promise.all([
    db.query<Checkpoint>(
      `SELECT checkpoint_id::text,unit_id,branch,head_sha,state,created_at
       FROM checkpoints WHERE repository_id=$1
       ORDER BY created_at DESC,checkpoint_id DESC LIMIT 25`,[item.repository_id]),
    db.query<ApprovedUnit>(
      `SELECT unit_id,title,state,version,depends_on,planned_prs,acceptance_criteria
       FROM roadmap_units WHERE repository_id=$1 AND approved=TRUE
       ORDER BY unit_id LIMIT 2001`,[item.repository_id]),
    db.query<Discussion>(`SELECT t.thread_id::text,t.subject,t.status,t.updated_at,
      COALESCE(json_agg(json_build_object('messageId',m.message_id,'kind',m.message_kind,'content',m.content,
        'evidence',m.evidence,'createdAt',m.created_at) ORDER BY m.created_at,m.message_id)
        FILTER(WHERE m.message_id IS NOT NULL),'[]'::json) AS messages
      FROM coffee_threads t LEFT JOIN coffee_messages m ON m.thread_id=t.thread_id
      WHERE t.repository_id=$1
      GROUP BY t.thread_id ORDER BY t.updated_at DESC LIMIT 50`,[item.repository_id]),
    fetchRepositoryInstruction(item.full_name,"AGENTS.md"),
    fetchRepositoryBranches(item.full_name)
  ]);
  if(units.rows.length>2000)throw new Error("Approved work-unit inventory exceeds supported context limit");
  const unitById=new Map(units.rows.map((unit)=>[unit.unit_id,unit]));
  const dependencyStatus=stringArray(item.depends_on).map((unitId)=>{
    const dependency=unitById.get(unitId);
    return {unitId,state:dependency?.state??"MISSING",approved:Boolean(dependency)};
  });
  const mappedUnits=units.rows.map((unit)=>({unitId:unit.unit_id,title:unit.title,state:unit.state,
    version:unit.version,dependsOn:stringArray(unit.depends_on),pullRequests:unit.planned_prs,
    acceptanceCriteria:unit.acceptance_criteria}));
  const mappedCheckpoints=checkpoints.rows.map((checkpoint)=>({checkpointId:checkpoint.checkpoint_id,
    unitId:checkpoint.unit_id,branch:checkpoint.branch,headSha:checkpoint.head_sha,state:checkpoint.state,
    createdAt:checkpoint.created_at.toISOString()}));
  const mappedDiscussions=discussions.rows.map((thread)=>({threadId:thread.thread_id,subject:thread.subject,
    status:thread.status,updatedAt:thread.updated_at.toISOString(),messages:thread.messages}));
  return {
    assignment:{assignmentId:item.assignment_id,repositoryId:item.repository_id,
      repository:item.full_name,unitId:item.unit_id,generation:item.generation,
      expiresAt:item.expires_at.toISOString()},
    workUnit:{title:item.title,state:item.state,version:item.version,
      dependsOn:item.depends_on,acceptanceCriteria:item.acceptance_criteria,
      pullRequests:item.planned_prs,externalDependencies:item.external_dependencies,
      externalPrerequisites:item.external_prerequisites,source:item.source_metadata},
    dependencyStatus,
    approvedUnits:mappedUnits,
    checkpoint:mappedCheckpoints[0]??null,
    recentCheckpoints:mappedCheckpoints,
    repositoryBranches:branchSnapshot.branches,
    repositoryBranchesLimited:branchSnapshot.limited,
    repositoryInstructions:instructions,
    executionLimits:{maxSessionSeconds:item.max_session_seconds,maxToolCalls:item.max_tool_calls,maxTokens:item.max_tokens,
      deadlineAt:new Date(item.started_at.getTime()+item.max_session_seconds*1000).toISOString()},
    technicalQuestions:mappedDiscussions.filter((thread)=>thread.status==="OPEN"),
    decisionHistory:mappedDiscussions.filter((thread)=>thread.status!=="OPEN"),
    contextLimits:{approvedUnits:2000,recentCheckpoints:25,discussionThreads:50,branches:100},
    instructionsAreUntrustedRepositoryContent:true
  };
}
