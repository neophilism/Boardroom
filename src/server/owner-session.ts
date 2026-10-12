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
export function authorizeOwnerRequest(request:Request,mutation=false):void{
  if(request.headers.has("authorization"))return authorizeOwner(request.headers);
  if(!validOwnerSession(fromHeader(request.headers,OWNER_COOKIE)))throw new UnauthorizedOwner();
  if(mutation){
    const origin=request.headers.get("origin");
    const site=request.headers.get("sec-fetch-site");
    if(origin!==new URL(request.url).origin && !(origin===null&&site==="same-origin"))
      throw new UnauthorizedOwner();
  }
}
