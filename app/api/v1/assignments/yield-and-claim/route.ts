import {authorizedSessionRequest} from "../../../../../src/server/session-http";
import {yieldAndClaim} from "../../../../../src/server/continuation";
import {SessionConflict} from "../../../../../src/server/sessions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const body=await request.clone().json().catch(()=>({}));
  return authorizedSessionRequest(request,typeof body.runId==="string"?body.runId:"",
    (db,runId,credentialId,generation,payload)=>{
      if(!["BLOCKED","YIELDED","COMPLETED"].includes(String(payload.outcome)))
        throw new SessionConflict("Invalid handoff outcome");
      return yieldAndClaim(db,runId,credentialId,generation,payload.outcome as "BLOCKED"|"YIELDED"|"COMPLETED");
    });
}
