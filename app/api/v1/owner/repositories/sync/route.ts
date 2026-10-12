import {NextResponse} from "next/server";
import {authorizeOwnerRequest} from "../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {synchronizeInstalledRepositories} from "../../../../../../src/server/repository-sync";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function POST(request:Request){
  try{
    authorizeOwnerRequest(request,true);
    const input:unknown=await request.json().catch(()=>null);
    if(!input||typeof input!=="object"||Array.isArray(input))
      return NextResponse.json({error:"JSON object required"},{status:400,headers});
    const v=input as Record<string,unknown>;
    const afterId=v.afterId??null;
    const limit=v.limit??3;
    if(afterId!==null&&(typeof afterId!=="string"||!/^[1-9][0-9]{0,18}$/.test(afterId))||
       typeof limit!=="number"||!Number.isSafeInteger(limit)||limit<1||limit>10)
      return NextResponse.json({error:"Invalid cursor or batch limit"},{status:400,headers});
    const result=await synchronizeInstalledRepositories({afterId:afterId as string|null,limit});
    return NextResponse.json(result,{headers});
  }catch(error){
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    console.error("Owner repository sync unavailable");
    return NextResponse.json({error:"Repository reconciliation unavailable"},{status:503,headers});
  }
}
