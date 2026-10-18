import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {boundedRequestText,RequestBodyTooLarge} from "../../../../../src/server/request-body";
import {getDatabase} from "../../../../../src/server/db";
import {createLogicalAgent,listLogicalAgents,LogicalAgentInvalid} from "../../../../../src/server/logical-agents";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","Pragma":"no-cache"};
function failure(e:unknown){
  if(e instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403,headers});
  if(e instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  if(e instanceof LogicalAgentInvalid)return NextResponse.json({error:e.message},{status:400,headers});
  if(e instanceof RequestBodyTooLarge)return NextResponse.json({error:"Request too large"},{status:413,headers});
  console.error("Owner logical-agent request unavailable");
  return NextResponse.json({error:"Logical agent operation unavailable"},{status:503,headers});
}
export async function GET(request:Request){
  try{
    authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    const params=new URL(request.url).searchParams;
    const keys=[...params.keys()];
    if(keys.some(k=>k!=="cursor"&&k!=="limit"))throw new LogicalAgentInvalid("Invalid query parameter");
    const cursor=params.get("cursor");
    const rawLimit=params.get("limit");
    if(rawLimit!==null&&!/^[1-9][0-9]{0,2}$/.test(rawLimit))throw new LogicalAgentInvalid("Invalid page size");
    return NextResponse.json(await listLogicalAgents(getDatabase(),cursor,rawLimit?Number(rawLimit):50),{headers});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    if(!request.headers.get("content-type")?.startsWith("application/json"))
      throw new LogicalAgentInvalid("JSON content type required");
    const source=await boundedRequestText(request,4096);
    let body:unknown;
    try{body=JSON.parse(source);}catch{throw new LogicalAgentInvalid("Malformed JSON");}
    const agent=await createLogicalAgent(getDatabase(),body);
    return NextResponse.json({agent},{status:201,headers});
  }catch(error){return failure(error);}
}
