import {boundedProviderJson,ProviderContractError,validateProviderTools} from "./provider-contract.ts";
import type {ProviderTurn,ToolCall,ToolDefinition} from "./provider-contract.ts";

/**
 * BR-093 offline adapter foundation. NOT wired to runnable jobs or any provider
 * credentials. An explicit transport injection is required for controlled
 * conformance testing and later owner-authorized executor integration.
 */
const ENDPOINT="https://generativelanguage.googleapis.com/v1beta/interactions";
const CALL_ID=/^[A-Za-z0-9_-]{1,220}$/;
const isObject=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function optionalCount(v:unknown):number|null{
  if(v===undefined||v===null)return null;
  if(typeof v!=="number"||!Number.isSafeInteger(v)||v<0||v>1_000_000_000)
    throw new ProviderContractError("Invalid Gemini token detail");
  return v;
}
export function normalizeGeminiInteraction(source:unknown,allowedTools:ReadonlySet<string>):{
  turn:ProviderTurn;steps:Record<string,unknown>[];status:"completed"|"requires_action"
}{
  if(!isObject(source)||source.object!=="interaction"||
     !["completed","requires_action"].includes(String(source.status))||
     !Array.isArray(source.steps)||source.steps.length>100||
     !isObject(source.usage))
    throw new ProviderContractError("Gemini interaction incomplete or malformed");
  const input=optionalCount(source.usage.total_input_tokens);
  const output=optionalCount(source.usage.total_output_tokens);
  if(input===null||output===null)
    throw new ProviderContractError("Gemini input/output usage missing");
  const calls:ToolCall[]=[];const ids=new Set<string>();
  let text="";const steps:Record<string,unknown>[]=[];
  for(const step of source.steps){
    if(!isObject(step))throw new ProviderContractError("Malformed Gemini step");
    if(step.type==="function_call"){
      if(typeof step.name!=="string"||!allowedTools.has(step.name)||
         typeof step.id!=="string"||!CALL_ID.test(step.id)||ids.has(step.id)||
         !isObject(step.arguments)||JSON.stringify(step.arguments).length>300000)
        throw new ProviderContractError("Invalid Gemini tool call");
      ids.add(step.id);
      calls.push({id:step.id,name:step.name,arguments:step.arguments});
    }else if(step.type==="model_output"){
      if(!Array.isArray(step.content)||step.content.length>100)
        throw new ProviderContractError("Unsupported Gemini output");
      for(const part of step.content){
        if(!isObject(part)||part.type!=="text"||typeof part.text!=="string")
          throw new ProviderContractError("Unsupported Gemini content type");
        text+=part.text;
      }
    }else if(step.type!=="thought"){
      throw new ProviderContractError("Unsupported Gemini step type");
    }
    steps.push(step);
    if(text.length>250000)throw new ProviderContractError("Unbounded Gemini output");
  }
  if((source.status==="requires_action")!==(calls.length>0))
    throw new ProviderContractError("Gemini action status does not match tool calls");
  const usage={
    inputTokens:input,outputTokens:output,
    cachedInputTokens:optionalCount(source.usage.total_cached_tokens),
    reasoningOutputTokens:optionalCount(source.usage.total_thought_tokens),
    cacheCreationInputTokens:null,
    provenance:"PROVIDER_RESPONSE" as const
  };
  return {turn:{calls,text,inputTokens:input,outputTokens:output,usage},steps,
    status:source.status as "completed"|"requires_action"};
}
export class GeminiTransportFailure extends Error{
  readonly status:number;
  constructor(status:number){
    super("Gemini transport returned HTTP "+status);
    this.name="GeminiTransportFailure";this.status=status;
  }
}
export class GeminiStatelessSession{
  readonly #transport:typeof fetch;readonly #model:string;readonly #key:string;
  readonly #instruction:string;readonly #history:Record<string,unknown>[];
  #pending:ToolCall[]=[];
  #lastCalled=false;
  constructor(model:string,secret:string,instruction:string,context:string,transport:typeof fetch){
    if(!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(model)||
       typeof secret!=="string"||secret.length<1||secret.length>1024||
       typeof instruction!=="string"||instruction.length>20000||
       typeof context!=="string"||context.length>250000||typeof transport!=="function")
      throw new ProviderContractError("Explicit bounded Gemini parameters and injected transport required");
    this.#model=model;this.#key=secret;this.#instruction=instruction;this.#transport=transport;
    this.#history=[{type:"user_input",content:[{type:"text",text:context}]}];
  }
  estimatedInputUpperBound(tools:ToolDefinition[]){
    validateProviderTools(tools);
    return Buffer.byteLength(JSON.stringify(this.#history)+this.#instruction+JSON.stringify(tools))+4096;
  }
  async next(tools:ToolDefinition[],maxOutputTokens:number,signal:AbortSignal):Promise<ProviderTurn>{
    validateProviderTools(tools);
    if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>100000)
      throw new ProviderContractError("Invalid max output token limit");
    if(this.#pending.length)throw new ProviderContractError("Unresolved Gemini function calls");
    if(this.#lastCalled)throw new ProviderContractError("Completed Gemini interaction cannot be implicitly restarted");
    signal.throwIfAborted();
    const toolNames=new Set(tools.map(t=>t.name));
    const body={
      model:this.#model,store:false,background:false,stream:false,
      system_instruction:this.#instruction,
      generation_config:{max_output_tokens:maxOutputTokens},
      input:this.#history,
      tools:tools.map(t=>({type:"function",name:t.name,description:t.description,parameters:t.parameters}))
    };
    if(JSON.stringify(body).length>2_000_000)throw new ProviderContractError("Gemini context exceeds maximum request size");
    const response=await this.#transport(ENDPOINT,{
      method:"POST",redirect:"error",cache:"no-store",
      signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),
      headers:{"Content-Type":"application/json","x-goog-api-key":this.#key},
      body:JSON.stringify(body)
    });
    if(!response.ok)throw new GeminiTransportFailure(response.status);
    const parsed=normalizeGeminiInteraction(await boundedProviderJson(response),toolNames);
    this.#history.push(...parsed.steps);this.#pending=parsed.turn.calls;
    this.#lastCalled=parsed.status==="completed";
    return parsed.turn;
  }
  results(results:{call:ToolCall;result:unknown;error?:boolean}[]):void{
    if(!this.#pending.length||results.length!==this.#pending.length)
      throw new ProviderContractError("Gemini results must resolve every pending call");
    const expected=new Map(this.#pending.map(c=>[c.id,c])),seen=new Set<string>();
    const steps:Record<string,unknown>[]=[];
    for(const item of results){
      const pending=expected.get(item.call.id);
      if(!pending||pending.name!==item.call.name||seen.has(item.call.id))
        throw new ProviderContractError("Unexpected or repeated Gemini function result");
      seen.add(item.call.id);
      let serialized:string;
      try{serialized=JSON.stringify(item.error?{error:"Tool unavailable"}:item.result);}catch{
        throw new ProviderContractError("Unable to serialize Gemini result");
      }
      if(typeof serialized!=="string"||serialized.length>100000)
        throw new ProviderContractError("Invalid Gemini result payload");
      steps.push({type:"function_result",name:pending.name,call_id:pending.id,
        result:[{type:"text",text:serialized}]});
    }
    this.#history.push(...steps);this.#pending=[];
  }
}
