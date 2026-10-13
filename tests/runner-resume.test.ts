import test from "node:test";
import assert from "node:assert/strict";
import {checkpointProgress,resumablePrNumber} from "../src/runner/resume.ts";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";

const id="26741e83-9694-4fb3-8174-783b2f9bf61c",sha="a".repeat(40);
const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"Smith",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"private-provider-fixture",
  maxSeconds:60,maxCalls:5,maxTokens:100000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
test("checkpoint hints belong to the current deterministic work branch",()=>{
  const c={branch:"boardroom/CI-001",state:{summary:"Actual remote progress",nextAction:"Address failing test",prNumber:8,checksPassed:true}};
  assert.deepEqual(checkpointProgress(c,"CI-001"),{summary:c.state.summary,nextAction:c.state.nextAction,prNumber:8});
  assert.deepEqual(checkpointProgress(c,"CI-002"),{prNumber:null});
  assert.equal(checkpointProgress({...c,state:{prNumber:"8"}},"CI-001").prNumber,null);
});
test("resume requires an authoritative open or merged PR at the actual snapshot head",()=>{
  const p={number:8,state:"open",mergedAt:null,headSha:sha};
  assert.equal(resumablePrNumber({pullRequest:p},sha),8);
  assert.equal(resumablePrNumber({pullRequest:{...p,state:"closed"}},sha),null);
  assert.equal(resumablePrNumber({pullRequest:{...p,state:"closed",mergedAt:"2026-10-13T00:00:00Z"}},sha),8);
  assert.equal(resumablePrNumber({pullRequest:p},"b".repeat(40)),null);
});

test("new session resumes its existing PR and keeps the latest substantive handoff",async(t)=>{
  let turn=0;
  const writes:Record<string,unknown>[]=[],paths:string[]=[];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const path=new URL(String(url)).pathname;paths.push(path);
    if(path.endsWith("/checkpoint"))writes.push(JSON.parse(String(init.body)));
    let body:unknown={};
    if(path.endsWith("/arrive"))body={agentName:"Smith",provider:"chatgpt",runId:id,shouldWork:true,state:"ADMITTED",replay:false};
    else if(path.endsWith("/claim"))body={status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}};
    else if(path.endsWith("/source"))body={repository:"ci/repo",headSha:sha,entries:[]};
    else if(path.endsWith("/context"))body={checkpoint:{branch:"boardroom/CI-001",state:{summary:"Prior implementation",nextAction:"Review CI",prNumber:8}}};
    else if(path.endsWith("/pr-evidence"))body={pullRequest:{number:8,headSha:sha,state:"open",mergedAt:null}};
    else if(path.endsWith("/usage"))body={replay:false};
    else if(String(url).startsWith("https://api.openai.com/")){
      const call=turn++===0?{name:"pr_status",arguments:"{}"}:turn===2?
        {name:"checkpoint",arguments:JSON.stringify({summary:"Fixed the failing integration",nextAction:"Wait for current PR review"})}:
        {name:"yield",arguments:'{"outcome":"YIELDED"}'};
      body={output:[{type:"function_call",call_id:"call-"+turn,...call}],usage:{input_tokens:10,output_tokens:5}};
    }else if(path.endsWith("/threads"))body={threads:[]};
    return new Response(JSON.stringify(body));
  });
  assert.equal((await runHostedAgent(config,"resume-test-activation-0001")).status,"YIELDED");
  assert.equal(paths.filter(p=>p.endsWith("/pr-evidence")).length,2);
  assert.ok(!paths.some(p=>p.endsWith("/write")));
  assert.equal((writes.at(-1)?.state as Record<string,unknown>).summary,"Fixed the failing integration");
  assert.equal((writes.at(-1)?.state as Record<string,unknown>).nextAction,"Wait for current PR review");
  assert.equal((writes.at(-1)?.state as Record<string,unknown>).prNumber,8);
});
