import test from "node:test";
import assert from "node:assert/strict";
import {hasGitHubAppEnvironment,getSystemStatus} from "../src/server/system-status.ts";
import type {Pool} from "pg";

const config:NodeJS.ProcessEnv={BOARDROOM_GITHUB_APP_ID:"1234",BOARDROOM_GITHUB_INSTALLATION_ID:"5678",
  BOARDROOM_GITHUB_APP_PRIVATE_KEY:"private PEM here",BOARDROOM_GITHUB_OWNER:"neophilism"};
test("the GitHub installation is not marked configured when a required setting is absent",()=>{
  assert.equal(hasGitHubAppEnvironment(config),true);
  assert.equal(hasGitHubAppEnvironment({...config,BOARDROOM_GITHUB_APP_PRIVATE_KEY:""}),false);
  assert.equal(hasGitHubAppEnvironment({} as NodeJS.ProcessEnv),false);
});
test("a reachable database with incomplete credentials is not production-ready",async()=>{
  const db={query:async(sql:string)=>{
    if(sql.includes("schema_migrations"))throw new Error("This must not happen when env is incomplete");
    return {rows:[{repositories:"0",registered_agents:"0",open_owner_actions:"2"}],rowCount:1};
  }} as unknown as Pool;
  const result=await getSystemStatus(db,{} as NodeJS.ProcessEnv);
  assert.equal(result.database.connected,true);
  assert.equal(result.database.migrationsReady,false);
  assert.equal(result.database.openOwnerActions,2);
  assert.equal(result.github.verifiedConnected,false);
  assert.equal(result.integration.safeAutonomousOperations,false);
  assert.equal(result.integration.scheduledWorkTested,false);
});
test("database connection failures are visible as unavailable, never fabricated green",async()=>{
  const db={query:async()=>{throw new Error("offline");}} as unknown as Pool;
  const result=await getSystemStatus(db,{} as NodeJS.ProcessEnv);
  assert.equal(result.database.connected,false);
  assert.equal(result.github.verifiedConnected,false);
});
