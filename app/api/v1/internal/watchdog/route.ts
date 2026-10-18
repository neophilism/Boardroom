import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {scanStaleSessions,recoverFencedOAuthSessions,authorizedWatchdogToken} from "../../../../../src/server/watchdog";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function POST(request:Request){
  if(!authorizedWatchdogToken(request.headers.get("authorization"),process.env.BOARDROOM_WATCHDOG_TOKEN))
    return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  try{
    const db=getDatabase(); const report=await scanStaleSessions(db); const oauthRecovery=await recoverFencedOAuthSessions(db);
    return NextResponse.json({scan:"completed",...report,oauthRecovery},{headers});
  }catch{
    console.error("Watchdog scan failed");
    return NextResponse.json({error:"Watchdog scan unavailable"},{status:503,headers});
  }
}
