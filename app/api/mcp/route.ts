import {NextResponse} from "next/server";
import {getDatabase} from "../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../src/server/agent-auth";
import {trustedOwnerOrigin} from "../../../src/server/owner-session";
import {AGENT_TOOLS,executeAgentTool,AgentToolError} from "../../../src/server/agent-tools";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const versions=["2025-03-26","2025-06-18","2025-11-25"];
/** Stateless Streamable HTTP MCP: JSON replies, no credentials in URL or cookies.
 * Every call is independently authenticated and service-layer lease-fenced.
 */
export async function POST(request:Request){
  let id:unknown=null;
  try{
    if(request.headers.get("origin")&&request.headers.get("origin")!==trustedOwnerOrigin())
      return NextResponse.json({error:"Origin rejected"},{status:403,headers});
    const db=getDatabase(),agent=await authenticateAgent(request.headers,db);
    const raw=await request.text();
    if(Buffer.byteLength(raw)>300000)return NextResponse.json({error:"Request too large"},{status:413,headers});
    const body=JSON.parse(raw) as {jsonrpc:string;id?:unknown;method:string;params?:Record<string,unknown>};
    id=body.id??null;
    if(body.jsonrpc!=="2.0"||typeof body.method!=="string"||Array.isArray(body))throw new AgentToolError();
    if(body.id===undefined&&body.method==="notifications/initialized")return new NextResponse(null,{status:202,headers});
    let result:unknown;
    if(body.method==="initialize")result={protocolVersion:versions.includes(String(body.params?.protocolVersion))?body.params?.protocolVersion:"2025-11-25",
      capabilities:{tools:{listChanged:false}},serverInfo:{name:"boardroom",version:"0.2.0"},
      instructions:"Use only the approved work and current run/lease. The name is server-verified. Tool availability does not confer owner authority."};
    else if(body.method==="ping")result={};
    else if(body.method==="tools/list")result={tools:AGENT_TOOLS};
    else if(body.method==="tools/call"){
      const value=await executeAgentTool(db,agent,String(body.params?.name),body.params?.arguments??{});
      result={content:[{type:"text",text:JSON.stringify(value)}],structuredContent:value};
    }else return NextResponse.json({jsonrpc:"2.0",id,error:{code:-32601,message:"Method not found"}},{headers});
    return NextResponse.json({jsonrpc:"2.0",id,result},{headers});
  }catch(error){
    if(error instanceof InvalidAgentCredential)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof SyntaxError||error instanceof AgentToolError)
      return NextResponse.json({jsonrpc:"2.0",id,error:{code:-32602,message:"Invalid request or tool arguments"}},{headers});
    return NextResponse.json({jsonrpc:"2.0",id,result:{isError:true,content:[{type:"text",text:"Operation unavailable or current session/policy requirements not satisfied. Reconcile state before retrying."}]}},{headers});
  }
}
export async function GET(){return new NextResponse(null,{status:405,headers:{...headers,Allow:"POST"}});}
