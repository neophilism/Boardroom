import {NextResponse} from "next/server";
import {authorizeOwner,UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {newOwnerSession,OWNER_COOKIE,OWNER_SESSION_SECONDS} from "../../../../../src/server/owner-session";
export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const body:unknown=await request.json().catch(()=>null);
    if(!body||typeof body!=="object"||!("token" in body)||typeof body.token!=="string")
      return NextResponse.json({error:"Credential required"},{status:400});
    authorizeOwner(new Headers({authorization:"Bearer "+body.token}));
    const response=NextResponse.json({authenticated:true},{headers:{"Cache-Control":"no-store"}});
    response.cookies.set(OWNER_COOKIE,newOwnerSession(),{
      httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:OWNER_SESSION_SECONDS
    });
    return response;
  }catch(error){
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Invalid credential"},{status:401});
    console.error("Boardroom owner login failed");return NextResponse.json({error:"Login unavailable"},{status:503});
  }
}
