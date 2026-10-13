import {NextResponse} from "next/server";
import {oauthEnabled,protectedResourceMetadata} from "../../../src/server/oauth-contract";
export const dynamic="force-dynamic";
export async function GET(){return oauthEnabled()?NextResponse.json(protectedResourceMetadata(),{headers:{"Cache-Control":"no-store"}}):new NextResponse(null,{status:404});}
