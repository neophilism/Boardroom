import test from "node:test";
import assert from "node:assert/strict";
import {activationFinishBasis,ACTIVATION_STOP_REASONS,type SessionOutcome} from "../src/server/sessions.ts";

const now=new Date("2026-10-18T21:42:30Z");
const evidence={startedAt:new Date("2026-10-18T21:40:57Z"),now,maxSessionSeconds:3300,
  leaseExpiresAt:new Date("2026-10-18T21:44:00Z"),paused:false,usedTokens:0,maxTokens:100000,checkpointState:{
    reason:"Current interactive execution ending before safe scoped implementation and verification; preserve assignment state",
    checks:"Not executed or verified for current SHA",remoteChanges:"None"
  }};

test("reported 93-second analysis-only yield requires useful continuation",()=>{
  for(const outcome of ["YIELDED","BLOCKED","COMPLETED"] as SessionOutcome[])
    assert.equal(activationFinishBasis(outcome,evidence),null);
  for(const activationStop of [null,[],{reason:"RUNTIME_LIMIT",detail:"Done"},
    {reason:"TURN_FINISHED",detail:"I chose to end this interactive execution after reviewing files."}])
    assert.equal(activationFinishBasis("YIELDED",{...evidence,checkpointState:{activationStop}}),null);
});

test("concrete early limits and user stops remain possible and explicitly agent-reported",()=>{
  for(const reason of ACTIVATION_STOP_REASONS){
    const detail=reason==="USER_STOP"?"The owner explicitly requested cancellation of this activation.":
      "The host reported the documented execution limit and requested a checkpoint.";
    assert.deepEqual(activationFinishBasis("YIELDED",{...evidence,checkpointState:{activationStop:{reason,detail}}}),
      {source:"AGENT_REPORTED",reason,detail});
  }
  for(const outcome of ["FAILED","CANCELLED"] as const)
    assert.deepEqual(activationFinishBasis(outcome,evidence),{source:"AGENT_REPORTED",reason:outcome});
});

test("server work clocks, real release limits, pause and recorded usage allow finishing without a supplied reason",()=>{
  const cases=[
    [{startedAt:new Date(now.getTime()-3000000)},"WORK_TARGET_OR_RUNTIME_MARGIN"],
    [{maxSessionSeconds:120},"WORK_TARGET_OR_RUNTIME_MARGIN"],
    [{leaseExpiresAt:new Date(now.getTime()-1)},"LEASE_EXPIRED"],
    [{paused:true},"OWNER_PAUSED"],
    [{usedTokens:100000},"RECORDED_TOKEN_LIMIT"]
  ] as const;
  for(const [change,reason] of cases)
    assert.deepEqual(activationFinishBasis("YIELDED",{...evidence,...change}),{source:"SERVER_OBSERVED",reason});
});
