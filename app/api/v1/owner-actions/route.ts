import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDatabase} from "../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../src/server/agent-auth";
import {UnauthorizedOwner} from "../../../../src/server/owner-auth";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../src/server/owner-session";
import {createOwnerAction,isOwnerActionStatus,listOwnerActions,parseOwnerAction} from "../../../../src/server/owner-actions";
import {SessionConflict} from "../../../../src/server/sessions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const noStore={"Cache-Control":"no-store"};

export async function POST(request:Request){
  try{
    const db=getDatabase();
    const principal=await authenticateAgent(request.headers,db);
    const body:unknown=await request.json().catch(()=>null);
    const input=parseOwnerAction(body);
    const created=await createOwnerAction(db,principal.credentialId,input);
    return NextResponse.json(created,{status:201,headers:noStore});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof InvalidAgentCredential)return NextResponse.json({error:"Unauthorized"},{status:401});
    if(error instanceof SessionConflict)return NextResponse.json({error:error.message},{status:400});
    console.error("Boardroom owner action submission failed");
    return NextResponse.json({error:"Owner action service unavailable"},{status:503});
  }
}

export async function GET(request:Request){
  try{
    authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    const db=getDatabase();
    const status=new URL(request.url).searchParams.get("status");
    if(status!==null&&!isOwnerActionStatus(status))
      return NextResponse.json({error:"Invalid status"},{status:400});
    const actions=await listOwnerActions(db,status);
    return NextResponse.json({actions},{headers:noStore});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Boardroom owner action list unavailable");
    return NextResponse.json({error:"Owner action service unavailable"},{status:503});
  }
}
