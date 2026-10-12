import {NextResponse} from "next/server";
import {OWNER_COOKIE} from "../../../../../src/server/owner-session";
export const runtime="nodejs";
export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request denied"},{status:403});
  const response=NextResponse.json({signedOut:true},{headers:{"Cache-Control":"no-store"}});
  response.cookies.set(OWNER_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});
  return response;
}
