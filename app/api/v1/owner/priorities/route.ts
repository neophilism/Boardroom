import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authorizeOwner,UnauthorizedOwner} from "../../../../../src/server/owner-auth";
import {getRepositoryPriority,parsePriorityOrder,replaceRepositoryPriority,PriorityValidationError} from "../../../../../src/server/priorities";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function GET(request:Request) {
  try{
    authorizeOwner(request.headers);
    const priorities=await getRepositoryPriority(getDatabase());
    return NextResponse.json({priorities},{headers});
  }catch(error){
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    console.error("Boardroom owner priority list failed");
    return NextResponse.json({error:"Repository priority unavailable"},{status:503,headers});
  }
}

export async function PUT(request:Request) {
  try{
    authorizeOwner(request.headers);
    const body:unknown=await request.json().catch(()=>null);
    const ids=parsePriorityOrder(body);
    const updated=await replaceRepositoryPriority(getDatabase(),ids);
    return NextResponse.json(updated,{headers});
  }catch(error){
    if(error instanceof UnauthorizedOwner)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof PriorityValidationError)return NextResponse.json({error:error.message},{status:400,headers});
    console.error("Boardroom owner priority update failed");
    return NextResponse.json({error:"Repository priority update unavailable"},{status:503,headers});
  }
}
