import test from "node:test";
import assert from "node:assert/strict";
import {submitOAuthConsent,ConsentSubmissionError} from "../src/sdk/oauth-consent-client.ts";
import {authorizeOwnerRequest,OWNER_COOKIE,issueOwnerCookie,OwnerOriginRejected} from "../src/server/owner-session.ts";
import {oauthConsentFailure} from "../src/server/oauth-consent-failure.ts";

const issuer="https://boardroom.example",form=()=>new URLSearchParams({state:"fixture-state",decision:"deny"});
const callback=()=>"https://chatgpt.com/connector_platform_oauth_redirect?state=fixture-state&iss="+encodeURIComponent(issuer)+"&error=access_denied";
const ok=(redirectTo=callback())=>new Response(JSON.stringify({redirectTo}),{headers:{"Content-Type":"application/json"}});
test("consent uses one cookie-bound CORS-mode POST and navigates only after its JSON result",async()=>{
  let calls=0;
  const target=await submitOAuthConsent(form(),issuer,async(input,options)=>{
    calls++;assert.equal(input,"/api/v1/owner/oauth/authorize");assert.equal(options?.method,"POST");
    assert.equal(options?.mode,"cors");assert.equal(options?.credentials,"same-origin");
    assert.equal(options?.redirect,"error");assert.equal(options?.cache,"no-store");
    const headers=new Headers(options?.headers);assert.equal(headers.get("accept"),"application/json");
    assert.equal(headers.get("content-type"),"application/x-www-form-urlencoded");
    assert.equal(String(options?.body),String(form()));return ok();
  });
  assert.equal(calls,1);assert.equal(target,callback());
});
test("ambiguous consent mutations are not retried or exposed through exception values",async()=>{
  let calls=0;
  await assert.rejects(submitOAuthConsent(form(),issuer,async()=>{calls++;throw Error("private-credential");}),
    error=>error instanceof ConsentSubmissionError&&!error.message.includes("private-credential"));
  assert.equal(calls,1);
});
test("consent refuses foreign callbacks, credentials, state/issuer mismatches and unexpected replies",async()=>{
  for(const target of ["https://attacker.example/?code=fixture",callback().replace("chatgpt.com","chatgpt.com.attacker.example"),
    callback().replace("fixture-state","different-state"),callback().replace(encodeURIComponent(issuer),"https%3A%2F%2Fother.example"),
    callback().replace("https://","https://user:password@"),callback()+"#fragment",callback()+"&code=fixture"])
    await assert.rejects(submitOAuthConsent(form(),issuer,async()=>ok(target)),ConsentSubmissionError);
  await assert.rejects(submitOAuthConsent(form(),issuer,async()=>new Response("not-json")),ConsentSubmissionError);
});
test("origin diagnostics identify the failed guard without leaking header or provider values",async()=>{
  const previous={secret:process.env.BOARDROOM_SESSION_SECRET,origin:process.env.BOARDROOM_PUBLIC_ORIGIN};
  const key="fixture-session-key-more-than-thirty-two-bytes";
  try{
    process.env.BOARDROOM_SESSION_SECRET=key;process.env.BOARDROOM_PUBLIC_ORIGIN=issuer;
    for(const [origin,site,reason] of [["null","same-origin","NULL_ORIGIN"],
      ["https://attacker.example","same-origin","ORIGIN_MISMATCH"],[issuer,"cross-site","FETCH_SITE_REJECTED"]]){
      const request=new Request(issuer+"/api/v1/owner/oauth/authorize",{method:"POST",
        headers:{origin,"sec-fetch-site":site,cookie:OWNER_COOKIE+"="+issueOwnerCookie(key)}});
      assert.throws(()=>authorizeOwnerRequest(request,true),error=>{
        assert.ok(error instanceof OwnerOriginRejected);const d=oauthConsentFailure(error);
        assert.equal(d.diagnostic,reason);assert.equal(JSON.stringify(d).includes("attacker.example"),false);return true;
      });
    }
  }finally{
    if(previous.secret===undefined)delete process.env.BOARDROOM_SESSION_SECRET;else process.env.BOARDROOM_SESSION_SECRET=previous.secret;
    if(previous.origin===undefined)delete process.env.BOARDROOM_PUBLIC_ORIGIN;else process.env.BOARDROOM_PUBLIC_ORIGIN=previous.origin;
  }
  await assert.rejects(submitOAuthConsent(form(),issuer,async()=>new Response(JSON.stringify({
    code:"CONSENT_ORIGIN_REJECTED",diagnostic:"NULL_ORIGIN",nextAction:"private-provider-error"
  }),{status:403})),error=>error instanceof ConsentSubmissionError&&error.message.includes("NULL_ORIGIN")&&!error.message.includes("private-provider-error"));
});
