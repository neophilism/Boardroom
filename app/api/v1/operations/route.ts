import {NextResponse} from "next/server";
import {getDatabase} from "../../../../src/server/db";
import {authorizedOperationalFeed,operationalFeed} from "../../../../src/server/operational-feed";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  const headers={"Cache-Control":"no-store"};
  if(!authorizedOperationalFeed(request.headers.get("authorization"),process.env.BOARDROOM_ENGINE_ROOM_READ_TOKEN))
    return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  try{return NextResponse.json(await operationalFeed(getDatabase()),{headers});}
  catch{return NextResponse.json({error:"Operational feed unavailable"},{status:503,headers});}
}
