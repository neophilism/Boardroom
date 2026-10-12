import { authorizedSessionRequest } from "../../../../../../src/server/session-http";
import { heartbeatRun } from "../../../../../../src/server/sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  return authorizedSessionRequest(request,runId,async(db,id,credential,generation)=>{
    const expiresAt=await heartbeatRun(db,id,credential,generation);
    return {state:"RUNNING",expiresAt};
  });
}
