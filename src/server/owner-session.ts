import { createHmac,randomBytes,timingSafeEqual } from "node:crypto";
import { authorizeOwner,UnauthorizedOwner } from "./owner-auth.ts";

export const OWNER_COOKIE="boardroom_owner_session";
export const OWNER_SESSION_SECONDS=60*60*8;
function secret():string{
  const key=process.env.BOARDROOM_SESSION_SECRET;
  if(!key||key.length<32)throw new Error("BOARDROOM_SESSION_SECRET must be 32+ characters");
  return key;
}
function digest(payload:string,key:string):Buffer{
  return createHmac("sha256",key).update("boardroom-session-v1\0"+payload).digest();
}
export function issueOwnerCookie(key:string,now=Date.now()):string{
  if(key.length<32)throw new Error("Session secret too short");
  const body=Buffer.from(JSON.stringify({iat:now,nonce:randomBytes(16).toString("base64url")})).toString("base64url");
  return body+"."+digest(body,key).toString("base64url");
}
export function verifyOwnerCookie(cookie:string|undefined,key:string,now=Date.now()):boolean{
  if(!cookie||key.length<32||cookie.length>800)return false;
  const [body,signature,...extra]=cookie.split(".");
  if(!body||!signature||extra.length)return false;
  try{
    const provided=Buffer.from(signature,"base64url"),expected=digest(body,key);
    if(provided.length!==expected.length||!timingSafeEqual(provided,expected))return false;
    const data=JSON.parse(Buffer.from(body,"base64url").toString("utf8")) as {iat?:unknown;nonce?:unknown};
    return typeof data.iat==="number"&&Number.isFinite(data.iat)&&
      typeof data.nonce==="string"&&data.nonce.length>=16&&
      data.iat<=now+60000&&now-data.iat<=OWNER_SESSION_SECONDS*1000;
  }catch{return false;}
}
/** In an unconfigured deployment, deny access instead of throwing on every
 * private page load. Secret-dependent issuance still fails closed.
 */
export function validOwnerSession(cookie:string|undefined):boolean{
  const key=process.env.BOARDROOM_SESSION_SECRET;
  if(!key||key.length<32)return false;
  return verifyOwnerCookie(cookie,key);
}
export function newOwnerSession():string{return issueOwnerCookie(secret());}
function fromHeader(headers:Headers,name:string):string|undefined{
  return headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="))?.slice(name.length+1);
}
/** A signed-in owner may still be rejected when a state-changing request
 * originates from another site. This is distinct from authentication failure.
 */
export class OwnerOriginRejected extends UnauthorizedOwner {
  readonly reason:"FETCH_SITE_REJECTED"|"NULL_ORIGIN"|"ORIGIN_MISMATCH"|"PROVENANCE_MISSING"|"UNSPECIFIED";
  constructor(reason:OwnerOriginRejected["reason"]="UNSPECIFIED"){
    super();this.name="OwnerOriginRejected";this.reason=reason;
  }
}

/** Render/Next may expose an internal request URL behind a reverse proxy.
 * NEVER use the internal request URL or user-supplied X-Forwarded-Host as the
 * authority for the public browser Origin. Use only trusted deployment config.
 */
export function trustedOwnerOrigin(env:NodeJS.ProcessEnv=process.env):string{
  const raw=env.BOARDROOM_PUBLIC_ORIGIN||
    env.RENDER_EXTERNAL_URL||
    "https://boardroom-iamn.onrender.com";
  const parsed=new URL(raw);
  if(parsed.protocol!=="https:"||parsed.username||parsed.password||
     parsed.pathname!=="/"||parsed.search||parsed.hash)
    throw new Error("Invalid Boardroom public origin configuration");
  return parsed.origin;
}

export function authorizeOwnerRequest(request:Request,mutation=false,serverCookie?:string):void{
  // Bearer API tokens are individually authenticated. They do not rely on a
  // browser session cookie and do not confer authority from a caller-set Origin.
  if(request.headers.has("authorization"))return authorizeOwner(request.headers);
  // Next.js request-scoped cookie parsing is authoritative in server routes.
  // The raw Cookie header remains a fallback for non-Next API clients.
  if(!validOwnerSession(serverCookie??fromHeader(request.headers,OWNER_COOKIE)))
    throw new UnauthorizedOwner();
  if(mutation){
    const origin=request.headers.get("origin");
    const site=request.headers.get("sec-fetch-site");
    // Always reject a contradictory browser Fetch Metadata signal.
    if(site!==null&&site!=="same-origin"&&site!=="none")
      throw new OwnerOriginRejected("FETCH_SITE_REJECTED");
    const expected=trustedOwnerOrigin();
    if(origin!==null){
      if(origin!==expected)throw new OwnerOriginRejected(origin==="null"?"NULL_ORIGIN":"ORIGIN_MISMATCH");
    }else if(site!=="same-origin"){
      // Older/privacy-focused browsers may omit both Origin and Fetch Metadata.
      // An exact public-origin Referer is a defensible fallback; never trust
      // unvalidated Host or X-Forwarded-* request headers from the caller.
      const referer=request.headers.get("referer");
      let refererOrigin:string|null=null;
      try{if(referer)refererOrigin=new URL(referer).origin;}catch{}
      if(refererOrigin!==expected)throw new OwnerOriginRejected("PROVENANCE_MISSING");
    }
  }
}
