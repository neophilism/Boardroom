import type {Pool} from "pg";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {safeWorkBranch} from "./github-write-gateway.ts";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";

export type CheckRun={
  id:number;name:string;status:string;conclusion:string|null;html_url?:string;
  started_at?:string|null;completed_at?:string|null;
  check_suite?:{id:number}|null;app?:{id?:number;slug?:string}|null;
};
export type CheckSuite={
  id:number;status:string;conclusion:string|null;url?:string;
  created_at?:string|null;updated_at?:string|null;
  latest_check_runs_count?:number;
  app?:{id?:number;slug?:string;name?:string|null}|null;
};
export type LegacyStatus={
  context:string;state:string;target_url?:string;
  created_at?:string|null;updated_at?:string|null;
};
export type CheckAssessment="OBSERVED_PASS"|"FAILED"|"PENDING"|"REVIEW"|"NO_CHECKS"|"INCOMPLETE";
const failedConclusions=["failure","cancelled","timed_out","startup_failure","action_required"];

// GitHub automatically requests suites from installed apps. Render leaves an
// empty queued suite on branches it does not deploy. It is not an executed check.
// Recognize only that exact public app and complete, contradictory-free metadata;
// all actual runs, other suites and configured required-check names still gate.
export function isEmptyRenderSuite(suite:CheckSuite,checks:readonly CheckRun[]):boolean{
  return suite.app?.id===14658&&suite.app.slug==="render"&&
    suite.status==="queued"&&suite.conclusion===null&&suite.latest_check_runs_count===0&&
    checks.every(c=>Number.isSafeInteger(c.check_suite?.id)&&
      c.check_suite?.id!==suite.id&&Number.isSafeInteger(c.app?.id)&&c.app?.id!==14658);
}

export function assessObservedChecks(checks:readonly CheckRun[],total:number,
  legacy:readonly LegacyStatus[],suites:readonly CheckSuite[]=[],
  suiteTotal=suites.length):CheckAssessment{
  if(!Number.isSafeInteger(total)||total<0||total!==checks.length||
     !Number.isSafeInteger(suiteTotal)||suiteTotal<0||suiteTotal!==suites.length)
    return "INCOMPLETE";
  const assessedSuites=suites.filter(s=>!isEmptyRenderSuite(s,checks));
  if(checks.length===0&&assessedSuites.length===0&&legacy.length===0)return "NO_CHECKS";
  if(checks.some(c=>failedConclusions.includes(c.conclusion??""))||
     assessedSuites.some(s=>failedConclusions.includes(s.conclusion??""))||
     legacy.some(s=>["failure","error"].includes(s.state)))return "FAILED";
  if(checks.some(c=>c.status!=="completed"||c.conclusion===null)||
     assessedSuites.some(s=>s.status!=="completed"||s.conclusion===null)||
     legacy.some(s=>s.state==="pending"))return "PENDING";
  if(checks.some(c=>c.conclusion!=="success")||
     assessedSuites.some(s=>s.conclusion!=="success")||
     legacy.some(s=>s.state!=="success"))return "REVIEW";
  return "OBSERVED_PASS";
}

export function completionEvidenceSufficient(assessment:CheckAssessment,unitState:string,
  acceptanceCriteria:string|null):boolean{
  return assessment==="OBSERVED_PASS"&&unitState==="ACCEPTED"&&
    typeof acceptanceCriteria==="string"&&acceptanceCriteria.trim().length>0;
}

export function evidenceTimestamp(value:unknown):string|null{
  if(value instanceof Date&&Number.isFinite(value.getTime()))return value.toISOString();
  if(typeof value!=="string"||value.length===0)return null;
  const parsed=Date.parse(value);
  return Number.isFinite(parsed)?new Date(parsed).toISOString():null;
}

export function acceptanceVerification(value:unknown):string[]{
  if(!value||typeof value!=="object"||Array.isArray(value))return [];
  const verification=(value as {verification?:unknown}).verification;
  if(!Array.isArray(verification))return [];
  return verification.filter((item):item is string=>
    typeof item==="string"&&item.length>0&&item.length<=2000).slice(0,100);
}

type Scope={
  repository_id:string;full_name:string;unit_id:string;title:string;state:string;
  acceptance_criteria:string|null;source_observed_at:Date|string|null;source_metadata:unknown;
};
export async function readAssignedPrEvidence(db:Pool,runId:string,credentialId:string,
  generation:string,prNumber:number){
  if(!isValidRunId(runId)||!isValidGeneration(generation)||
     !Number.isSafeInteger(prNumber)||prNumber<=0)
    throw new SessionConflict("Invalid run, lease generation, or PR number");
  const q=await db.query<Scope>(
    "SELECT r.repository_id::text,r.full_name,a.unit_id,w.title,w.state,w.acceptance_criteria," +
    "w.source_observed_at,w.source_metadata FROM agent_runs ar " +
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
  const pullPath=url+"/pulls/"+prNumber;
  const pr=await githubAppRequest("GET",pullPath) as {
    number:number;html_url:string;state:string;draft:boolean;merged_at:string|null;
    created_at?:string|null;updated_at?:string|null;
    head?:{sha?:string;ref?:string;repo?:{id?:number}};
  };
  if(!pr.head||pr.head.ref!==safeWorkBranch(scope.unit_id)||
     !/^[a-f0-9]{40}$/i.test(pr.head.sha??"")||
     String(pr.head.repo?.id)!==scope.repository_id)
    throw new SessionConflict("PR is not associated with the assigned repository work branch");
  const sha=pr.head.sha as string;
  const checkPath=url+"/commits/"+sha+"/check-runs?per_page=100";
  const checked=await githubAppRequest("GET",checkPath) as
    {total_count:number;check_runs:CheckRun[]};
  if(!Array.isArray(checked.check_runs))throw new GitHubAppError(503);
  const suitePath=url+"/commits/"+sha+"/check-suites?per_page=100";
  const suiteResult=await githubAppRequest("GET",suitePath) as
    {total_count:number;check_suites:CheckSuite[]};
  if(!Array.isArray(suiteResult.check_suites))throw new GitHubAppError(503);
  const statusPath=url+"/commits/"+sha+"/status";
  const legacy=await githubAppRequest("GET",statusPath) as {statuses?:LegacyStatus[]};
  const contexts=Array.isArray(legacy.statuses)?legacy.statuses:[];
  const assessment=assessObservedChecks(checked.check_runs,checked.total_count,contexts,
    suiteResult.check_suites,suiteResult.total_count);
  const collectedAt=new Date().toISOString();
  const evidenceSufficient=completionEvidenceSufficient(
    assessment,scope.state,scope.acceptance_criteria);
  return {
    repository:scope.full_name,unitId:scope.unit_id,
    pullRequest:{number:pr.number,url:pr.html_url,draft:pr.draft,state:pr.state,
      createdAt:evidenceTimestamp(pr.created_at),updatedAt:evidenceTimestamp(pr.updated_at),
      mergedAt:evidenceTimestamp(pr.merged_at),headSha:sha},
    unitAcceptance:{title:scope.title,state:scope.state,criteria:scope.acceptance_criteria,
      verification:acceptanceVerification(scope.source_metadata),
      planObservedAt:evidenceTimestamp(scope.source_observed_at),satisfied:evidenceSufficient},
    checks:{assessment,total:checked.total_count,suiteTotal:suiteResult.total_count,observedAt:collectedAt,
      suites:suiteResult.check_suites.map(s=>({id:s.id,app:s.app?.name??null,
        status:s.status,conclusion:s.conclusion,createdAt:evidenceTimestamp(s.created_at),
        updatedAt:evidenceTimestamp(s.updated_at),url:s.url??null,
        assessmentRole:isEmptyRenderSuite(s,checked.check_runs)?"EMPTY_PROVIDER_SUITE":"CHECK_SUITE"})),
      runs:checked.check_runs.map(c=>({id:c.id,name:c.name,status:c.status,conclusion:c.conclusion,
        startedAt:evidenceTimestamp(c.started_at),completedAt:evidenceTimestamp(c.completed_at),
        url:c.html_url??null})),
      legacyStatuses:contexts.map(c=>({context:c.context,state:c.state,
        createdAt:evidenceTimestamp(c.created_at),updatedAt:evidenceTimestamp(c.updated_at),
        url:c.target_url??null}))},
    provenance:{provider:"GitHub App REST API",collectedAt,repositoryId:scope.repository_id,
      pullRequestPath:pullPath,checkSuitesPath:suitePath,checkRunsPath:checkPath,
      legacyStatusPath:statusPath,headSha:sha},
    requiredBranchProtectionVerified:false,reviewApprovalVerified:false,
    safeToAutoMerge:false,safeToMarkComplete:evidenceSufficient,
    observedFrom:"GitHub App API"
  };
}
