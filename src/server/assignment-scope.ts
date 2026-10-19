import type {Pool,PoolClient} from "pg";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";

export type AssignmentScope={repository_id:string;full_name:string;unit_id:string;title:string;assignment_id:string};
export async function assignedScope(db:Pool|PoolClient,runId:string,credentialId:string,generation:string,lock=false):Promise<AssignmentScope>{
  if(!isValidRunId(runId)||!isValidGeneration(generation))throw new SessionConflict("Invalid session identity");
  const result=await db.query<AssignmentScope>(
    `SELECT r.repository_id::text,r.full_name,w.unit_id,w.title,a.assignment_id::text
     FROM agent_runs ar JOIN agent_credentials c ON c.credential_id=ar.credential_id
     JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
     JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id AND l.generation=a.lease_generation
     JOIN repositories r ON r.repository_id=a.repository_id
     JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
     LEFT JOIN repository_execution_policy policy ON policy.repository_id=r.repository_id
     WHERE ar.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
       AND c.enabled=TRUE AND c.revoked_at IS NULL AND a.lease_generation=$3::bigint
       AND l.expires_at>now() AND r.enabled=TRUE AND r.archived=FALSE AND w.approved=TRUE
       AND ar.started_at>now()-make_interval(secs=>COALESCE(policy.max_session_seconds,3300))
     ${lock?"FOR UPDATE OF l":""}`,[runId,credentialId,generation]);
  if(result.rowCount!==1)throw new SessionConflict("Current authorized repository lease unavailable");
  return result.rows[0];
}
export function repositoryApiPath(name:string):string{
  const parts=name.split("/");
  if(parts.length!==2||parts.some(p=>!/^[a-zA-Z0-9_.-]{1,100}$/.test(p)))throw new SessionConflict("Invalid registered repository");
  return "/repos/"+parts.map(encodeURIComponent).join("/");
}
