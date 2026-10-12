import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { admitAgentRun } from "../src/server/admission.ts";
import type { Pool, PoolClient } from "pg";

const principal={credentialId:"cred-1",label:"Smith",provider:"chatgpt"};
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
    {match:/SELECT 1 FROM agent_runs/,rows:[]},
    {match:/INSERT INTO agent_runs/,rows:[{run_id:"run-new",state:"ADMITTED"}]},
    {match:/INSERT INTO audit_events/},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,null),{kind:"CREATED",runId:"run-new",state:"ADMITTED"});
  assert.equal(x.consumed,7);
});

test("new activation cannot obtain the existing running session id",async()=>{
  const x=fakeClient([
    {match:/BEGIN/},
    {match:/agent_credentials.*FOR UPDATE/,rows:[{credential_id:"cred-1"}]},
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[{run_id:"old",state:"RUNNING",stale_admitted:false}]},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,null),{kind:"BUSY",runId:null,state:"ALREADY_ACTIVE"});
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
    {match:/FROM agent_runs.*FOR UPDATE/s,rows:[{run_id:"stale",state:"UNKNOWN",stale_admitted:false}]},
    {match:/COMMIT/}
  ]);
  assert.deepEqual(await admitAgentRun(x.pool,principal,null),{kind:"BUSY",runId:null,state:"RECOVERY_REQUIRED"});
});

test("DB enforces one active run per credential independent of application code",()=>{
  const sql=readFileSync(new URL("../db/migrations/0005_single_active_run_per_named_agent.sql",import.meta.url),"utf8");
  assert.match(sql,/CREATE UNIQUE INDEX/);
  assert.match(sql,/agent_runs\(credential_id\)/);
  assert.match(sql,/state IN \('ADMITTED','RUNNING','RECOVERING','UNKNOWN'\)/);
});
