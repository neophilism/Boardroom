import test from "node:test";
import assert from "node:assert/strict";
import {authorizedWatchdogToken,scanStaleSessions} from "../src/server/watchdog.ts";
import type {Pool,PoolClient} from "pg";
const token="watchdog_test_0123456789ABCDEFGHIJKLMNOPQRSTUV";
test("watchdog uses a separate constant-time token",()=>{
  assert.equal(authorizedWatchdogToken("Bearer "+token,token),true);
  assert.equal(authorizedWatchdogToken("Bearer wrong",token),false);
  assert.equal(authorizedWatchdogToken("Bearer "+token,undefined),false);
  assert.equal(authorizedWatchdogToken("Bearer "+token,"short"),false);
});
function fake(responses:Array<{rows?:unknown[];count?:number}>){
  const statements:string[]=[];
  const parameters:unknown[][]=[];
  let n=0;
  const client={query:async(sql:string,values:unknown[]=[])=>{
      statements.push(sql);
      parameters.push(values);
      const a=responses[n++];
      if(!a)throw new Error("Unexpected SQL "+n+": "+sql);
      return {rows:a.rows??[],rowCount:a.count??a.rows?.length??0};
    },release:()=>{}} as unknown as PoolClient;
  return {db:{connect:async()=>client} as unknown as Pool,statements,parameters};
}
test("no expired runs means no change to leases or running sessions",async()=>{
  const x=fake([{}, {rows:[]}, {}]);
  assert.deepEqual(await scanStaleSessions(x.db),{examined:0,heldForRecovery:0,renewedMeanwhile:0,ownerRequestsCreated:0});
  assert.ok(x.statements[1].includes("SKIP LOCKED"));
  assert.ok(!x.statements.some(s=>s.startsWith("UPDATE repository_leases")));
});
test("a renewed lease after waiting for the lock is not misclassified",async()=>{
  const x=fake([{}, {rows:[{run_id:"run",repository_id:"123",generation:"2",expires_at:new Date(0)}]},
    {rows:[{run_id:"run",generation:"2",expires_at:new Date(Date.now()+60000)}]},{}]);
  const out=await scanStaleSessions(x.db);
  assert.equal(out.renewedMeanwhile,1);
  assert.equal(out.heldForRecovery,0);
});
test("reject invalid scan limits without connecting",async()=>{
  const x=fake([]);
  await assert.rejects(scanStaleSessions(x.db,0));
  await assert.rejects(scanStaleSessions(x.db,101));
  assert.equal(x.statements.length,0);
});

test("scoped native recovery classification creates no human approval request",async()=>{
  const x=fake([{}, {rows:[{run_id:"run",repository_id:"123",generation:"2",expires_at:new Date(0),native_oauth:true}]},
    {rows:[{run_id:"run",generation:"2",expires_at:new Date(0)}]},{count:1},{count:1},{}]);
  const result=await scanStaleSessions(x.db,1,"credential");
  assert.equal(result.heldForRecovery,1);assert.equal(result.ownerRequestsCreated,0);
  assert.deepEqual(x.parameters[1],[1,"credential"]);
  assert.ok(x.statements[1].includes("ar.credential_id=$2::uuid"));
  assert.ok(!x.statements.some(sql=>sql.includes("INSERT INTO owner_actions")));
});

test("a lease locked by an in-flight gateway write is deferred without changing its run",async()=>{
  const x=fake([{}, {rows:[{run_id:"run",repository_id:"123",generation:"2",expires_at:new Date(0),native_oauth:true}]},
    {rows:[]},{}]);
  const result=await scanStaleSessions(x.db);
  assert.equal(result.heldForRecovery,0);assert.equal(result.renewedMeanwhile,1);
  assert.ok(x.statements[2].includes("FOR UPDATE SKIP LOCKED"));
  assert.ok(!x.statements.some(sql=>sql.startsWith("UPDATE agent_runs")));
});

test("native recovery refuses invalid limits",async()=>{
  const x=fake([]);
  const {recoverFencedOAuthSessions}=await import("../src/server/watchdog.ts");
  await assert.rejects(recoverFencedOAuthSessions(x.db,0));
  await assert.rejects(recoverFencedOAuthSessions(x.db,101));
});
test("native recovery limits its candidate query to the authenticated credential",async()=>{
  const {recoverFencedOAuthSessions}=await import("../src/server/watchdog.ts");
  const x=fake([{}, {rows:[]},{}]);
  await recoverFencedOAuthSessions(x.db,1,"credential");
  assert.deepEqual(x.parameters[1],[1,"credential"]);
  assert.ok(x.statements[1].includes("ar.credential_id=$2::uuid"));
});
test("native recovery preserves OAuth credentials and fences the old generation",async()=>{
  const {recoverFencedOAuthSessions}=await import("../src/server/watchdog.ts");
  const x=fake([{}, {rows:[{run_id:"run",repository_id:"123",generation:"2",expires_at:new Date(0)}]},
    {rows:[{run_id:"run",generation:"2",expires_at:new Date(0)}]},
    {rows:[{assignment_id:"assigned",lease_generation:"2"}]},
    {rows:[]},{rows:[]},{count:1},{count:1},{count:1},{count:1},{count:1},{}]);
  const result=await recoverFencedOAuthSessions(x.db);
  assert.equal(result.released,1);
  assert.ok(x.statements.some(s=>s.includes("generation=generation+1")));
  assert.ok(!x.statements.some(s=>s.startsWith("UPDATE agent_credentials")));
  assert.ok(x.statements.some(s=>s.includes("agent.run.oauth_fenced_and_released")));
});
test("native recovery holds uncertain GitHub effects and does not release a lease",async()=>{
  const {recoverFencedOAuthSessions}=await import("../src/server/watchdog.ts");
  const x=fake([{}, {rows:[{run_id:"run",repository_id:"123",generation:"2",expires_at:new Date(0)}]},
    {rows:[{run_id:"run",generation:"2",expires_at:new Date(0)}]},
    {rows:[{assignment_id:"assigned",lease_generation:"2"}]},{rows:[]},{rows:[{exists:1}]},{}]);
  const result=await recoverFencedOAuthSessions(x.db);
  assert.equal(result.released,0);
  assert.equal(result.heldForAmbiguousWrites,1);
  assert.ok(!x.statements.some(s=>s.startsWith("UPDATE repository_leases")));
});
