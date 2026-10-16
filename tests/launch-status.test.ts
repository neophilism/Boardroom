import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {getLaunchStatus} from "../src/server/launch-status.ts";

test("empty or connected identities do not manufacture scheduled acceptance",async()=>{
  const agents=[{credentialId:"fixture",name:"Smith",provider:"chatgpt",connected:true,
    activations:1,assignments:0,lastActivationAt:new Date("2026-10-16T12:00:00Z")}];
  const db={query:async(sql:string)=>({rows:sql.includes("FROM agent_credentials c")?agents:
    sql.includes("FROM execution_controls")?[{paused:false,plans:37,merges:0}]:[]})} as unknown as Pool;
  const status=await getLaunchStatus(db);
  assert.equal(status.agents[0].connected,true);
  assert.equal(status.agents[0].assignments,0);
  assert.equal(status.automaticMergeRepositories,0);
  assert.deepEqual(status.recordedIntegrationGates,[]);
  assert.equal(status.lastMaintenanceAt,null);
  assert.equal(Object.hasOwn(status,"scheduledWorkTested"),false);
});
test("a missing launch control observation fails instead of showing ready",async()=>{
  const db={query:async()=>({rows:[]})} as unknown as Pool;
  await assert.rejects(getLaunchStatus(db),/Launch configuration unavailable/);
});
