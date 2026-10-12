import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../src/server/agent-auth";
import {readAssignedSource} from "../../../../../src/server/source";
import {SessionConflict} from "../../../../../src/server/sessions";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const headers={"Cache-Control":"no-store"};
  try{
    const db=getDatabase(),agent=await authenticateAgent(request.headers,db);
    const q=new URL(request.url).searchParams,kind=q.get("kind")??"tree";
    if(kind!=="tree"&&kind!=="file"&&kind!=="blob")return NextResponse.json({error:"Unsupported source operation"},{status:400,headers});
    return NextResponse.json(await readAssignedSource(db,q.get("runId")??"",agent.credentialId,q.get("generation")??"",
      {kind,path:q.get("path")??undefined,sha:q.get("sha")??undefined}),{headers});
  }catch(error){
    const status=error instanceof InvalidAgentCredential?401:error instanceof SessionConflict?409:503;
    return NextResponse.json({error:status===401?"Unauthorized":status===409?"Source scope or snapshot conflict":"Source unavailable"},{status,headers});
  }
}
