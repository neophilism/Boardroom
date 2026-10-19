import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import type {githubAppRequest} from "../src/server/github-app.ts";
import {WorkMappingConflict,type WorkPull} from "../src/server/work-branch.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import {
  acceptanceVerification,assessObservedChecks,completionEvidenceSufficient,evidenceTimestamp,isEmptyRenderSuite,
  isAcceptedMergedPullRequest,readAssignedPrEvidence,type CheckRun,type CheckSuite,type LegacyStatus
} from "../src/server/pr-evidence.ts";
const one:CheckRun={id:1,name:"verify",status:"completed",conclusion:"success"};
const suite:CheckSuite={id:2,status:"completed",conclusion:"success",app:{name:"Actions"}};
const good:LegacyStatus={context:"legacy-test",state:"success"};
const executed:CheckRun={...one,check_suite:{id:2},app:{id:15368,slug:"github-actions"}};
const emptyRender:CheckSuite={id:3,status:"queued",conclusion:null,
  latest_check_runs_count:0,app:{id:14658,slug:"render",name:"Render"}};
test("an explicitly empty Render suite is visible but cannot stand in for an executed check",()=>{
  assert.equal(isEmptyRenderSuite(emptyRender,[executed]),true);
  assert.equal(assessObservedChecks([executed],1,[],[suite,emptyRender],2),"OBSERVED_PASS");
  assert.equal(assessObservedChecks([],0,[],[emptyRender],1),"NO_CHECKS");
  assert.equal(assessObservedChecks([executed],2,[],[suite,emptyRender],2),"INCOMPLETE");
  assert.equal(assessObservedChecks([executed],1,[],[suite,emptyRender],3),"INCOMPLETE");
});
test("unknown apps, missing metadata and actual Render execution remain gated",()=>{
  const variants:CheckSuite[]=[
    {...emptyRender,app:{id:7,slug:"render",name:"Render"}},
    {...emptyRender,app:{id:14658,slug:"other"}},
    {...emptyRender,app:{id:15368,slug:"github-actions"}},
    {...emptyRender,latest_check_runs_count:undefined},
    {...emptyRender,latest_check_runs_count:1},
    {...emptyRender,status:"in_progress"}
  ];
  for(const candidate of variants){
    assert.equal(isEmptyRenderSuite(candidate,[executed]),false);
    assert.equal(assessObservedChecks([executed],1,[],[suite,candidate],2),"PENDING");
  }
  for(const run of [one,{...executed,check_suite:{id:3}},
    {...executed,app:{id:14658,slug:"render"}}])
    assert.equal(isEmptyRenderSuite(emptyRender,[run]),false);
  assert.equal(assessObservedChecks([one],1,[],[suite,emptyRender],2),"PENDING");
});
test("Render failures and every real failed, skipped or queued check still block",()=>{
  const failed={...emptyRender,status:"completed",conclusion:"failure"};
  assert.equal(assessObservedChecks([executed],1,[],[suite,failed],2),"FAILED");
  for(const [run,expected] of [
    [{...executed,status:"queued",conclusion:null},"PENDING"],
    [{...executed,conclusion:"failure"},"FAILED"],
    [{...executed,conclusion:"skipped"},"REVIEW"]
  ] as const)
    assert.equal(assessObservedChecks([run],1,[],[suite,emptyRender],2),expected);
});
test("checks only pass when every observed suite, run and legacy context passes",()=>{
  assert.equal(assessObservedChecks([one],1,[good],[suite],1),"OBSERVED_PASS");
  assert.equal(assessObservedChecks([],0,[],[],0),"NO_CHECKS");
  assert.equal(assessObservedChecks([one],2,[],[suite],1),"INCOMPLETE");
  assert.equal(assessObservedChecks([one],1,[],[suite],2),"INCOMPLETE");
});
test("pending and failed evidence cannot be misreported green",()=>{
  assert.equal(assessObservedChecks([{...one,status:"in_progress",conclusion:null}],1,[]),"PENDING");
  assert.equal(assessObservedChecks([{...one,conclusion:"failure"}],1,[]),"FAILED");
  assert.equal(assessObservedChecks([one],1,[],[{...suite,conclusion:"failure"}],1),"FAILED");
  assert.equal(assessObservedChecks([one],1,[],[{...suite,status:"in_progress",conclusion:null}],1),"PENDING");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"error"}]),"FAILED");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"pending"}]),"PENDING");
});
test("neutral or skipped conclusions require further review",()=>{
  assert.equal(assessObservedChecks([{...one,conclusion:"neutral"}],1,[]),"REVIEW");
  assert.equal(assessObservedChecks([{...one,conclusion:"skipped"}],1,[]),"REVIEW");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"something_new"}]),"REVIEW");
  assert.equal(assessObservedChecks([one],1,[],[{...suite,conclusion:"neutral"}],1),"REVIEW");
});
test("completion evidence requires green checks and accepted criteria",()=>{
  assert.equal(completionEvidenceSufficient("OBSERVED_PASS","ACCEPTED","All tests pass."),true);
  assert.equal(completionEvidenceSufficient("FAILED","ACCEPTED","All tests pass."),false);
  assert.equal(completionEvidenceSufficient("OBSERVED_PASS","MERGED","All tests pass."),false);
  assert.equal(completionEvidenceSufficient("OBSERVED_PASS","ACCEPTED","  "),false);
});
test("timestamps are normalized and invalid source values remain visibly absent",()=>{
  assert.equal(evidenceTimestamp("2026-10-15T09:30:00Z"),"2026-10-15T09:30:00.000Z");
  assert.equal(evidenceTimestamp(new Date("2026-10-15T09:31:00Z")),"2026-10-15T09:31:00.000Z");
  assert.equal(evidenceTimestamp("not-a-date"),null);
  assert.equal(evidenceTimestamp(undefined),null);
});
test("only bounded source-owned verification statements become acceptance evidence",()=>{
  assert.deepEqual(acceptanceVerification({verification:["test passes","",7,"x".repeat(2001)]}),
    ["test passes"]);
  assert.deepEqual(acceptanceVerification(null),[]);
  assert.equal(acceptanceVerification({verification:Array.from({length:120},(_,i)=>"v"+i)}).length,100);
});


test('GitHub merger immediately accepts the PR without pretending a whole work package is complete',()=>{
 assert.equal(isAcceptedMergedPullRequest('2026-10-17T13:00:00Z'),true);
 assert.equal(isAcceptedMergedPullRequest(null),false);
 assert.equal(isAcceptedMergedPullRequest(undefined),false);
 assert.equal(isAcceptedMergedPullRequest('not a timestamp'),false);
 // A completed PR remains accepted even when a later package still needs work.
 assert.equal(completionEvidenceSufficient('OBSERVED_PASS','MERGED','Whole-package criteria'),false);
});

const evidenceRun="11111111-1111-4111-8111-111111111111";
function assignedEvidenceFixture(number:number,sourceMetadata:unknown,plannedPrs:number[]=[],leasePresent=true){
  const scope={repository_id:"1413400269",full_name:"ci/Example",unit_id:"CS-12",title:"Succession verification",
    state:"ACCEPTED",acceptance_criteria:"Entire work unit independently verified",
    source_observed_at:"2026-10-18T00:00:00Z",source_metadata:sourceMetadata};
  const pr:WorkPull & {html_url:string;draft:boolean}={number,state:"closed",merged_at:"2026-10-17T00:00:00Z",
    html_url:"https://github.com/ci/Example/pull/"+number,draft:false,
    head:{ref:"historical/succession",sha:"a".repeat(40),repo:{id:1413400269}},base:{ref:"main",repo:{id:1413400269}}};
  const queries:{sql:string;values:unknown[]}[]=[],requests:{method:string;path:string}[]=[];
  const db={query:async(sql:string,values:unknown[])=>{
    queries.push({sql,values});
    if(sql.includes("FROM agent_runs"))return {rows:leasePresent?[scope]:[],rowCount:leasePresent?1:0};
    if(sql.includes("SELECT planned_prs,source_metadata"))
      return {rows:[{planned_prs:plannedPrs,source_metadata:sourceMetadata}],rowCount:1};
    throw new Error("Unexpected database operation: "+sql);
  }} as unknown as Pool;
  const request=async(method:string,path:string)=>{
    requests.push({method,path});assert.equal(method,"GET");
    if(path==="/repos/ci/Example/pulls/"+number)return pr;
    if(path.endsWith("/check-runs?per_page=100"))return {total_count:1,check_runs:[one]};
    if(path.endsWith("/check-suites?per_page=100"))return {total_count:1,check_suites:[suite]};
    if(path.endsWith("/status"))return {statuses:[]};
    throw new Error("Unexpected GitHub path: "+path);
  };
  return {scope,pr,queries,requests,db,request:request as typeof githubAppRequest};
}

test("CS-12 contributing PRs remain readable without converting evidence into completion or merge authority",async()=>{
  // Same source shape as the reported failure: explicit completion mapping is
  // empty, while both real historical contributions have source-owned links.
  for(const number of [14,29]){
    const f=assignedEvidenceFixture(number,{id:"CS-12",prs:[],contributingPrs:[14,29]});
    const result=await readAssignedPrEvidence(f.db,evidenceRun,"credential","3",number,f.request);
    assert.equal(result.pullRequest.relationship,"CONTRIBUTION");
    assert.equal(result.pullRequest.accepted,true);
    assert.equal(result.pullRequest.headSha,"a".repeat(40));
    assert.equal(result.checks.assessment,"OBSERVED_PASS");
    assert.equal(result.unitAcceptance.satisfied,false);
    assert.equal(result.safeToMarkComplete,false);
    assert.equal(result.safeToAutoMerge,false);
    assert.equal(result.requiredBranchProtectionVerified,false);
    assert.equal(result.reviewApprovalVerified,false);
    assert.ok(f.requests.slice(1).every(r=>r.path.startsWith("/repos/ci/Example/commits/"+"a".repeat(40)+"/")));
    assert.ok(f.queries.every(q=>q.sql.startsWith("SELECT ")));
    assert.deepEqual(f.queries[0].values,[evidenceRun,"credential","3"]);
  }
});

test("prior evidence and assigned work retain distinct acceptance semantics",async()=>{
  for(const [metadata,planned,relationship,satisfied] of [
    [{id:"CS-12",prs:[],priorEvidencePrs:[14]},[],"PRIOR_EVIDENCE",false],
    [{id:"CS-12",prs:[14]},[14],"ASSIGNED_WORK",true]
  ] as const){
    const f=assignedEvidenceFixture(14,metadata,[...planned]);
    const result=await readAssignedPrEvidence(f.db,evidenceRun,"credential","3",14,f.request);
    assert.equal(result.pullRequest.relationship,relationship);
    assert.equal(result.unitAcceptance.satisfied,satisfied);
    assert.equal(result.safeToMarkComplete,satisfied);
    assert.equal(result.safeToAutoMerge,false);
  }
});

test("unmapped or cross-repository evidence is refused before reading commit checks",async()=>{
  const fixtures=[
    assignedEvidenceFixture(99,{id:"CS-12",prs:[],contributingPrs:[14,29]},[99]),
    assignedEvidenceFixture(14,{id:"CS-12",prs:[],contributingPrs:[14,29]})
  ];
  fixtures[1].pr.base={ref:"main",repo:{id:99}};
  for(const f of fixtures){
    await assert.rejects(readAssignedPrEvidence(f.db,evidenceRun,"credential","3",f.pr.number,f.request),WorkMappingConflict);
    assert.equal(f.requests.length,1);
    assert.ok(f.requests[0].path.startsWith("/repos/ci/Example/pulls/"));
  }
});

test("historical evidence still requires an authorized current lease",async()=>{
  const f=assignedEvidenceFixture(14,{id:"CS-12",prs:[],contributingPrs:[14,29]},[],false);
  await assert.rejects(readAssignedPrEvidence(f.db,evidenceRun,"credential","3",14,f.request),SessionConflict);
  assert.deepEqual(f.requests,[]);
});
