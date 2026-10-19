import {authorizedSessionRequest} from "../../../../../src/server/session-http";
import {continueAssignedWork} from "../../../../../src/server/next-work";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  return authorizedSessionRequest(request,null,continueAssignedWork);
}
