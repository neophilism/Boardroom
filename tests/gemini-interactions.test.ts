import test from "node:test";
import assert from "node:assert/strict";
import {GeminiStatelessSession,normalizeGeminiInteraction,GeminiTransportFailure} from "../src/runner/gemini-interactions.ts";
import {ProviderContractError} from "../src/runner/provider-contract.ts";
const tools=[{name:"read_file",description:"Read source safely",parameters:{type:"object",properties:{path:{type:"string"}}}}];
const call={type:"function_call",id:"call_7",name:"read_file",arguments:{path:"README.md"}};
const usage={total_input_tokens:100,total_output_tokens:20,total_cached_tokens:40,total_thought_tokens:9,total_tool_use_tokens:6};
const action={object:"interaction",status:"requires_action",steps:[
  {type:"thought",signature:"opaque-thought-state"},
  call
],usage};
const done={object:"interaction",status:"completed",steps:[{type:"model_output",content:[{type:"text",text:"Completed"}]}],usage};
test("Gemini Interactions stateless turn retains thought and function_result without provider storage",async()=>{
  const requests:Array<{body:Record<string,unknown>;headers:HeadersInit|undefined;url:string}>=[];
  let count=0;
  const transport=async(url:RequestInfo|URL,init?:RequestInit)=>{
    requests.push({url:String(url),body:JSON.parse(String(init?.body)),headers:init?.headers});
    return new Response(JSON.stringify(count++===0?action:done));
  };
  const session=new GeminiStatelessSession("fixture-model-snapshot","test-api-key","trusted instructions","repo context",transport as typeof fetch);
  const first=await session.next(tools,200,AbortSignal.timeout(3000));
  assert.equal(first.calls.length,1);
  assert.equal(first.usage.cachedInputTokens,40);
  assert.equal(first.usage.reasoningOutputTokens,9);
  assert.equal(first.usage.cacheCreationInputTokens,null);
  assert.equal(requests[0].url,"https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(requests[0].body.store,false);
  assert.equal(requests[0].body.background,false);
  assert.ok(!("previous_interaction_id" in requests[0].body));
  assert.equal((requests[0].headers as Record<string,string>)["x-goog-api-key"],"test-api-key");
  await assert.rejects(session.next(tools,200,AbortSignal.timeout(3000)),ProviderContractError);
  session.results([{call:first.calls[0],result:{ok:true}}]);
  const second=await session.next(tools,200,AbortSignal.timeout(3000));
  assert.equal(second.text,"Completed");
  const steps=requests[1].body.input as Array<Record<string,unknown>>;
  assert.equal(steps[0].type,"user_input");
  assert.equal(steps[1].type,"thought");
  assert.equal(steps[2].type,"function_call");
  assert.equal(steps[3].type,"function_result");
  assert.equal(steps[3].call_id,"call_7");
  assert.equal((steps[3].result as Array<{text:string}>)[0].text,'{"ok":true}');
  assert.equal(requests[1].body.store,false);
  assert.ok(!("previous_interaction_id" in requests[1].body));
  assert.doesNotMatch(JSON.stringify(requests.map(x=>x.body)),/test-api-key/);
  await assert.rejects(session.next(tools,200,AbortSignal.timeout(3000)),ProviderContractError);
});
test("Gemini rejects unknown tools, duplicate calls, hidden usage and inconsistent async status",()=>{
  const allowed=new Set(["read_file"]);
  for(const bad of [
    {...action,steps:[call,call]},
    {...action,steps:[{...call,name:"unsafe_execute"}]},
    {...action,steps:[{...call,id:"<bad>"}]},
    {...action,steps:[{...call,arguments:["array"]}]},
    {...action,status:"completed"},
    {...action,status:"in_progress"},
    {...action,usage:{total_input_tokens:100}},
    {...action,steps:[{type:"provider_tool",name:"google_search"}]},
    {...done,steps:[call]},
    {...done,usage:{...usage,total_thought_tokens:-1}}
  ])assert.throws(()=>normalizeGeminiInteraction(bad,allowed),ProviderContractError);
});
test("Gemini result matching is exact and cannot replay writes",async()=>{
  const session=new GeminiStatelessSession("test-model","key","instructions","context",
    (async()=>new Response(JSON.stringify(action))) as typeof fetch);
  const first=await session.next(tools,123,AbortSignal.timeout(3000));
  assert.throws(()=>session.results([{call:{...first.calls[0],id:"other"},result:{}}]),ProviderContractError);
  assert.throws(()=>session.results([]),ProviderContractError);
  session.results([{call:first.calls[0],result:"ok"}]);
  assert.throws(()=>session.results([{call:first.calls[0],result:"duplicate"}]),ProviderContractError);
});
test("Gemini provider errors sanitize bodies and incomplete status",async()=>{
  const session=new GeminiStatelessSession("test-model","private-secret","instructions","context",
    (async()=>new Response("provider leaked secret",{status:403})) as typeof fetch);
  await assert.rejects(session.next(tools,100,AbortSignal.timeout(3000)),e=>{
    assert.ok(e instanceof GeminiTransportFailure);
    assert.equal(e.status,403);
    assert.doesNotMatch(e.message,/leaked|secret/);return true;
  });
});
test("Transport cannot be omitted and aborted signals produce no paid request",async()=>{
  assert.throws(()=>new GeminiStatelessSession("model","key","instructions","context",
    undefined as unknown as typeof fetch),ProviderContractError);
  let calls=0;
  const transport=async()=>{calls++;return new Response(JSON.stringify(done));};
  const session=new GeminiStatelessSession("model","key","instructions","context",transport as typeof fetch);
  await assert.rejects(session.next(tools,100,AbortSignal.abort()));
  assert.equal(calls,0);
});
