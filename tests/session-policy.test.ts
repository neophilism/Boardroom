import test from "node:test";
import assert from "node:assert/strict";
import { isValidRunId,isValidGeneration,parseSessionOutcome,isTerminalSessionState,validateCheckpoint,SessionConflict } from "../src/server/sessions.ts";

test("session identity and fencing generation have strict formats",()=>{
  assert.equal(isValidRunId("7d54a632-94aa-4a9b-b84f-58ebaa0c7208"),true);
  assert.equal(isValidRunId("bogus"),false);
  assert.equal(isValidGeneration("1"),true);
  assert.equal(isValidGeneration("0"),false);
  assert.equal(isValidGeneration("-1"),false);
  assert.equal(isValidGeneration(1),false);
});
test("session outcome is independent from PR acceptance",()=>{
  assert.equal(parseSessionOutcome("COMPLETED"),"COMPLETED");
  assert.equal(parseSessionOutcome("YIELDED"),"YIELDED");
  assert.throws(()=>parseSessionOutcome("ACCEPTED"),SessionConflict);
});
test("checkpoint payload rejects oversized, malformed or invalid remote references",()=>{
  assert.deepEqual(validateCheckpoint({branch:"boardroom/BR-017",headSha:null,state:{remaining:["CI"]}}),{
    branch:"boardroom/BR-017",headSha:null,state:{remaining:["CI"]}
  });
  assert.throws(()=>validateCheckpoint({branch:"../escape",state:{}}));
  assert.throws(()=>validateCheckpoint({headSha:"abc",state:{}}));
  assert.throws(()=>validateCheckpoint({state:{notes:"x".repeat(20000)}}));
});

test("terminal state classification",()=>{ assert.equal(isTerminalSessionState("CANCELLED"),true); assert.equal(isTerminalSessionState("RECOVERING"),false); });
