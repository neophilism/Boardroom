import test from "node:test";
import assert from "node:assert/strict";
import {assessObservedChecks,type CheckRun,type LegacyStatus} from "../src/server/pr-evidence.ts";
const one:CheckRun={id:1,name:"verify",status:"completed",conclusion:"success"};
const good:LegacyStatus={context:"legacy-test",state:"success"};
test("checks only pass when every observed check and legacy context passes",()=>{
  assert.equal(assessObservedChecks([one],1,[good]),"OBSERVED_PASS");
  assert.equal(assessObservedChecks([],0,[]),"NO_CHECKS");
  assert.equal(assessObservedChecks([one],2,[]),"INCOMPLETE");
});
test("pending and failed checks cannot be misreported green",()=>{
  assert.equal(assessObservedChecks([{...one,status:"in_progress",conclusion:null}],1,[]),"PENDING");
  assert.equal(assessObservedChecks([{...one,conclusion:"failure"}],1,[]),"FAILED");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"error"}]),"FAILED");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"pending"}]),"PENDING");
});
test("neutral or skipped conclusions require further review",()=>{
  assert.equal(assessObservedChecks([{...one,conclusion:"neutral"}],1,[]),"REVIEW");
  assert.equal(assessObservedChecks([{...one,conclusion:"skipped"}],1,[]),"REVIEW");
  assert.equal(assessObservedChecks([one],1,[{...good,state:"something_new"}]),"REVIEW");
});
