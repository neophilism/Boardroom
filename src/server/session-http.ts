import { NextResponse } from "next/server";
import {boundedRequestText,RequestBodyTooLarge} from "./request-body";
import { getDatabase } from "./db";
import { authenticateAgent, InvalidAgentCredential } from "./agent-auth";
import { isValidRunId, isValidGeneration, SessionConflict,ContinuationRequired,ReleaseReconciliationRequired } from "./sessions";
import type { Pool } from "pg";
import {RunnerBudgetBlocked} from "./budget-errors";
import {GithubOperationUncertain} from "./github-operation-ledger";

type Action = (db: Pool, runId: string, credentialId: string, generation: string, body: Record<string,unknown>) => Promise<unknown>;

export async function authorizedSessionRequest(request: Request, runId: string | null, action: Action): Promise<NextResponse> {
  if (runId !== null && !isValidRunId(runId)) return NextResponse.json({error:"Invalid run ID"},{status:400});
  try {
    const db = getDatabase();
    const principal = await authenticateAgent(request.headers,db);
    const raw = await boundedRequestText(request,65536);
    let body:unknown;
    try{body=JSON.parse(raw);}catch{body=null;}
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"JSON object required"},{status:400});
    const record = body as Record<string,unknown>;
    const assignedRunId=runId??record.runId;
    if (!isValidRunId(assignedRunId)) return NextResponse.json({error:"Invalid run ID"},{status:400});
    if (!isValidGeneration(record.generation)) return NextResponse.json({error:"Valid generation required"},{status:400});
    const value = await action(db,assignedRunId,principal.credentialId,record.generation,record);
    return NextResponse.json(value, {headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if (error instanceof RequestBodyTooLarge) return NextResponse.json({error:"Request body too large"},{status:413});
    if (error instanceof InvalidAgentCredential) return NextResponse.json({error:"Unauthorized"},{status:401});
    if (error instanceof RunnerBudgetBlocked) return NextResponse.json({error:error.message,code:error.code},{status:409,headers:{"Cache-Control":"no-store"}});
    if (error instanceof ReleaseReconciliationRequired) return NextResponse.json({error:error.message,code:"RELEASE_RECONCILIATION_REQUIRED"},{status:409,headers:{"Cache-Control":"no-store"}});
    if (error instanceof GithubOperationUncertain) return NextResponse.json({error:error.message,code:"GITHUB_OPERATION_UNCERTAIN"},{status:409,headers:{"Cache-Control":"no-store"}});
    if (error instanceof ContinuationRequired) return NextResponse.json({error:error.message,code:"CONTINUATION_REQUIRED"},{status:409,headers:{"Cache-Control":"no-store"}});
    if (error instanceof SessionConflict) return NextResponse.json({error:error.message},{status:409});
    console.error("Boardroom session operation failed");
    return NextResponse.json({error:"Session service unavailable"},{status:503});
  }
}
