import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../../src/server/db";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../../src/server/owner-session";
import {RiskApprovalRejected,verifyRiskApproval} from "../../../../../../src/server/risk-approval";
import {OwnerActionResolutionRejected,respondToOwnerAction} from "../../../../../../src/server/owner-action-resolution";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{actionId:string}>}){
  const {actionId}=await params;
  if(!/^[0-9a-f-]{36}$/i.test(actionId))return NextResponse.json({error:"Invalid action ID"},{status:400});
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const payload:unknown=await request.json().catch(()=>null);
    const db=getDatabase();
    if(payload&&typeof payload==="object"&&"status" in payload&&String(payload.status)==="VERIFIED")
      return NextResponse.json(await verifyRiskApproval(db,actionId),{headers:{"Cache-Control":"no-store"}});
    return NextResponse.json(await respondToOwnerAction(db,actionId,payload),{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    if(error instanceof OwnerOriginRejected)return NextResponse.json({error:"Origin rejected"},{status:403});
    if(error instanceof RiskApprovalRejected||error instanceof OwnerActionResolutionRejected)
      return NextResponse.json({error:error.message},{status:409});
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401});
    console.error("Owner action update failed");
    return NextResponse.json({error:"Owner action update unavailable"},{status:503});
  }
}
