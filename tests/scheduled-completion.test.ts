import test from "node:test";
import assert from "node:assert/strict";
import {parseSessionStop} from "../src/server/scheduled-completion.ts";
import {validateAgentTool} from "../src/server/agent-tools.ts";
test("early hard stops require bounded, secret-free observed evidence",()=>{
  assert.equal(parseSessionStop(undefined),undefined);
  assert.deepEqual(parseSessionStop({reason:'RUNTIME_LIMIT',evidence:'The host returned its actual deadline error'}),{
    reason:'RUNTIME_LIMIT',evidence:'The host returned its actual deadline error'});
  for(const value of [null,{},'done',{reason:'PENDING_CI',evidence:'CI pending is unit-scoped'},
    {reason:'RUNTIME_LIMIT',evidence:''},{reason:'RESOURCE_LIMIT',evidence:'x'.repeat(1001)},
    {reason:'CAPABILITY_UNAVAILABLE',evidence:'password='+ 'x'.repeat(30)}])assert.throws(()=>parseSessionStop(value));
});
test("old finish signatures still validate; new schemas carry an explicit early stop",()=>{
  const old={runId:'fixture',generation:'1',outcome:'YIELDED'};
  assert.deepEqual(validateAgentTool('boardroom_finish',old),old);
  const sessionStop={reason:'CAPABILITY_UNAVAILABLE',evidence:'An observed tool outage affects the entire activation'};
  assert.deepEqual(validateAgentTool('boardroom_finish',{...old,sessionStop}),{...old,sessionStop});
  assert.deepEqual(validateAgentTool('boardroom_finish_idle',{runId:'fixture',sessionStop}),{runId:'fixture',sessionStop});
});
