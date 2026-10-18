import test from "node:test";
import assert from "node:assert/strict";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";
import {BoardroomRequestError} from "../src/sdk/boardroom-agent-client.ts";
import {activationFinishBasis} from "../src/server/sessions.ts";
const id="26741e83-9694-4fb3-8174-783b2f9bf61c",sha="a".repeat(40);
const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"Smith",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"private-provider-fixture",
  maxSeconds:60,maxCalls:5,maxTokens:100000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
for(const code of ["BUDGET_LIMIT","BUDGET_NOT_CONFIGURED"] as const)test(code+" stops before a model charge and checkpoints/releases accurately",async(t)=>{
  let paidCalls=0;const payloads:{path:string;body:Record<string,unknown>}[]=[];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const path=new URL(String(url)).pathname;
    if(String(url).startsWith("https://api.openai.com/"))paidCalls++;
    if(init.method==="POST")payloads.push({path,body:JSON.parse(String(init.body))});
    if(path.endsWith("/usage"))return new Response(JSON.stringify({code,error:"private-value-must-not-leak"}),{status:409});
    const body=path.endsWith("/arrive")?{agentName:"Smith",runId:id,shouldWork:true,state:"ADMITTED",replay:false}:
      path.endsWith("/claim")?{status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}}:
      path.endsWith("/source")?{repository:"ci/repo",headSha:sha,entries:[]}:path.endsWith("/threads")?{threads:[]}:{};
    return new Response(JSON.stringify(body));
  });
  const result=await runHostedAgent(config,"budget-fixture-activation-0001");
  const expected=code==="BUDGET_LIMIT"?"YIELDED":"BLOCKED";
  assert.equal(result.status,expected);assert.equal(paidCalls,0);
  assert.equal(payloads.at(-1)?.body.outcome,expected);
  assert.ok(payloads.some(p=>p.path.endsWith("/checkpoint")));
  const checkpointState=payloads.findLast(p=>p.path.endsWith("/checkpoint"))?.body.state;
  const now=new Date();
  const basis=activationFinishBasis(expected,{startedAt:new Date(now.getTime()-5000),now,maxSessionSeconds:3300,
    leaseExpiresAt:new Date(now.getTime()+180000),paused:false,usedTokens:0,maxTokens:100000,checkpointState});
  assert.equal(basis?.source,"AGENT_REPORTED");assert.equal(basis?.reason,"RESOURCE_LIMIT");
  assert.equal(payloads.filter(p=>p.path.endsWith("/owner-actions")).length,code==="BUDGET_NOT_CONFIGURED"?1:0);
  assert.ok(!JSON.stringify(payloads).includes("private-value-must-not-leak"));
});
test("failed heartbeat never reports an assigned session as safely released",async(t)=>{
  t.mock.timers.enable({apis:["setInterval"]});
  let finished=false;
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL)=>{
    const path=new URL(String(url)).pathname;
    if(path.endsWith("/heartbeat"))return new Response("{}",{status:401});
    if(path.endsWith("/finish"))finished=true;
    let body:unknown=path.endsWith("/arrive")?{agentName:"Smith",runId:id,shouldWork:true,state:"ADMITTED",replay:false}:
      path.endsWith("/claim")?{status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}}:
      path.endsWith("/source")?{repository:"ci/repo",headSha:sha,entries:[]}:path.endsWith("/usage")?{replay:false}:{};
    if(String(url).startsWith("https://api.openai.com/")){
      t.mock.timers.tick(45000);
      body={output:[{type:"function_call",call_id:"one",name:"yield",arguments:'{"outcome":"YIELDED"}'}],usage:{input_tokens:10,output_tokens:5}};
    }
    return new Response(JSON.stringify(body));
  });
  assert.equal((await runHostedAgent(config,"heartbeat-fixture-activation-0001")).status,"RECOVERY_REQUIRED");
  assert.equal(finished,false);
});
test("an already-cancelled activation makes no API or model call",async(t)=>{
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("must not call");});
  assert.equal((await runHostedAgent(config,"cancelled-fixture-activation-0001",AbortSignal.abort())).status,"CANCELLED");
});
test("safe budget error codes do not contain arbitrary provider payloads",()=>{
  const error=new BoardroomRequestError(409,"BUDGET_LIMIT");
  assert.equal(error.code,"BUDGET_LIMIT");assert.equal(error.message,"Boardroom request failed with HTTP 409");
});
