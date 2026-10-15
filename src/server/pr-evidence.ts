import type {Pool} from "pg";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {safeWorkBranch} from "./github-write-gateway.ts";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";

export type CheckRun={
  id:number;name:string;status:string;conclusion:string|null;html_url?:string;
  started_at?:string|null;completed_at?:string|null
};
export type CheckSuite={
  id:number;status:string;conclusion:string|null;url?:string;
  app?:{name?:string|null}|null
};
export type LegacyStatus={
  context:string;state:string;target_url?:string;created_at?:string;updated_at?:string
};
export type CheckAssessment="OBSERVED_PASS"|"FAILED"|"PENDING"|"REVIEW"|"NO_CHECKS"|"INCOMPLETE";
const failedConclusions=["failure","cancelled","timed_out","startup_failure","action_required"];

export function assessObservedChecks(checks:readonly CheckRun[],total:number,
  legacy:readonly LegacyStatus[],suites:readonly CheckSuite[]=[],
  suiteTotal=suites.length):CheckAssessment{
  if(!Number.isSafeInteger(total)||total<0||total!==checks.length||
     !Number.isSafeInteger(suiteTotal)||suiteTotal<0||suiteTotal!==suites.length)
    return "INCOMPLETE";
  if(checks.length===0&&suites.length===0&&legacy.length===0)return "NO_CHECKS";
  if(checks.some(c=>failedConclusions.includes(c.conclusion??""))||
     suites.some(s=>failedConclusions.includes(s.conclusion??""))||
     legacy.some(s=>["failure","error"].includes(s.state)))return "FAILED";
  if(checks.some(c=>c.status!=="completed"||c.conclusion===null)||
     suites.some(s=>s.status!=="completed"||s.conclusion===null)||
     legacy.some(s=>s.state==="pending"))return "PENDING";
  if(checks.some(c=>c.conclusion!=="success")||
     suites.some(s=>s.conclusion!=="success")||
     legacy.some(s=>s.state!=="success"))return "REVIEW";
  return "OBSERVED_PASS";
}

export function completionEvidenceSufficient(assessment:CheckAssessment,unitState:string,
  acceptanceCriteria:string|null):boolean{
  return assessment==="OBSERVED_PASS"&&unitState==="ACCEPTED"&&
    typeof acceptanceCriteria==="string"&&acceptanceCriteria.trim().length>0;
}

type Scope={
  repository_id:string;full_name:string;unit_id:string;title:string;state:string;
  acceptance_criteria:string|null;source_observed_at:Date|string|null
};
export async function readAssignedPrEvidence(db:Pool,runId:string,credentialId:string,
  generation:string,prNumber:number){
  if(!isValidRunId(runId)||!isValidGeneration(generation)||
     !Number.isSafeInteger(prNumber)||prNumber<=0)
    throw new SessionConflict("Invalid run, lease generation, or PR number");
  const q=await db.query<Scope>(
    "SELECT r.repository_id::text,r.full_name,a.unit_id,w.title,w.state," +
    "w.acceptance_criteria,w.source_observed_at FROM agent_runs ar " +
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
    created_at?:string;updated_at?:string;
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
  const suiteResult=await githubAppRequest("GET",
    url+"/commits/"+sha+"/check-suites?per_page=100") as
    {total_count:number;check_suites:CheckSuite[]};
  if(!Array.isArray(suiteResult.check_suites))throw new GitHubAppError(503);
  const legacy=await githubAppRequest("GET",url+"/commits/"+sha+"/status") as {
    statuses?:LegacyStatus[];
  };
  const contexts=Array.isArray(legacy.statuses)?legacy.statuses:[];
  const assessment=assessObservedChecks(
    checked.check_runs,checked.total_count,contexts,
    suiteResult.check_suites,suiteResult.total_count
  );
  const observedAt=new Date().toISOString();
  const evidenceSufficient=completionEvidenceSufficient(
    assessment,scope.state,scope.acceptance_criteria
  );
  return {
    repository:scope.full_name,unitId:scope.unit_id,
    pullRequest:{number:pr.number,url:pr.html_url,draft:pr.draft,state:pr.state,
      createdAt:pr.created_at??null,updatedAt:pr.updated_at??null,
      mergedAt:pr.merged_at,headSha:sha},
    unitAcceptance:{title:scope.title,state:scope.state,
      criteria:scope.acceptance_criteria,
      sourceObservedAt:scope.source_observed_at instanceof Date?
        scope.source_observed_at.toISOString():scope.source_observed_at,
      evidenceSufficient},
    checks:{assessment,total:checked.total_count,suiteTotal:suiteResult.total_count,
      suites:suiteResult.check_suites.map(s=>({id:s.id,app:s.app?.name??null,
        status:s.status,conclusion:s.conclusion,url:s.url??null})),
      runs:checked.check_runs.map(c=>({id:c.id,name:c.name,status:c.status,
        conclusion:c.conclusion,url:c.html_url??null,
        startedAt:c.started_at??null,completedAt:c.completed_at??null})),
      legacyStatuses:contexts.map(c=>({context:c.context,state:c.state,
        url:c.target_url??null,createdAt:c.created_at??null,updatedAt:c.updated_at??null}))},
    provenance:{provider:"GitHub App API",observedAt,
      resources:["pull_request","check_suites","check_runs","combined_status","roadmap_unit"]},
    requiredBranchProtectionVerified:false,reviewApprovalVerified:false,
    safeToAutoMerge:false,safeToMarkComplete:evidenceSufficient,
    observedFrom:"GitHub App API"
  };
}
