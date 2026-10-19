import {authorizedSessionRequest} from "../../../../../src/server/session-http";
import {mergeAssignedPullRequest} from "../../../../../src/server/merge-policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  return authorizedSessionRequest(request,null,(db,runId,credentialId,generation,record)=>
    mergeAssignedPullRequest(db,runId,credentialId,generation,Number(record.number),String(record.expectedSha??"")));
}
