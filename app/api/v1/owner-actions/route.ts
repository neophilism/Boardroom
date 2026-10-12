import {NextResponse} from "next/server";
import {getDatabase} from "../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../src/server/agent-auth";
import {authorizeOwner,UnauthorizedOwner} from "../../../../src/server/owner-auth";
import {createOwnerAction,parseOwnerAction} from "../../../../src/server/owner-actions";
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
    if(error instanceof InvalidAgentCredential)return NextResponse.json({error:"Unauthorized"},{status:401});
    if(error instanceof SessionConflict)return NextResponse.json({error:error.message},{status:400});
    console.error("Boardroom owner action submission failed");
    return NextResponse.json({error:"Owner action service unavailable"},{status:503});
  }
}

export async function GET(request:Request){
  try{
    authorizeOwner(request.headers);
    const db=getDatabase();
    const status=new URL(request.url).searchParams.get("status");
    if(status && !["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION","VERIFIED","DECLINED","CANCELLED"].includes(status))
      return NextResponse.json({error:"Invalid status"},{status:400});
    const records=await db.query(
      "SELECT a.action_id,a.title,a.action_type,a.instructions,a.requested_permissions,a.secure_entry_location,a.price_estimate_cents,a.status,a.created_at,a.updated_at,COALESCE(json_agg(json_build_object('repositoryId',d.repository_id,'unitId',d.unit_id)) FILTER (WHERE d.repository_id IS NOT NULL),'[]'::json) AS affected FROM owner_actions a LEFT JOIN owner_action_dependents d ON d.action_id=a.action_id WHERE ($1::text IS NULL OR a.status=$1) GROUP BY a.action_id ORDER BY CASE WHEN a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') THEN 0 ELSE 1 END,a.created_at ASC LIMIT 100",
      [status]
    );
    return NextResponse.json({actions:records.rows},{headers:noStore});
  }catch(error){
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Boardroom owner action list unavailable");
    return NextResponse.json({error:"Owner action service unavailable"},{status:503});
  }
}
