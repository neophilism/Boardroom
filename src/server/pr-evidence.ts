import type {Pool} from "pg";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {safeWorkBranch} from "./github-write-gateway.ts";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";

export type CheckRun={id:number;name:string;status:string;conclusion:string|null;html_url?:string};
export type LegacyStatus={context:string;state:string;target_url?:string};
export type CheckAssessment="OBSERVED_PASS"|"FAILED"|"PENDING"|"REVIEW"|"NO_CHECKS"|"INCOMPLETE";

export function assessObservedChecks(checks:readonly CheckRun[],total:number,
  legacy:readonly LegacyStatus[]):CheckAssessment{
  if(!Number.isSafeInteger(total)||total<0||total!==checks.length)return "INCOMPLETE";
  if(checks.length===0&&legacy.length===0)return "NO_CHECKS";
  if(checks.some(c=>["failure","cancelled","timed_out","startup_failure","action_required"].includes(c.conclusion??""))||
     legacy.some(s=>["failure","error"].includes(s.state)))return "FAILED";
  if(checks.some(c=>c.status!=="completed"||c.conclusion===null)||
     legacy.some(s=>s.state==="pending"))return "PENDING";
  if(checks.some(c=>c.conclusion!=="success")||legacy.some(s=>s.state!=="success"))
    return "REVIEW";
  return "OBSERVED_PASS";
}

type Scope={repository_id:string;full_name:string;unit_id:string};
export async function readAssignedPrEvidence(db:Pool,runId:string,credentialId:string,
  generation:string,prNumber:number){
  if(!isValidRunId(runId)||!isValidGeneration(generation)||
     !Number.isSafeInteger(prNumber)||prNumber<=0)
    throw new SessionConflict("Invalid run, lease generation, or PR number");
  const q=await db.query<Scope>(
    "SELECT r.repository_id::text,r.full_name,a.unit_id FROM agent_runs ar " +
    "JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL " +
    "JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id " +
    "AND l.generation=a.lease_generation " +
    "JOIN repositories r ON r.repository_id=a.repository_id " +
    "JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id " +
    "WHERE ar.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING' " +
    "AND a.lease_generation=$3::bigint AND l.expires_at>now() AND w.approved=TRUE LIMIT 1",
    [runId,credentialId,generation]
  );
  if(q.rowCount!==1)throw new SessionConflict("Current authorized repository lease unavailable");
  const scope=q.rows[0];
  const parts=scope.full_name.split("/");
  if(parts.length!==2||parts.some(x=>!/^[a-zA-Z0-9_.-]+$/.test(x)))
    throw new Error("Invalid registered repository identity");
  const url="/repos/"+parts.map(encodeURIComponent).join("/");
  const pr=await githubAppRequest("GET",url+"/pulls/"+prNumber) as {
    number:number;html_url:string;state:string;draft:boolean;merged_at:string|null;
    head?:{sha?:string;ref?:string;repo?:{id?:number}};
  };
  if(!pr.head||pr.head.ref!==safeWorkBranch(scope.unit_id)||
     !/^[a-f0-9]{40}$/i.test(pr.head.sha??"")||
     String(pr.head.repo?.id)!==scope.repository_id)
    throw new SessionConflict("PR is not associated with the assigned repository work branch");
  const sha=pr.head.sha as string;
  const checked=await githubAppRequest("GET",
    url+"/commits/"+sha+"/check-runs?per_page=100") as
    {total_count:number;check_runs:CheckRun[]};
  if(!Array.isArray(checked.check_runs))throw new GitHubAppError(503);
  const legacy=await githubAppRequest("GET",url+"/commits/"+sha+"/status") as {
    statuses?:LegacyStatus[];
  };
  const contexts=Array.isArray(legacy.statuses)?legacy.statuses:[];
  const assessment=assessObservedChecks(checked.check_runs,checked.total_count,contexts);
  return {
    repository:scope.full_name,unitId:scope.unit_id,
    pullRequest:{number:pr.number,url:pr.html_url,draft:pr.draft,state:pr.state,
      mergedAt:pr.merged_at,headSha:sha},
    checks:{assessment,total:checked.total_count,
      runs:checked.check_runs.map(c=>({name:c.name,status:c.status,conclusion:c.conclusion,url:c.html_url??null})),
      legacyStatuses:contexts.map(c=>({context:c.context,state:c.state,url:c.target_url??null}))},
    requiredBranchProtectionVerified:false,reviewApprovalVerified:false,
    safeToAutoMerge:false,
    observedFrom:"GitHub App API"
  };
}
