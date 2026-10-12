import {NextResponse} from "next/server";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../src/server/agent-auth";
import {getDatabase} from "../../../../../src/server/db";
import {readAssignedPrEvidence} from "../../../../../src/server/pr-evidence";
import {GitHubAppError} from "../../../../../src/server/github-app";
import {SessionConflict,isValidGeneration,isValidRunId} from "../../../../../src/server/sessions";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function GET(request:Request){
  try{
    const db=getDatabase();
    const principal=await authenticateAgent(request.headers,db);
    const q=new URL(request.url).searchParams;
    const runId=q.get("runId"),generation=q.get("generation"),raw=q.get("number");
    if(!isValidRunId(runId)||!isValidGeneration(generation)||
       !raw||!/^[1-9][0-9]{0,8}$/.test(raw))
      return NextResponse.json({error:"Valid runId, generation and PR number required"},{status:400,headers});
    const evidence=await readAssignedPrEvidence(db,runId,principal.credentialId,generation,Number(raw));
    return NextResponse.json(evidence,{headers});
  }catch(error){
    if(error instanceof InvalidAgentCredential)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof SessionConflict)
      return NextResponse.json({error:error.message},{status:409,headers});
    if(error instanceof GitHubAppError)
      return NextResponse.json({error:"GitHub evidence unavailable",githubStatus:error.httpStatus},{status:503,headers});
    console.error("GitHub PR evidence unavailable");
    return NextResponse.json({error:"PR evidence unavailable"},{status:503,headers});
  }
}
