import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {getDatabase} from "../../../../../../src/server/db";
import {updateNamedAgentAccountEmail,AgentRegistrationError} from "../../../../../../src/server/agent-registration";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","Pragma":"no-cache"};
export async function PATCH(request:Request,{params}:{params:Promise<{credentialId:string}>}){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const {credentialId}=await params;
    const body:unknown=await request.json().catch(()=>null);
    const accountEmail=body&&typeof body==="object"&&!Array.isArray(body)?(body as Record<string,unknown>).accountEmail:undefined;
    return NextResponse.json(await updateNamedAgentAccountEmail(getDatabase(),credentialId,accountEmail),{headers});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403,headers});
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof AgentRegistrationError)return NextResponse.json({error:error.message},{status:400,headers});
    console.error("Account email update unavailable");
    return NextResponse.json({error:"Account email update unavailable"},{status:503,headers});
  }
}
