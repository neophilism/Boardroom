import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {createWorkContinuation} from "../src/server/next-work.ts";
import {ChainHandoffRequired,type ChainHandoffReason} from "../src/server/chain.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import {RunnerBudgetBlocked} from "../src/server/budget-errors.ts";

const db={} as Pool,runId="26741e83-9694-4fb3-8174-783b2f9bf61c",credentialId="fixture",generation="7";
const assignment={assignmentId:"next",repositoryId:"2",fullName:"ci/next",unitId:"NEXT-001",generation:"8",expiresAt:"2026-10-18T22:00:00Z",replay:false};

for(const reason of ["MERGE_EVIDENCE_UNAVAILABLE","WORK_PLAN_CHANGED","WORK_INCOMPLETE"] as ChainHandoffReason[]){
  test("cached advance tool can safely hand off "+reason+" without asserting completion",async()=>{
    const calls:unknown[][]=[];
    const advance=createWorkContinuation({
      advance:async()=>{throw new ChainHandoffRequired(reason,"Source observation prevents chaining");},
      handoff:async(...args)=>{calls.push(args);return {status:"ASSIGNED",assignment};}
    });
    const result=await advance(db,runId,credentialId,generation);
    assert.deepEqual(calls,[[db,runId,credentialId,generation,"YIELDED"]]);
    assert.ok("assignment" in result);assert.equal(result.assignment?.generation,"8");
    assert.ok("handoffReason" in result);assert.equal(result.handoffReason,reason);
    assert.equal(result.continuationRequired,true);
  });
}

test("authority, paused execution, exhausted budget and unexpected errors never trigger a handoff",async()=>{
  const errors=[new SessionConflict("Current authorized repository lease unavailable"),new SessionConflict("Owner paused execution"),
    new SessionConflict("Session time budget exhausted; checkpoint and finish"),new SessionConflict("Work unit is no longer approved"),
    new SessionConflict("Current unit needs observed merge evidence before chaining: forged message"),
    new Error("Database unavailable"),new RunnerBudgetBlocked("BUDGET_LIMIT")];
  for(const error of errors){
    let handoffs=0;
    const advance=createWorkContinuation({advance:async()=>{throw error;},handoff:async()=>{handoffs++;return {status:"IDLE",assignment:null};}});
    await assert.rejects(advance(db,runId,credentialId,generation),candidate=>candidate===error);
    assert.equal(handoffs,0);
  }
});

test("failed checkpoint or ledger release validation is preserved without a retry",async()=>{
  const failure=new SessionConflict("Unreconciled GitHub operations require recovery before release");
  let handoffs=0;
  const advance=createWorkContinuation({
    advance:async()=>{throw new ChainHandoffRequired("MERGE_EVIDENCE_UNAVAILABLE","Read failed");},
    handoff:async()=>{handoffs++;throw failure;}
  });
  await assert.rejects(advance(db,runId,credentialId,generation),candidate=>candidate===failure);
  assert.equal(handoffs,1);
});

test("verified next-unit chaining keeps its assignment while exhausted merged work hands off completed",async()=>{
  const nextUnit={status:"NEXT_UNIT",repository:"ci/current",unitId:"CI-002",generation};
  const direct=createWorkContinuation({advance:async()=>nextUnit,handoff:async()=>{assert.fail("A same-repository chain must retain its lease");}});
  assert.deepEqual(await direct(db,runId,credentialId,generation),nextUnit);
  const outcomes:string[]=[];
  const exhausted=createWorkContinuation({
    advance:async()=>({status:"EXHAUSTED",repository:"ci/current"}),
    handoff:async(_db,_runId,_credentialId,_generation,outcome)=>{outcomes.push(outcome);return {status:"IDLE",assignment:null};}
  });
  const result=await exhausted(db,runId,credentialId,generation);
  assert.deepEqual(outcomes,["COMPLETED"]);assert.equal(result.status,"IDLE");
  assert.ok("continuationRequired" in result);assert.equal(result.continuationRequired,false);
});
