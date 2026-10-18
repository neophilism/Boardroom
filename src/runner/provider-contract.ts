/** Provider-independent data contract; no provider SDK or paid execution. */
export type ProviderName="openai"|"anthropic"|"xai";
export type ToolDefinition={name:string;description:string;parameters:Record<string,unknown>};
export type ToolCall={id:string;name:string;arguments:Record<string,unknown>};
export type ReportedModelUsage={
  inputTokens:number;outputTokens:number;
  cachedInputTokens:number|null;reasoningOutputTokens:number|null;
  cacheCreationInputTokens:number|null;
  provenance:"PROVIDER_RESPONSE";
};
export type ProviderTurn={
  calls:ToolCall[];text:string;inputTokens:number;outputTokens:number;
  usage:ReportedModelUsage;
};
export class ProviderContractError extends Error{
  constructor(message="Provider protocol response invalid"){super(message);this.name="ProviderContractError";}
}
const PLAIN=/^[a-z_][a-z0-9_]{0,63}$/;
const CALL_ID=/^[A-Za-z0-9_-]{1,220}$/;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const finiteInteger=(v:unknown,max=1_000_000_000)=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0&&v<=max;
function optionalInteger(value:unknown):number|null{
  if(value===undefined||value===null)return null;
  if(!finiteInteger(value))throw new ProviderContractError("Invalid provider usage detail");
  return value as number;
}
export function validateProviderTools(tools:unknown):asserts tools is ToolDefinition[]{
  if(!Array.isArray(tools)||tools.length>100)throw new ProviderContractError("Invalid provider tool catalog");
  const seen=new Set<string>();
  for(const t of tools){
    if(!isRecord(t)||typeof t.name!=="string"||!PLAIN.test(t.name)||
       seen.has(t.name)||typeof t.description!=="string"||t.description.length>1200||
       !isRecord(t.parameters)||t.parameters.type!=="object"||
       JSON.stringify(t.parameters).length>80000)
      throw new ProviderContractError("Invalid or duplicate tool definition");
    seen.add(t.name);
  }
}
function extractUsage(provider:ProviderName,input:unknown):ReportedModelUsage{
  if(!isRecord(input)||!finiteInteger(input.input_tokens)||!finiteInteger(input.output_tokens))
    throw new ProviderContractError("Missing or invalid provider token counts");
  const inDetails=isRecord(input.input_tokens_details)?input.input_tokens_details:{};
  const outDetails=isRecord(input.output_tokens_details)?input.output_tokens_details:{};
  return {
    inputTokens:input.input_tokens as number,outputTokens:input.output_tokens as number,
    cachedInputTokens:optionalInteger(provider==="anthropic"?input.cache_read_input_tokens:inDetails.cached_tokens),
    reasoningOutputTokens:optionalInteger(outDetails.reasoning_tokens),
    cacheCreationInputTokens:optionalInteger(provider==="anthropic"?input.cache_creation_input_tokens:undefined),
    provenance:"PROVIDER_RESPONSE"
  };
}
function decodedArguments(value:unknown,isAnthropic:boolean):Record<string,unknown>{
  let parsed:unknown=value;
  if(!isAnthropic){
    if(typeof value!=="string"||value.length>300000)throw new ProviderContractError("Invalid function-call arguments");
    try{parsed=JSON.parse(value);}catch{throw new ProviderContractError("Malformed function-call arguments");}
  }
  if(!isRecord(parsed)||JSON.stringify(parsed).length>300000)
    throw new ProviderContractError("Invalid tool input");
  return parsed;
}
export function normalizeProviderTurn(provider:ProviderName,data:unknown):ProviderTurn{
  if(!["openai","anthropic","xai"].includes(provider))throw new ProviderContractError("Unsupported provider");
  if(!isRecord(data))throw new ProviderContractError();
  const isAnthropic=provider==="anthropic";
  const raw=data[isAnthropic?"content":"output"];
  if(!Array.isArray(raw)||raw.length>100)throw new ProviderContractError("Invalid provider output");
  const usage=extractUsage(provider,data.usage);
  const calls:ToolCall[]=[];let text="";
  const ids=new Set<string>();
  for(const item of raw){
    if(!isRecord(item))throw new ProviderContractError("Invalid provider output item");
    if(item.type==="tool_use"||item.type==="function_call"){
      if((item.type==="tool_use")!==isAnthropic)throw new ProviderContractError("Mismatched provider tool protocol");
      const id=isAnthropic?item.id:item.call_id;
      if(typeof id!=="string"||!CALL_ID.test(id)||ids.has(id)||typeof item.name!=="string"||!PLAIN.test(item.name))
        throw new ProviderContractError("Invalid or duplicate provider tool call");
      ids.add(id);
      calls.push({id,name:item.name,arguments:decodedArguments(isAnthropic?item.input:item.arguments,isAnthropic)});
    }else if(item.type==="text"||item.type==="output_text"){
      if(typeof item.text!=="string")throw new ProviderContractError("Invalid provider text");
      text+=item.text;
    }else if(item.type==="message"){
      if(!Array.isArray(item.content)||item.content.length>100)throw new ProviderContractError("Invalid provider message");
      for(const part of item.content){
        if(!isRecord(part))throw new ProviderContractError("Invalid content part");
        if(part.type==="output_text"){
          if(typeof part.text!=="string")throw new ProviderContractError("Invalid output text");
          text+=part.text;
        }
      }
    }
    if(text.length>250000)throw new ProviderContractError("Unbounded provider text output");
  }
  return {calls,text,inputTokens:usage.inputTokens,outputTokens:usage.outputTokens,usage};
}
/** The provider may be trusted for model inference, but never for unbounded HTTP
 * response bodies. Error responses are deliberately not logged or consumed.
 */
export async function boundedProviderJson(response:Response,maxBytes=2_000_000):Promise<unknown>{
  const len=response.headers.get("content-length");
  if(len&&/^\d+$/.test(len)&&Number(len)>maxBytes)throw new ProviderContractError("Provider response too large");
  if(!response.body)throw new ProviderContractError("Empty provider response");
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const r=await reader.read();
      if(r.done)break;
      size+=r.value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new ProviderContractError("Provider response too large");}
      parts.push(r.value);
    }
    let result:unknown;
    try{result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts)));}catch{throw new ProviderContractError();}
    return result;
  }finally{reader.releaseLock();}
}
