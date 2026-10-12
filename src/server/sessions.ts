import type { Pool, PoolClient } from "pg";

export class SessionConflict extends Error {
  constructor(message = "Session state or lease conflict") { super(message); this.name = "SessionConflict"; }
}
export type SessionOutcome = "COMPLETED" | "YIELDED" | "BLOCKED" | "FAILED" | "CANCELLED";
export const SESSION_OUTCOMES: readonly SessionOutcome[] = ["COMPLETED","YIELDED","BLOCKED","FAILED","CANCELLED"];

export function parseSessionOutcome(value: unknown): SessionOutcome {
  if (typeof value !== "string" || !SESSION_OUTCOMES.includes(value as SessionOutcome))
    throw new SessionConflict("Invalid session outcome");
  return value as SessionOutcome;
}
export function isValidRunId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isValidGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
}

type Current = {state: string};
type Assignment = {
  assignment_id: string;
  repository_id: string;
  lease_generation: string;
  unit_id: string | null;
};
async function lockedRun(client: PoolClient, runId: string, credentialId: string): Promise<Current> {
  const result = await client.query<Current>(
    "SELECT state FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",
    [runId,credentialId]
  );
  if (result.rowCount !== 1) throw new SessionConflict("Run unavailable");
  return result.rows[0];
}
async function lockedAssignment(client: PoolClient, runId: string, generation: string): Promise<Assignment> {
  const result = await client.query<Assignment>(
    "SELECT assignment_id,repository_id,lease_generation::text AS lease_generation,unit_id FROM work_assignments WHERE run_id=$1 AND released_at IS NULL FOR UPDATE",
    [runId]
  );
  const current = result.rows[0];
  if (!current || current.lease_generation !== generation) throw new SessionConflict("Stale or missing assignment");
  return current;
}
async function lockedLease(client: PoolClient, assignment: Assignment, runId: string, generation: string, requireLive: boolean): Promise<void> {
  const result = await client.query<{run_id:string;generation:string;expires_at:Date}>(
    "SELECT run_id,generation::text AS generation,expires_at FROM repository_leases WHERE repository_id=$1 FOR UPDATE",
    [assignment.repository_id]
  );
  const row = result.rows[0];
  if (!row || row.run_id !== runId || row.generation !== generation)
    throw new SessionConflict("Repository lease was superseded");
  if (requireLive && row.expires_at <= new Date()) throw new SessionConflict("Lease expired; recovery required");
}

export async function heartbeatRun(db: Pool, runId: string, credentialId: string, generation: string): Promise<string> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const run = await lockedRun(client,runId,credentialId);
    if (run.state !== "RUNNING") throw new SessionConflict("Run is not active");
    const assignment = await lockedAssignment(client,runId,generation);
    await lockedLease(client,assignment,runId,generation,true);
    const budget=await client.query<{within_budget:boolean}>(`SELECT ar.started_at>now()-make_interval(secs=>COALESCE(p.max_session_seconds,1800)) AS within_budget
      FROM agent_runs ar LEFT JOIN repository_execution_policy p ON p.repository_id=$2 WHERE ar.run_id=$1`,[runId,assignment.repository_id]);
    if(budget.rows[0]?.within_budget!==true)throw new SessionConflict("Session time budget exhausted; checkpoint and finish");
    const result = await client.query<{expires_at:Date}>(
      "UPDATE repository_leases SET last_heartbeat_at=now(), expires_at=now()+interval '180 seconds' WHERE repository_id=$1 AND run_id=$2 AND generation=$3::bigint AND expires_at>now() RETURNING expires_at",
      [assignment.repository_id,runId,generation]
    );
    if (result.rowCount !== 1) throw new SessionConflict("Lease expired");
    await client.query("UPDATE agent_runs SET last_seen_at=now() WHERE run_id=$1",[runId]);
    await client.query("COMMIT");
    return result.rows[0].expires_at.toISOString();
  } catch(error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export type CheckpointPayload = {
  branch: string | null;
  headSha: string | null;
  state: Record<string, unknown>;
};
export function validateCheckpoint(input: unknown): CheckpointPayload {
  if (!input || typeof input !== "object") throw new SessionConflict("Checkpoint body required");
  const value = input as Record<string, unknown>;
  const branch = value.branch ?? null;
  const headSha = value.headSha ?? null;
  if (branch !== null && (typeof branch !== "string" || !/^[a-zA-Z0-9._/-]{1,180}$/.test(branch) || branch.includes("..") || branch.endsWith(".lock")))
    throw new SessionConflict("Invalid branch name");
  if (headSha !== null && (typeof headSha !== "string" || !/^[0-9a-f]{40}$/i.test(headSha)))
    throw new SessionConflict("Invalid Git SHA");
  const state = value.state;
  if (!state || typeof state !== "object" || Array.isArray(state) ||
      JSON.stringify(state).length > 16000) throw new SessionConflict("Invalid or oversized checkpoint");
  if(/(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|postgres(?:ql)?:\/\/[^\s]+@|(?:password|api.?key|secret|token)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{20,})/i.test(JSON.stringify(state)))
    throw new SessionConflict("Possible secret in checkpoint; store only secure references");
  return {branch:branch as string|null,headSha:headSha as string|null,state:state as Record<string,unknown>};
}

export async function saveCheckpoint(db: Pool, runId: string, credentialId: string, generation: string, input: unknown): Promise<string> {
  const body = validateCheckpoint(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const run = await lockedRun(client,runId,credentialId);
    if (run.state !== "RUNNING") throw new SessionConflict("Run cannot checkpoint");
    const assignment = await lockedAssignment(client,runId,generation);
    await lockedLease(client,assignment,runId,generation,true);
    const saved = await client.query<{checkpoint_id:string}>(
      "INSERT INTO checkpoints(assignment_id,run_id,repository_id,unit_id,branch,head_sha,state) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING checkpoint_id",
      [assignment.assignment_id,runId,assignment.repository_id,assignment.unit_id,body.branch,body.headSha,JSON.stringify(body.state)]
    );
    await client.query("COMMIT");
    return saved.rows[0].checkpoint_id;
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function finishRun(db: Pool, runId: string, credentialId: string, generation: string, outcome: SessionOutcome): Promise<{state:SessionOutcome;replay:boolean}> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const run = await lockedRun(client,runId,credentialId);
    if (run.state === outcome) {
      await client.query("COMMIT");
      return {state:outcome,replay:true};
    }
    if (run.state !== "RUNNING") throw new SessionConflict("Run cannot finish from " + run.state);
    const assignment = await lockedAssignment(client,runId,generation);
    await lockedLease(client,assignment,runId,generation,false);
    await client.query(
      "UPDATE work_assignments SET released_at=now(),outcome=$1 WHERE assignment_id=$2 AND released_at IS NULL",
      [outcome,assignment.assignment_id]
    );
    const released = await client.query(
      "UPDATE repository_leases SET run_id=NULL,expires_at=NULL,last_heartbeat_at=NULL,assigned_at=NULL WHERE repository_id=$1 AND run_id=$2 AND generation=$3::bigint",
      [assignment.repository_id,runId,generation]
    );
    if (released.rowCount !== 1) throw new SessionConflict("Lease could not be released");
    await client.query(
      "UPDATE agent_runs SET state=$1,ended_at=now(),last_seen_at=now() WHERE run_id=$2",
      [outcome,runId]
    );
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.run.finished',$3::jsonb)",
      [runId,assignment.repository_id,JSON.stringify({outcome,generation})]
    );
    await client.query("COMMIT");
    return {state:outcome,replay:false};
  } catch(error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
