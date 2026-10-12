import { authorizedSessionRequest } from "../../../../../../src/server/session-http";
import { finishRun, parseSessionOutcome } from "../../../../../../src/server/sessions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}) {
  const {runId}=await params;
  return authorizedSessionRequest(request,runId,async(db,id,credential,generation,body)=>{
    const outcome=parseSessionOutcome(body.outcome);
    return finishRun(db,id,credential,generation,outcome);
  });
}
