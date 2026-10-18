import test from "node:test";
import assert from "node:assert/strict";
import {parseModelCatalog,requireQualifiedModel,ModelCatalogInvalid} from "../src/runner/model-catalog.ts";
const seen="2026-10-18T00:00:00Z",exp="2026-11-17T00:00:00Z";
const entry={
  provider:"openai",modelId:"snapshot-model-20261018",revision:"2026-10-18",
  lifecycle:"QUALIFIED",snapshotPinned:true,reasoningSettings:["low","high","xhigh"],
  supportsTools:true,modalities:["text"],contextWindow:null,maxOutputTokens:null,
  sourceUrl:"https://developers.openai.com/api/docs/models",
  observedAt:seen,expiresAt:exp,
  qualificationEvidenceUrl:"https://github.com/neophilism/Boardroom/actions/runs/123456"
};
const make=(models:unknown[])=>({schemaVersion:1,catalogVersion:1,models});
test("default catalog holds zero executable or qualified models",()=>{
  const c=parseModelCatalog(make([]));
  assert.deepEqual(c.models,[]);
  assert.throws(()=>requireQualifiedModel(c,"openai","any","high"),ModelCatalogInvalid);
});
test("a snapshot may only be selected with precisely validated provider-native effort",()=>{
  const c=parseModelCatalog(make([entry]));
  const date=Date.parse("2026-10-19T00:00:00Z");
  assert.equal(requireQualifiedModel(c,"openai",entry.modelId,"xhigh",date).revision,"2026-10-18");
  assert.throws(()=>requireQualifiedModel(c,"openai",entry.modelId,"adaptive",date),ModelCatalogInvalid);
  assert.throws(()=>requireQualifiedModel(c,"anthropic",entry.modelId,"high",date),ModelCatalogInvalid);
  assert.throws(()=>requireQualifiedModel(c,"openai",entry.modelId,"high",Date.parse(exp)),ModelCatalogInvalid);
});
test("aliases, stale claims, missing qualification and source spoofing fail closed",()=>{
  for(const alteration of [
    {snapshotPinned:false},{qualificationEvidenceUrl:null},
    {qualificationEvidenceUrl:"https://evil.example/actions/runs/123"},
    {sourceUrl:"http://developers.openai.com/api/docs/models"},
    {sourceUrl:"https://developers.openai.com.evil.example/models"},
    {observedAt:"2026-10-18T00:00:00Z",expiresAt:"2027-10-18T00:00:00Z"},
    {reasoningSettings:["high","high"]},{reasoningSettings:["imaginary"]},
    {modalities:["text","text"]},{contextWindow:-10},
    {maxOutputTokens:0}, {modelId:"../secret"}
  ])assert.throws(()=>parseModelCatalog(make([{...entry,...alteration}])),ModelCatalogInvalid);
  assert.throws(()=>parseModelCatalog(make([entry,entry])),ModelCatalogInvalid);
});
test("unverified and retired models may be documented but never selected",()=>{
  for(const state of ["CANDIDATE","RETIRED"]){
    const c=parseModelCatalog(make([{...entry,lifecycle:state,snapshotPinned:false,qualificationEvidenceUrl:null}]));
    assert.throws(()=>requireQualifiedModel(c,"openai",entry.modelId,"high",Date.parse(seen)+1000),ModelCatalogInvalid);
  }
});
test("Gemini/Claude/Grok may be recorded without fabricating production readiness",()=>{
  const choices=[
    ["google","https://ai.google.dev/gemini-api/docs/models"],
    ["anthropic","https://platform.claude.com/docs/en/models/overview"],
    ["xai","https://docs.x.ai/developers/models"]
  ] as const;
  for(const [provider,sourceUrl] of choices){
    const c=parseModelCatalog(make([{...entry,provider,sourceUrl,lifecycle:"CANDIDATE",snapshotPinned:false,qualificationEvidenceUrl:null}]));
    assert.equal(c.models[0].provider,provider);
    assert.throws(()=>requireQualifiedModel(c,provider,entry.modelId,"high",Date.parse(seen)+1000),ModelCatalogInvalid);
  }
});
