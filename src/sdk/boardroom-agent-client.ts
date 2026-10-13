/** Provider-neutral, capability-limited Boardroom agent HTTP client.
 * Only place an agent bearer credential in a trusted secret-backed runtime.
 * Never put this credential in a scheduled task's plain-text prompt.
 */
export type Arrival=
  |{agentName:string;provider:string;runId:string;shouldWork:true;state:"ADMITTED";replay:false}
  |{agentName:string;provider:string;runId:null;shouldWork:false;state:string;replay:boolean};
export type Claimed={
  assignmentId:string;repositoryId:string;fullName:string;unitId:string;
  generation:string;expiresAt:string;replay:boolean;
};
export type Claim=
  |{status:"ASSIGNED";assignment:Claimed}
  |{status:"IDLE";assignment:null};
export type AgentContext={
  assignment:{assignmentId:string;repositoryId:string;repository:string;unitId:string;generation:string;expiresAt:string};
  workUnit:{title:string;state:string;version:number;dependsOn:unknown;acceptanceCriteria:string|null;pullRequests:unknown};
  checkpoint:{branch:string|null;headSha:string|null;state:unknown;createdAt:string}|null;
  repositoryInstructions:{path:"AGENTS.md";text:string;sha:string}|null;
  technicalQuestions?:unknown[];
  instructionsAreUntrustedRepositoryContent:true;
};
export type SessionOutcome="COMPLETED"|"YIELDED"|"BLOCKED"|"FAILED"|"CANCELLED";
export type GithubWrite=
  |{kind:"ensure_branch"}
  |{kind:"upsert_file";path:string;contentBase64:string;expectedSha:string|null;message:string}
  |{kind:"open_draft_pr";description:string}
  |{kind:"ready_pr";number:number};

export class BoardroomRequestError extends Error{
  readonly status:number;
  readonly code:"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED"|null;
  constructor(status:number,code:"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED"|null=null){
    super("Boardroom request failed with HTTP "+status);
    this.name="BoardroomRequestError";
    this.status=status;
    this.code=code;
  }
}
export class BoardroomContractError extends Error{
  constructor(message:string){super(message);this.name="BoardroomContractError";}
}
export type AgentClientSettings={
  baseUrl:string;
  bearerToken:string;
  assignedName:string;
  transport?:typeof fetch;
};

/** Transport never retries mutating requests implicitly. Network timeout or
 * interrupted responses require state reconciliation, not duplicate writes.
 */
export class BoardroomAgentClient{
  readonly #base:string;
  readonly #token:string;
  readonly #name:string;
  readonly #transport:typeof fetch;
  constructor({baseUrl,bearerToken,assignedName,transport}:AgentClientSettings){
    const url=new URL(baseUrl);
    if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
       (url.pathname!=="/"&&url.pathname!==""))
      throw new BoardroomContractError("Boardroom base URL must be a credential-free HTTPS origin");
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(bearerToken))
      throw new BoardroomContractError("A secure agent credential is required");
    if(typeof assignedName!=="string"||!assignedName||assignedName.length>100)
      throw new BoardroomContractError("Assigned agent display name required");
    this.#base=url.origin;
    this.#token=bearerToken;
    this.#name=assignedName;
    this.#transport=transport??fetch;
  }
  async #request<T>(method:"GET"|"POST",path:string,payload?:unknown,
    extraHeaders?:Record<string,string>):Promise<T>{
    if(!path.startsWith("/api/v1/")||path.includes("//"))
      throw new BoardroomContractError("Unsupported API path");
    const response=await this.#transport(this.#base+path,{
      method,redirect:"error",cache:"no-store",
      headers:{
        Authorization:"Bearer "+this.#token,"X-Boardroom-Agent-Name":this.#name,
        Accept:"application/json",
        ...(method==="POST"?{"Content-Type":"application/json"}:{}),
        ...extraHeaders
      },
      body:method==="POST"?JSON.stringify(payload??{}):undefined,
      signal:AbortSignal.timeout(40000)
    });
    if(!response.ok){
      // Recognize only fixed server budget codes, never provider messages or
      // arbitrary response text which might contain a credential.
      const body=response.status===409?await response.json().catch(()=>null):null;
      const code=body?.code==="BUDGET_LIMIT"||body?.code==="BUDGET_NOT_CONFIGURED"?body.code:null;
      throw new BoardroomRequestError(response.status,code);
    }
    try{return await response.json() as T;}
    catch{throw new BoardroomContractError("Boardroom did not return valid JSON");}
  }
  async arrive(activationKey?:string):Promise<Arrival>{
    const headers:Record<string,string>|undefined=activationKey?{"Idempotency-Key":activationKey}:undefined;
    const result=await this.#request<Arrival>("POST","/api/v1/runs/arrive",{},headers);
    if(result.agentName!==this.#name||typeof result.shouldWork!=="boolean"||
       (result.shouldWork&&!result.runId))
      throw new BoardroomContractError("Server-verified agent identity or arrival contract mismatch");
    return result;
  }
  claim(runId:string):Promise<Claim>{
    return this.#request("POST","/api/v1/assignments/claim",{runId});
  }
  context(runId:string,generation:string):Promise<AgentContext>{
    return this.#request("GET","/api/v1/assignments/context?runId="+encodeURIComponent(runId)+
      "&generation="+encodeURIComponent(generation));
  }
  heartbeat(runId:string,generation:string):Promise<{state:string;expiresAt:string}>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/heartbeat",{generation});
  }
  checkpoint(runId:string,generation:string,checkpoint:{
    branch:string|null;headSha:string|null;state:Record<string,unknown>
  }):Promise<{checkpointId:string;status:string}>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/checkpoint",
      {generation,...checkpoint});
  }
  finish(runId:string,generation:string,outcome:SessionOutcome):Promise<{state:SessionOutcome;replay:boolean}>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/finish",{generation,outcome});
  }
  finishIdle(runId:string):Promise<{state:"YIELDED";replay:boolean}>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/idle");
  }
  githubWrite(runId:string,generation:string,operation:GithubWrite):Promise<unknown>{
    return this.#request("POST","/api/v1/github/write",{runId,generation,...operation});
  }
  sourceTree(runId:string,generation:string):Promise<{repository:string;headSha:string;entries:{path:string;sha:string;size?:number}[]}>{
    return this.#request("GET","/api/v1/github/source?runId="+encodeURIComponent(runId)+"&generation="+encodeURIComponent(generation));
  }
  sourceFile(runId:string,generation:string,path:string,sha:string):Promise<{path:string;sha:string;text:string;snapshotSha:string}>{
    return this.#request("GET","/api/v1/github/source?kind=file&runId="+encodeURIComponent(runId)+"&generation="+encodeURIComponent(generation)+
      "&path="+encodeURIComponent(path)+"&sha="+encodeURIComponent(sha));
  }
  sourceBlob(runId:string,generation:string,path:string,sha:string):Promise<{path:string;sha:string;contentBase64:string;snapshotSha:string}>{
    return this.#request("GET","/api/v1/github/source?kind=blob&runId="+encodeURIComponent(runId)+"&generation="+encodeURIComponent(generation)+
      "&path="+encodeURIComponent(path)+"&sha="+encodeURIComponent(sha));
  }
  merge(runId:string,generation:string,number:number,expectedSha:string):Promise<unknown>{
    return this.#request("POST","/api/v1/github/merge",{runId,generation,number,expectedSha});
  }
  advance(runId:string,generation:string):Promise<{status:"NEXT_UNIT"|"EXHAUSTED";unitId?:string}>{
    return this.#request("POST","/api/v1/assignments/advance",{runId,generation});
  }
  reserveBudget(runId:string,generation:string,operationKey:string,amountMicroUsd:number):Promise<{reservationId:string;replay:boolean}>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/usage",{kind:"reserve",generation,operationKey,amountMicroUsd});
  }
  reportUsage(runId:string,generation:string,operationKey:string,inputTokens:number,outputTokens:number,costMicroUsd:number):Promise<unknown>{
    return this.#request("POST","/api/v1/runs/"+encodeURIComponent(runId)+"/usage",{kind:"record",generation,operationKey,inputTokens,outputTokens,costMicroUsd});
  }
  prEvidence(runId:string,generation:string,number:number):Promise<unknown>{
    if(!Number.isSafeInteger(number)||number<1)throw new BoardroomContractError("Valid PR number required");
    return this.#request("GET","/api/v1/github/pr-evidence?runId="+encodeURIComponent(runId)+
      "&generation="+encodeURIComponent(generation)+"&number="+number);
  }
  coffeeThreads(status?:"OPEN"|"ANSWERED"|"RESOLVED"|"CLOSED",query?:string):Promise<{threads:unknown[]}>{
    const parameters=new URLSearchParams();
    if(status)parameters.set("status",status);
    if(query)parameters.set("q",query);
    return this.#request("GET","/api/v1/coffee/threads"+(parameters.size?"?"+parameters.toString():""));
  }
  coffeeMessages(threadId:string):Promise<{messages:unknown[]}>{
    return this.#request("GET","/api/v1/coffee/threads/"+encodeURIComponent(threadId)+"/messages");
  }
  answerCoffee(runId:string,threadId:string,answer:string,evidence:string[]=[]):Promise<unknown>{
    return this.#request("POST","/api/v1/coffee/threads/"+encodeURIComponent(threadId)+"/messages",
      {runId,answer,evidence});
  }
  resolveCoffee(runId:string,generation:string,threadId:string,messageId:string,adr:string):Promise<unknown>{
    return this.#request("POST","/api/v1/coffee/threads/"+encodeURIComponent(threadId)+"/resolve",{runId,generation,messageId,adr});
  }
  askCoffee(runId:string,subject:string,question:string,evidence:string[]=[],generation?:string){
    return this.#request("POST","/api/v1/coffee/threads",
      {runId,subject,question,evidence,...(generation?{generation}:{})});
  }
  ownerAction(payload:Record<string,unknown>):Promise<unknown>{
    return this.#request("POST","/api/v1/owner-actions",payload);
  }
}
