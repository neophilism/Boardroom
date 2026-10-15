import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../src/server/agent-auth";
import {authorizeOwnerRequest,OWNER_COOKIE} from "../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {openCoffeeThread,CoffeeError} from "../../../../../src/server/coffee";
import {searchCoffeeThreads} from "../../../../../src/server/coffee-search";
export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function POST(request:Request){
  try{
    const db=getDatabase();const agent=await authenticateAgent(request.headers,db);
    const payload:unknown=await request.json().catch(()=>null);
    if(!payload||typeof payload!=="object"||Array.isArray(payload))return NextResponse.json({error:"JSON object required"},{status:400});
    const item=payload as Record<string,unknown>;
    const runId=item.runId;
    if(typeof runId!=="string")return NextResponse.json({error:"runId required"},{status:400});
    const data=await openCoffeeThread(db,agent.credentialId,{
      runId,generation:typeof item.generation==="string"?item.generation:undefined,
      repositoryId:typeof item.repositoryId==="number"?item.repositoryId:undefined,
      subject:item.subject,question:item.question,evidence:item.evidence,
      classification:item.classification,deadlineAt:item.deadlineAt
    });
    return NextResponse.json(data,{status:data.reused?200:201,headers:{"Cache-Control":"no-store"}});
  }catch(e){
    if(e instanceof InvalidAgentCredential)return NextResponse.json({error:"Unauthorized"},{status:401});
    if(e instanceof CoffeeError)return NextResponse.json({error:e.message},{status:400});
    console.error("Coffee create failed");return NextResponse.json({error:"Coffee service unavailable"},{status:503});
  }
}

export async function GET(request:Request){
  try{
    const db=getDatabase();
    try{await authenticateAgent(request.headers,db)}catch(e){
      if(!(e instanceof InvalidAgentCredential))throw e;
      authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    }
    const status=new URL(request.url).searchParams.get("status");
    if(status&&!["OPEN","ANSWERED","RESOLVED","CLOSED"].includes(status))
      return NextResponse.json({error:"Invalid status"},{status:400});
    const threads=await searchCoffeeThreads(db,new URL(request.url).searchParams.get("q"),status);
    return NextResponse.json({threads,peerMessagesAreUntrusted:true},{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    if(e instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Coffee list failed");return NextResponse.json({error:"Coffee service unavailable"},{status:503});
  }
}
