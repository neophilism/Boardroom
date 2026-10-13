import test from "node:test";
import assert from "node:assert/strict";
import {boundedWorkerLimits} from "../src/domain/execution-limits.ts";
import {parseExecutionPolicy} from "../src/server/operations.ts";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";
test("repository limits can only tighten a worker's already authorized caps",()=>{
  const runtime={maxSessionSeconds:1800,maxToolCalls:100,maxTokens:100000};
  assert.deepEqual(boundedWorkerLimits(runtime,{maxSessionSeconds:60,maxToolCalls:1,maxTokens:10}),{maxSessionSeconds:60,maxToolCalls:1,maxTokens:10});
  assert.deepEqual(boundedWorkerLimits(runtime,{maxSessionSeconds:14400,maxToolCalls:1000,maxTokens:10000000}),runtime);
  assert.throws(()=>boundedWorkerLimits(runtime,{maxSessionSeconds:-1,maxToolCalls:1,maxTokens:10}));
});
test("owner limits are bounded and legacy merge-only updates leave caps unspecified",()=>{
  const policy={repositoryId:"1",autoMerge:false,requiredChecks:[]};
  assert.equal(parseExecutionPolicy(policy).maxSessionSeconds,null);
  assert.equal(parseExecutionPolicy({...policy,maxSessionSeconds:60,maxToolCalls:1,maxTokens:1}).maxTokens,1);
  for(const value of [{maxSessionSeconds:59},{maxSessionSeconds:14401},{maxToolCalls:0},{maxTokens:"1000"}])assert.throws(()=>parseExecutionPolicy({...policy,...value}));
});
test("a live repository token cap prevents the first paid request and releases safely",async(t)=>{
  const id="26741e83-9694-4fb3-8174-783b2f9bf61c",sha="a".repeat(40);
  const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"Smith",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"private-provider-fixture",
    maxSeconds:60,maxCalls:5,maxTokens:100000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
  let modelCalls=0,reservations=0,finished=false;
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL)=>{
    const path=new URL(String(url)).pathname;
    if(String(url).startsWith("https://api.openai.com/"))modelCalls++;
    if(path.endsWith("/usage"))reservations++;
    if(path.endsWith("/finish"))finished=true;
    const body=path.endsWith("/arrive")?{agentName:"Smith",runId:id,shouldWork:true,state:"ADMITTED",replay:false}:
      path.endsWith("/claim")?{status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}}:
      path.endsWith("/source")?{repository:"ci/repo",headSha:sha,entries:[]}:
      path.endsWith("/context")?{executionLimits:{maxSessionSeconds:60,maxToolCalls:5,maxTokens:1,deadlineAt:new Date(Date.now()+60000).toISOString()}}:
      path.endsWith("/threads")?{threads:[]}:{};
    return new Response(JSON.stringify(body));
  });
  assert.equal((await runHostedAgent(config,"limits-fixture-activation-0001")).status,"YIELDED");
  assert.equal(modelCalls,0);assert.equal(reservations,0);assert.equal(finished,true);
});
