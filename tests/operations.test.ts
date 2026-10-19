import test from "node:test";
import assert from "node:assert/strict";
import {parseExecutionPolicy,recoverRun} from "../src/server/operations.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import type {Pool} from "pg";
test("merge policy requires named passing CI and never adds a human-review count",()=>{
  const valid={repositoryId:"1",autoMerge:true,requiredChecks:["verify","verify"]};
  assert.deepEqual(parseExecutionPolicy(valid).requiredChecks,["verify"]);
  assert.equal(parseExecutionPolicy(valid).minimumReviews,0);
  assert.equal(parseExecutionPolicy({...valid,minimumReviews:0}).minimumReviews,0);
  for(const p of [{...valid,requiredChecks:[]},{...valid,minimumReviews:1},
    {...valid,minimumReviews:-1},{...valid,repositoryId:"x"}])
    assert.throws(()=>parseExecutionPolicy(p),SessionConflict);
});
test("recovery cannot run based solely on expired heartbeat",async()=>{
  const db={connect:()=>{throw new Error("Must not access DB before verified termination");}} as unknown as Pool;
  await assert.rejects(recoverRun(db,"26741e83-9694-4fb3-8174-783b2f9bf61c",false),SessionConflict);
});
