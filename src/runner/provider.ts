import {boundedProviderJson,normalizeProviderTurn,validateProviderTools} from "./provider-contract.ts";
import type {ProviderName,ProviderTurn,ToolDefinition,ToolCall} from "./provider-contract.ts";
export type {ProviderName,ProviderTurn,ToolDefinition,ToolCall,ReportedModelUsage} from "./provider-contract.ts";
export class ProviderFailure extends Error{
  readonly status:number;
  constructor(status:number){super("Model provider request failed (HTTP "+status+")");this.status=status;}
}
export class ProviderSession{
  readonly #key:string;readonly #provider:ProviderName;readonly #model:string;readonly #fetch:typeof fetch;
  readonly #instructions:string;readonly #history:unknown[];
  constructor(provider:ProviderName,model:string,key:string,instructions:string,context:string,transport:typeof fetch=fetch){
    if(!["openai","anthropic","xai"].includes(provider)||!model||!key)throw new Error("Explicit provider, model and protected provider credential required");
    this.#key=key;this.#provider=provider;this.#model=model;this.#fetch=transport;this.#instructions=instructions;
    this.#history=[{role:"user",content:context}];
  }
  estimatedInputUpperBound(tools:ToolDefinition[]):number{
    // Conservative byte-count bound; include request metadata/tool schemas.
    return Buffer.byteLength(JSON.stringify(this.#history)+this.#instructions+JSON.stringify(tools))+4096;
  }
  async next(tools:ToolDefinition[],maxOutputTokens:number,signal:AbortSignal):Promise<ProviderTurn>{
    validateProviderTools(tools);
    if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>100000)throw new Error("Invalid output token cap");
    signal.throwIfAborted();
    const anthropic=this.#provider==="anthropic";
    const url=anthropic?"https://api.anthropic.com/v1/messages":this.#provider==="xai"?"https://api.x.ai/v1/responses":"https://api.openai.com/v1/responses";
    const body=anthropic?{model:this.#model,system:this.#instructions,messages:this.#history,max_tokens:maxOutputTokens,
      tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}))}:
      {model:this.#model,instructions:this.#instructions,input:this.#history,max_output_tokens:maxOutputTokens,store:false,
        tools:tools.map(t=>({type:"function",name:t.name,description:t.description,parameters:t.parameters}))};
    const response=await this.#fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),
      headers:anthropic?{"Content-Type":"application/json","x-api-key":this.#key,"anthropic-version":"2023-06-01"}:
        {"Content-Type":"application/json",Authorization:"Bearer "+this.#key},body:JSON.stringify(body)});
    if(!response.ok)throw new ProviderFailure(response.status);
    const data=await boundedProviderJson(response) as Record<string,unknown>;
    const turn=normalizeProviderTurn(this.#provider,data);
    const output=(anthropic?data.content:data.output) as Array<Record<string,unknown>>;
    if(anthropic)this.#history.push({role:"assistant",content:output});
    else this.#history.push(...output);
    return turn;
  }
  results(results:{call:ToolCall;result:unknown;error?:boolean}[]):void{
    if(this.#provider==="anthropic")this.#history.push({role:"user",content:results.map(r=>({type:"tool_result",tool_use_id:r.call.id,
      content:JSON.stringify(r.result),is_error:r.error??false}))});
    else this.#history.push(...results.map(r=>({type:"function_call_output",call_id:r.call.id,output:JSON.stringify(r.result)})));
  }
}
