import {OwnerOriginRejected} from "./owner-session.ts";
import {UnauthorizedOwner} from "./owner-auth.ts";
import {OAuthFailure} from "./oauth-contract.ts";
import {RequestBodyTooLarge} from "./request-body.ts";

/** Return fixed diagnostics, never exception text or OAuth request values. */
export function oauthConsentFailure(error:unknown){
  if(error instanceof RequestBodyTooLarge)return {status:413,code:"CONSENT_REQUEST_TOO_LARGE",
    nextAction:"Restart the connection from ChatGPT."};
  if(error instanceof OwnerOriginRejected)return {status:403,code:"CONSENT_ORIGIN_REJECTED",diagnostic:error.reason,
    nextAction:"Open a fresh connection request in a top-level browser window and retry. Boardroom must verify a same-origin submission."};
  if(error instanceof UnauthorizedOwner)return {status:401,code:"OWNER_SESSION_REQUIRED",
    nextAction:"Sign in to Boardroom, then restart the connection from ChatGPT."};
  if(error instanceof OAuthFailure)return {status:error.code==="temporarily_unavailable"?503:400,
    code:"CONSENT_"+error.code.toUpperCase(),nextAction:error.code==="temporarily_unavailable"?
      "Client verification is temporarily unavailable. Wait briefly, then restart the connection from ChatGPT.":
      "Restart the connection from ChatGPT with OAuth and the supported CIMD public-client settings."};
  return {status:503,code:"CONSENT_UNAVAILABLE",
    nextAction:"Boardroom could not complete consent. Retry once; if it persists, report this diagnostic code."};
}
