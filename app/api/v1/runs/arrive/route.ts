import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../src/server/db";
import { authenticateAgent, digestActivation, InvalidAgentCredential } from "../../../../../src/server/agent-auth";
import { admitAgentRun } from "../../../../../src/server/admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const db = getDatabase();
  try {
    const agent = await authenticateAgent(request.headers, db);
    // Optional caller-supplied name is only a consistency check, not an identity claim.
    const claimedName = request.headers.get("x-boardroom-agent-name");
    if (claimedName !== null && claimedName !== agent.label) {
      return NextResponse.json({ error: "Agent name does not match registered identity" }, { status: 403 });
    }
    const key = request.headers.get("idempotency-key");
    const pepper = process.env.BOARDROOM_TOKEN_PEPPER!;
    let digest: string | null = null;
    if (key !== null) {
      try { digest = digestActivation(agent.credentialId, key, pepper); }
      catch { return NextResponse.json({ error: "Invalid Idempotency-Key" }, { status: 400 }); }
    }
    const admitted = await admitAgentRun(db, agent, digest);
    const publicIdentity = {agentName:agent.label,provider:agent.provider};
    if(admitted.kind === "BUSY") {
      return NextResponse.json({...publicIdentity,runId:null,state:admitted.state,shouldWork:false,replay:false,
        activeSession:admitted.activeSession}, {
        status:200,headers:{"Cache-Control":"no-store"}
      });
    }
    if(admitted.kind === "REPLAY") {
      // A duplicate activation is an acknowledgment, NOT a second execution
      // capability for the previous run.
      return NextResponse.json({...publicIdentity,runId:null,state:admitted.state,shouldWork:false,replay:true}, {
        status:200,headers:{"Cache-Control":"no-store"}
      });
    }
    return NextResponse.json({...publicIdentity,runId:admitted.runId,state:admitted.state,shouldWork:true,replay:false}, {
      status:201,headers:{"Cache-Control":"no-store"}
    });
  } catch(error) {
    if (error instanceof InvalidAgentCredential) return NextResponse.json({error:"Unauthorized"}, {status:401});
    console.error("Boardroom arrival failed without exposing credentials");
    return NextResponse.json({error:"Agent arrival unavailable"}, {status:503});
  }
}
