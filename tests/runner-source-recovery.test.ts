import test from "node:test";
import assert from "node:assert/strict";
import {runHostedAgent,type RunnerConfig} from "../src/runner/run.ts";
const id="26741e83-9694-4fb3-8174-783b2f9bf61c",oldSha="a".repeat(40),newSha="b".repeat(40);
const config:RunnerConfig={baseUrl:"https://boardroom.example",name:"Smith",token:"b".repeat(64),provider:"openai",model:"explicit-model",providerKey:"private-provider-fixture",
  maxSeconds:60,maxCalls:10,maxTokens:300000,maxCostMicroUsd:1000000,inputUsdPerMillion:1,outputUsdPerMillion:1};
test("an interrupted write blocks stale tests until the hosted agent refreshes actual source",async(t)=>{
  const checkpoints:Record<string,unknown>[]=[],modelBodies:string[]=[];
  let sourceReads=0,fileWrites=0,turn=0,finished=false;
  const calls=[
    {name:"write_file",arguments:{path:"src/new.ts",text:"export const n=2;",message:"CI-001: useful source change"}},
    {name:"run_checks",arguments:{name:"test"}},
    {name:"refresh_source",arguments:{}},
    {name:"read_file",arguments:{path:"src/new.ts"}},
    {name:"yield",arguments:{outcome:"YIELDED"}}
  ];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const u=new URL(String(url)),path=u.pathname;let body:unknown={};
    if(path.endsWith("/arrive"))body={agentName:"Smith",provider:"chatgpt",runId:id,shouldWork:true,state:"ADMITTED",replay:false};
    else if(path.endsWith("/claim"))body={status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}};
    else if(path.endsWith("/context"))body={workUnit:{title:"fixture",acceptanceCriteria:"fixture"}};
    else if(path.endsWith("/source")){
      if(u.searchParams.get("kind")==="file"){
        assert.equal(u.searchParams.get("sha"),newSha);
        body={path:"src/new.ts",sha:"c".repeat(40),text:"export const n=2;",snapshotSha:newSha};
      }else body={repository:"ci/repo",headSha:sourceReads++?newSha:oldSha,entries:[]};
    }else if(path.endsWith("/write")){
      const op=JSON.parse(String(init.body));
      if(op.kind==="upsert_file"){
        fileWrites++;
        // The upstream commit happened, but the response was interrupted.
        return new Response(JSON.stringify({error:"private upstream credential detail"}),{status:503});
      }
    }else if(path.endsWith("/usage"))body={reservationId:id,replay:false};
    else if(path.endsWith("/checkpoint"))checkpoints.push(JSON.parse(String(init.body)));
    else if(path.endsWith("/finish"))finished=true;
    else if(String(url).startsWith("https://api.openai.com/")){
      modelBodies.push(String(init.body));const next=calls[turn++];assert.ok(next);
      body={output:[{type:"function_call",call_id:"call-"+turn,name:next.name,arguments:JSON.stringify(next.arguments)}],usage:{input_tokens:10,output_tokens:5}};
    }else if(path.endsWith("/threads"))body={threads:[]};
    return new Response(JSON.stringify(body));
  });
  const result=await runHostedAgent(config,"source-recovery-activation-0001");
  assert.equal(result.status,"YIELDED");assert.equal(fileWrites,1);assert.equal(finished,true);
  assert.equal(checkpoints.at(-1)?.headSha,newSha);
  assert.match(modelBodies.join("\n"),/SOURCE_RECONCILIATION_REQUIRED/);
  assert.match(modelBodies.join("\n"),/testsNeedRerun/);
  assert.doesNotMatch(modelBodies.join("\n"),/private upstream credential detail/);
});
test("an unreconciled final write records an unknown head and explicit handoff",async(t)=>{
  let turn=0,reads=0;const checkpoints:Record<string,unknown>[]=[];
  t.mock.method(globalThis,"fetch",async(url:RequestInfo|URL,init:RequestInit)=>{
    const path=new URL(String(url)).pathname;let body:unknown={};
    if(path.endsWith("/arrive"))body={agentName:"Smith",provider:"chatgpt",runId:id,shouldWork:true,state:"ADMITTED",replay:false};
    else if(path.endsWith("/claim"))body={status:"ASSIGNED",assignment:{assignmentId:id,repositoryId:"1",fullName:"ci/repo",unitId:"CI-001",generation:"1"}};
    else if(path.endsWith("/context"))body={workUnit:{title:"fixture",acceptanceCriteria:"fixture"}};
    else if(path.endsWith("/source")){
      if(reads++)return new Response("{}",{status:503});
      body={repository:"ci/repo",headSha:oldSha,entries:[]};
    }else if(path.endsWith("/write")&&JSON.parse(String(init.body)).kind==="upsert_file")return new Response("{}",{status:503});
    else if(path.endsWith("/usage"))body={reservationId:id,replay:false};
    else if(path.endsWith("/checkpoint"))checkpoints.push(JSON.parse(String(init.body)));
    else if(String(url).startsWith("https://api.openai.com/")){
      const call=turn++===0?{name:"write_file",arguments:{path:"src/new.ts",text:"export const n=2;",message:"CI-001: useful change"}}:
        {name:"yield",arguments:{outcome:"YIELDED"}};
      body={output:[{type:"function_call",call_id:"call-"+turn,name:call.name,arguments:JSON.stringify(call.arguments)}],usage:{input_tokens:10,output_tokens:5}};
    }else if(path.endsWith("/threads"))body={threads:[]};
    return new Response(JSON.stringify(body));
  });
  assert.equal((await runHostedAgent(config,"source-recovery-activation-0002")).status,"YIELDED");
  const checkpoint=checkpoints.at(-1)!;
  assert.equal(checkpoint.headSha,null);
  assert.equal((checkpoint.state as Record<string,unknown>).sourceNeedsRefresh,true);
  assert.match(String((checkpoint.state as Record<string,unknown>).nextAction),/outcome is unknown/);
});
