import {authorizedSessionRequest} from "../../../../../../../src/server/session-http";
import {resolveCoffeeAnswer} from "../../../../../../../src/server/coffee-resolution";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{threadId:string}>}){
  const {threadId}=await params;
  return authorizedSessionRequest(request,null,(db,runId,credentialId,generation,input)=>
    resolveCoffeeAnswer(db,runId,credentialId,generation,threadId,String(input.messageId),String(input.adr)));
}
