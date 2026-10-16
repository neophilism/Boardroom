import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {scanStaleSessions,authorizedWatchdogToken} from "../../../../../src/server/watchdog";
import {queueInventoryRefresh,dispatchOutbox} from "../../../../../src/server/outbox";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store"};
  if(!authorizedWatchdogToken(request.headers.get("authorization"),process.env.BOARDROOM_WATCHDOG_TOKEN))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  try{
    const db=getDatabase();const watchdog=await scanStaleSessions(db);
    await queueInventoryRefresh(db);const outbox=await dispatchOutbox(db,3);
    await db.query("INSERT INTO audit_events(kind,details) VALUES('maintenance.tick.completed',$1::jsonb)",
      [JSON.stringify({watchdog,outbox,automaticLeaseRelease:false})]);
    return NextResponse.json({watchdog,outbox,automaticLeaseRelease:false},{headers});
  }catch{return NextResponse.json({error:"Maintenance unavailable"},{status:503,headers});}
}
