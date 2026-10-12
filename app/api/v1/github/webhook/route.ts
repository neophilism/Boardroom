import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {validWebhookSignature,acceptGitHubWebhook} from "../../../../../src/server/webhook";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const raw=await request.text();
  if(Buffer.byteLength(raw)>1000000)return NextResponse.json({error:"Delivery too large"},{status:413});
  if(!validWebhookSignature(raw,request.headers.get("x-hub-signature-256"),process.env.BOARDROOM_GITHUB_WEBHOOK_SECRET))
    return NextResponse.json({error:"Invalid delivery signature"},{status:401});
  try{return NextResponse.json(await acceptGitHubWebhook(getDatabase(),request.headers.get("x-github-delivery")??"",request.headers.get("x-github-event")??"",raw));}
  catch{return NextResponse.json({error:"Webhook processing unavailable"},{status:503});}
}
