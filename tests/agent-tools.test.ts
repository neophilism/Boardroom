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
});
