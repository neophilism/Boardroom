import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {REQUIRED_CONFIG,REQUIRED_MIGRATIONS,environmentReady,checkReadiness} from "../src/server/readiness.ts";
const env=Object.fromEntries(REQUIRED_CONFIG.map(x=>[x,"x".repeat(40)])) as NodeJS.ProcessEnv;
const rows=REQUIRED_MIGRATIONS.map(filename=>({filename,sha256:"a".repeat(64)}));
test("missing configuration fails closed without printing values",()=>{
  assert.equal(environmentReady({}),false);
  assert.equal(environmentReady(env),true);
  assert.equal(environmentReady({...env,BOARDROOM_SESSION_SECRET:"short"}),false);
});
test("verified migrations with configured database mean infrastructure ready",async()=>{
  const fake={query:async()=>({rows})} as unknown as Pool;
  assert.equal(await checkReadiness(fake,env),true);
});
test("one missing schema migration is not production ready",async()=>{
  const fake={query:async()=>({rows:rows.slice(0,-1)})} as unknown as Pool;
  assert.equal(await checkReadiness(fake,env),false);
});
test("invalid fingerprints are not accepted",async()=>{
  const fake={query:async()=>({rows:[...rows.slice(0,-1),{filename:rows.at(-1)?.filename,sha256:"tampered"}]})} as unknown as Pool;
  assert.equal(await checkReadiness(fake,env),false);
});
