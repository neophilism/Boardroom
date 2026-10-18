import {NextResponse} from "next/server";
import {OWNER_COOKIE,authorizeOwnerRequest,OwnerOriginRejected} from "../../../../../src/server/owner-session";
export const runtime="nodejs";
export async function POST(request:Request){
  try{authorizeOwnerRequest(request,true);}
  catch(error){return NextResponse.json({error:error instanceof OwnerOriginRejected?"Cross-origin request denied":"Owner authorization required"},
    {status:error instanceof OwnerOriginRejected?403:401,headers:{"Cache-Control":"no-store"}});}
  const response=NextResponse.json({signedOut:true},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(OWNER_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});
  return response;
}
