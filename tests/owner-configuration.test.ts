import test from "node:test";
import assert from "node:assert/strict";
import {validOwnerSession} from "../src/server/owner-session.ts";
import {environmentReady} from "../src/server/readiness.ts";

test("unconfigured owner secrets deny entry without crashing the owner pages",()=>{
  const prior=process.env.BOARDROOM_SESSION_SECRET;
  try{
    delete process.env.BOARDROOM_SESSION_SECRET;
    assert.equal(validOwnerSession(undefined),false);
    assert.equal(validOwnerSession("malicious"),false);
  }finally{
    if(prior===undefined)delete process.env.BOARDROOM_SESSION_SECRET;
    else process.env.BOARDROOM_SESSION_SECRET=prior;
  }
});
test("deployed-but-unconfigured application is never marked ready",()=>{
  assert.equal(environmentReady({} as NodeJS.ProcessEnv),false);
});
