import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptanceVerification,assessObservedChecks,completionEvidenceSufficient,evidenceTimestamp,
  type CheckRun,type CheckSuite,type LegacyStatus
} from "../src/server/pr-evidence.ts";
const one:CheckRun={id:1,name:"verify",status:"completed",conclusion:"success"};
const suite:CheckSuite={id:2,status:"completed",conclusion:"success",app:{name:"Actions"}};
const good:LegacyStatus={context:"legacy-test",state:"success"};
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
