import {authorizedSessionRequest} from "../../../../../src/server/session-http";
import {continueAssignedWork} from "../../../../../src/server/next-work";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const body=await request.clone().json().catch(()=>({}));
  return authorizedSessionRequest(request,typeof body.runId==="string"?body.runId:"",continueAssignedWork);
}
