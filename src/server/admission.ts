import type { Pool, PoolClient } from "pg";
import type { AuthenticatedAgent } from "./agent-auth";

/** An activation is a temporary process, not the durable agent identity. */
export type AdmissionResult =
  | { kind: "CREATED"; runId: string; state: string }
  | { kind: "REPLAY"; runId: string; state: string }
  | { kind: "BUSY"; runId: null; state: "ALREADY_ACTIVE" | "RECOVERY_REQUIRED" };

type LiveRun = { run_id: string; state: string; stale_admitted: boolean };
type CreatedRun = { run_id: string; state: string };

/** Serialize all new activations for the same authenticated credential.
 * No persistent slot ID, provider account name, or model memory is needed.
 * The DB also enforces at most one nonterminal run per credential.
 */
export async function admitAgentRun(db: Pool, principal: AuthenticatedAgent, activationHash: string | null): Promise<AdmissionResult> {
  const client: PoolClient = await db.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const principalRow = await client.query(
      "SELECT credential_id FROM agent_credentials WHERE credential_id=$1 AND enabled=TRUE AND revoked_at IS NULL FOR UPDATE",
      [principal.credentialId]
    );
    if (principalRow.rowCount !== 1) throw new Error("Registered principal is no longer active");

    // Deliveries with an identical *trusted* activation idempotency key are replays.
    if (activationHash !== null) {
      const prior = await client.query<CreatedRun>(
        "SELECT run_id,state FROM agent_runs WHERE credential_id=$1 AND activation_dedupe_hash=$2",
        [principal.credentialId, activationHash]
      );
      if (prior.rowCount) {
        await client.query("COMMIT"); committed = true;
        return {kind:"REPLAY", runId:prior.rows[0].run_id, state:prior.rows[0].state};
      }
    }

    const active = await client.query<LiveRun>(
      `SELECT run_id,state,
        (state='ADMITTED' AND last_seen_at < now() - interval '10 minutes') AS stale_admitted
       FROM agent_runs
       WHERE credential_id=$1 AND state IN ('ADMITTED','RUNNING','RECOVERING','UNKNOWN')
       ORDER BY started_at ASC
       FOR UPDATE`,
      [principal.credentialId]
    );
    for (const previous of active.rows) {
      if (previous.state !== "ADMITTED" || !previous.stale_admitted) continue;
      // Abandoned admission with NO repository assignment is safe to retire.
      // A stale running/leased execution is NEVER assumed dead just by elapsed time.
      const assignment = await client.query(
        "SELECT 1 FROM work_assignments WHERE run_id=$1 AND released_at IS NULL LIMIT 1",
        [previous.run_id]
      );
      if (assignment.rowCount) continue;
      await client.query(
        "UPDATE agent_runs SET state='CANCELLED', ended_at=now() WHERE run_id=$1 AND state='ADMITTED'",
        [previous.run_id]
      );
      await client.query(
        "INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.abandoned_admission',$2::jsonb)",
        [previous.run_id, JSON.stringify({reason:"No assignment after 10 minutes"})]
      );
    }
    if (active.rows.some(r => r.state !== "ADMITTED" || !r.stale_admitted)) {
      const recovery = active.rows.some(r => r.state === "RECOVERING" || r.state === "UNKNOWN");
      await client.query("COMMIT"); committed = true;
      return {kind:"BUSY", runId:null, state:recovery?"RECOVERY_REQUIRED":"ALREADY_ACTIVE"};
    }
    // Stale admitted runs with a still-open assignment must also remain blocked.
    const remaining = await client.query(
      "SELECT 1 FROM agent_runs WHERE credential_id=$1 AND state IN ('ADMITTED','RUNNING','RECOVERING','UNKNOWN') LIMIT 1",
      [principal.credentialId]
    );
    if (remaining.rowCount) {
      await client.query("COMMIT"); committed = true;
      return {kind:"BUSY",runId:null,state:"RECOVERY_REQUIRED"};
    }

    const created = await client.query<CreatedRun>(
      "INSERT INTO agent_runs(provider,activation_source,activation_dedupe_hash,credential_id) VALUES($1,$2,$3,$4) RETURNING run_id,state",
      [principal.provider, principal.label, activationHash, principal.credentialId]
    );
    if (created.rowCount !== 1) throw new Error("Run creation did not return a run ID");
    await client.query(
      "INSERT INTO audit_events(run_id,kind,details) VALUES($1,'agent.run.admitted',$2::jsonb)",
      [created.rows[0].run_id,JSON.stringify({credentialId:principal.credentialId,agentName:principal.label})]
    );
    await client.query("COMMIT"); committed = true;
    return {kind:"CREATED",runId:created.rows[0].run_id,state:created.rows[0].state};
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
