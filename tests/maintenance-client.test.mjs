import test from "node:test";
import assert from "node:assert/strict";
import {maintenanceCredential} from "../scripts/maintenance-auth.mjs";
const origin="https://boardroom.example";
const env={ACTIONS_ID_TOKEN_REQUEST_URL:"https://pipelines.actions.githubusercontent.com/fixture?api-version=2.0",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN:"private-runner-fixture"};
test("GitHub assertion is requested for the exact maintenance audience without following redirects",async()=>{
  const token=await maintenanceCredential(env,origin,async(url,options)=>{
    assert.equal(new URL(url).searchParams.get("audience"),origin+"/api/v1/internal/tick");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,"Bearer private-runner-fixture");
    return Response.json({value:"signed.fixture.jwt"});
  });
  assert.equal(token,"signed.fixture.jwt");
});
test("a supplied protected legacy credential requires no GitHub request",async()=>{
  assert.equal(await maintenanceCredential({BOARDROOM_WATCHDOG_TOKEN:"protected-fixture"},origin,async()=>{
    throw new Error("Must not request another credential");
  }),"protected-fixture");
});
test("untrusted identity endpoints and malformed provider results are rejected",async()=>{
  for(const endpoint of ["http://pipelines.actions.githubusercontent.com/fixture","https://attacker.invalid/fixture",
    "https://pipelines.actions.githubusercontent.com.attacker.invalid/fixture","https://user:password@pipelines.actions.githubusercontent.com/fixture"])
    await assert.rejects(maintenanceCredential({...env,ACTIONS_ID_TOKEN_REQUEST_URL:endpoint},origin,async()=>{throw new Error("Must not transmit");}));
  for(const response of [Response.json({value:"not-a-jwt"}),Response.json({value:"a".repeat(20001)}),new Response("denied",{status:403})])
    await assert.rejects(maintenanceCredential(env,origin,async()=>response));
  await assert.rejects(maintenanceCredential({},origin));
  await assert.rejects(maintenanceCredential(env,origin,async()=>new Response("private-provider-response")),
    error=>error.message==="Invalid GitHub identity response");
});
