import {createRemoteJWKSet,customFetch,jwtVerify,type JWTVerifyGetKey} from "jose";
import {trustedOwnerOrigin} from "./owner-session.ts";

export const GITHUB_OIDC_ISSUER="https://token.actions.githubusercontent.com";
const githubKeys=createRemoteJWKSet(new URL(GITHUB_OIDC_ISSUER+"/.well-known/jwks"),{
  timeoutDuration:5000,cacheMaxAge:600000,cooldownDuration:30000,
  [customFetch]:(url,options)=>fetch(url,{...options,redirect:"error"})
});
const repository="neophilism/Boardroom",ownerId="6145609",repositoryId="1415596507";
const environment="boardroom-maintenance";
const subjects=["repo:"+repository+":environment:"+environment,
  "repo:neophilism@"+ownerId+"/Boardroom@"+repositoryId+":environment:"+environment];

export type MaintenancePrincipal={method:"github-oidc";workflowRunId:string;sha:string};

/** Trust one workflow in one immutable repository, never generic GitHub JWTs.
 * This authority is used only by the bounded maintenance tick, not agent,
 * owner, recovery, source-writing or merge endpoints. Fail closed on outage. */
export async function authorizeMaintenance(value:string|null,env:NodeJS.ProcessEnv=process.env,
  key:CryptoKey|JWTVerifyGetKey=githubKeys,now=new Date()):Promise<MaintenancePrincipal|null>{
  if(!value?.startsWith("Bearer "))return null;
  const token=value.slice(7);
  if(token.length>16000||!/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(token))return null;
  try{
    const {payload:p}=await jwtVerify(token,key,{
      issuer:GITHUB_OIDC_ISSUER,audience:trustedOwnerOrigin(env)+"/api/v1/internal/tick",
      algorithms:["RS256"],typ:"JWT",requiredClaims:["sub","exp","iat","nbf","jti"],
      maxTokenAge:"10m",clockTolerance:5,currentDate:now
    });
    if(p.repository!==repository||p.repository_id!==repositoryId||p.repository_owner_id!==ownerId||
      p.ref!=="refs/heads/main"||p.environment!==environment||!subjects.includes(p.sub??"")||
      p.workflow_ref!==repository+"/.github/workflows/maintenance.yml@refs/heads/main"||
      !["schedule","push"].includes(String(p.event_name))||
      p.runner_environment!=="github-hosted"||
      typeof p.run_id!=="string"||!/^\d{1,20}$/.test(p.run_id)||
      typeof p.sha!=="string"||!/^([a-f0-9]{40})$/i.test(p.sha)||
      typeof p.jti!=="string"||p.jti.length<8||p.jti.length>200||
      typeof p.exp!=="number"||typeof p.iat!=="number"||p.exp-p.iat>900)return null;
    return {method:"github-oidc",workflowRunId:p.run_id,sha:p.sha};
  }catch{return null;}
}
