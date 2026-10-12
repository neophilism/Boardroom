import { NextResponse } from "next/server";
import { getDatabase } from "./db";
import { authenticateAgent, InvalidAgentCredential } from "./agent-auth";
import { isValidRunId, isValidGeneration, SessionConflict } from "./sessions";
import type { Pool } from "pg";

type Action = (db: Pool, runId: string, credentialId: string, generation: string, body: Record<string,unknown>) => Promise<unknown>;

export async function authorizedSessionRequest(request: Request, runId: string, action: Action): Promise<NextResponse> {
  if (!isValidRunId(runId)) return NextResponse.json({error:"Invalid run ID"},{status:400});
  try {
    const db = getDatabase();
    const principal = await authenticateAgent(request.headers,db);
    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"JSON object required"},{status:400});
    const record = body as Record<string,unknown>;
    if (!isValidGeneration(record.generation)) return NextResponse.json({error:"Valid generation required"},{status:400});
    const value = await action(db,runId,principal.credentialId,record.generation,record);
    return NextResponse.json(value, {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof InvalidAgentCredential) return NextResponse.json({error:"Unauthorized"},{status:401});
    if (error instanceof SessionConflict) return NextResponse.json({error:error.message},{status:409});
    console.error("Boardroom session operation failed");
    return NextResponse.json({error:"Session service unavailable"},{status:503});
  }
}
