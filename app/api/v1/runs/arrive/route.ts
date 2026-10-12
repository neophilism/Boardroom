import { NextResponse } from "next/server";
import { getDatabase } from "../../../../../src/server/db";
import { authenticateAgent, digestActivation, InvalidAgentCredential } from "../../../../../src/server/agent-auth";

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
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query<{run_id:string;state:string}>(
        "INSERT INTO agent_runs(provider,activation_source,activation_dedupe_hash,credential_id) VALUES($1,$2,$3,$4) ON CONFLICT (activation_dedupe_hash) DO NOTHING RETURNING run_id,state",
        [agent.provider,agent.label,digest,agent.credentialId]
      );
      const replay = created.rowCount === 0;
      const row = replay
        ? (await client.query<{run_id:string;state:string}>("SELECT run_id,state FROM agent_runs WHERE activation_dedupe_hash=$1 AND credential_id=$2", [digest,agent.credentialId])).rows[0]
        : created.rows[0];
      if (!row) throw new Error("Activation replay could not be reconciled");
      if (!replay) {
        await client.query("INSERT INTO audit_events(run_id,kind,details) VALUES($1,$2,$3::jsonb)",[row.run_id,"agent.run.admitted",JSON.stringify({ credentialId:agent.credentialId })]);
      }
      await client.query("COMMIT");
      return NextResponse.json({ runId: row.run_id, agentName: agent.label, provider: agent.provider, state: row.state, replay }, {
        status: replay ? 200 : 201,
        headers: { "Cache-Control": "no-store" }
      });
    } catch(error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch(error) {
    if (error instanceof InvalidAgentCredential) return NextResponse.json({error:"Unauthorized"}, {status:401});
    console.error("Boardroom arrival failed without exposing credentials");
    return NextResponse.json({error:"Agent arrival unavailable"}, {status:503});
  }
}
