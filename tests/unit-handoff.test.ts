import test from "node:test";
import assert from "node:assert/strict";
import {unitHandoffReport} from "../src/domain/unit-handoff.ts";
test("unfinished drafts and unfinished work with pending CI never justify leaving the unit",()=>{
  for(const value of [undefined,{reason:'DRAFT_CREATED'},
    {reason:'IMPLEMENTATION_COMPLETE_WAITING_CI',implementationComplete:false,remainingImplementation:['Integration'],prNumber:1,acceptanceEvidence:[]},
    {reason:'EXTERNAL_BLOCKER',code:'IMPLEMENTATION_INCOMPLETE',operation:'Integration',observedError:'Substantial integration work remains',unblockedImplementationRemaining:[]},
    {reason:'EXTERNAL_BLOCKER',code:'HARDWARE_UNAVAILABLE',operation:'Hardware test',observedError:'The required audio hardware is not present',unblockedImplementationRemaining:['Implement the endpoint']}])
    assert.equal(unitHandoffReport(value),null);
});
test("CI-wait handoff requires complete implementation and immutable acceptance evidence",()=>{
  const good={reason:'IMPLEMENTATION_COMPLETE_WAITING_CI',implementationComplete:true,remainingImplementation:[],prNumber:1,
    acceptanceEvidence:['https://github.com/ci/fixture/blob/'+ 'a'.repeat(40)+'/tests/api.test.ts']};
  assert.deepEqual(unitHandoffReport(good),good);
  assert.equal(unitHandoffReport({...good,acceptanceEvidence:['https://github.com/ci/fixture/blob/main/tests/api.test.ts']}),null);
  assert.equal(unitHandoffReport({...good,remainingImplementation:['Add authorization checks']}),null);
});
test("external blockers require a specific observed operation and no unblocked implementation",()=>{
  const good={reason:'EXTERNAL_BLOCKER',code:'REPOSITORY_CREDENTIAL_UNAVAILABLE',operation:'Provider API integration',
    observedError:'The provider credential is not provisioned for this repository',unblockedImplementationRemaining:[]};
  assert.deepEqual(unitHandoffReport(good),good);
  assert.equal(unitHandoffReport({...good,observedError:'Unknown'}),null);
});
