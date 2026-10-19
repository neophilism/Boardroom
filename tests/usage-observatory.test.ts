import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {getUsageObservatory} from "../src/server/usage-observatory.ts";

const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const another="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function fixture():Pool{
  const today=new Date().toISOString().slice(0,10);
  const response=(sql:string):Record<string,unknown>[]=>{
    if(sql.includes("FROM agent_credentials WHERE"))return [
      {credentialId:id,name:"R2",provider:"chatgpt"},
      {credentialId:another,name:"Eve",provider:"claude"}];
    if(sql.includes("FROM agent_runs WHERE started_at")&&sql.includes('AS "sessions24h"'))
      return [{credentialId:id,sessions24h:3,sessions7d:4,sessions30d:5,completed7d:2,
        failed7d:1,blocked7d:1,lastSeenAt:new Date("2026-10-17T10:00:00Z"),durationSeconds7d:"7200"}];
    if(sql.includes("FROM agent_runs ar"))return [
      {credentialId:id,activeNow:1,activeRepository:"neophilism/Garden"}];
    if(sql.includes("FROM usage_events ue JOIN agent_runs"))
      return [{credentialId:id,inputTokens24h:"10000",outputTokens24h:"5000",
        reportedMicro24h:"15000",reportedMicro7d:"150000",reportedMicro30d:"500000",reportedCalls7d:5}];
    if(sql.includes("FROM runner_budget_reservations rb"))
      return [{credentialId:id,pendingMicro24h:"200000"}];
    if(sql.includes("FROM audit_events ae JOIN agent_runs"))
      return [{credentialId:id,verifiedMerges7d:2,mergeDenials7d:3}];
    if(sql.includes("FROM usage_events ue WHERE"))
      return [{day:today,microUsd:"15000",calls:2}];
    if(sql.includes("FROM agent_runs\n"))return [{day:today,sessions:3}];
    if(sql.includes("FROM audit_events\n"))return [{day:today,merges:2}];
    if(sql.includes("(SELECT count(*)::int FROM agent_runs"))
      return [{recovering:1,outboxPending:4,outboxFailed:2,openOwnerActions:6,lastMaintenanceAt:new Date("2026-10-18T09:00:00Z")}];
    throw new Error("Unexpected SQL: "+sql);
  };
  return {query:async(sql:string)=>({rows:response(sql)})} as unknown as Pool;
}
test("usage observatory aggregates by verified credential and never fabricates native ChatGPT credits",async()=>{
  const data=await getUsageObservatory(fixture(),{NODE_ENV:"test",BOARDROOM_DAILY_COST_CAP_MICROUSD:"1000000"} as NodeJS.ProcessEnv);
  assert.equal(data.agents.length,2);
  const robot=data.agents.find(a=>a.name==="R2")!;
  assert.equal(robot.metering,"hosted-reported");
  assert.equal(robot.reportedUsd24h,0.015);
  assert.equal(robot.reportedUsd7d,0.15);
  assert.equal(robot.pendingMaximumUsd24h,0.2);
  assert.equal(robot.completedRuntimeHours7d,2);
  assert.equal(robot.verifiedMerges7d,2);
  assert.equal(robot.mergeDenials7d,3);
  assert.equal(robot.activeNow,1);
  assert.equal(robot.activeRepository,"neophilism/Garden");
  const nativeOnly=data.agents.find(a=>a.name==="Eve")!;
  assert.equal(nativeOnly.metering,"not-observed");
  assert.equal(nativeOnly.reportedCalls7d,0);
  assert.equal(data.summary.unmeteredAgents,1);
  assert.equal(data.summary.reportedUsd24h,0.015);
  assert.equal(data.summary.pendingMaximumUsd24h,0.2);
  assert.equal(data.summary.recovering,1);
  assert.equal(data.summary.outboxPending,4);
  assert.equal(data.summary.outboxFailed,2);
  assert.equal(data.summary.openOwnerActions,6);
  assert.equal(data.hostedRollingCapUsd,1);
  assert.equal(data.days.length,14);
  assert.equal(data.days.at(-1)?.reportedUsd,0.015);
  assert.equal(data.days.at(-1)?.sessions,3);
  assert.ok(data.limitations.some(line=>line.includes("ChatGPT Work credits")));
  assert.ok(!JSON.stringify(data).includes("secret"));
});
test("unconfigured spending cap is unavailable instead of an invented allowance",async()=>{
  const data=await getUsageObservatory(fixture(),{NODE_ENV:"test"} as NodeJS.ProcessEnv);
  assert.equal(data.hostedRollingCapUsd,null);
});
