import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {getDatabase} from "../../../../../src/server/db";
import {listRegisteredAgents,registerNamedAgent,AgentRegistrationError,
  AgentAlreadyRegistered} from "../../../../../src/server/agent-registration";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store","Pragma":"no-cache"};

export async function GET(request:Request){
  try{
    authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    const agents=await listRegisteredAgents(getDatabase());
    return NextResponse.json({agents},{headers});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    console.error("Owner agent list unavailable");
    return NextResponse.json({error:"Agent list unavailable"},{status:503,headers});
  }
}
export async function POST(request:Request){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const body:unknown=await request.json().catch(()=>null);
    const pepper=process.env.BOARDROOM_TOKEN_PEPPER??"";
    const issued=await registerNamedAgent(getDatabase(),body,pepper);
    // This one-time response must not be logged, cached or persisted by clients.
    return NextResponse.json(issued,{status:201,headers});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof AgentAlreadyRegistered)
      return NextResponse.json({error:error.message},{status:409,headers});
    if(error instanceof AgentRegistrationError)
      return NextResponse.json({error:error.message},{status:400,headers});
    console.error("Owner agent issuance unavailable");
    return NextResponse.json({error:"Agent registration unavailable"},{status:503,headers});
  }
}
