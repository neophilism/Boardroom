import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OwnerOriginRejected,OWNER_COOKIE} from "../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {getDatabase} from "../../../../../../src/server/db";
import {verifyOwnerSetup} from "../../../../../../src/server/setup-verification";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function POST(request:Request){
  try{
    const jar=await cookies();
    authorizeOwnerRequest(request,true,jar.get(OWNER_COOKIE)?.value);
    const result=await verifyOwnerSetup(getDatabase(),process.env);
    return NextResponse.json({
      actions:result.actions,
      databaseReady:result.system.database.migrationsReady,
      githubInstallationConnected:result.system.github.verifiedConnected,
      scheduledDevelopmentTested:false
    },{headers});
  }catch(error){
    if(error instanceof OwnerOriginRejected)
      return NextResponse.json({error:"Request origin is not authorized",code:"ORIGIN_REJECTED"},
        {status:403,headers});
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    console.error("Boardroom owner setup verification unavailable");
    return NextResponse.json({error:"Setup verification unavailable"},{status:503,headers});
  }
}
