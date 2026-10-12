import test from "node:test";
import assert from "node:assert/strict";
import {issueOwnerCookie,verifyOwnerCookie,OWNER_SESSION_SECONDS} from "../src/server/owner-session.ts";
const key="BoardroomOwnerSessionSigningSecretMoreThan32Chars";
test("signed owner cookies expire and reject tampering",()=>{
  const now=1760300000000;
  const cookie=issueOwnerCookie(key,now);
  assert.equal(verifyOwnerCookie(cookie,key,now+1000),true);
  assert.equal(verifyOwnerCookie(cookie,key+"x",now+1000),false);
  assert.equal(verifyOwnerCookie(cookie,key,now+OWNER_SESSION_SECONDS*1000+1),false);
  assert.equal(verifyOwnerCookie(cookie,key,now-120000),false);
  assert.equal(verifyOwnerCookie(cookie.slice(1),key,now),false);
});


test("owner POST accepts the request-scoped signed cookie, but still checks origin",async()=>{
  const {authorizeOwnerRequest,OwnerOriginRejected}=await import("../src/server/owner-session.ts");
  const old=process.env.BOARDROOM_SESSION_SECRET;
  process.env.BOARDROOM_SESSION_SECRET=key;
  try{
    const session=issueOwnerCookie(key);
    const request=new Request("https://boardroom-iamn.onrender.com/api/v1/owner/setup/verify",{
      method:"POST",headers:{origin:"https://boardroom-iamn.onrender.com",
        "sec-fetch-site":"same-origin"}
    });
    assert.doesNotThrow(()=>authorizeOwnerRequest(request,true,session));
    assert.throws(()=>authorizeOwnerRequest(request,true),/Owner authorization required/);
    const badOrigin=new Request("https://boardroom-iamn.onrender.com/api/v1/owner/setup/verify",{
      method:"POST",headers:{origin:"https://evil.example","sec-fetch-site":"cross-site"}
    });
    assert.throws(()=>authorizeOwnerRequest(badOrigin,true,session),OwnerOriginRejected);
  }finally{
    if(old===undefined)delete process.env.BOARDROOM_SESSION_SECRET;
    else process.env.BOARDROOM_SESSION_SECRET=old;
  }
});
