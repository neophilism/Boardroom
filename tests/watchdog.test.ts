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
  let n=0;
  const client={query:async(sql:string)=>{
      statements.push(sql);
      const a=responses[n++];
      if(!a)throw new Error("Unexpected SQL "+n+": "+sql);
      return {rows:a.rows??[],rowCount:a.count??a.rows?.length??0};
    },release:()=>{}} as unknown as PoolClient;
  return {db:{connect:async()=>client} as unknown as Pool,statements};
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
