export class ConsentSubmissionError extends Error{}

/** Use a fresh CORS-mode request rather than a native form navigation. The
 * browser preserves its actual Origin even under a no-referrer document policy.
 * A consent mutation is sent once; an uncertain result is never auto-replayed. */
export async function submitOAuthConsent(form:URLSearchParams,issuer:string,request:typeof fetch=fetch):Promise<string>{
  let response:Response;
  try{
    response=await request("/api/v1/owner/oauth/authorize",{
      method:"POST",mode:"cors",credentials:"same-origin",cache:"no-store",redirect:"error",
      headers:{Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:form
    });
  }catch{throw new ConsentSubmissionError("The consent result could not be confirmed. Restart the connection from ChatGPT; this request was not retried.");}
  const value:unknown=await response.json().catch(()=>null);
  const body=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
  if(!response.ok){
    const code=typeof body.code==="string"&&/^[A-Z_]{1,64}$/.test(body.code)?body.code:"CONSENT_UNAVAILABLE";
    const diagnostic=typeof body.diagnostic==="string"&&/^[A-Z_]{1,64}$/.test(body.diagnostic)?" / "+body.diagnostic:"";
    throw new ConsentSubmissionError(code==="OWNER_SESSION_REQUIRED"?
      "Sign in to Boardroom, then restart the connection from ChatGPT. ("+code+")":
      "The connection was not authorized. Restart it from ChatGPT. ("+code+diagnostic+")");
  }
  try{
    if(typeof body.redirectTo!=="string")throw new Error();
    const target=new URL(body.redirectTo);
    if(target.origin!=="https://chatgpt.com"||target.pathname!=="/connector_platform_oauth_redirect"||
       target.username||target.password||target.hash||target.searchParams.get("iss")!==issuer||
       target.searchParams.get("state")!==form.get("state")||
       target.searchParams.has("code")===target.searchParams.has("error"))throw new Error();
    return target.href;
  }catch{throw new ConsentSubmissionError("Boardroom returned an unexpected connection response. Restart the connection from ChatGPT.");}
}
