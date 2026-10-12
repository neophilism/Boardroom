import test from "node:test";
import assert from "node:assert/strict";
import {classifyLease,formatEastern} from "../src/domain/work-board.ts";
const now=Date.parse("2026-10-12T14:00:00Z");
test("unassigned repository never appears as active",()=>{
  assert.equal(classifyLease({runId:null,runState:null,leaseExpiresAt:null,lastHeartbeatAt:null},now),"UNASSIGNED");
});
test("verified running lease with positive expiry is labeled RUNNING, not completed",()=>{
  assert.equal(classifyLease({runId:"run",runState:"RUNNING",leaseExpiresAt:"2026-10-12T14:03:00Z",lastHeartbeatAt:"2026-10-12T13:59:45Z"},now),"RUNNING");
});
test("expired or recovering leases never look healthy",()=>{
  assert.equal(classifyLease({runId:"run",runState:"RUNNING",leaseExpiresAt:"2026-10-12T13:59:00Z",lastHeartbeatAt:"2026-10-12T13:58:00Z"},now),"RECOVERING");
  assert.equal(classifyLease({runId:"run",runState:"RECOVERING",leaseExpiresAt:"2026-10-12T14:03:00Z",lastHeartbeatAt:null},now),"RECOVERING");
  assert.equal(classifyLease({runId:"run",runState:"UNKNOWN",leaseExpiresAt:"2026-10-12T14:03:00Z",lastHeartbeatAt:null},now),"UNKNOWN");
  assert.equal(classifyLease({runId:"run",runState:"RUNNING",leaseExpiresAt:null,lastHeartbeatAt:null},now),"UNKNOWN");
});
test("development timestamps display Eastern Time without inventing source events",()=>{
  assert.match(formatEastern("2026-10-12T14:00:00Z"),/EDT/);
  assert.equal(formatEastern(null),"No verified update");
});
