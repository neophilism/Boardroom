import test from "node:test";
import assert from "node:assert/strict";
import {activityCursor,eventDescription,githubEvidenceUrl,safeEventPaths,safeUuidLink} from "../src/domain/agent-activity.ts";
import type {Pool} from "pg";
import {AGENT_ACTIVITY_QUERY,classifyAgentActivity,listReservedAgentNames,getAgentActivity,type AgentActivityRow} from "../src/server/agent-activity.ts";
test("activity pages accept bounded integer pagination only",()=>{
  assert.equal(activityCursor("12345"),"12345");
  for(const v of [undefined,null,"0","01","-1","1 OR 1=1","1".repeat(50)])assert.equal(activityCursor(v),null);
});
test("evidence links are limited to valid GitHub repository identities",()=>{
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","pull","15"),"https://github.com/neophilism/TrackZero/pull/15");
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","commit","a".repeat(40)),"https://github.com/neophilism/TrackZero/commit/"+"a".repeat(40));
  assert.equal(githubEvidenceUrl("evil/a/../../x","pull","15"),null);
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","commit","javascript:alert(1)"),null);
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","pull","1?hack"),null);
});
test("safe activity fields are bounded without revealing raw audit payloads",()=>{
  assert.equal(eventDescription("github.write.commit_files"),"Files committed");
  assert.deepEqual(safeEventPaths(["src/main.ts",4,"bad\nname","x".repeat(300)]),["src/main.ts"]);
  assert.equal(safeUuidLink("not-a-uuid"),null);
  assert.equal(safeUuidLink("db226a76-256f-42ba-b510-6a3803aabbee"),"db226a76-256f-42ba-b510-6a3803aabbee");
});


const fixture:AgentActivityRow={
  name:"Joi",provider:"chatgpt",accountEmail:"joi@example.test",accountSlot:null,credentialId:"id",
  lastRunState:"RUNNING",lastStartedAt:null,activeRunId:"run",activeRunState:"RUNNING",
  currentUnitId:"BR-001",assignedAt:null,currentProject:"neophilism/Boardroom",
  leaseExpiresAt:new Date("2026-10-17T15:00:00Z"),lastHeartbeatAt:new Date("2026-10-17T14:58:00Z"),
  leaseMatches:true,previousProject:null,previousUnitId:null,previousReleasedAt:null
};
test("agent status reads only actual credentials, run assignments, repositories and leases",()=>{
  for(const name of ["agent_credentials","agent_name_reservations","agent_runs","work_assignments","repository_leases","repositories"])
    assert.ok(AGENT_ACTIVITY_QUERY.includes(name));
  assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(AGENT_ACTIVITY_QUERY));
  assert.ok(AGENT_ACTIVITY_QUERY.includes("wa.released_at IS NULL"));
  assert.ok(AGENT_ACTIVITY_QUERY.includes("l.generation=wa.lease_generation"));
});
test("lease status never fabricates healthy work",()=>{
  const now=Date.parse("2026-10-17T14:59:00Z");
  assert.equal(classifyAgentActivity(fixture,now),"RUNNING");
  assert.equal(classifyAgentActivity({...fixture,leaseExpiresAt:new Date("2026-10-17T14:00:00Z")},now),"RECOVERING");
  assert.equal(classifyAgentActivity({...fixture,leaseMatches:false},now),"UNKNOWN");
  assert.equal(classifyAgentActivity({...fixture,activeRunId:null,currentProject:null},now),"IDLE");
  assert.equal(classifyAgentActivity({...fixture,credentialId:null,activeRunId:null},now),"NOT REGISTERED");
  assert.equal(classifyAgentActivity({...fixture,activeRunId:null,lastRunState:"ADMITTED"},now),"ARRIVED");
});
test("manual status snapshot is read-only and returns a single observed moment",async()=>{
  const called:string[]=[];
  const db={query:async(sql:string)=>{called.push(sql);return {rows:sql===AGENT_ACTIVITY_QUERY?[fixture]:[{name:"CASE",accountSlot:2}]}}} as unknown as Pool;
  const observed=await getAgentActivity(db);
  assert.equal(observed.agents[0].name,"Joi");
  assert.equal(called.length,1);
  const reserved=await listReservedAgentNames(db);
  assert.deepEqual(reserved,[{name:"CASE",accountSlot:2}]);
});
