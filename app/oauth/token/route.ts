import {NextResponse} from "next/server";
import {oauthEnabled,OAuthFailure} from "../../../src/server/oauth-contract";
import {exchangeOAuthToken} from "../../../src/server/oauth";
import {getDatabase} from "../../../src/server/db";
import {boundedRequestText,RequestBodyTooLarge} from "../../../src/server/request-body";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store",Pragma:"no-cache"};
  if(!oauthEnabled())return new NextResponse(null,{status:404,headers});
  try{
    if(request.headers.has("authorization")||!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded"))throw new OAuthFailure("invalid_request");
    const raw=await boundedRequestText(request,10000);
    const result=await exchangeOAuthToken(getDatabase(),new URLSearchParams(raw),process.env.BOARDROOM_TOKEN_PEPPER??"");
    return NextResponse.json(result,{headers});
  }catch(error){
    return NextResponse.json({error:error instanceof OAuthFailure?error.code:error instanceof RequestBodyTooLarge?"invalid_request":"temporarily_unavailable"},{status:error instanceof RequestBodyTooLarge?413:error instanceof OAuthFailure?400:503,headers});
  }
}
