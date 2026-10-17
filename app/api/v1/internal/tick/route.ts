import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {scanStaleSessions} from "../../../../../src/server/watchdog";
import {authorizeMaintenance} from "../../../../../src/server/maintenance-auth";
import {queueInventoryRefresh,dispatchOutbox} from "../../../../../src/server/outbox";
import {purgeExpiredCoffee} from "../../../../../src/server/coffee-moderation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const headers={"Cache-Control":"no-store"};
  const principal=await authorizeMaintenance(request.headers.get("authorization"));
  if(!principal)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  try{
    const db=getDatabase();const watchdog=await scanStaleSessions(db);
    const retention=await purgeExpiredCoffee(db);
    await queueInventoryRefresh(db);const outbox=await dispatchOutbox(db,3);
    await db.query("INSERT INTO audit_events(kind,details) VALUES('maintenance.tick.completed',$1::jsonb)",
      [JSON.stringify({watchdog,outbox,retention,automaticLeaseRelease:false,principal})]);
    return NextResponse.json({watchdog,outbox,retention,automaticLeaseRelease:false},{headers});
  }catch{return NextResponse.json({error:"Maintenance unavailable"},{status:503,headers});}
}
