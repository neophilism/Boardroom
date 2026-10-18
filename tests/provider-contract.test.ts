import test from "node:test";
import assert from "node:assert/strict";
import {normalizeProviderTurn,ProviderContractError,validateProviderTools,boundedProviderJson} from "../src/runner/provider-contract.ts";
const call={type:"function_call",call_id:"call_001",name:"read_file",arguments:'{"path":"README.md"}'};
test("provider-normalized OpenAI responses retain cache and reasoning as measured but not billed",()=>{
  const turn=normalizeProviderTurn("openai",{output:[call,{type:"message",content:[{type:"output_text",text:"done"}]}],
    usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40},output_tokens_details:{reasoning_tokens:9}}});
  assert.equal(turn.text,"done");assert.equal(turn.calls[0].name,"read_file");
  assert.deepEqual(turn.calls[0].arguments,{path:"README.md"});
  assert.deepEqual(turn.usage,{inputTokens:100,outputTokens:20,cachedInputTokens:40,reasoningOutputTokens:9,
    cacheCreationInputTokens:null,provenance:"PROVIDER_RESPONSE"});
});
test("Anthropic tool protocol never pretends cache creation or reads are ordinary input tokens",()=>{
  const turn=normalizeProviderTurn("anthropic",{
    content:[{type:"text",text:"first"},{type:"tool_use",id:"toolu_01",name:"read_file",input:{path:"src/app.ts"}}],
    usage:{input_tokens:31,output_tokens:12,cache_creation_input_tokens:120,cache_read_input_tokens:180}});
  assert.equal(turn.usage.inputTokens,31);
  assert.equal(turn.usage.cachedInputTokens,180);
  assert.equal(turn.usage.cacheCreationInputTokens,120);
  assert.deepEqual(turn.calls[0],{id:"toolu_01",name:"read_file",arguments:{path:"src/app.ts"}});
});
test("xAI response protocol follows independent normalized contract without inventing token details",()=>{
  const turn=normalizeProviderTurn("xai",{output:[call],usage:{input_tokens:5,output_tokens:2}});
  assert.equal(turn.usage.cachedInputTokens,null);
  assert.equal(turn.usage.reasoningOutputTokens,null);
});
test("untrusted provider output cannot emit duplicate/invalid calls or unbounded content",()=>{
  const baseline={output:[call],usage:{input_tokens:5,output_tokens:2}};
  for(const v of [{...baseline,output:[call,call]}, {...baseline,output:[{...call,call_id:"<script>"}]},
    {...baseline,output:[{...call,arguments:"{"}]},
    {...baseline,output:[{...call,arguments:'["not","object"]'}]},
    {...baseline,output:[{...call,name:"../../secret"}]},
    {...baseline,usage:{input_tokens:-1,output_tokens:1}},
    {...baseline,output:[{type:"output_text",text:"x".repeat(250001)}]},
    {content:[{type:"tool_use",id:"abc",name:"read_file",input:{}}],usage:baseline.usage}])
    assert.throws(()=>normalizeProviderTurn("openai",v),ProviderContractError);
});
test("tool schemas are required, unique, size-limited, and bounded before any paid call",()=>{
  const good={name:"read_file",description:"read",parameters:{type:"object",properties:{path:{type:"string"}}}};
  assert.doesNotThrow(()=>validateProviderTools([good]));
  for(const bad of [[good,good],[{...good,name:"rm -rf"}],[{...good,parameters:{type:"string"}}],
    Array.from({length:101},(_,i)=>({...good,name:"tool_"+i}))])
    assert.throws(()=>validateProviderTools(bad),ProviderContractError);
});
test("bounded HTTP JSON parser refuses overlarge streamed provider payload before decoding",async()=>{
  await assert.rejects(boundedProviderJson(new Response("x".repeat(50)),10),ProviderContractError);
  const payload={output:[call],usage:{input_tokens:1,output_tokens:1}};
  assert.deepEqual(await boundedProviderJson(new Response(JSON.stringify(payload))),payload);
  await assert.rejects(boundedProviderJson(new Response("raw provider secret")),ProviderContractError);
});
