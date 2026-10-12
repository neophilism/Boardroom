import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {finishIdleSession} from "../src/server/idle-session.ts";
import {SessionConflict} from "../src/server/sessions.ts";

const id="26741e83-9694-4fb3-8174-783b2f9bf61c";
type Step={match:RegExp,rows?:unknown[],count?:number};
function fake(steps:Step[]){
  let cursor=0;
  const calls:string[]=[];
  const client={
    query:async(sql:string)=>{
      const step=steps[cursor++];
      if(!step||!step.match.test(sql))throw new Error("Unexpected SQL "+cursor+": "+sql);
      calls.push(sql);
      const rows=step.rows??[];
      return {rowCount:step.count??rows.length,rows};
    },
    release:()=>{}
  } as unknown as PoolClient;
  return {db:{connect:async()=>client} as unknown as Pool,calls,get consumed(){return cursor}};
}
test("unassigned admitted run ends cleanly after Coffee Corner, with no lease change",async()=>{
  const x=fake([
    {match:/^BEGIN/},
    {match:/FROM agent_runs.*FOR UPDATE/,rows:[{state:"ADMITTED"}]},
    {match:/FROM work_assignments/,rows:[]},
    {match:/FROM repository_leases/,rows:[]},
    {match:/UPDATE agent_runs/,count:1},
    {match:/INSERT INTO audit_events/},
    {match:/^COMMIT/}
  ]);
  assert.deepEqual(await finishIdleSession(x.db,id,"cred"),{state:"YIELDED",replay:false});
  assert.equal(x.consumed,7);
  assert.ok(!x.calls.some(sql=>sql.includes("UPDATE repository_leases")));
});
test("repeated successful idle finish is idempotent",async()=>{
  const x=fake([
    {match:/^BEGIN/},
    {match:/FROM agent_runs.*FOR UPDATE/,rows:[{state:"YIELDED"}]},
    {match:/^COMMIT/}
  ]);
  assert.deepEqual(await finishIdleSession(x.db,id,"cred"),{state:"YIELDED",replay:true});
});
test("running assigned sessions must use fenced finish and cannot be ended as idle",async()=>{
  const x=fake([
    {match:/^BEGIN/},
    {match:/FROM agent_runs.*FOR UPDATE/,rows:[{state:"RUNNING"}]},
    {match:/^ROLLBACK/}
  ]);
  await assert.rejects(finishIdleSession(x.db,id,"cred"),SessionConflict);
});
test("open assignment prevents idle completion even if state is stale",async()=>{
  const x=fake([
    {match:/^BEGIN/},
    {match:/FROM agent_runs.*FOR UPDATE/,rows:[{state:"ADMITTED"}]},
    {match:/FROM work_assignments/,rows:[{exists:1}]},
    {match:/^ROLLBACK/}
  ]);
  await assert.rejects(finishIdleSession(x.db,id,"cred"),SessionConflict);
});
test("invalid run IDs fail before touching storage",async()=>{
  const x=fake([]);
  await assert.rejects(finishIdleSession(x.db,"../bad","cred"),SessionConflict);
  assert.equal(x.consumed,0);
});
