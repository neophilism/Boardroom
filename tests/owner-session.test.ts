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
