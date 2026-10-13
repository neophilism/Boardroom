import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authorizeOwnerRequest,OWNER_COOKIE} from "../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {SessionConflict} from "../../../../../src/server/sessions";
import {operationsOverview,setExecutionPaused,setExecutionPolicy,recoverRun} from "../../../../../src/server/operations";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET(request:Request){
  try{
    authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    return NextResponse.json(await operationsOverview(getDatabase()),{headers});
  }catch(error){return NextResponse.json({error:"Operations unavailable"},{status:error instanceof UnauthorizedOwner?401:503,headers});}
}
export async function POST(request:Request){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const body=await request.json();
    const db=getDatabase();
    const result=body.kind==="pause"?await setExecutionPaused(db,body.paused):
      body.kind==="policy"?await setExecutionPolicy(db,body):body.kind==="recover"?
        await recoverRun(db,String(body.runId),body.externalExecutionStopped):null;
    if(!result)throw new SessionConflict("Unsupported owner operation");
    return NextResponse.json(result,{headers});
  }catch(error){
    const status=error instanceof UnauthorizedOwner?401:error instanceof SessionConflict?409:503;
    return NextResponse.json({error:error instanceof SessionConflict?error.message:"Operations unavailable"},{status,headers});
  }
}
