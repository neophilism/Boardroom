import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../../src/server/db";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {authorizeOwnerRequest} from "../../../../../../src/server/owner-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{actionId:string}>}){
  const {actionId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(actionId))return NextResponse.json({error:"Invalid action ID"},{status:400});
  try{
    authorizeOwnerRequest(request,true);
    const payload:unknown=await request.json().catch(()=>null);
    if(!payload || typeof payload!=="object" || !("status" in payload) ||
        !["ACKNOWLEDGED","AWAITING_VERIFICATION","DECLINED"].includes(String(payload.status)))
      return NextResponse.json({error:"Unsupported owner transition"},{status:400});
    const status=String(payload.status);
    const db=getDatabase();
    const response=await db.query<{action_id:string;status:string}>(
      "UPDATE owner_actions SET status=$2,updated_at=now(),resolved_at=CASE WHEN $2='DECLINED' THEN now() ELSE resolved_at END WHERE action_id=$1 AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') RETURNING action_id,status",
      [actionId,status]
    );
    if(response.rowCount!==1)return NextResponse.json({error:"Action unavailable or already final"},{status:409});
    return NextResponse.json({actionId:response.rows[0].action_id,status:response.rows[0].status},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Owner action update failed");
    return NextResponse.json({error:"Owner action update unavailable"},{status:503});
  }
}
