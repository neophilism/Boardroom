import {NextResponse} from "next/server";
import {checkReadiness,environmentReady} from "../../../src/server/readiness";
import {getDatabase} from "../../../src/server/db";
export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Runtime readiness, not CI, actual agent availability, or deployment acceptance. */
export async function GET(){
  if(!environmentReady(process.env))
    return NextResponse.json({service:"boardroom",readiness:"not_ready"},{status:503,headers:{"Cache-Control":"no-store"}});
  try{
    const healthy=await checkReadiness(getDatabase(),process.env);
    return NextResponse.json({service:"boardroom",readiness:healthy?"ready":"not_ready"},{
      status:healthy?200:503,headers:{"Cache-Control":"no-store"}
    });
  }catch{
    return NextResponse.json({service:"boardroom",readiness:"not_ready"},{
      status:503,headers:{"Cache-Control":"no-store"}
    });
  }
}
