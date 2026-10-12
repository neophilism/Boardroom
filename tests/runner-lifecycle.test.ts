import test from "node:test";
import assert from "node:assert/strict";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";
const id="26741e83-9694-4fb3-8174-783b2f9bf61c",sha="a".repeat(40);
const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"Smith",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"private-provider-fixture",
  maxSeconds:60,maxCalls:5,maxTokens:100000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
test("one bounded hosted activation checkpoints and releases after a tool-driven yield",async(t)=>{
  const paths:string[]=[],providerBodies:string[]=[];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const path=new URL(String(url)).pathname;paths.push(path);
    let body:unknown={};
    if(path.endsWith("/arrive"))body={agentName:"Smith",provider:"chatgpt",runId:id,shouldWork:true,state:"ADMITTED",replay:false};
    else if(path.endsWith("/claim"))body={status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1",expiresAt:new Date(Date.now()+180000).toISOString(),replay:false}};
    else if(path.endsWith("/source"))body={repository:"ci/repo",headSha:sha,entries:[]};
    else if(path.endsWith("/context"))body={workUnit:{title:"fixture",acceptanceCriteria:"fixture"}};
    else if(path.endsWith("/usage"))body={reservationId:id,replay:false};
    else if(String(url).startsWith("https://api.openai.com/")){
      providerBodies.push(String(init.body));body={output:[{type:"function_call",call_id:"call-1",name:"yield",arguments:'{"outcome":"YIELDED"}'}],usage:{input_tokens:10,output_tokens:5}};
    }
    else if(path.endsWith("/threads"))body={threads:[]};
    return new Response(JSON.stringify(body),{status:200});
  });
  const result=await runHostedAgent(config,"hosted-test-activation-0001");
  assert.equal(result.status,"YIELDED");assert.ok(paths.some(p=>p.endsWith("/checkpoint")));assert.ok(paths.at(-1)?.endsWith("/finish"));
  assert.ok(!providerBodies.join("").includes(config.token));assert.ok(!providerBodies.join("").includes(config.providerKey));
});
test("a source failure still closes a safe assigned session without calling a model",async(t)=>{
  const paths:string[]=[];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL)=>{
    const path=new URL(String(url)).pathname;paths.push(path);
    if(path.endsWith("/source"))return new Response("{}",{status:503});
    const body=path.endsWith("/arrive")?{agentName:"Smith",provider:"chatgpt",runId:id,shouldWork:true,state:"ADMITTED",replay:false}:
      path.endsWith("/claim")?{status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}}:
        path.endsWith("/threads")?{threads:[]}:{};
    return new Response(JSON.stringify(body));
  });
  assert.equal((await runHostedAgent(config,"hosted-test-activation-0002")).status,"FAILED");
  assert.ok(paths.at(-1)?.endsWith("/finish"));assert.ok(!paths.includes("/v1/responses"));
});
