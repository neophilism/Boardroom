import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../../src/server/owner-auth";
import {getDatabase} from "../../../../../../../src/server/db";
import {revokeNamedAgent,AgentRegistrationError} from "../../../../../../../src/server/agent-registration";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function POST(request:Request,{params}:{params:Promise<{credentialId:string}>}){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const {credentialId}=await params;
    const revoked=await revokeNamedAgent(getDatabase(),credentialId);
    return NextResponse.json(revoked,{headers});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof AgentRegistrationError)
      return NextResponse.json({error:error.message},{status:409,headers});
    console.error("Agent revocation unavailable");
    return NextResponse.json({error:"Agent revocation unavailable"},{status:503,headers});
  }
}
