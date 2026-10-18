import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {validateEvidence,fromReportedUsage,evidenceDigest,appendProviderUsage,UsageEvidenceInvalid} from "../src/server/api-usage-evidence.ts";
const id="26741e83-9694-4fb3-8174-783b2f9bf61c";
const row={runId:id,logicalAgentId:null,operationKey:"model-5",
  provider:"openai",modelId:"model-snapshot",modelRevision:"v1",
  inputTokens:10,outputTokens:20,cachedInputTokens:null,reasoningOutputTokens:5,
  cacheCreationInputTokens:null,toolUseTokens:null} as const;
test("per-provider evidence preserves null unknown quantities without invented pricing",()=>{
  const v=validateEvidence(row);
  assert.equal(v.cachedInputTokens,null);
  assert.equal(v.toolUseTokens,null);
  assert.equal(v.reasoningOutputTokens,5);
  assert.match(evidenceDigest(v),/^[a-f0-9]{64}$/);
  assert.equal(evidenceDigest(v),evidenceDigest(v));
  assert.notEqual(evidenceDigest(v),evidenceDigest({...v,outputTokens:21}));
});
test("provider usage import rejects manually invented cost, invoices and spoofed runs",()=>{
  for(const bad of [
    {...row,reportedCostMicroUsd:0},
    {...row,provenance:"INVOICE_RECONCILED"},
    {...row,inputTokens:-1},{...row,reasoningOutputTokens:undefined},
    {...row,runId:"not_uuid"},{...row,modelRevision:""},
    {...row,logicalAgentId:"not_ulid"},{...row,provider:"fake"},
    {...row,operationKey:"../model-5"}
  ])assert.throws(()=>validateEvidence(bad),UsageEvidenceInvalid);
  assert.throws(()=>fromReportedUsage(row.runId,null,"model-1","openai","snapshot","rev",
    {inputTokens:1,outputTokens:2,cachedInputTokens:null,reasoningOutputTokens:null,
      cacheCreationInputTokens:null,provenance:"UNKNOWN" as "PROVIDER_RESPONSE"}),UsageEvidenceInvalid);
});
function fakeDB(existing:string|null=null,linked=true){
  const calls:{sql:string;args:unknown[]}[]=[];
  const db={connect:async()=>({query:async(sql:string,args:unknown[]=[])=>{
    calls.push({sql,args});
    if(sql.includes("FROM agent_runs"))return {rows:[{run_id:id}],rowCount:1};
    if(sql.includes("FROM logical_agent_run_links"))return {rows:linked?[{yes:1}]:[],rowCount:linked?1:0};
    if(sql.includes("INSERT INTO api_usage_evidence")){
      return {rows:existing===null?[{event_id:id}]:[],rowCount:existing===null?1:0};
    }
    if(sql.includes("SELECT sanitized_evidence_sha256"))return {rows:[{sanitized_evidence_sha256:existing}],rowCount:1};
    return {rows:[],rowCount:0};
  },release:()=>{}} as unknown as PoolClient)} as unknown as Pool;
  return {db,calls};
}
test("server append records only sanitized usage, never fake pricing or credentials",async()=>{
  const {db,calls}=fakeDB();
  assert.deepEqual(await appendProviderUsage(db,row),{recorded:true,replay:false});
  const insert=calls.find(c=>c.sql.includes("INSERT INTO api_usage_evidence"))!;
  assert.equal(insert.args.at(-1),evidenceDigest(row));
  assert.ok(!insert.sql.includes("reported_cost_microusd"));
  assert.ok(!insert.sql.includes("pricing_revision"));
  assert.ok(calls.some(x=>x.sql==="COMMIT"));
});
test("idempotent same digest replays, conflicting usage refuses changing history",async()=>{
  const identical=fakeDB(evidenceDigest(row));
  assert.deepEqual(await appendProviderUsage(identical.db,row),{recorded:true,replay:true});
  const changed=fakeDB("0".repeat(64));
  await assert.rejects(appendProviderUsage(changed.db,row),UsageEvidenceInvalid);
  assert.ok(changed.calls.some(x=>x.sql==="ROLLBACK"));
});
test("logical provenance requires a separately confirmed linkage to the same run",async()=>{
  const agentId="01K72H94M00TVFG2A7TF0K98AY";
  const notLinked=fakeDB(null,false);
  await assert.rejects(appendProviderUsage(notLinked.db,{...row,logicalAgentId:agentId}),UsageEvidenceInvalid);
  assert.ok(!notLinked.calls.some(x=>x.sql.includes("INSERT INTO api_usage_evidence")));
});
