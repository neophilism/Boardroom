import {createHash,timingSafeEqual} from "node:crypto";

export class UnauthorizedOwner extends Error {
  constructor(){super("Owner authorization required");this.name="UnauthorizedOwner";}
}
export class OwnerConfigurationError extends Error {
  constructor(){super("Owner credential unavailable");this.name="OwnerConfigurationError";}
}

/** The owner secret is an opaque high-entropy string, NOT a base64url token.
 * In particular, legitimate password-manager secrets may contain +, /, =,
 * spaces, symbols and other printable characters. Do not trim or normalize:
 * credential equality must remain exact.
 */
export function authorizeOwnerCredential(candidate:unknown):void{
  const secret=process.env.BOARDROOM_OWNER_API_TOKEN;
  if(typeof secret!=="string"||secret.length<32)
    throw new OwnerConfigurationError();
  if(typeof candidate!=="string"||candidate.length<32||candidate.length>4096)
    throw new UnauthorizedOwner();
  const expectedHash=createHash("sha256").update(secret,"utf8").digest();
  const actualHash=createHash("sha256").update(candidate,"utf8").digest();
  if(!timingSafeEqual(expectedHash,actualHash))throw new UnauthorizedOwner();
}

export function authorizeOwner(headers:Headers):void{
  const header=headers.get("authorization")??"";
  const candidate=header.startsWith("Bearer ")?header.slice(7):null;
  authorizeOwnerCredential(candidate);
}
