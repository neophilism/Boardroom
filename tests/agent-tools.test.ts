import test from "node:test";
import assert from "node:assert/strict";
import {AGENT_TOOLS,validateAgentTool,AgentToolError} from "../src/server/agent-tools.ts";
test("MCP exposes scoped development operations and no owner administration",()=>{
  const names=AGENT_TOOLS.map(t=>t.name);
  assert.equal(new Set(names).size,names.length);
  assert.ok(names.includes("boardroom_source"));
  assert.ok(names.includes("boardroom_merge"));
  assert.ok(names.every(n=>!n.includes("register")&&!n.includes("secret")&&!n.includes("policy")));
});
test("tool name, required arguments, and extra authority fields fail closed",()=>{
  assert.deepEqual(validateAgentTool("boardroom_arrive",{}),{});
  for(const [name,args] of [["owner_register",{}],["boardroom_claim",{}],["boardroom_claim",{runId:"x",credentialId:"other"}]])
    assert.throws(()=>validateAgentTool(name as string,args),AgentToolError);
  assert.throws(()=>validateAgentTool("boardroom_claim",{runId:1}),AgentToolError);
  assert.throws(()=>validateAgentTool("boardroom_source",{runId:"x",generation:"1",kind:"admin"}),AgentToolError);
  for(const field of ["constructor","__proto__","toString"])
    assert.throws(()=>validateAgentTool("boardroom_arrive",JSON.parse('{"'+field+'":"unexpected"}')),AgentToolError);
});

test("Coffee questions require a bounded technical blocker classification",()=>{
  const base={runId:"run",subject:"Which repository test is failing?",question:"The database API integration test fails."};
  assert.throws(()=>validateAgentTool("boardroom_coffee_ask",base),AgentToolError);
  assert.deepEqual(validateAgentTool("boardroom_coffee_ask",{...base,classification:"TEST_FAILURE"}),{...base,classification:"TEST_FAILURE"});
  assert.throws(()=>validateAgentTool("boardroom_coffee_ask",{...base,classification:"OWNER_APPROVAL"}),AgentToolError);
});

test("Coffee answers require evidence and uncertainty at the MCP boundary",()=>{
  const base={runId:"run",threadId:"thread",answer:"The repository API test passes."};
  assert.throws(()=>validateAgentTool("boardroom_coffee_answer",base),AgentToolError);
  assert.deepEqual(validateAgentTool("boardroom_coffee_answer",{...base,
    evidence:["https://github.com/neophilism/Boardroom/pull/92"],uncertainty:"Production was not inspected."}),{...base,
    evidence:["https://github.com/neophilism/Boardroom/pull/92"],uncertainty:"Production was not inspected."});
});

test("continuation accepts only fenced truthful assignment outcomes",()=>{
  assert.ok(AGENT_TOOLS.some(tool=>tool.name==="boardroom_yield_and_claim"));
  for(const outcome of ["BLOCKED","YIELDED","COMPLETED"])
    assert.equal(validateAgentTool("boardroom_yield_and_claim",{runId:"run",generation:"1",outcome}).outcome,outcome);
  for(const outcome of ["MERGED","ACCEPTED","FAILED","UNKNOWN"])
    assert.throws(()=>validateAgentTool("boardroom_yield_and_claim",{runId:"run",generation:"1",outcome}),AgentToolError);
});
