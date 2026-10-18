import {createHash} from "node:crypto";
import type {Pool} from "pg";
import type {ModelProvider} from "../runner/model-catalog.ts";
import type {ReportedModelUsage} from "../runner/provider-contract.ts";
import {isValidRunId} from "./sessions.ts";
import {validLogicalAgentId} from "./logical-agents.ts";

export class UsageEvidenceInvalid extends Error{
  constructor(message="Invalid provider usage evidence"){super(message);this.name="UsageEvidenceInvalid";}
}
export type ProviderEvidenceInput={
  runId:string;logicalAgentId:string|null;operationKey:string;
  provider:ModelProvider;modelId:string;modelRevision:string;
  inputTokens:number;outputTokens:number;
  cachedInputTokens:number|null;reasoningOutputTokens:number|null;
  cacheCreationInputTokens:number|null;toolUseTokens:number|null;
};
const VALID_PROVIDER=["openai","anthropic","xai","google"];
const MODEL=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;
const KEY=/^model-[0-9]{1,5}$/;
const MAX=1_000_000_000;
function token(v:unknown,nullable=false):boolean{
  return (v===null&&nullable)||
    (typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=MAX);
}
export function validateEvidence(input:unknown):ProviderEvidenceInput{
  if(!input||typeof input!=="object"||Array.isArray(input))throw new UsageEvidenceInvalid();
  const v=input as Record<string,unknown>;
  const allowed=["runId","logicalAgentId","operationKey","provider","modelId","modelRevision",
    "inputTokens","outputTokens","cachedInputTokens","reasoningOutputTokens","cacheCreationInputTokens","toolUseTokens"];
  if(Object.keys(v).some(k=>!allowed.includes(k))||!isValidRunId(v.runId)||
    !(v.logicalAgentId===null||validLogicalAgentId(v.logicalAgentId))||
    typeof v.operationKey!=="string"||!KEY.test(v.operationKey)||
    !VALID_PROVIDER.includes(String(v.provider))||
    typeof v.modelId!=="string"||!MODEL.test(v.modelId)||
    typeof v.modelRevision!=="string"||!MODEL.test(v.modelRevision)||
    !token(v.inputTokens)||!token(v.outputTokens)||
    !token(v.cachedInputTokens,true)||!token(v.reasoningOutputTokens,true)||
    !token(v.cacheCreationInputTokens,true)||!token(v.toolUseTokens,true))
    throw new UsageEvidenceInvalid();
  return v as ProviderEvidenceInput;
}
export function fromReportedUsage(runId:string,logicalAgentId:string|null,operationKey:string,
  provider:ModelProvider,modelId:string,modelRevision:string,usage:ReportedModelUsage,
  toolUseTokens:number|null=null):ProviderEvidenceInput{
  if(usage.provenance!=="PROVIDER_RESPONSE")
    throw new UsageEvidenceInvalid("Provider usage must have provider-response provenance");
  return validateEvidence({runId,logicalAgentId,operationKey,provider,modelId,modelRevision,
    inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,
    cachedInputTokens:usage.cachedInputTokens,reasoningOutputTokens:usage.reasoningOutputTokens,
    cacheCreationInputTokens:usage.cacheCreationInputTokens,toolUseTokens});
}
export function evidenceDigest(row:ProviderEvidenceInput):string{
  const v=validateEvidence(row);
  const serialized=JSON.stringify([
    v.runId,v.logicalAgentId,v.operationKey,v.provider,v.modelId,v.modelRevision,
    v.inputTokens,v.outputTokens,v.cachedInputTokens,v.reasoningOutputTokens,
    v.cacheCreationInputTokens,v.toolUseTokens
  ]);
  return createHash("sha256").update(serialized).digest("hex");
}
/** Internal-only writer, not reachable from a public/model-provided route.
 * Records metering evidence. It never claims invoice settlement or USD cost.
 * Caller must obtain this evidence from a verified provider adapter/session.
 */
export async function appendProviderUsage(db:Pool,input:unknown){
  const row=validateEvidence(input),digest=evidenceDigest(row);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const exists=await client.query<{run_id:string}>(`SELECT run_id FROM agent_runs
      WHERE run_id=$1 AND state IN ('RUNNING','YIELDED','COMPLETED','BLOCKED','FAILED') FOR SHARE`,
      [row.runId]);
    if(exists.rowCount!==1)throw new UsageEvidenceInvalid("Verified run not found");
    if(row.logicalAgentId!==null){
      const linked=await client.query(`SELECT 1 FROM logical_agent_run_links
        WHERE run_id=$1 AND agent_id=$2`,[row.runId,row.logicalAgentId]);
      if(linked.rowCount!==1)throw new UsageEvidenceInvalid("Unverified logical agent link");
    }
    const inserted=await client.query<{event_id:string}>(`INSERT INTO api_usage_evidence
      (run_id,logical_agent_id,operation_key,provider,model_id,model_revision,
       input_tokens,output_tokens,cached_input_tokens,reasoning_output_tokens,
       cache_creation_input_tokens,tool_use_tokens,sanitized_evidence_sha256)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(run_id,operation_key,provenance) DO NOTHING RETURNING event_id`,
      [row.runId,row.logicalAgentId,row.operationKey,row.provider,row.modelId,row.modelRevision,
       row.inputTokens,row.outputTokens,row.cachedInputTokens,row.reasoningOutputTokens,
       row.cacheCreationInputTokens,row.toolUseTokens,digest]);
    if(inserted.rowCount===1){
      await client.query("COMMIT");
      return {recorded:true,replay:false};
    }
    const old=await client.query<{sanitized_evidence_sha256:string}>(`SELECT sanitized_evidence_sha256 FROM api_usage_evidence
      WHERE run_id=$1 AND operation_key=$2 AND provenance='PROVIDER_RESPONSE'`,
      [row.runId,row.operationKey]);
    if(old.rowCount!==1||old.rows[0].sanitized_evidence_sha256!==digest)
      throw new UsageEvidenceInvalid("Conflicting immutable usage evidence");
    await client.query("COMMIT");return {recorded:true,replay:true};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
