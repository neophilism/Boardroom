import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {verifyOwnerSetup} from "../src/server/setup-verification.ts";
import {REQUIRED_CONFIG} from "../src/server/readiness.ts";

const goodEnv={NODE_ENV:"test",...Object.fromEntries(REQUIRED_CONFIG.map(k=>[k,"x".repeat(48)]))} as NodeJS.ProcessEnv;
const migrations=MIGRATION_MANIFEST.map(migration=>({...migration}));

test("Neon ready but GitHub missing: verify only evidenced owner actions",async()=>{
  const queries:string[]=[];
  const db={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes("FROM schema_migrations"))return {rows:migrations,rowCount:migrations.length};
    if(sql.includes("FROM agent_credentials"))return {rows:[{repositories:"0",registered_agents:"0",open_owner_actions:"2"}],rowCount:1};
    if(sql.startsWith("UPDATE owner_actions"))return {rows:[{action_id:"id"}],rowCount:1};
    return {rows:[],rowCount:0};
  }} as unknown as Pool;
  const result=await verifyOwnerSetup(db,goodEnv);
  assert.equal(result.system.database.migrationsReady,true);
  assert.equal(result.system.github.verifiedConnected,false);
  assert.equal(result.actions.find(x=>x.actionKey==="boardroom:github-app")?.verified,false);
  assert.equal(queries.filter(q=>q.startsWith("UPDATE owner_actions")).length,2);
});
test("unreachable DB fails closed, cannot report actions verified",async()=>{
  const db={query:async()=>{throw new Error("offline");}} as unknown as Pool;
  await assert.rejects(verifyOwnerSetup(db,goodEnv),/available Boardroom database/);
});
test("absent owner token is never verified",async()=>{
  const queries:string[]=[];
  const db={query:async(sql:string)=>{
    queries.push(sql);
    if(sql.includes("FROM agent_credentials"))return {rows:[{repositories:"0",registered_agents:"0",open_owner_actions:"2"}],rowCount:1};
    if(sql.startsWith("UPDATE owner_actions"))return {rows:[{action_id:"id"}],rowCount:1};
    return {rows:[],rowCount:0};
  }} as unknown as Pool;
  const result=await verifyOwnerSetup(db,{NODE_ENV:"test"} as NodeJS.ProcessEnv);
  assert.equal(result.actions.find(x=>x.actionKey==="boardroom:render-owner-credentials")?.verified,false);
  assert.equal(queries.filter(q=>q.startsWith("UPDATE owner_actions")).length,1);
});
test("missing or incorrect migration fingerprints cannot verify owner setup",async()=>{
  const evidenceSets=[migrations.slice(0,-1),migrations.map(row=>({...row,sha256:"a".repeat(64)}))];
  for(const evidence of evidenceSets){
    const updatedKeys:string[]=[];
    const db={query:async(sql:string,values:unknown[]=[])=>{
      if(sql.includes("FROM schema_migrations"))return {rows:evidence,rowCount:evidence.length};
      if(sql.includes("FROM agent_credentials"))return {rows:[{repositories:"0",registered_agents:"0",open_owner_actions:"2"}],rowCount:1};
      if(sql.startsWith("UPDATE owner_actions")){
        updatedKeys.push(String(values[0]));
        return {rows:[{action_id:"id"}],rowCount:1};
      }
      return {rows:[],rowCount:0};
    }} as unknown as Pool;
    const result=await verifyOwnerSetup(db,goodEnv);
    assert.equal(result.system.database.migrationsReady,false);
    assert.equal(result.actions.find(x=>x.actionKey==="boardroom:render-owner-credentials")?.verified,false);
    assert.deepEqual(updatedKeys,["boardroom:render-database"]);
  }
});
