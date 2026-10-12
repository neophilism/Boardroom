import type {Pool} from "pg";
import {assignedScope,repositoryApiPath} from "./assignment-scope.ts";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {safeWorkBranch} from "./github-write-gateway.ts";
import {assessObservedChecks,type CheckRun,type LegacyStatus} from "./pr-evidence.ts";
import {SessionConflict} from "./sessions.ts";

export type MergePolicy={auto_merge:boolean;required_checks:string[];minimum_reviews:number};
export type MergeFacts={
  draft:boolean;state:string;headSha:string;expectedSha:string;branch:string;expectedBranch:string;
  repositoryId:string;expectedRepositoryId:string;mergeStateStatus:string;reviewDecision:string|null;
  checks:CheckRun[];checkTotal:number;statuses:LegacyStatus[];reviews:{login:string;state:string;commitId:string}[];
  requiredReviewerLogin?:string;
};
export function mergeBlockers(policy:MergePolicy,facts:MergeFacts):string[]{
  const blocked:string[]=[];
  if(!policy.auto_merge)blocked.push("OWNER_MERGE_POLICY_REQUIRED");
  if(!Array.isArray(policy.required_checks)||!policy.required_checks.length)blocked.push("REQUIRED_CHECKS_NOT_CONFIGURED");
  if(facts.draft||facts.state!=="open")blocked.push("PR_NOT_READY");
  if(facts.headSha!==facts.expectedSha)blocked.push("HEAD_CHANGED");
  if(facts.branch!==facts.expectedBranch||facts.repositoryId!==facts.expectedRepositoryId)blocked.push("PR_SCOPE_MISMATCH");
  if(facts.mergeStateStatus!=="CLEAN")blocked.push("GITHUB_MERGE_REQUIREMENTS_UNSATISFIED");
  if(facts.reviewDecision!==null&&facts.reviewDecision!=="APPROVED")blocked.push("GITHUB_REVIEW_REQUIRED");
  if(assessObservedChecks(facts.checks,facts.checkTotal,facts.statuses)!=="OBSERVED_PASS")blocked.push("CHECKS_NOT_PASSING");
  const observed=new Set([...facts.checks.filter(c=>c.status==="completed"&&c.conclusion==="success").map(c=>c.name),
    ...facts.statuses.filter(s=>s.state==="success").map(s=>s.context)]);
  if(policy.required_checks.some(name=>!observed.has(name)))blocked.push("REQUIRED_CHECK_MISSING");
  const latest=new Map<string,MergeFacts["reviews"][number]>();
  for(const review of facts.reviews)if(["APPROVED","CHANGES_REQUESTED","DISMISSED"].includes(review.state))latest.set(review.login,review);
  if([...latest.values()].some(r=>r.state==="CHANGES_REQUESTED"))blocked.push("CHANGES_REQUESTED");
  if([...latest.values()].filter(r=>r.state==="APPROVED"&&r.commitId===facts.headSha).length<policy.minimum_reviews)
    blocked.push("CURRENT_HEAD_APPROVAL_REQUIRED");
  if(facts.requiredReviewerLogin&&![...latest.values()].some(r=>r.login===facts.requiredReviewerLogin&&r.state==="APPROVED"&&r.commitId===facts.headSha))
    blocked.push("CONTROL_PLANE_OWNER_REVIEW_REQUIRED");
  return blocked;
}

export async function mergeAssignedPullRequest(db:Pool,runId:string,credentialId:string,generation:string,number:number,expectedSha:string){
  if(!Number.isSafeInteger(number)||number<=0||!/^[a-f0-9]{40}$/i.test(expectedSha))throw new SessionConflict("Valid PR and expected commit required");
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='25s'");
    const scope=await assignedScope(client,runId,credentialId,generation,true);
    const policyResult=await client.query<MergePolicy>("SELECT auto_merge,required_checks,minimum_reviews FROM repository_execution_policy WHERE repository_id=$1",[scope.repository_id]);
    const policy=policyResult.rows[0]??{auto_merge:false,required_checks:[],minimum_reviews:0};
    const controls=await client.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
    if(controls.rows[0]?.paused)throw new SessionConflict("Owner paused execution");
    const incompatible=await client.query(`SELECT 1 FROM compatibility_dependencies d JOIN roadmap_units w
      ON w.repository_id=d.prerequisite_repository_id AND w.unit_id=d.prerequisite_unit_id
      WHERE d.repository_id=$1 AND d.unit_id=$2 AND w.state NOT IN ('MERGED','ACCEPTED') LIMIT 1`,[scope.repository_id,scope.unit_id]);
    if(incompatible.rowCount)throw new SessionConflict("Cross-repository compatibility prerequisite unresolved");
    const api=repositoryApiPath(scope.full_name);
    const pr=await githubAppRequest("GET",api+"/pulls/"+number) as {
      state:string;draft:boolean;merged:boolean;head:{sha:string;ref:string;repo:{id:number}};html_url:string;
    };
    if(pr.head.ref!==safeWorkBranch(scope.unit_id)||String(pr.head.repo.id)!==scope.repository_id)
      throw new SessionConflict("PR is outside the assigned work branch");
    if(pr.merged){await client.query("COMMIT");return {merged:true,replay:true,url:pr.html_url};}
    const [owner,name]=scope.full_name.split("/");
    const controlsItsOwnAuthority=scope.full_name.toLowerCase()===(process.env.BOARDROOM_GITHUB_OWNER??"neophilism").toLowerCase()+"/boardroom";
    const observed=await githubAppRequest("POST","/graphql",{
      query:"query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeStateStatus reviewDecision headRefOid}}}",
      variables:{owner,name,number}
    }) as {data?:{repository?:{pullRequest?:{mergeStateStatus:string;reviewDecision:string|null;headRefOid:string}}};errors?:unknown[]};
    const graph=observed.data?.repository?.pullRequest;
    if(!graph||observed.errors?.length||graph.headRefOid!==pr.head.sha)throw new SessionConflict("Authoritative merge requirements unavailable or head changed");
    const checked=await githubAppRequest("GET",api+"/commits/"+pr.head.sha+"/check-runs?per_page=100") as {total_count:number;check_runs:CheckRun[]};
    const statuses=await githubAppRequest("GET",api+"/commits/"+pr.head.sha+"/status?per_page=100") as {total_count:number;statuses:LegacyStatus[]};
    if(statuses.total_count>100)throw new SessionConflict("Check status pagination incomplete");
    const reviews=await githubAppRequest("GET",api+"/pulls/"+number+"/reviews?per_page=100") as {user:{login:string};state:string;commit_id:string}[];
    if(!Array.isArray(reviews)||reviews.length===100)throw new SessionConflict("Review evidence requires pagination");
    const reasons=mergeBlockers(policy,{draft:pr.draft,state:pr.state,headSha:pr.head.sha,expectedSha,
      branch:pr.head.ref,expectedBranch:safeWorkBranch(scope.unit_id),repositoryId:String(pr.head.repo.id),
      expectedRepositoryId:scope.repository_id,...graph,checks:checked.check_runs,checkTotal:checked.total_count,
      requiredReviewerLogin:controlsItsOwnAuthority?owner:undefined,
      statuses:statuses.statuses,reviews:reviews.map(r=>({login:r.user.login,state:r.state,commitId:r.commit_id}))});
    if(reasons.length)throw new SessionConflict("Merge blocked: "+reasons.join(", "));
    const merged=await githubAppRequest("PUT",api+"/pulls/"+number+"/merge",{sha:expectedSha,merge_method:"squash"}) as {merged:boolean;sha:string};
    if(!merged.merged||!/^[a-f0-9]{40}$/i.test(merged.sha))throw new GitHubAppError(409);
    await client.query("UPDATE roadmap_units SET state='MERGED',source_observed_at=now() WHERE repository_id=$1 AND unit_id=$2",[scope.repository_id,scope.unit_id]);
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'github.pr.merged',$3::jsonb)",
      [runId,scope.repository_id,JSON.stringify({unitId:scope.unit_id,number,headSha:expectedSha,mergeSha:merged.sha})]);
    await client.query("COMMIT");
    return {merged:true,replay:false,sha:merged.sha,url:pr.html_url};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
