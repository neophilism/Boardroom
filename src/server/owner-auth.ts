import {timingSafeEqual} from "node:crypto";

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
  // This is a high-entropy bearer API token stored only as a runtime secret,
  // not a user password that needs an offline-resistant password hash.
  // Compare fixed-size, zero-padded byte buffers in constant time; explicit
  // byte lengths prevent equality if either value includes trailing NUL bytes.
  const maxBytes=4096;
  if(typeof secret!=="string"||secret.length<32||
     Buffer.byteLength(secret,"utf8")>maxBytes)
    throw new OwnerConfigurationError();
  if(typeof candidate!=="string"||candidate.length<32||
     Buffer.byteLength(candidate,"utf8")>maxBytes)
    throw new UnauthorizedOwner();
  const expected=Buffer.alloc(maxBytes);
  const supplied=Buffer.alloc(maxBytes);
  const secretLength=Buffer.from(secret,"utf8").copy(expected);
  const suppliedLength=Buffer.from(candidate,"utf8").copy(supplied);
  const match=timingSafeEqual(expected,supplied);
  if(!match||secretLength!==suppliedLength)throw new UnauthorizedOwner();
}

export function authorizeOwner(headers:Headers):void{
  const header=headers.get("authorization")??"";
  const candidate=header.startsWith("Bearer ")?header.slice(7):null;
  authorizeOwnerCredential(candidate);
}
