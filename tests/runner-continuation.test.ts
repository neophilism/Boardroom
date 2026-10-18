import test from "node:test";
import assert from "node:assert/strict";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";
const id="26741e83-9694-4fb3-8174-783b2f9bf61c";
const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"HAL 9000",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"fixture-provider-value",
  maxSeconds:3300,maxCalls:20,maxTokens:1000000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
for(const lostResponse of [false,true])test("early yield continues across projects with a single arrival and isolated context; lost response="+lostResponse,async t=>{
  let project=1,arrivals=0,handoffs=0,turns=0,claims=0,idleFinished=false;
  const providerBodies:string[]=[],checkpoints:Record<string,unknown>[]=[],writes:unknown[]=[];
  const started=Date.now();
  const grant=()=>({status:"ASSIGNED",assignment:{assignmentId:project===1?id:"26741e83-9694-4fb3-8174-783b2f9bf61d",repositoryId:String(project),fullName:"ci/project-"+project,unitId:"CI-00"+project,generation:String(project)}});
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const path=new URL(String(url)).pathname;
    let body:unknown={};
    if(path.endsWith("/arrive")){arrivals++;body={agentName:"HAL 9000",runId:id,shouldWork:true,state:"ADMITTED",replay:false};}
    else if(path.endsWith("/claim")){claims++;body=grant();}
    else if(path.endsWith("/source"))body={repository:"ci/project-"+project,branch:project===1?"feat/imported":"boardroom/CI-002",headSha:String(project).repeat(40),entries:[]};
    else if(path.endsWith("/context"))body={workUnit:{title:"project-context-"+project},executionLimits:{maxSessionSeconds:3300,maxToolCalls:20,maxTokens:1000000,deadlineAt:new Date(started+3300000).toISOString()},workSession:{workUntilAt:new Date(started+3000000).toISOString()}};
    else if(path.endsWith("/usage"))body={replay:false};
    else if(path.endsWith("/checkpoint"))checkpoints.push(JSON.parse(String(init.body)));
    else if(path.endsWith("/write"))writes.push(init.body);
    else if(path.endsWith("/yield-and-claim")){
      handoffs++;
      const request=JSON.parse(String(init.body));assert.equal(request.runId,id);
      assert.equal(request.generation,String(project));
      if(project===1){project=2;body=grant();if(lostResponse)throw new TypeError("Fixture lost response after release");}
      else body={status:"IDLE",assignment:null};
    }else if(path.endsWith("/idle"))idleFinished=true;
    else if(path.endsWith("/finish"))assert.fail("No assigned finish after the final handoff returned IDLE");
    else if(path.endsWith("/threads"))body={threads:[]};
    else if(String(url).startsWith("https://api.openai.com/")){
      providerBodies.push(String(init.body));turns++;
      body={output:[{type:"function_call",call_id:"yield-"+turns,name:"yield",arguments:'{"outcome":"YIELDED"}'},
        ...(turns===1?[{type:"function_call",call_id:"stale-write",name:"write_file",arguments:'{"path":"src/stale.ts","text":"stale","message":"Fixture stale queued write"}'}]:[])],usage:{input_tokens:10,output_tokens:5}};
    }
    return new Response(JSON.stringify(body));
  });
  const result=await runHostedAgent(config,"continuation-fixture-0001");
  assert.equal(result.status,"YIELDED");assert.equal(arrivals,1);assert.equal(handoffs,2);assert.equal(turns,2);assert.equal(claims,lostResponse?2:1);
  assert.equal(idleFinished,true);assert.equal(writes.length,0);
  assert.equal(checkpoints[0].branch,"feat/imported");assert.equal(checkpoints[1].generation,"2");
  assert.ok(providerBodies[0].includes("project-context-1"));
  assert.ok(providerBodies[1].includes("project-context-2"));
  assert.ok(!providerBodies[1].includes("project-context-1"));
});
