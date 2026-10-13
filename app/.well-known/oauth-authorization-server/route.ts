import {NextResponse} from "next/server";
import {oauthEnabled,authorizationServerMetadata} from "../../../src/server/oauth-contract";
export const dynamic="force-dynamic";
export async function GET(){return oauthEnabled()?NextResponse.json(authorizationServerMetadata(),{headers:{"Cache-Control":"no-store"}}):new NextResponse(null,{status:404});}
