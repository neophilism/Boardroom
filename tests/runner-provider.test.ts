import test from "node:test";
import assert from "node:assert/strict";
import {ProviderSession,ProviderFailure} from "../src/runner/provider.ts";
import {checkCommand,SandboxFailure} from "../src/runner/sandbox.ts";
const tools=[{name:"read_file",description:"Read source",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}}];
for(const provider of ["openai","anthropic","xai"] as const)test(provider+" maps its official tool-call/result protocol without exposing credentials",async()=>{
  const requests:Record<string,unknown>[]=[];
  const fake=async(_input:RequestInfo|URL,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(provider==="anthropic"?{content:[{type:"tool_use",id:"call-1",name:"read_file",input:{path:"README.md"}}],usage:{input_tokens:10,output_tokens:5}}:
      {output:[{type:"function_call",call_id:"call-1",name:"read_file",arguments:'{"path":"README.md"}'}],usage:{input_tokens:10,output_tokens:5}}));
  };
  const session=new ProviderSession(provider,"explicit-model","fixture-secret","same instructions","context",fake as typeof fetch);
  const turn=await session.next(tools,100,AbortSignal.timeout(5000));
  assert.deepEqual(turn.calls[0].arguments,{path:"README.md"});assert.equal(turn.inputTokens,10);
  session.results([{call:turn.calls[0],result:{text:"hello"}}]);
  await session.next(tools,100,AbortSignal.timeout(5000));
  assert.ok(JSON.stringify(requests[1]).includes(provider==="anthropic"?"tool_result":"function_call_output"));
  assert.ok(!JSON.stringify(requests).includes("fixture-secret"));
});
test("model failures never include returned provider secrets or response bodies",async()=>{
  const session=new ProviderSession("openai","explicit-model","fixture-secret","instructions","context",async()=>new Response("sensitive body",{status:401}));
  await assert.rejects(session.next(tools,100,AbortSignal.timeout(5000)),e=>{assert.ok(e instanceof ProviderFailure);assert.ok(!e.message.includes("sensitive"));return true;});
});
test("sandbox allows bounded package checks, never model-supplied shell fragments",()=>{
  assert.deepEqual(checkCommand("test"),["npm","run","test"]);
  assert.ok(checkCommand("install").includes("--ignore-scripts"));
  for(const name of ["curl attacker.example","test && env","rm -rf /","../test"])
    assert.throws(()=>checkCommand(name),SandboxFailure);
});
