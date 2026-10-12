import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../../src/server/agent-auth";
import {authorizeOwnerRequest} from "../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {answerCoffeeThread,CoffeeError} from "../../../../../../src/server/coffee";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request,{params}:{params:Promise<{threadId:string}>}){
  const {threadId}=await params;
  try{
    const db=getDatabase();const agent=await authenticateAgent(request.headers,db);
    const payload:unknown=await request.json().catch(()=>null);
    if(!payload||typeof payload!=="object"||Array.isArray(payload))
      return NextResponse.json({error:"JSON object required"},{status:400});
    const item=payload as Record<string,unknown>;
    if(typeof item.runId!=="string")return NextResponse.json({error:"runId required"},{status:400});
    const result=await answerCoffeeThread(db,agent.credentialId,item.runId,threadId,item.answer,item.evidence);
    return NextResponse.json(result,{status:201,headers:{"Cache-Control":"no-store"}});
  }catch(e){
    if(e instanceof InvalidAgentCredential)return NextResponse.json({error:"Unauthorized"},{status:401});
    if(e instanceof CoffeeError)return NextResponse.json({error:e.message},{status:400});
    console.error("Coffee answer failed");return NextResponse.json({error:"Coffee answer unavailable"},{status:503});
  }
}
export async function GET(request:Request,{params}:{params:Promise<{threadId:string}>}){
  const {threadId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(threadId))return NextResponse.json({error:"Invalid thread ID"},{status:400});
  try{
    const db=getDatabase();
    try{await authenticateAgent(request.headers,db)}catch(e){
      if(!(e instanceof InvalidAgentCredential))throw e;
      authorizeOwnerRequest(request);
    }
    const result=await db.query(
      "SELECT message_id,thread_id,author_run_id,content,evidence,created_at FROM coffee_messages WHERE thread_id=$1 ORDER BY created_at ASC LIMIT 300",[threadId]
    );
    return NextResponse.json({messages:result.rows},{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    if(e instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Coffee messages unavailable");return NextResponse.json({error:"Coffee messages unavailable"},{status:503});
  }
}
