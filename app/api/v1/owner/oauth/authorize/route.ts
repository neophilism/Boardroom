import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected,trustedOwnerOrigin} from "../../../../../../src/server/owner-session";
import {UnauthorizedOwner} from "../../../../../../src/server/owner-auth";
import {oauthEnabled,parseOAuthAuthorization,verifyOpenAIClient,OAuthFailure} from "../../../../../../src/server/oauth-contract";
import {createOAuthCode} from "../../../../../../src/server/oauth";
import {getDatabase} from "../../../../../../src/server/db";
import {boundedRequestText,RequestBodyTooLarge} from "../../../../../../src/server/request-body";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  if(!oauthEnabled())return new NextResponse(null,{status:404});
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const raw=await boundedRequestText(request,10000);
    const form=new URLSearchParams(raw),a=parseOAuthAuthorization(form);
    await verifyOpenAIClient();
    const location=new URL(a.redirectUri);location.searchParams.set("state",a.state);location.searchParams.set("iss",trustedOwnerOrigin());
    const decision=form.get("decision");
    if(form.getAll("decision").length!==1)throw new OAuthFailure("invalid_request");
    if(decision==="deny")location.searchParams.set("error","access_denied");
    else if(decision==="allow"){
      if(form.getAll("credential_id").length!==1)throw new OAuthFailure("invalid_request");
      const code=await createOAuthCode(getDatabase(),form.get("credential_id")??"",a,process.env.BOARDROOM_TOKEN_PEPPER??"");
      location.searchParams.set("code",code);
    }else throw new OAuthFailure("invalid_request");
    return NextResponse.redirect(location,{status:303,headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
  }catch(error){
    const status=error instanceof RequestBodyTooLarge?413:error instanceof OwnerOriginRejected?403:error instanceof UnauthorizedOwner?401:error instanceof OAuthFailure?400:503;
    return NextResponse.json({error:"Connection consent could not be completed"},{status,headers:{"Cache-Control":"no-store"}});
  }
}
