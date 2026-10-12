/**
 * Public, credential-free Render smoke checks. These verify reachability and
 * private-route denial, NOT the full agent work cycle or exact deployed SHA.
 */
import assert from "node:assert/strict";

const base = "https://boardroom-iamn.onrender.com";
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function request(path) {
  return fetch(base+path,{
    method:"GET",redirect:"manual",
    headers:{"Accept":"application/json, text/html"},
    signal:AbortSignal.timeout(55000)
  });
}
async function verify(){
  const health=await request("/api/health");
  assert.equal(health.status,200,"Liveness must return HTTP 200");
  const data=await health.json();
  assert.equal(data.service,"boardroom");
  assert.equal(data.liveness,"alive");
  assert.ok(data.revision===null||/^[0-9a-f]{40}$/i.test(data.revision),
    "Revision must be a valid Git SHA or null");

  const ready=await request("/api/ready");
  assert.ok([200,503].includes(ready.status),
    "Readiness must indicate ready or not ready");
  const state=await ready.json();
  assert.equal(state.service,"boardroom");
  assert.equal(state.readiness,ready.status===200?"ready":"not_ready");

  const setup=await request("/setup");
  assert.equal(setup.status,200,"Safe public setup screen should be available");
  const page=await setup.text();
  assert.ok(page.includes("Boardroom"),"Setup page should identify Boardroom");

  for(const path of ["/owner-actions","/agents","/system"]){
    const protectedResponse=await request(path);
    assert.ok([302,303,307,308].includes(protectedResponse.status),
      path+" must redirect unauthorized visitors to login");
    const target=protectedResponse.headers.get("location")??"";
    assert.ok(target.includes("/login"),path+" must target login");
  }
  const privateApi=await request("/api/v1/owner/agents");
  assert.equal(privateApi.status,401,"Unauthenticated agent registry API must reject");
  console.log("Live Boardroom smoke checks passed.");
  console.log("Observed Render revision:",data.revision??"unknown");
  console.log("Observed readiness:",state.readiness,
    "(not a claim of scheduled-agent readiness)");
}
let last;
for(let attempt=1;attempt<=7;attempt++){
  try{await verify();process.exit(0);}
  catch(error){
    last=error;
    console.error("Deployment smoke attempt "+attempt+"/7:",error instanceof Error?error.message:"unknown failure");
    if(attempt<7)await pause(12000);
  }
}
console.error("Boardroom public deployment smoke failed after retries:",last instanceof Error?last.message:"unknown");
process.exitCode=1;
