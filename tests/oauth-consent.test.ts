import test from "node:test";
import assert from "node:assert/strict";
import {authorizeOwnerRequest,issueOwnerCookie,OWNER_COOKIE,OwnerOriginRejected} from "../src/server/owner-session.ts";
import {UnauthorizedOwner} from "../src/server/owner-auth.ts";
import {OAuthFailure} from "../src/server/oauth-contract.ts";
import {RequestBodyTooLarge} from "../src/server/request-body.ts";
import {oauthConsentFailure} from "../src/server/oauth-consent-failure.ts";

const {default:config}=await import(new URL("../next.config.mjs",import.meta.url).href) as {
  default:{headers:()=>Promise<Array<{source:string;headers:Array<{key:string;value:string}>}>>}
};

async function policyFor(path:string){
  const result=new Map<string,string>();
  for(const rule of await config.headers!()){
    if(rule.source===path||(rule.source==="/oauth/:path*"&&path.startsWith("/oauth/")))
      for(const header of rule.headers)result.set(header.key.toLowerCase(),header.value);
  }
  return result;
}
test("consent preserves same-origin form provenance and blocks external referrers",async()=>{
  const consent=await policyFor("/oauth/authorize");
  assert.equal(consent.get("referrer-policy"),"same-origin");
  assert.equal(consent.get("x-frame-options"),"DENY");
  assert.match(consent.get("content-security-policy")!,/frame-ancestors 'none'/);
  assert.equal((await policyFor("/login")).get("referrer-policy"),"no-referrer");
  assert.equal((await policyFor("/oauth/token")).get("referrer-policy"),"no-referrer");
});
test("native consent POST passes the unchanged owner guard; null and foreign origins fail",()=>{
  const before={secret:process.env.BOARDROOM_SESSION_SECRET,origin:process.env.BOARDROOM_PUBLIC_ORIGIN};
  const secret="fixture-owner-session-signing-key-more-than-32-bytes",origin="https://boardroom.example";
  try{
    process.env.BOARDROOM_SESSION_SECRET=secret;process.env.BOARDROOM_PUBLIC_ORIGIN=origin;
    const cookie=issueOwnerCookie(secret);
    const post=(from:string,site="same-origin")=>new Request("http://127.0.0.1:10000/api/v1/owner/oauth/authorize",{
      method:"POST",headers:{origin:from,"sec-fetch-site":site,"sec-fetch-mode":"navigate",
        cookie:OWNER_COOKIE+"="+cookie,"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({decision:"deny"})});
    assert.doesNotThrow(()=>authorizeOwnerRequest(post(origin),true));
    for(const from of ["null","https://attacker.example"])
      assert.throws(()=>authorizeOwnerRequest(post(from),true),OwnerOriginRejected);
    assert.throws(()=>authorizeOwnerRequest(post(origin,"cross-site"),true),OwnerOriginRejected);
  }finally{
    if(before.secret===undefined)delete process.env.BOARDROOM_SESSION_SECRET;else process.env.BOARDROOM_SESSION_SECRET=before.secret;
    if(before.origin===undefined)delete process.env.BOARDROOM_PUBLIC_ORIGIN;else process.env.BOARDROOM_PUBLIC_ORIGIN=before.origin;
  }
});
test("safe consent diagnostics distinguish failures without revealing exception values",()=>{
  for(const [error,status,code] of [
    [new OwnerOriginRejected(),403,"CONSENT_ORIGIN_REJECTED"],
    [new UnauthorizedOwner(),401,"OWNER_SESSION_REQUIRED"],
    [new RequestBodyTooLarge(),413,"CONSENT_REQUEST_TOO_LARGE"],
    [new OAuthFailure("invalid_client"),400,"CONSENT_INVALID_CLIENT"],
    [new OAuthFailure("temporarily_unavailable"),503,"CONSENT_TEMPORARILY_UNAVAILABLE"]
  ] as const){
    const failure=oauthConsentFailure(error);assert.equal(failure.status,status);assert.equal(failure.code,code);
    assert.ok(failure.nextAction.length>10);
  }
  const secret="private-db-password-state-code-and-token";
  assert.deepEqual(oauthConsentFailure(new Error(secret)),oauthConsentFailure({message:secret}));
  assert.equal(JSON.stringify(oauthConsentFailure(new Error(secret))).includes(secret),false);
});
