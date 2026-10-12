import { authorizedSessionRequest } from "../../../../../../src/server/session-http";
import { saveCheckpoint } from "../../../../../../src/server/sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  return authorizedSessionRequest(request,runId,async(db,id,credential,generation,body)=>{
    const checkpointId=await saveCheckpoint(db,id,credential,generation,body);
    return {checkpointId,status:"RECORDED_UNVERIFIED"};
  });
}
