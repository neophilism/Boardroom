import test from "node:test";
import assert from "node:assert/strict";
import {mergeBlockers,aggregateLinkedPrState,type MergeFacts} from "../src/server/merge-policy.ts";
const facts:MergeFacts={draft:false,state:"open",headSha:"a".repeat(40),expectedSha:"a".repeat(40),
  branch:"boardroom/BR-038",expectedBranch:"boardroom/BR-038",repositoryId:"1",expectedRepositoryId:"1",
  mergeStateStatus:"CLEAN",reviewDecision:null,checks:[{id:1,name:"verify",status:"completed",conclusion:"success"}],
  checkTotal:1,suites:[{id:2,status:"completed",conclusion:"success",app:{name:"Actions"}}],
  suiteTotal:1,statuses:[],reviews:[]};
const policy={auto_merge:true,required_checks:["verify"],minimum_reviews:0};
test("only owner-enabled, current-head, correctly scoped green PRs are eligible",()=>{
  assert.deepEqual(mergeBlockers(policy,facts),[]);
  for(const patch of [{auto_merge:false},{required_checks:[]},{required_checks:["security"]},{minimum_reviews:1}])
    assert.ok(mergeBlockers({...policy,...patch},facts).length);
  for(const patch of [{draft:true},{expectedSha:"b".repeat(40)},{repositoryId:"2"},{mergeStateStatus:"BLOCKED"},
    {reviewDecision:"REVIEW_REQUIRED"},{checkTotal:2},{checks:[]},{suiteTotal:2},
    {suites:[{...facts.suites[0],conclusion:"failure"}]},
    {reviews:[{login:"owner",state:"CHANGES_REQUESTED",commitId:facts.headSha}]}])
    assert.ok(mergeBlockers(policy,{...facts,...patch}).length);
});
test("suite failures, pending suites and truncated suite pages block merge",()=>{
  assert.ok(mergeBlockers(policy,{...facts,
    suites:[{...facts.suites[0],conclusion:"failure"}]}).includes("CHECKS_NOT_PASSING"));
  assert.ok(mergeBlockers(policy,{...facts,
    suites:[{...facts.suites[0],status:"in_progress",conclusion:null}]}).includes("CHECKS_NOT_PASSING"));
  assert.ok(mergeBlockers(policy,{...facts,suiteTotal:2}).includes("CHECKS_NOT_PASSING"));
});
test("reviews must approve the current head and later change requests defeat an earlier approval",()=>{
  const review={login:"reviewer",state:"APPROVED",commitId:facts.headSha};
  assert.deepEqual(mergeBlockers({...policy,minimum_reviews:1},{...facts,reviews:[review]}),[]);
  assert.ok(mergeBlockers({...policy,minimum_reviews:1},{...facts,reviews:[{...review,commitId:"b".repeat(40)}]}).includes("CURRENT_HEAD_APPROVAL_REQUIRED"));
  assert.ok(mergeBlockers(policy,{...facts,reviews:[review,{...review,state:"CHANGES_REQUESTED"}]}).includes("CHANGES_REQUESTED"));
});
test("agents cannot automatically replace their own control plane without the owner's exact-head review",()=>{
  assert.ok(mergeBlockers(policy,{...facts,requiredReviewerLogin:"owner"}).includes("CONTROL_PLANE_OWNER_REVIEW_REQUIRED"));
  assert.deepEqual(mergeBlockers(policy,{...facts,requiredReviewerLogin:"owner",reviews:[{login:"owner",state:"APPROVED",commitId:facts.headSha}]}),[]);
});
test("one merged PR cannot complete a unit with another open or missing linked PR",()=>{
  const open={number:2,title:"BR-038: follow-up",state:"open" as const,created_at:"2026-10-12T00:00:00Z",merged_at:null,updated_at:"2026-10-12T00:00:00Z"};
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[open],1),"OPEN_PR");
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[],1),"UNKNOWN");
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[{...open,state:"closed",merged_at:"2026-10-12T00:00:00Z"}],1),"MERGED");
});
