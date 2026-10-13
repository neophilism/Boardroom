import {authorizedSessionRequest} from "../../../../../src/server/session-http";
import {mergeAssignedPullRequest} from "../../../../../src/server/merge-policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const body=await request.clone().json().catch(()=>({}));
  return authorizedSessionRequest(request,typeof body.runId==="string"?body.runId:"",(db,runId,credentialId,generation,record)=>
    mergeAssignedPullRequest(db,runId,credentialId,generation,Number(record.number),String(record.expectedSha??"")));
}
