import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {trustedOwnerOrigin} from "./owner-session.ts";
export const OAUTH_SCOPE="boardroom:agent";
export const OPENAI_CLIENT_ID="https://chatgpt.com/oauth/client.json";
export const OPENAI_REDIRECT_URI="https://chatgpt.com/connector_platform_oauth_redirect";
export class OAuthFailure extends Error{
  readonly code:"invalid_request"|"invalid_client"|"invalid_grant"|"invalid_scope"|"invalid_target"|"temporarily_unavailable";
  constructor(code:OAuthFailure["code"]){super("OAuth request could not be authorized");this.name="OAuthFailure";this.code=code;}
}
export const oauthEnabled=(env:NodeJS.ProcessEnv=process.env)=>env.BOARDROOM_OAUTH_ENABLED==="true";
export const oauthResource=(env:NodeJS.ProcessEnv=process.env)=>trustedOwnerOrigin(env)+"/api/mcp";
export function oauthDigest(kind:"code"|"token",value:string,pepper:string):string{
  if(pepper.length<32)throw new OAuthFailure("temporarily_unavailable");
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(value))throw new OAuthFailure("invalid_grant");
  return createHmac("sha256",pepper).update("boardroom-oauth-"+kind+"-v1\0"+value).digest("hex");
}
export function validPkce(verifier:unknown,challenge:string):boolean{
  if(typeof verifier!=="string"||!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)||!/^[A-Za-z0-9_-]{43}$/.test(challenge))return false;
  const actual=Buffer.from(createHash("sha256").update(verifier).digest("base64url")),expected=Buffer.from(challenge);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
export type OAuthAuthorization={clientId:string;redirectUri:string;resource:string;scope:string;state:string;challenge:string};
export function parseOAuthAuthorization(input:URLSearchParams,env:NodeJS.ProcessEnv=process.env):OAuthAuthorization{
  for(const key of ["client_id","redirect_uri","resource","scope","state","code_challenge","code_challenge_method","response_type"]){
    if(input.getAll(key).length!==1)throw new OAuthFailure("invalid_request");
  }
  if(input.get("client_id")!==OPENAI_CLIENT_ID)throw new OAuthFailure("invalid_client");
  if(input.get("redirect_uri")!==OPENAI_REDIRECT_URI||input.get("response_type")!=="code"||input.get("code_challenge_method")!=="S256")throw new OAuthFailure("invalid_request");
  if(input.get("resource")!==oauthResource(env))throw new OAuthFailure("invalid_target");
  if(input.get("scope")!==OAUTH_SCOPE)throw new OAuthFailure("invalid_scope");
  const state=input.get("state")!,challenge=input.get("code_challenge")!;
  if(!state||state.length>1024||/[\x00-\x1f\x7f]/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(challenge))throw new OAuthFailure("invalid_request");
  return {clientId:OPENAI_CLIENT_ID,redirectUri:OPENAI_REDIRECT_URI,resource:oauthResource(env),scope:OAUTH_SCOPE,state,challenge};
}
export function protectedResourceMetadata(env:NodeJS.ProcessEnv=process.env){
  return {resource:oauthResource(env),authorization_servers:[trustedOwnerOrigin(env)],scopes_supported:[OAUTH_SCOPE],bearer_methods_supported:["header"]};
}
export function authorizationServerMetadata(env:NodeJS.ProcessEnv=process.env){
  const issuer=trustedOwnerOrigin(env);
  return {issuer,authorization_endpoint:issuer+"/oauth/authorize",token_endpoint:issuer+"/oauth/token",
    authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true,
    token_endpoint_auth_methods_supported:["none"],code_challenge_methods_supported:["S256"],
    response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],scopes_supported:[OAUTH_SCOPE]};
}
export function oauthChallenge(env:NodeJS.ProcessEnv=process.env){
  return 'Bearer resource_metadata="'+trustedOwnerOrigin(env)+'/.well-known/oauth-protected-resource", scope="'+OAUTH_SCOPE+'", error="invalid_token", error_description="Connect an owner-authorized named agent"';
}
/** Validate only the fixed HTTPS OpenAI CIMD, not a caller-chosen metadata URL. */
export function validOpenAIClientDocument(input:unknown):boolean{
  if(!input||typeof input!=="object"||Array.isArray(input))return false;
  const d=input as Record<string,unknown>;
  const methods=Array.isArray(d.token_endpoint_auth_methods_supported)?d.token_endpoint_auth_methods_supported:[d.token_endpoint_auth_method];
  return (d.client_id===undefined||d.client_id===OPENAI_CLIENT_ID)&&Array.isArray(d.redirect_uris)&&
    d.redirect_uris.includes(OPENAI_REDIRECT_URI)&&methods.includes("none");
}
let clientDocumentUntil=0;
export async function verifyOpenAIClient(transport:typeof fetch=fetch){
  if(transport===fetch&&clientDocumentUntil>Date.now())return;
  try{
    const response=await transport(OPENAI_CLIENT_ID,{redirect:"error",signal:AbortSignal.timeout(10000),headers:{Accept:"application/json"}});
    if(!response.ok)throw new OAuthFailure("temporarily_unavailable");
    const text=await response.text();
    if(Buffer.byteLength(text)>20000||!validOpenAIClientDocument(JSON.parse(text)))throw new OAuthFailure("invalid_client");
    if(transport===fetch)clientDocumentUntil=Date.now()+300000;
  }catch(error){if(error instanceof OAuthFailure)throw error;throw new OAuthFailure("temporarily_unavailable");}
}
