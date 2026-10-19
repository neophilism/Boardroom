import test,{after} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Pool} from "pg";
import {getLaunchStatus} from "../src/server/launch-status.ts";
import {registerNamedAgent,revokeNamedAgent} from "../src/server/agent-registration.ts";
import {createOAuthCode,exchangeOAuthToken} from "../src/server/oauth.ts";
import {OPENAI_CLIENT_ID,OPENAI_REDIRECT_URI,parseOAuthAuthorization} from "../src/server/oauth-contract.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Launch fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});after(async()=>db.end());

test("native launch observes real consent, token expiry and revocation without exposing secrets",async()=>{
  const pepper="launch-fixture-pepper".repeat(3),verifier="l".repeat(64);
  const env:NodeJS.ProcessEnv={NODE_ENV:"test",BOARDROOM_PUBLIC_ORIGIN:"https://boardroom.example"};
  const registered=await registerNamedAgent(db,{name:"Bishop",provider:"chatgpt",authentication:"oauth",accountEmail:"bishop@example.test"},pepper);
  const find=async()=>(await getLaunchStatus(db)).agents.find(a=>a.credentialId===registered.credentialId);
  assert.equal(registered.token,undefined);
  assert.equal((await find())?.connected,false);
  const authorization=parseOAuthAuthorization(new URLSearchParams({client_id:OPENAI_CLIENT_ID,
    redirect_uri:OPENAI_REDIRECT_URI,resource:"https://boardroom.example/api/mcp",scope:"boardroom:agent",
    state:"launch-test",code_challenge:createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method:"S256",response_type:"code"}),env);
  const code=await createOAuthCode(db,registered.credentialId,authorization,pepper,env);
  const tokens=await exchangeOAuthToken(db,new URLSearchParams({grant_type:"authorization_code",
    client_id:OPENAI_CLIENT_ID,code,redirect_uri:OPENAI_REDIRECT_URI,resource:authorization.resource,
    code_verifier:verifier}),pepper,env);
  const connected=await find();
  assert.equal(connected?.connected,true);
  assert.equal(connected?.activations,0);
  assert.equal(connected?.assignments,0);
  assert.ok(!JSON.stringify(connected).includes(tokens.access_token));
  assert.ok(!JSON.stringify(connected).includes(tokens.refresh_token));
  await db.query(`UPDATE oauth_tokens SET expires_at=now()-interval '1 second'
    WHERE grant_id IN (SELECT grant_id FROM oauth_grants WHERE credential_id=$1)`,[registered.credentialId]);
  assert.equal((await find())?.connected,false);
  await revokeNamedAgent(db,registered.credentialId);
  assert.equal(await find(),undefined);
});
