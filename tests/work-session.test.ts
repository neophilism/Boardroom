import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {TARGET_WORK_SECONDS,workSession} from "../src/domain/work-session.ts";
import {SCHEDULED_AGENT_INSTRUCTION} from "../src/domain/scheduled-instruction.ts";
import {executeAgentTool} from "../src/server/agent-tools.ts";
import type {Pool} from "pg";
const start=new Date("2026-10-18T18:00:00Z");
test("one 50-minute target spans project handoffs with a five-minute release margin",()=>{
  const first=workSession(start,3300,start.getTime()+120000);
  const next=workSession(start,3300,start.getTime()+1800000);
  assert.equal(TARGET_WORK_SECONDS,3000);
  assert.equal(first.workUntilAt,"2026-10-18T18:50:00.000Z");
  assert.equal(first.deadlineAt,"2026-10-18T18:55:00.000Z");
  assert.equal(next.workUntilAt,first.workUntilAt);assert.equal(next.remainingWorkSeconds,1200);
  assert.equal(next.shouldContinue,true);
  assert.equal(workSession(start,3300,start.getTime()+3000000).shouldContinue,false);
  assert.equal(workSession(start,120,start.getTime()+61000).shouldContinue,false);
  assert.equal(workSession(start,120).targetFitsRuntime,false);
});
test("profile supplies current shared work instructions to older installed connections",async()=>{
  const profile=await executeAgentTool({} as Pool,{credentialId:"fixture",label:"HAL 9000",provider:"chatgpt"},"boardroom_profile",{});
  assert.ok("scheduledInstruction" in profile);
  assert.equal(profile.scheduledInstruction,SCHEDULED_AGENT_INSTRUCTION);
});
test("launch instruction and copyable protocol are identical and require continuation without empty polling",async()=>{
  const doc=await readFile(new URL("../docs/SCHEDULED_AGENT_PROTOCOL.md",import.meta.url),"utf8");
  const prompt=doc.slice(doc.indexOf("> Policy version:"),doc.indexOf("\n## Supported integration boundary")).trim().split("\n").map(line=>line.replace(/^> ?/,"")).join("\n");
  assert.equal(prompt,SCHEDULED_AGENT_INSTRUCTION);
  for(const text of ["budgeted-native-v3","12 minutes","15 minutes","BUDGET_PAUSED","boardroom_yield_and_claim","SAME runId","imported branch names"])
    assert.ok(prompt.includes(text),text);
});

test("combined recovery policy preserves recurrence and truthful failure handling without ending normal handoffs",()=>{
  for(const text of ["Never create another schedule or change your own recurrence", "server-verified identity", "permission bypass", "Do not spend the session polling pending CI", "A failed checkpoint must not prevent a best-effort boardroom_finish attempt", "Do not call boardroom_finish after an ordinary PR handoff", "SAME runId", "12 minutes"])
    assert.ok(SCHEDULED_AGENT_INSTRUCTION.includes(text),text);
});
