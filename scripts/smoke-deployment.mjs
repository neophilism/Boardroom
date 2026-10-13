/** Public checks; an expected SHA enables strict release verification, not agent acceptance. */
import assert from "node:assert/strict";
import {verifyAgentInterface} from "../src/server/agent-interface-smoke.ts";
import {checkDeploymentEvidence,expectedReleaseRevision} from "../src/domain/deployment-evidence.ts";

const base="https://boardroom-iamn.onrender.com";
const expectedRevision=expectedReleaseRevision(process.env.BOARDROOM_EXPECTED_REVISION);
const deadline=Date.now()+12*60*1000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,options={}){
  const remaining=deadline-Date.now();
  if(remaining<=0)throw new Error("Deployment verification deadline exceeded");
  return fetch(base+path,{
    ...options,method:options.method??"GET",redirect:"manual",
    headers:{"Accept":"application/json, text/html",...options.headers},
    signal:AbortSignal.timeout(Math.min(55000,remaining))
  });
}
async function verify(){
  const health=await request("/api/health");
  const data=await health.json();
  const ready=await request("/api/ready");
  const state=await ready.json();
  const evidence=checkDeploymentEvidence({
    healthStatus:health.status,health:data,
    readinessStatus:ready.status,readiness:state,expectedRevision
  });

  const setup=await request("/setup");
  assert.equal(setup.status,200,"Safe public setup screen should be available");
  assert.ok((await setup.text()).includes("Boardroom"),"Setup page should identify Boardroom");
  for(const path of ["/owner-actions","/agents","/system"]){
    const protectedResponse=await request(path);
    assert.ok([302,303,307,308].includes(protectedResponse.status),path+" must redirect unauthorized visitors to login");
    const target=new URL(protectedResponse.headers.get("location")??"",base);
    assert.ok(target.origin===base&&target.pathname==="/login",path+" must target the same-origin login page");
  }
  const privateApi=await request("/api/v1/owner/agents");
  assert.equal(privateApi.status,401,"Unauthenticated agent registry API must reject");
  const connectionMode=await verifyAgentInterface(base,request);
  console.log("Observed MCP discovery and anonymous operational denial: passed");
  if(connectionMode==="ENABLED")console.log("Observed native OAuth discovery: ENABLED (owner connection/trial still required)");
  else console.log("Observed native OAuth discovery: DISABLED (enable before native connection)");
  console.log("Live Boardroom smoke checks passed.");
  console.log("Observed Render revision:",evidence.revision??"unknown");
  console.log("Observed readiness:",evidence.readiness);
  console.log("Exact release verified:",evidence.exactReleaseVerified,
    "(not a claim of scheduled-agent or unattended-operation acceptance)");
}
let last;
for(let attempt=1;Date.now()<deadline;attempt++){
  try{await verify();process.exit(0);}
  catch(error){
    last=error;
    console.error("Deployment smoke attempt "+attempt+":",error instanceof Error?error.message.slice(0,300):"unknown failure");
    const remaining=deadline-Date.now();
    if(remaining>0)await pause(Math.min(12000,remaining));
  }
}
console.error("Boardroom deployment verification failed before its deadline:",last instanceof Error?last.message.slice(0,300):"unknown");
process.exitCode=1;
