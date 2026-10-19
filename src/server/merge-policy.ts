import type {Pool} from "pg";
import {assignedScope,repositoryApiPath} from "./assignment-scope.ts";
import {githubAppRequest,GitHubAppError,fetchPullRequests,type GitHubPull} from "./github-app.ts";
import {titleWorkUnitIds} from "./roadmap-import.ts";
import {assignedPrNumbers,assertAssignedPull,type WorkPull} from "./work-branch.ts";
import {assessObservedChecks,type CheckRun,type CheckSuite,type LegacyStatus} from "./pr-evidence.ts";
import {SessionConflict} from "./sessions.ts";
import {assertWorkPrerequisites} from "./work-prerequisites.ts";
import {prepareGithubOperation,recordGithubMutation,githubOperationWriter,unresolvedGithubOperation,GithubOperationUncertain} from "./github-operation-ledger.ts";

export type MergePolicy={auto_merge:boolean;required_checks:string[]};
export function aggregateLinkedPrState(unitId:string,linked:number[],pulls:readonly GitHubPull[],confirmedMerged:number):"MERGED"|"OPEN_PR"|"UNKNOWN"{
  const numbers=[...new Set([...linked,confirmedMerged,...pulls.filter(p=>titleWorkUnitIds(p.title).includes(unitId)).map(p=>p.number)])];
  const remaining=numbers.filter(n=>n!==confirmedMerged).map(n=>pulls.find(p=>p.number===n));
  if(remaining.some(p=>!p))return "UNKNOWN";
  if(remaining.some(p=>p?.state==="open"))return "OPEN_PR";
  return remaining.every(p=>!!p?.merged_at)?"MERGED":"UNKNOWN";
}
export type MergeFacts={
  draft:boolean;state:string;headSha:string;expectedSha:string;branch:string;expectedBranch:string;
  repositoryId:string;expectedRepositoryId:string;baseBranch:string;expectedBaseBranch:string;mergeable:string;mergeStateStatus:string;
  checks:CheckRun[];checkTotal:number;suites:CheckSuite[];suiteTotal:number;statuses:LegacyStatus[];
};
export function mergeBlockers(policy:MergePolicy,facts:MergeFacts):string[]{
  const blocked:string[]=[];
  if(!policy.auto_merge)blocked.push("OWNER_MERGE_POLICY_REQUIRED");
  if(!Array.isArray(policy.required_checks)||!policy.required_checks.length)blocked.push("REQUIRED_CHECKS_NOT_CONFIGURED");
  if(facts.draft||facts.state!=="open")blocked.push("PR_NOT_READY");
  if(facts.headSha!==facts.expectedSha)blocked.push("HEAD_CHANGED");
  if(facts.branch!==facts.expectedBranch||facts.repositoryId!==facts.expectedRepositoryId||
     facts.baseBranch!==facts.expectedBaseBranch)blocked.push("PR_SCOPE_MISMATCH");
  // GitHub owns review and branch-protection requirements. An owner-approved
  // autonomous merge must not add an independent human-review prerequisite.
  if(facts.mergeable!=="MERGEABLE"||facts.mergeStateStatus!=="CLEAN")
    blocked.push("GITHUB_MERGE_REQUIREMENTS_UNSATISFIED");
  if(assessObservedChecks(facts.checks,facts.checkTotal,facts.statuses,
    facts.suites,facts.suiteTotal)!=="OBSERVED_PASS")blocked.push("CHECKS_NOT_PASSING");
  const observed=new Set([...facts.checks.filter(c=>c.status==="completed"&&c.conclusion==="success").map(c=>c.name),
    ...facts.statuses.filter(s=>s.state==="success").map(s=>s.context)]);
  if(policy.required_checks.some(name=>!observed.has(name)))blocked.push("REQUIRED_CHECK_MISSING");
  return blocked;
}

export function mergeDenialAuditDetails(unitId:string,number:number,headSha:string,reasons:readonly string[]){
  return {unitId,number,headSha,reasons:[...new Set(reasons)]};
}

export async function mergeAssignedPullRequest(db:Pool,runId:string,credentialId:string,generation:string,number:number,expectedSha:string,
  request:typeof githubAppRequest=githubAppRequest,readPulls:typeof fetchPullRequests=fetchPullRequests){
  if(!Number.isSafeInteger(number)||number<=0||!/^[a-f0-9]{40}$/i.test(expectedSha))throw new SessionConflict("Valid PR and expected commit required");
  const client=await db.connect();
  let transactionOpen=false;
  try{
    const operation=await prepareGithubOperation(client,runId,credentialId,generation,{kind:"merge_pr",number,expectedSha});
    await client.query("BEGIN");transactionOpen=true;
    await client.query("SET LOCAL statement_timeout='25s'");
    await client.query("SELECT run_id FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",[runId,credentialId]);
    const scope=await assignedScope(client,runId,credentialId,generation,true);
    if(scope.repository_id!==operation.repositoryId||scope.unit_id!==operation.unitId)
      throw new SessionConflict("Assignment changed before GitHub operation fencing");
    const policyResult=await client.query<MergePolicy>("SELECT auto_merge,required_checks FROM repository_execution_policy WHERE repository_id=$1",[scope.repository_id]);
    const policy=policyResult.rows[0]??{auto_merge:false,required_checks:[]};
    const controls=await client.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
    if(controls.rows[0]?.paused)throw new SessionConflict("Owner paused execution");
    await assertWorkPrerequisites(client,scope.repository_id,scope.unit_id,true);
    const pending=await unresolvedGithubOperation(client,runId,scope.repository_id,request);
    if(pending){await client.query("COMMIT");transactionOpen=false;throw new GithubOperationUncertain(pending);}
    const api=repositoryApiPath(scope.full_name);
    async function reconcileMergedUnit(){
      const refs=await client.query<{planned_prs:unknown}>("SELECT planned_prs FROM roadmap_units WHERE repository_id=$1 AND unit_id=$2",[scope.repository_id,scope.unit_id]);
      const links=refs.rows[0]?.planned_prs;
      if(!Array.isArray(links)||links.some(n=>!Number.isSafeInteger(n)||n<1))throw new SessionConflict("Approved PR references unavailable");
      const observed=aggregateLinkedPrState(scope.unit_id,links,await readPulls(scope.full_name),number);
      await client.query("UPDATE roadmap_units SET state=CASE WHEN state='ACCEPTED' THEN state ELSE $3 END,source_observed_at=now() WHERE repository_id=$1 AND unit_id=$2",[scope.repository_id,scope.unit_id,observed]);
      return observed;
    }
    const pr=await request("GET",api+"/pulls/"+number) as WorkPull & {
      state:string;draft:boolean;merged:boolean;head:{sha:string;ref:string;repo:{id:number}};html_url:string;
    };
    const workBranch=assertAssignedPull(scope,number,await assignedPrNumbers(client,scope),pr);
    if(pr.merged){
      const unitState=await reconcileMergedUnit();await client.query("COMMIT");transactionOpen=false;
      return {merged:true,replay:true,url:pr.html_url,unitState};
    }
    const repository=await request("GET",api) as {default_branch?:string};
    if(typeof repository.default_branch!=="string"||!repository.default_branch)
      throw new SessionConflict("Expected target branch unavailable");
    const expectedBaseBranch=repository.default_branch;
    const [owner,name]=scope.full_name.split("/");
    const observed=await request("POST","/graphql",{
      query:"query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){mergeable mergeStateStatus headRefOid}}}",
      variables:{owner,name,number}
    }) as {data?:{repository?:{pullRequest?:{mergeable:string;mergeStateStatus:string;headRefOid:string}}};errors?:unknown[]};
    const graph=observed.data?.repository?.pullRequest;
    if(!graph||observed.errors?.length||graph.headRefOid!==pr.head.sha)throw new SessionConflict("Authoritative merge requirements unavailable or head changed");
    const checked=await request("GET",api+"/commits/"+pr.head.sha+"/check-runs?per_page=100") as {total_count:number;check_runs:CheckRun[]};
    const suiteResult=await request("GET",api+"/commits/"+pr.head.sha+"/check-suites?per_page=100") as {total_count:number;check_suites:CheckSuite[]};
    const statuses=await request("GET",api+"/commits/"+pr.head.sha+"/status?per_page=100") as {total_count:number;statuses:LegacyStatus[]};
    if(!Array.isArray(checked.check_runs)||!Array.isArray(suiteResult.check_suites)||!Array.isArray(statuses.statuses))
      throw new SessionConflict("Authoritative check evidence unavailable");
    if(statuses.total_count>100)throw new SessionConflict("Check status pagination incomplete");
    const reasons=mergeBlockers(policy,{draft:pr.draft,state:pr.state,headSha:pr.head.sha,expectedSha,
      branch:pr.head.ref,expectedBranch:workBranch,baseBranch:pr.base?.ref??"",expectedBaseBranch,
      repositoryId:String(pr.head.repo.id),
      expectedRepositoryId:scope.repository_id,...graph,checks:checked.check_runs,checkTotal:checked.total_count,
      suites:suiteResult.check_suites,suiteTotal:suiteResult.total_count,
      statuses:statuses.statuses});
    if(reasons.length){
      const details=mergeDenialAuditDetails(scope.unit_id,number,pr.head.sha,reasons);
      await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'github.pr.merge_denied',$3::jsonb)",
        [runId,scope.repository_id,JSON.stringify(details)]);
      await client.query("COMMIT");transactionOpen=false;
      throw new SessionConflict("Merge blocked: "+reasons.join(", "));
    }
    // Recheck the target immediately before the privileged merge mutation.
    const finalPull=await request("GET",api+"/pulls/"+number) as WorkPull;
    if(finalPull.base?.ref!==expectedBaseBranch||String(finalPull.base?.repo?.id)!==scope.repository_id)
      throw new SessionConflict("Pull request target branch changed before merge");
    const merged=await recordGithubMutation(githubOperationWriter(db),operation,{kind:"MERGE_PR",number,headSha:expectedSha},
      ()=>request("PUT",api+"/pulls/"+number+"/merge",{sha:expectedSha,merge_method:"squash"})) as {merged:boolean;sha:string};
    if(!merged.merged||!/^[a-f0-9]{40}$/i.test(merged.sha))throw new GitHubAppError(409);
    const unitState=await reconcileMergedUnit();
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'github.pr.merged',$3::jsonb)",
      [runId,scope.repository_id,JSON.stringify({unitId:scope.unit_id,number,headSha:expectedSha,mergeSha:merged.sha})]);
    await client.query("COMMIT");transactionOpen=false;
    return {merged:true,replay:false,sha:merged.sha,url:pr.html_url,unitState};
  }catch(error){if(transactionOpen)await client.query("ROLLBACK");throw error;}finally{client.release();}
}
