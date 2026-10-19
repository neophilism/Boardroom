import test from "node:test";
import assert from "node:assert/strict";
import {parseSessionStop,requireScheduledHandoff,EARLY_CANCELLATION_FALLBACK} from "../src/server/scheduled-completion.ts";
import {activationFinishBasis} from "../src/server/sessions.ts";
import {validateAgentTool} from "../src/server/agent-tools.ts";
import type {Pool} from "pg";
import type {readAssignedPrEvidence} from "../src/server/pr-evidence.ts";
test("early hard stops require bounded, secret-free observed evidence",()=>{
  assert.equal(parseSessionStop(undefined),undefined);
  assert.deepEqual(parseSessionStop({reason:'RUNTIME_LIMIT',evidence:'The host returned its actual deadline error'}),{
    reason:'RUNTIME_LIMIT',evidence:'The host returned its actual deadline error'});
  for(const value of [null,{},'done',{reason:'PENDING_CI',evidence:'CI pending is unit-scoped'},
    {reason:'RUNTIME_LIMIT',evidence:''},{reason:'RESOURCE_LIMIT',evidence:'x'.repeat(1001)},
    {reason:'CAPABILITY_UNAVAILABLE',evidence:'password='+ 'x'.repeat(30)}])assert.throws(()=>parseSessionStop(value));
});
test("a CI-wait handoff checks the assigned PR's actual head and keeps failing or historical work on the current unit",async()=>{
  const run='26741e83-9694-4fb3-8174-783b2f9bf61c',head='a'.repeat(40);
  let audits=0;
  const db={query:async(sql:string)=>{
    if(sql.includes('COALESCE(p.max_session_seconds'))return {rowCount:1,rows:[{
      state:'RUNNING',generation:'1',live:true,repository_id:'1',unit_id:'CI-001',unit_state:'OPEN_PR',checkpoint_head:head,
      checkpoint_state:{unitHandoff:{reason:'IMPLEMENTATION_COMPLETE_WAITING_CI',implementationComplete:true,
        remainingImplementation:[],prNumber:1,acceptanceEvidence:['https://github.com/ci/fixture/blob/'+head+'/tests/api.test.ts']}}}]};
    if(sql.includes('registry_prerequisites_satisfied'))return {rowCount:1,rows:[{}]};
    if(sql.includes('INSERT INTO audit_events')){audits++;return {rowCount:1,rows:[]};}
    throw new Error('Unexpected query');
  }} as unknown as Pool;
  const reader=(assessment:string,sha=head,relationship='ASSIGNED_WORK')=>(async()=>({
    pullRequest:{headSha:sha,relationship},checks:{assessment}})) as unknown as typeof readAssignedPrEvidence;
  await requireScheduledHandoff(db,run,'credential','1',reader('PENDING'));
  assert.equal(audits,1);
  for(const read of [reader('FAILED'),reader('OBSERVED_PASS'),reader('PENDING','b'.repeat(40)),reader('PENDING',head,'HISTORICAL_CONTRIBUTION')])
    await assert.rejects(requireScheduledHandoff(db,run,'credential','1',read),/Continue the current approved unit/);
  assert.equal(audits,1);
});
test("old finish signatures still validate; new schemas carry an explicit early stop",()=>{
  const old={runId:'fixture',generation:'1',outcome:'YIELDED'};
  assert.deepEqual(validateAgentTool('boardroom_finish',old),old);
  const sessionStop={reason:'CAPABILITY_UNAVAILABLE',evidence:'An observed tool outage affects the entire activation'};
  assert.deepEqual(validateAgentTool('boardroom_finish',{...old,sessionStop}),{...old,sessionStop});
  assert.deepEqual(validateAgentTool('boardroom_finish_idle',{runId:'fixture',sessionStop}),{runId:'fixture',sessionStop});
});


test("a normal early finish is rejected, while truthful incomplete cancellation has a safe release basis",()=>{
  const evidence={startedAt:new Date("2026-10-19T18:22:00Z"),now:new Date("2026-10-19T18:25:00Z"),
    maxSessionSeconds:3300,leaseExpiresAt:new Date("2026-10-19T18:37:00Z"),paused:false,
    usedTokens:0,maxTokens:100000,checkpointState:{nextAction:"complete unfinished acceptance"}};
  assert.equal(activationFinishBasis("COMPLETED",evidence),null);
  assert.deepEqual(activationFinishBasis("CANCELLED",evidence),{source:"AGENT_REPORTED",reason:"CANCELLED"});
  for(const expected of ["outcome=CANCELLED","incomplete early cancellation","Do not cancel","unverified"])
    assert.ok(EARLY_CANCELLATION_FALLBACK.includes(expected),expected);
});
