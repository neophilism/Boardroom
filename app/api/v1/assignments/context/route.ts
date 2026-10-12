import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../src/server/agent-auth";
import {getAssignmentContext} from "../../../../../src/server/assignment-context";
import {isValidRunId,isValidGeneration,SessionConflict} from "../../../../../src/server/sessions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function GET(request:Request){
  try{
    const db=getDatabase();
    const principal=await authenticateAgent(request.headers,db);
    const search=new URL(request.url).searchParams;
    const runId=search.get("runId"),generation=search.get("generation");
    if(!isValidRunId(runId)||!isValidGeneration(generation))
      return NextResponse.json({error:"Valid runId and generation required"},{status:400,headers});
    const result=await getAssignmentContext(db,runId,principal.credentialId,generation);
    return NextResponse.json(result,{headers});
  }catch(error){
    if(error instanceof InvalidAgentCredential)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof SessionConflict)
      return NextResponse.json({error:error.message},{status:409,headers});
    console.error("Assignment context unavailable");
    return NextResponse.json({error:"Assignment context unavailable"},{status:503,headers});
  }
}
