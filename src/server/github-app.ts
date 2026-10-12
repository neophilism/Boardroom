import { createSign } from "node:crypto";

export type GitHubRepository = {
  id:number; full_name:string; created_at:string; pushed_at:string|null;
  updated_at:string; description:string|null; archived:boolean;
};
export type GitHubPull = {
  number:number; title:string; state:"open"|"closed"; updated_at:string; merged_at:string|null;
};
type TokenCache={value:string;expires:number};
let tokenCache:TokenCache|undefined;
function requiredEnv(name:string):string{
  const value=process.env[name];
  if(!value)throw new Error("Boardroom GitHub App missing required configuration: "+name);
  return value;
}
function signInstallationJWT():string{
  const now=Math.floor(Date.now()/1000);
  const header=Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url");
  const payload=Buffer.from(JSON.stringify({iat:now-60,exp:now+540,iss:requiredEnv("BOARDROOM_GITHUB_APP_ID")})).toString("base64url");
  const data=header+"."+payload;
  const key=requiredEnv("BOARDROOM_GITHUB_APP_PRIVATE_KEY").replace(/\\n/g,"\n");
  return data+"."+createSign("RSA-SHA256").update(data).end().sign(key).toString("base64url");
}
async function installationToken():Promise<string>{
  if(tokenCache && tokenCache.expires-Date.now()>5*60*1000)return tokenCache.value;
  const installationId=requiredEnv("BOARDROOM_GITHUB_INSTALLATION_ID");
  if(!/^\d+$/.test(installationId))throw new Error("Invalid installation ID");
  const response=await fetch("https://api.github.com/app/installations/"+installationId+"/access_tokens",{
    method:"POST",headers:{
      Authorization:"Bearer "+signInstallationJWT(),
      Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28",
      "User-Agent":"Boardroom-Coordinator"
    },signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error("GitHub installation authorization failed: HTTP "+response.status);
  const data=await response.json() as {token?:string;expires_at?:string};
  if(!data.token||!data.expires_at)throw new Error("GitHub did not return a valid installation token");
  tokenCache={value:data.token,expires:Date.parse(data.expires_at)};
  return data.token;
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
