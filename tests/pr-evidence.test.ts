import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceVerification,assessObservedChecks,completionEvidenceSufficient,evidenceTimestamp,isEmptyRenderSuite,
  isAcceptedMergedPullRequest,type CheckRun,type CheckSuite,type LegacyStatus
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
