import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../../src/server/agent-auth";
import {finishIdleSession} from "../../../../../../src/server/idle-session";
import {SessionConflict} from "../../../../../../src/server/sessions";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
  try{
    const {runId}=await params;
    const db=getDatabase();
    const principal=await authenticateAgent(request.headers,db);
    const result=await finishIdleSession(db,runId,principal.credentialId);
    return NextResponse.json(result,{headers});
  }catch(error){
    if(error instanceof InvalidAgentCredential)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof SessionConflict)
      return NextResponse.json({error:error.message},{status:409,headers});
    console.error("Idle session completion unavailable");
    return NextResponse.json({error:"Idle session completion unavailable"},{status:503,headers});
  }
}
