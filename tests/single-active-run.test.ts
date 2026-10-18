import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { admitAgentRun } from "../src/server/admission.ts";
import type { Pool, PoolClient } from "pg";

const principal={credentialId:"cred-1",label:"Smith",provider:"chatgpt"};
const startedAt=new Date("2026-10-18T21:00:00Z"),lastSeenAt=new Date("2026-10-18T21:02:00Z");
const expiresAt=new Date("2026-10-18T21:05:00Z");
const liveRun={run_id:"old",state:"RUNNING",stale_admitted:false,lease_expired:false,
  started_at:startedAt,last_seen_at:lastSeenAt,lease_expires_at:expiresAt};
const diagnostic={classification:"ACTIVE_LEASE",startedAt:startedAt.toISOString(),
  lastSeenAt:lastSeenAt.toISOString(),leaseExpiresAt:expiresAt.toISOString()};
function fakeClient(steps: Array<{match: RegExp, rows?: unknown[], rowCount?: number}>) {
  let index=0;
  const queries: string[]=[];
  const client={
    query: async (sql:string) => {
      const step=steps[index++];
      if (!step || !step.match.test(sql)) throw new Error("Unexpected SQL statement "+index+": "+sql);
      queries.push(sql);
      const rows=step.rows||[];
      return {rowCount:step.rowCount ?? rows.length,rows};
    },
    release:()=>{}
  } as unknown as PoolClient;
  return {pool:{connect:async()=>client} as unknown as Pool,queries,get consumed(){return index}};
}

test("new activation is serialized by credential row and receives a fresh run id",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},
    {match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[]},
    {match:/INSERT INTO agent_runs/,rows:[{run_id:"run-new",state:"ADMITTED"}]},
    {match:/INSERT INTO audit_events/},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,null),{kind:"CREATED",runId:"run-new",state:"ADMITTED"});
  assert.equal(x.consumed,6);
});

test("new activation cannot obtain the existing running session id",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},
    {match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[liveRun]},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,null),{kind:"BUSY",runId:null,state:"ALREADY_ACTIVE",activeSession:diagnostic});
  assert.equal(x.consumed,4);
});

test("same trusted activation key is idempotent, not a second run",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},
    {match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/activation_dedupe_hash/,rows:[{run_id:"original",state:"ADMITTED"}]},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,"digest"),{kind:"REPLAY",runId:"original",state:"ADMITTED"});
});

test("expired heartbeats on a running session never permit concurrent work",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},
    {match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[{...liveRun,state:"UNKNOWN"}]},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,{...principal,provider:"test"},null),{
    kind:"BUSY",runId:null,state:"RECOVERY_REQUIRED",activeSession:{...diagnostic,classification:"RECOVERY_HELD"}});
});

test("a RUNNING row with an expired lease is diagnosed as recovery, not healthy overlap",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},{match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[{...liveRun,lease_expired:true}]},{match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,{...principal,provider:"test"},null),{
    kind:"BUSY",runId:null,state:"RECOVERY_REQUIRED",activeSession:{...diagnostic,classification:"EXPIRED_LEASE"}});
});

test("an abandoned admission with an orphaned lease cannot be silently cancelled",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},{match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[{...liveRun,state:"ADMITTED",stale_admitted:true}]},
    {match:/work_assignments.*UNION ALL SELECT 1 FROM repository_leases/s,rows:[{exists:1}]},
    {match:/COMMIT/}
  ]);
  const result=await admitAgentRun(x.pool,{...principal,provider:"test"},null);
  assert.equal(result.kind,"BUSY");assert.equal(result.state,"RECOVERY_REQUIRED");
  assert.ok(!x.queries.some(sql=>sql.startsWith("UPDATE agent_runs")));
});

test("DB enforces one active run per credential independent of application code",()=>{
  const sql=readFileSync(new URL("../db/migrations/0005_single_active_run_per_named_agent.sql",import.meta.url),"utf8");
  assert.match(sql,/CREATE UNIQUE INDEX/);
  assert.match(sql,/agent_runs\(credential_id\)/);
  assert.match(sql,/state IN \('ADMITTED','RUNNING','RECOVERING','UNKNOWN'\)/);
});
