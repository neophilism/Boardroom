import {cookies} from "next/headers";
import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authorizeOwnerRequest,OWNER_COOKIE,OwnerOriginRejected} from "../../../../../src/server/owner-session";
import {UnauthorizedOwner,OwnerConfigurationError} from "../../../../../src/server/owner-auth";
import {boundedRequestText,RequestBodyTooLarge} from "../../../../../src/server/request-body";
import {CoffeeModerationError,parseCoffeeModeration,coffeeRetentionPolicy,saveCoffeeRetentionPolicy,moderateCoffee,purgeExpiredCoffee} from "../../../../../src/server/coffee-moderation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
function failure(error:unknown){
  const status=error instanceof OwnerOriginRejected?403:error instanceof UnauthorizedOwner?401:
    error instanceof RequestBodyTooLarge?413:error instanceof SyntaxError||error instanceof CoffeeModerationError?400:503;
  const message=error instanceof CoffeeModerationError?error.message:
    error instanceof OwnerConfigurationError?"Owner access unavailable":"Coffee owner operation unavailable";
  return NextResponse.json({error:message},{status,headers});
}
export async function GET(request:Request){
  try{
    authorizeOwnerRequest(request,false,(await cookies()).get(OWNER_COOKIE)?.value);
    return NextResponse.json({policy:await coffeeRetentionPolicy(getDatabase())},{headers});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  try{
    authorizeOwnerRequest(request,true,(await cookies()).get(OWNER_COOKIE)?.value);
    const value=parseCoffeeModeration(JSON.parse(await boundedRequestText(request,4096)));
    const db=getDatabase();
    const result=value.kind==="retention-policy"?await saveCoffeeRetentionPolicy(db,value):
      value.kind==="purge"?await purgeExpiredCoffee(db):await moderateCoffee(db,value);
    return NextResponse.json(result,{headers});
  }catch(error){return failure(error);}
}
