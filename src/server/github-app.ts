import { createSign } from "node:crypto";

export type GitHubRepository = {
  id:number; full_name:string; created_at:string; pushed_at:string|null;
  updated_at:string; description:string|null; archived:boolean;
};
export type GitHubPull = {
  number:number; title:string; state:"open"|"closed"; updated_at:string; merged_at:string|null;
};
type TokenCache={value:string;expires:number;permissions:Record<string,string>|null};
let tokenCache:TokenCache|undefined;
export type GitHubAppFailureCode=
  |"APP_ID_INVALID"|"APP_ID_MISSING"|"INSTALLATION_ID_MISSING"|"PRIVATE_KEY_MISSING"
  |"INSTALLATION_ID_INVALID"|"PRIVATE_KEY_INVALID"
  |"APP_AUTH_REJECTED"|"INSTALLATION_NOT_FOUND"|"INSTALLATION_FORBIDDEN"
  |"GITHUB_TEMPORARILY_UNAVAILABLE"|"GITHUB_NETWORK_ERROR"|"INSTALLATION_RESPONSE_INVALID";
export class GitHubAppSetupFailure extends Error {
  readonly issue:GitHubAppFailureCode;
  constructor(issue:GitHubAppFailureCode){
    super("GitHub App configuration or connectivity problem");
    this.name="GitHubAppSetupFailure";
    this.issue=issue;
  }
}

function requiredEnv(name:string):string{
  const value=process.env[name];
  if(!value){
    const code=name==="BOARDROOM_GITHUB_APP_ID"?"APP_ID_MISSING":
      name==="BOARDROOM_GITHUB_INSTALLATION_ID"?"INSTALLATION_ID_MISSING":
      "PRIVATE_KEY_MISSING";
    throw new GitHubAppSetupFailure(code);
  }
  return value;
}
function signInstallationJWT():string{
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url");
  const appId=requiredEnv("BOARDROOM_GITHUB_APP_ID");
  if(!/^\d+$/.test(appId))throw new GitHubAppSetupFailure("APP_ID_INVALID");
  const payload=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:appId})).toString("base64url");
  const data=header+"."+payload;
  const key=requiredEnv("BOARDROOM_GITHUB_APP_PRIVATE_KEY").replace(/\\n/g,"\n");
  try{
    return data+"."+createSign("RSA-SHA256").update(data).end().sign(key).toString("base64url");
  }catch{
    throw new GitHubAppSetupFailure("PRIVATE_KEY_INVALID");
  }
}
async function installationToken():Promise<string>{
  if(tokenCache && tokenCache.expires-Date.now()>5*60*1000)return tokenCache.value;
  const installationId=requiredEnv("BOARDROOM_GITHUB_INSTALLATION_ID");
  if(!/^\d+$/.test(installationId))throw new GitHubAppSetupFailure("INSTALLATION_ID_INVALID");
  let response:Response;
  try{
    response=await fetch("https://api.github.com/app/installations/"+installationId+"/access_tokens",{
      method:"POST",headers:{
        Authorization:"Bearer "+signInstallationJWT(),
        Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
        "User-Agent":"Boardroom-Coordinator"
      },signal:AbortSignal.timeout(15000)
    });
  }catch(error){
    if(error instanceof GitHubAppSetupFailure)throw error;
    throw new GitHubAppSetupFailure("GITHUB_NETWORK_ERROR");
  }
  if(!response.ok){
    const issue=response.status===401?"APP_AUTH_REJECTED":
      response.status===403?"INSTALLATION_FORBIDDEN":
      response.status===404?"INSTALLATION_NOT_FOUND":
      response.status===422?"INSTALLATION_ID_INVALID":
      "GITHUB_TEMPORARILY_UNAVAILABLE";
    throw new GitHubAppSetupFailure(issue);
  }
  const data=await response.json() as {token?:string;expires_at?:string;permissions?:Record<string,string>};
  if(!data.token||!data.expires_at)
    throw new GitHubAppSetupFailure("INSTALLATION_RESPONSE_INVALID");
  tokenCache={value:data.token,expires:Date.parse(data.expires_at),permissions:data.permissions??null};
  return data.token;
}
/** The GitHub App token response includes its granted permissions. Only
 * non-secret permission levels are exposed to authenticated system diagnostics.
 * Never return the installation token itself.
 */
export async function getInstalledGitHubPermissions():Promise<Record<string,string>|null>{
  await installationToken();
  return tokenCache?.permissions?{...tokenCache.permissions}:null;
}

async function gh(path:string):Promise<Response>{
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Invalid GitHub API path");
  const url=new URL("https://api.github.com"+path);
  const res=await fetch(url,{
    headers:{
      Authorization:"Bearer "+await installationToken(),
      Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"Boardroom-Coordinator"
    },signal:AbortSignal.timeout(20000)
  });
  if(!res.ok&&res.status!==404)throw new Error("GitHub API "+path+" HTTP "+res.status);
  return res;
}
async function ghJson<T>(path:string):Promise<T>{
  const res=await gh(path);
  if(!res.ok)throw new Error("GitHub resource not found: "+path);
  return res.json() as Promise<T>;
}

export async function listAppRepositories():Promise<GitHubRepository[]>{
  const all:GitHubRepository[]=[];
  for(let page=1;page<=200;page++){
    const response=await ghJson<{repositories:GitHubRepository[]}>("/installation/repositories?per_page=100&page="+page);
    all.push(...response.repositories);
    if(response.repositories.length<100)return all;
  }
  throw new Error("Repository inventory exceeds supported pagination without an explicit cursor continuation");
}
export async function fetchPullRequests(fullName:string):Promise<GitHubPull[]>{
  const [owner,name]=fullName.split("/");
  if(!owner||!name)throw new Error("Invalid GitHub repository identity");
  const all:GitHubPull[]=[];
  for(let page=1;page<=100;page++){
    const path="/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(name)+
      "/pulls?state=all&sort=updated&direction=desc&per_page=100&page="+page;
    const batch=await ghJson<GitHubPull[]>(path);
    all.push(...batch);
    if(batch.length<100)return all;
  }
  throw new Error("Pull-request list exceeds supported pagination");
}
export async function fetchCanonicalRoadmap(fullName:string):Promise<unknown|null>{
  const [owner,name]=fullName.split("/");
  if(!owner||!name)throw new Error("Invalid GitHub repository identity");
  const path="/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(name)+"/contents/registry/roadmap.json";
  const response=await gh(path);
  if(response.status===404)return null;
  const file=await response.json() as {content?:string;encoding?:string;size?:number};
  if(file.encoding!=="base64"||!file.content||Number(file.size)>2000000)
    throw new Error("Canonical roadmap could not be decoded safely");
  const data=Buffer.from(file.content.replace(/\s/g,""),"base64").toString("utf8");
  return JSON.parse(data) as unknown;
}


export type RepositoryInstruction={path:"AGENTS.md";text:string;sha:string};

/** Decode only a fixed, bounded repository instruction file. Never accept
 * arbitrary caller-supplied GitHub paths or interpret fetched text as authorization.
 */
export function decodeRepositoryInstruction(value:unknown,path:string):RepositoryInstruction|null{
  if(path!=="AGENTS.md")throw new Error("Unsupported repository instruction path");
  if(value===null)return null;
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new Error("Invalid GitHub contents response");
  const obj=value as Record<string,unknown>;
  if(obj.encoding!=="base64"||typeof obj.content!=="string"||
     typeof obj.size!=="number"||!Number.isSafeInteger(obj.size)||
     obj.size<0||obj.size>100000||
     typeof obj.sha!=="string"||!/^[0-9a-f]{40}$/i.test(obj.sha))
    throw new Error("Invalid or oversized GitHub instructions");
  const compact=obj.content.replace(/\s/g,"");
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)||
    compact.length>140000)
    throw new Error("Malformed GitHub instruction encoding");
  const bytes=Buffer.from(compact,"base64");
  if(bytes.length!==obj.size)throw new Error("GitHub instruction size mismatch");
  const decoded=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
  return {path:"AGENTS.md",text:decoded,sha:obj.sha};
}

export async function fetchRepositoryInstruction(fullName:string,path:"AGENTS.md"):Promise<RepositoryInstruction|null>{
  const parts=fullName.split("/");
  if(parts.length!==2||parts.some(part=>!/^[a-zA-Z0-9_.-]{1,100}$/.test(part)))
    throw new Error("Invalid repository identity");
  const response=await gh("/repos/"+parts.map(encodeURIComponent).join("/")+"/contents/"+path);
  if(response.status===404)return null;
  const contents=await response.json() as unknown;
  return decodeRepositoryInstruction(contents,path);
}

/** Privileged GitHub App write transport. Call only through the DB-fenced gateway.
 * Never expose the installation token or unsanitized response bodies to callers.
 */
export class GitHubAppError extends Error{
  readonly httpStatus:number;
  constructor(httpStatus:number){
    super("GitHub installation operation failed: HTTP "+httpStatus);
    this.name="GitHubAppError";
    this.httpStatus=httpStatus;
  }
}
export async function githubAppRequest(method:"GET"|"POST"|"PUT",path:string,body?:unknown):Promise<unknown>{
  if(!path.startsWith("/")||path.startsWith("//")||path.includes("#")||path.includes("\\"))
    throw new Error("Invalid GitHub App request path");
  const url=new URL("https://api.github.com"+path);
  if(url.origin!=="https://api.github.com")throw new Error("Unexpected GitHub origin");
  const res=await fetch(url,{
    method,headers:{
      Authorization:"Bearer "+await installationToken(),
      Accept:"application/vnd.github+json",
      "Content-Type":"application/json",
      "X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"Boardroom-Coordinator"
    },
    body:method==="GET"?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(16000)
  });
  if(!res.ok)throw new GitHubAppError(res.status);
  if(res.status===204)return null;
  return res.json() as Promise<unknown>;
}
