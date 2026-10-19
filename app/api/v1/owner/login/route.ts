import {NextResponse} from "next/server";
import {boundedRequestText,RequestBodyTooLarge} from "../../../../../src/server/request-body";
import {authorizeOwnerCredential,UnauthorizedOwner,OwnerConfigurationError}
  from "../../../../../src/server/owner-auth";
import {newOwnerSession,OWNER_COOKIE,OWNER_SESSION_SECONDS}
  from "../../../../../src/server/owner-session";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function POST(request:Request){
  try{
    let body:unknown;
    try{body=JSON.parse(await boundedRequestText(request,8192));}catch(error){if(error instanceof RequestBodyTooLarge)throw error;body=null;}
    if(!body||typeof body!=="object"||Array.isArray(body)||
       !("token" in body)||typeof body.token!=="string")
      return NextResponse.json({error:"Credential required",code:"INVALID_REQUEST"},{status:400,headers});
    // Compare raw credential data; never interpolate an arbitrary owner secret
    // into an HTTP Authorization header (which also rejects some valid chars).
    authorizeOwnerCredential(body.token);
    const response=NextResponse.json({authenticated:true},{headers});
    response.cookies.set(OWNER_COOKIE,newOwnerSession(),{
      httpOnly:true,secure:process.env.NODE_ENV==="production",
      sameSite:"strict",path:"/",maxAge:OWNER_SESSION_SECONDS
    });
    return response;
  }catch(error){
    if(error instanceof RequestBodyTooLarge)
      return NextResponse.json({error:"Delivery too large"},{status:413,headers});
    if(error instanceof UnauthorizedOwner)
      return NextResponse.json({error:"Invalid owner credential",code:"INVALID_CREDENTIAL"},{status:401,headers});
    if(error instanceof OwnerConfigurationError)
      return NextResponse.json({error:"Owner authentication is not configured",code:"LOGIN_NOT_CONFIGURED"},{status:503,headers});
    // A missing or invalid server session-signing key is a server configuration
    // problem, not a bad password. Do not expose values or exception messages.
    console.error("Boardroom owner login unavailable");
    return NextResponse.json({error:"Owner login unavailable",code:"LOGIN_UNAVAILABLE"},{status:503,headers});
  }
}
