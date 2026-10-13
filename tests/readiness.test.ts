import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {REQUIRED_CONFIG,REQUIRED_MIGRATIONS,environmentReady,checkReadiness} from "../src/server/readiness.ts";
const env=Object.fromEntries(REQUIRED_CONFIG.map(x=>[x,"x".repeat(40)])) as NodeJS.ProcessEnv;
const rows=MIGRATION_MANIFEST.map(migration=>({...migration}));
function database(evidence:readonly {filename:string;sha256:string}[]):Pool{
  return {query:async()=>({rows:evidence})} as unknown as Pool;
}
test("missing configuration fails closed without printing values",()=>{
  assert.equal(environmentReady({} as NodeJS.ProcessEnv),false);
  assert.equal(environmentReady(env),true);
  assert.equal(environmentReady({...env,BOARDROOM_SESSION_SECRET:"short"}),false);
});
test("all exact migration fingerprints mean infrastructure ready only",async()=>{
  assert.equal(await checkReadiness(database(rows),env),true);
});
test("the five-migration deployment is not execution-schema ready",async()=>{
  assert.ok(REQUIRED_MIGRATIONS.includes("0006_execution_controls.sql"));
  assert.equal(await checkReadiness(database(rows.filter(row=>row.filename!=="0006_execution_controls.sql")),env),false);
});
test("every required migration is independently required",async()=>{
  for(const missing of rows){
    assert.equal(await checkReadiness(database(rows.filter(row=>row.filename!==missing.filename)),env),false,missing.filename);
  }
});
test("well-formed but incorrect fingerprints fail closed",async()=>{
  for(const migration of rows){
    const altered=rows.map(row=>row.filename===migration.filename?{...row,sha256:"a".repeat(64)}:row);
    assert.equal(await checkReadiness(database(altered),env),false,migration.filename);
  }
});
test("malformed fingerprints and duplicate ledger evidence are rejected",async()=>{
  assert.equal(await checkReadiness(database([...rows.slice(0,-1),{filename:rows.at(-1)!.filename,sha256:"tampered"}]),env),false);
  assert.equal(await checkReadiness(database([...rows,rows[0]]),env),false);
});
test("ledger order does not affect readiness",async()=>{
  assert.equal(await checkReadiness(database([...rows].reverse()),env),true);
});
test("missing environment prevents database access",async()=>{
  const db={query:async()=>{throw new Error("Database must not be queried");}} as unknown as Pool;
  assert.equal(await checkReadiness(db,{NODE_ENV:"test"}),false);
});
