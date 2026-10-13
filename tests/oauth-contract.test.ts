import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {oauthDigest,validPkce,parseOAuthAuthorization,authorizationServerMetadata,protectedResourceMetadata,OAuthFailure,OPENAI_CLIENT_ID,OPENAI_REDIRECT_URI,validOpenAIClientDocument,verifyOpenAIClient} from "../src/server/oauth-contract.ts";
import {safeOwnerReturnTo} from "../src/domain/owner-return.ts";
const env:NodeJS.ProcessEnv={NODE_ENV:"test",BOARDROOM_PUBLIC_ORIGIN:"https://boardroom.example"};
const verifier="v".repeat(64),challenge=createHash("sha256").update(verifier).digest("base64url");
const request=()=>new URLSearchParams({client_id:OPENAI_CLIENT_ID,redirect_uri:OPENAI_REDIRECT_URI,resource:"https://boardroom.example/api/mcp",scope:"boardroom:agent",state:"client-state",code_challenge:challenge,code_challenge_method:"S256",response_type:"code"});
test("native discovery identifies the exact resource, issuer, S256 and public-client flow",()=>{
  const as=authorizationServerMetadata(env),resource=protectedResourceMetadata(env);
  assert.equal(resource.resource,"https://boardroom.example/api/mcp");assert.deepEqual(resource.authorization_servers,[as.issuer]);
  assert.equal(as.authorization_response_iss_parameter_supported,true);assert.deepEqual(as.code_challenge_methods_supported,["S256"]);
  assert.deepEqual(as.token_endpoint_auth_methods_supported,["none"]);
});
test("authorization rejects alternate clients, callbacks, audiences, scopes and weak PKCE",()=>{
  assert.equal(parseOAuthAuthorization(request(),env).clientId,OPENAI_CLIENT_ID);
  for(const [key,value] of [["client_id","https://attacker.invalid/client.json"],["redirect_uri","https://attacker.invalid/callback"],["scope","boardroom:owner"],["resource","https://other.invalid/api/mcp"],["code_challenge_method","plain"]]){
    const r=request();r.set(key,value);assert.throws(()=>parseOAuthAuthorization(r,env),OAuthFailure);
  }
  const duplicate=request();duplicate.append("state","another-state");assert.throws(()=>parseOAuthAuthorization(duplicate,env),OAuthFailure);
});
test("PKCE and domain-separated hashes reject wrong or malformed secrets",()=>{
  assert.equal(validPkce(verifier,challenge),true);assert.equal(validPkce("w".repeat(64),challenge),false);assert.equal(validPkce("short",challenge),false);
  const token="a".repeat(64),pepper="private-fixture-pepper".repeat(3);
  assert.notEqual(oauthDigest("code",token,pepper),oauthDigest("token",token,pepper));
  assert.notEqual(oauthDigest("token",token,pepper),token);
});
test("owner sign-in return paths cannot redirect to an attacker",()=>{
  assert.equal(safeOwnerReturnTo("/oauth/authorize?state=one"),"/oauth/authorize?state=one");
  for(const value of [null,"//attacker.invalid","https://attacker.invalid","/oauth/authorize?state=x#secret","/oauth/authorize?\\attacker.invalid"])assert.equal(safeOwnerReturnTo(value),"/owner-actions");
});
test("CIMD verifies the fixed public client document and compatible methods",async()=>{
  const data={client_id:OPENAI_CLIENT_ID,redirect_uris:[OPENAI_REDIRECT_URI],token_endpoint_auth_methods_supported:["none","private_key_jwt"]};
  assert.equal(validOpenAIClientDocument(data),true);assert.equal(validOpenAIClientDocument({...data,redirect_uris:["https://attacker.invalid"]}),false);
  let requested="";
  await verifyOpenAIClient(async(url)=>{requested=String(url);return new Response(JSON.stringify(data));});
  assert.equal(requested,OPENAI_CLIENT_ID);
  await assert.rejects(verifyOpenAIClient(async()=>new Response(JSON.stringify({...data,client_id:"wrong"}))),OAuthFailure);
});
