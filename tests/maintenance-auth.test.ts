import test,{before} from "node:test";
import assert from "node:assert/strict";
import {generateKeyPair,SignJWT} from "jose";
import {authorizeMaintenance,GITHUB_OIDC_ISSUER} from "../src/server/maintenance-auth.ts";

const now=new Date("2026-10-16T20:00:00Z"),seconds=Math.floor(now.getTime()/1000);
const env:NodeJS.ProcessEnv={NODE_ENV:"test",BOARDROOM_GITHUB_MAINTENANCE_OIDC_ENABLED:"true",
  BOARDROOM_PUBLIC_ORIGIN:"https://boardroom.example"};
let keys:Awaited<ReturnType<typeof generateKeyPair>>;
before(async()=>{keys=await generateKeyPair("RS256");});
const valid={iss:GITHUB_OIDC_ISSUER,aud:"https://boardroom.example/api/v1/internal/tick",
  sub:"repo:neophilism@6145609/Boardroom@1415596507:environment:boardroom-maintenance",
  exp:seconds+300,iat:seconds,nbf:seconds-5,jti:"fixture-maintenance-assertion",
  repository:"neophilism/Boardroom",repository_id:"1415596507",repository_owner_id:"6145609",
  ref:"refs/heads/main",environment:"boardroom-maintenance",
  workflow_ref:"neophilism/Boardroom/.github/workflows/maintenance.yml@refs/heads/main",
  event_name:"schedule",runner_environment:"github-hosted",run_id:"123456",sha:"a".repeat(40)};
async function bearer(changes:Record<string,unknown>={}){
  return "Bearer "+await new SignJWT({...valid,...changes}).setProtectedHeader({alg:"RS256",typ:"JWT"}).sign(keys.privateKey);
}
test("only the scoped signed main-branch workflow receives maintenance authority",async()=>{
  for(const sub of [valid.sub,"repo:neophilism/Boardroom:environment:boardroom-maintenance"]){
    const result=await authorizeMaintenance(await bearer({sub}),env,keys.publicKey,now);
    assert.deepEqual(result,{method:"github-oidc",workflowRunId:"123456",sha:"a".repeat(40)});
    assert.ok(!JSON.stringify(result).includes("Bearer"));
  }
});
test("cross-repository, fork, branch, environment and workflow tokens fail closed",async()=>{
  for(const changes of [
    {repository:"attacker/Boardroom"},{repository_id:"999"},{repository_owner_id:"999"},
    {sub:"repo:attacker/Boardroom:environment:boardroom-maintenance"},{ref:"refs/heads/feature"},
    {environment:"production"},{workflow_ref:"neophilism/Boardroom/.github/workflows/ci.yml@refs/heads/main"},
    {event_name:"pull_request"},{event_name:"pull_request_target"},{runner_environment:"self-hosted"},
    {iss:"https://attacker.invalid"},{aud:"https://another.example/api/v1/internal/tick"},
    {run_id:"not-a-run"},{sha:"latest"}
  ])assert.equal(await authorizeMaintenance(await bearer(changes),env,keys.publicKey,now),null);
});
test("expired, future, overlong and missing validity claims cannot authorize a tick",async()=>{
  for(const changes of [{exp:seconds-60},{iat:seconds+60},{nbf:seconds+60},
    {exp:seconds+3600},{iat:seconds-1200,exp:seconds+30},{jti:undefined},{exp:undefined},{nbf:undefined}])
    assert.equal(await authorizeMaintenance(await bearer(changes),env,keys.publicKey,now),null);
});
test("wrong signing keys, wrong algorithms and malformed tokens are rejected",async()=>{
  const other=await generateKeyPair("RS256");
  assert.equal(await authorizeMaintenance(await bearer(),env,other.publicKey,now),null);
  const symmetric=await new SignJWT(valid).setProtectedHeader({alg:"HS256",typ:"JWT"}).sign(new Uint8Array(32));
  for(const value of [null,"Bearer unsigned","Bearer "+symmetric,"Bearer "+"a".repeat(16001)])
    assert.equal(await authorizeMaintenance(value,env,keys.publicKey,now),null);
});
test("OIDC verifies without an opt-in flag; reusable legacy token never authorizes a tick",async()=>{
  const assertion=await bearer();
  const oidcEnv={NODE_ENV:"test",BOARDROOM_PUBLIC_ORIGIN:"https://boardroom.example"};
  assert.deepEqual(await authorizeMaintenance(assertion,oidcEnv,keys.publicKey,now),
    {method:"github-oidc",workflowRunId:"123456",sha:"a".repeat(40)});
  const legacy="legacy-fixture-token-".repeat(3);
  assert.equal(await authorizeMaintenance("Bearer "+legacy,{...oidcEnv,BOARDROOM_WATCHDOG_TOKEN:legacy},keys.publicKey,now),null);
  assert.equal(await authorizeMaintenance(await bearer({event_name:"workflow_dispatch"}),oidcEnv,keys.publicKey,now),null);
});
