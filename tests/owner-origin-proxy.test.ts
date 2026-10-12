import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_COOKIE,issueOwnerCookie,authorizeOwnerRequest,OwnerOriginRejected,
  trustedOwnerOrigin
} from "../src/server/owner-session.ts";
import {UnauthorizedOwner} from "../src/server/owner-auth.ts";

const key="BoardroomOwnerSessionSigningKeyMoreThan32Bytes";
const publicOrigin="https://boardroom-iamn.onrender.com";
const internalOrigin="http://127.0.0.1:10000";

function withSession(fn:()=>void){
  const previous=process.env.BOARDROOM_SESSION_SECRET;
  const previousPublic=process.env.BOARDROOM_PUBLIC_ORIGIN;
  try{
    process.env.BOARDROOM_SESSION_SECRET=key;
    process.env.BOARDROOM_PUBLIC_ORIGIN=publicOrigin;
    fn();
  }finally{
    if(previous===undefined)delete process.env.BOARDROOM_SESSION_SECRET;
    else process.env.BOARDROOM_SESSION_SECRET=previous;
    if(previousPublic===undefined)delete process.env.BOARDROOM_PUBLIC_ORIGIN;
    else process.env.BOARDROOM_PUBLIC_ORIGIN=previousPublic;
  }
}

function post(headers:Record<string,string>):Request{
  return new Request(internalOrigin+"/api/v1/owner/setup/verify",{
    method:"POST",
    headers:{
      cookie:OWNER_COOKIE+"="+issueOwnerCookie(key),
      ...headers
    }
  });
}

test("signed-in owner mutation succeeds behind Render reverse proxy",()=>{
  withSession(()=>{
    const req=post({origin:publicOrigin,"sec-fetch-site":"same-origin"});
    assert.equal(new URL(req.url).origin,internalOrigin);
    assert.doesNotThrow(()=>authorizeOwnerRequest(req,true));
  });
});

test("Safari-style browser omitting Origin must positively report same-origin",()=>{
  withSession(()=>{
    assert.doesNotThrow(()=>authorizeOwnerRequest(post({"sec-fetch-site":"same-origin"}),true));
    assert.throws(()=>authorizeOwnerRequest(post({}),true),OwnerOriginRejected);
    assert.doesNotThrow(()=>authorizeOwnerRequest(post({referer:publicOrigin+"/system"}),true));
    assert.throws(()=>authorizeOwnerRequest(post({referer:"https://evil.example/system"}),true),OwnerOriginRejected);
  });
});

test("malicious origins and cross-site browser requests cannot mutate owner data",()=>{
  withSession(()=>{
    assert.throws(()=>authorizeOwnerRequest(post({origin:"https://evil.example","sec-fetch-site":"cross-site"}),true),OwnerOriginRejected);
    assert.throws(()=>authorizeOwnerRequest(post({origin:internalOrigin,"sec-fetch-site":"same-origin"}),true),OwnerOriginRejected);
    assert.throws(()=>authorizeOwnerRequest(post({origin:publicOrigin,"sec-fetch-site":"cross-site"}),true),OwnerOriginRejected);
    assert.throws(()=>authorizeOwnerRequest(post({origin:"null","sec-fetch-site":"same-origin"}),true),OwnerOriginRejected);
  });
});

test("invalid or missing owner session is still rejected before origin check",()=>{
  withSession(()=>{
    const req=new Request(internalOrigin+"/api/v1/owner/setup/verify",{
      method:"POST",headers:{origin:publicOrigin,"sec-fetch-site":"same-origin"}
    });
    assert.throws(()=>authorizeOwnerRequest(req,true),UnauthorizedOwner);
  });
});

test("owner configured public origin cannot be spoofed with forwarded headers",()=>{
  withSession(()=>{
    const req=post({origin:"https://evil.example",
      "x-forwarded-host":"evil.example",
      "x-forwarded-proto":"https",
      "sec-fetch-site":"same-origin"});
    assert.throws(()=>authorizeOwnerRequest(req,true),OwnerOriginRejected);
  });
});

test("only secure deployment-configured public origins are accepted",()=>{
  assert.equal(trustedOwnerOrigin({RENDER_EXTERNAL_URL:publicOrigin} as unknown as NodeJS.ProcessEnv),publicOrigin);
  assert.equal(trustedOwnerOrigin({BOARDROOM_PUBLIC_ORIGIN:publicOrigin} as unknown as NodeJS.ProcessEnv),publicOrigin);
  assert.throws(()=>trustedOwnerOrigin({BOARDROOM_PUBLIC_ORIGIN:"http://boardroom-iamn.onrender.com"} as unknown as NodeJS.ProcessEnv));
  assert.throws(()=>trustedOwnerOrigin({BOARDROOM_PUBLIC_ORIGIN:"https://evil.example/other"} as unknown as NodeJS.ProcessEnv));
  assert.throws(()=>trustedOwnerOrigin({BOARDROOM_PUBLIC_ORIGIN:"https://user:pass@evil.example"} as unknown as NodeJS.ProcessEnv));
});
