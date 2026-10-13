import {authorizedSessionRequest} from "../../../../../../src/server/session-http";
import {reserveRunnerBudget,recordRunnerUsage} from "../../../../../../src/server/usage";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
  const {runId}=await params;
  return authorizedSessionRequest(request,runId,(db,id,credentialId,generation,body)=>body.kind==="reserve"?
    reserveRunnerBudget(db,id,credentialId,generation,String(body.operationKey),Number(body.amountMicroUsd)):
    recordRunnerUsage(db,id,credentialId,generation,body));
}
