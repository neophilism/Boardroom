import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {parseAgentRegistration,registerNamedAgent,revokeNamedAgent,
  AgentRegistrationError,validCredentialId,AgentAlreadyRegistered} from "../src/server/agent-registration.ts";
import {digestCredential} from "../src/server/agent-auth.ts";

const pepper="test_named_agent_registry_pepper_48_characters_at_least";
test("owner registration requires the exact approved name and known provider",()=>{
  assert.deepEqual(parseAgentRegistration({name:"Smith",provider:"chatgpt"}),{name:"Smith",provider:"chatgpt"});
  for(const v of [{name:"smith",provider:"chatgpt"},{name:"Smith",provider:"unknown"},null,{},[]])
    assert.throws(()=>parseAgentRegistration(v),AgentRegistrationError);
});
function fake(handlers:Array<{rows?:unknown[];rowCount?:number;error?:unknown}>){
  let index=0;
  const statements:{sql:string;args:unknown[]}[]=[];
  const client={query:async(sql:string,args:unknown[]=[])=>{
    statements.push({sql,args});
    const h=handlers[index++];
    if(!h)throw new Error("Unexpected query "+index+": "+sql);
    if(h.error)throw h.error;
    return {rows:h.rows??[],rowCount:h.rowCount??h.rows?.length??0};
  },release:()=>{}} as unknown as PoolClient;
  return {db:{connect:async()=>client} as unknown as Pool,statements};
}
test("fresh token is returned exactly once and only its digest is stored",async()=>{
  const id="26741e83-9694-4fb3-8174-783b2f9bf61c";
  const x=fake([{}, {rows:[{credential_id:id}]},{},{}]);
  const issued=await registerNamedAgent(x.db,{name:"Smith",provider:"chatgpt"},pepper);
  assert.equal(issued.credentialId,id);
  assert.equal(issued.name,"Smith");
  assert.match(issued.token,/^[A-Za-z0-9_-]{60,80}$/);
  const insert=x.statements.find(s=>s.sql.includes("INSERT INTO agent_credentials"));
  assert.deepEqual(insert?.args,[issued.name,issued.provider,digestCredential(issued.token,pepper)]);
  assert.ok(!JSON.stringify(x.statements).includes(issued.token));
});
test("name collisions return a clear actionable error and roll back",async()=>{
  const x=fake([{}, {error:{code:"23505"}},{}]);
  await assert.rejects(registerNamedAgent(x.db,{name:"Smith",provider:"chatgpt"},pepper),AgentAlreadyRegistered);
  assert.ok(x.statements.some(s=>s.sql.includes("ROLLBACK")));
});
test("credential revocation immediately disables auth and records audit without raw token",async()=>{
  const id="26741e83-9694-4fb3-8174-783b2f9bf61c";
  const x=fake([{}, {rows:[{label:"Smith",provider:"chatgpt"}]},{},{}]);
  assert.deepEqual(await revokeNamedAgent(x.db,id),{credentialId:id,revoked:true});
  assert.ok(x.statements[1].sql.includes("enabled=FALSE"));
  assert.ok(x.statements[1].sql.includes("revoked_at=now()"));
  assert.ok(validCredentialId(id));
  assert.ok(!validCredentialId("../oops"));
});
