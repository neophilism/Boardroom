import { NextResponse } from "next/server";
import { getDatabase } from "../../../../src/server/db";
import { authenticateAgent, InvalidAgentCredential } from "../../../../src/server/agent-auth";
import { AssignmentConflict, claimAssignment } from "../../../../src/server/assignment";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const db = getDatabase();
    const principal = await authenticateAgent(request.headers, db);
    const payload: unknown = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object" || !("runId" in payload) ||
        typeof payload.runId !== "string" ||
        !/^[0-9a-fA-F-]{36}$/.test(payload.runId)) {
      return NextResponse.json({error:"runId UUID required"}, {status:400});
    }
    const assignment = await claimAssignment(db,payload.runId,principal.credentialId);
    return NextResponse.json(assignment
      ? {status:"ASSIGNED", assignment}
      : {status:"IDLE", assignment:null},
      {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof InvalidAgentCredential) return NextResponse.json({error:"Unauthorized"},{status:401});
    if (error instanceof AssignmentConflict) return NextResponse.json({error:error.message},{status:409});
    console.error("Boardroom claim failed");
    return NextResponse.json({error:"Assignment service unavailable"},{status:503});
  }
}
