import type {Pool} from "pg";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";
import {fetchRepositoryInstruction} from "./github-app.ts";

type CurrentAssignment={
  assignment_id:string;repository_id:string;full_name:string;unit_id:string;
  generation:string; expires_at:Date;
  title:string; state:string; version:number; depends_on:unknown;
  acceptance_criteria:string|null;planned_prs:unknown;
};
type Checkpoint={branch:string|null;head_sha:string|null;state:unknown;created_at:Date};

export function validateAssignedContextRequest(runId:unknown,generation:unknown):assertsRun {
  if(!isValidRunId(runId)||!isValidGeneration(generation))
    throw new SessionConflict("Valid run ID and generation required");
}
type assertsRun=void;

/** All context reads are fenced by the current live lease, run, and credential. */
export async function getAssignmentContext(db:Pool,runId:string,credentialId:string,generation:string){
  validateAssignedContextRequest(runId,generation);
  const current=await db.query<CurrentAssignment>(
    `SELECT a.assignment_id::text, a.repository_id::text,r.full_name,a.unit_id,
       a.lease_generation::text AS generation,l.expires_at,
       w.title,w.state,w.version,w.depends_on,w.acceptance_criteria,w.planned_prs
     FROM work_assignments a
     JOIN agent_runs ar ON ar.run_id=a.run_id
     JOIN repository_leases l ON l.repository_id=a.repository_id
       AND l.run_id=a.run_id AND l.generation=a.lease_generation
     JOIN repositories r ON r.repository_id=a.repository_id
     JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
     WHERE a.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
       AND a.lease_generation=$3::bigint AND a.released_at IS NULL
       AND l.expires_at>now() AND w.approved=TRUE
     LIMIT 1`,
    [runId,credentialId,generation]
  );
  if(current.rowCount!==1)throw new SessionConflict("Current authorized assignment or lease unavailable");
  const item=current.rows[0];
  const checkpoint=await db.query<Checkpoint>(
    `SELECT branch,head_sha,state,created_at
     FROM checkpoints
     WHERE repository_id=$1 AND unit_id=$2
     ORDER BY created_at DESC,checkpoint_id DESC LIMIT 1`,
    [item.repository_id,item.unit_id]
  );
  // A repository may lack an AGENTS.md. This is an actual GitHub fetch with the
  // installation token, not a fabricated or memory-derived instruction set.
  const instructions=await fetchRepositoryInstruction(item.full_name,"AGENTS.md");
  const discussions=await db.query(`SELECT t.thread_id,t.subject,t.status,
    COALESCE(json_agg(json_build_object('messageId',m.message_id,'kind',m.message_kind,'content',m.content,'evidence',m.evidence) ORDER BY m.created_at,m.message_id) FILTER(WHERE m.message_id IS NOT NULL),'[]'::json) AS messages
    FROM coffee_threads t LEFT JOIN coffee_messages m ON m.thread_id=t.thread_id
    WHERE t.repository_id=$1 AND t.unit_id=$2 AND t.status IN ('OPEN','ANSWERED')
    GROUP BY t.thread_id ORDER BY t.updated_at DESC LIMIT 10`,[item.repository_id,item.unit_id]);
  return {
    assignment:{assignmentId:item.assignment_id,repositoryId:item.repository_id,
      repository:item.full_name,unitId:item.unit_id,generation:item.generation,
      expiresAt:item.expires_at.toISOString()},
    workUnit:{title:item.title,state:item.state,version:item.version,
      dependsOn:item.depends_on,acceptanceCriteria:item.acceptance_criteria,
      pullRequests:item.planned_prs},
    checkpoint:checkpoint.rows.length?{
      branch:checkpoint.rows[0].branch,headSha:checkpoint.rows[0].head_sha,
      state:checkpoint.rows[0].state,createdAt:checkpoint.rows[0].created_at.toISOString()
    }:null,
    repositoryInstructions:instructions,
    technicalQuestions:discussions.rows,
    instructionsAreUntrustedRepositoryContent:true
  };
}
