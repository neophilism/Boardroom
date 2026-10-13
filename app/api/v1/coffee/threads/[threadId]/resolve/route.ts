import {authorizedSessionRequest} from "../../../../../../../src/server/session-http";
import {resolveCoffeeAnswer} from "../../../../../../../src/server/coffee-resolution";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{threadId:string}>}){
  const {threadId}=await params,body=await request.clone().json().catch(()=>({}));
  return authorizedSessionRequest(request,typeof body.runId==="string"?body.runId:"",(db,runId,credentialId,generation,input)=>
    resolveCoffeeAnswer(db,runId,credentialId,generation,threadId,String(input.messageId),String(input.adr)));
}
