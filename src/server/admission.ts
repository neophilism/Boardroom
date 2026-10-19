import type { Pool, PoolClient } from "pg";
import type { AuthenticatedAgent } from "./agent-auth";
import {scanStaleSessionsLocked,recoverFencedOAuthSessionsLocked} from "./watchdog.ts";
import {evaluateNativeBudget,FLEET_ADMISSION_ADVISORY_LOCK,type NativeBudgetObservation,type NativeBudgetDenial} from "./native-budget.ts";

export type ActiveSessionDiagnostic={
  classification:"ACTIVE_LEASE"|"ADMISSION_IN_PROGRESS"|"EXPIRED_LEASE"|"MISSING_LEASE"|"RECOVERY_HELD";
  startedAt:string;lastSeenAt:string;leaseExpiresAt:string|null;
};

/** An activation is a temporary process, not the durable agent identity. */
export type AdmissionResult =
  | { kind: "CREATED"; runId: string; state: string }
  | { kind: "REPLAY"; runId: string; state: string }
  | { kind: "BUSY"; runId:null;state:"ALREADY_ACTIVE"|"RECOVERY_REQUIRED";activeSession:ActiveSessionDiagnostic }
  | { kind:"THROTTLED";runId:null;state:"BUDGET_PAUSED";budget:NativeBudgetDenial };

type LiveRun = {
  run_id:string;state:string;stale_admitted:boolean;lease_expired:boolean;
  started_at:Date;last_seen_at:Date;lease_expires_at:Date|null;
};
type CreatedRun = { run_id: string; state: string };

function activeSessionDiagnostic(run:LiveRun):ActiveSessionDiagnostic{
  const classification=run.state==="RECOVERING"||run.state==="UNKNOWN"||run.stale_admitted?"RECOVERY_HELD":
    run.state==="ADMITTED"?"ADMISSION_IN_PROGRESS":run.lease_expires_at===null?"MISSING_LEASE":
    run.lease_expired?"EXPIRED_LEASE":"ACTIVE_LEASE";
  return {classification,startedAt:run.started_at.toISOString(),lastSeenAt:run.last_seen_at.toISOString(),
    leaseExpiresAt:run.lease_expires_at?.toISOString()??null};
}

const ACTIVE_RUN_QUERY=`SELECT ar.run_id,ar.state,ar.started_at,ar.last_seen_at,l.expires_at AS lease_expires_at,
  (ar.state='ADMITTED' AND ar.last_seen_at < now() - interval '10 minutes') AS stale_admitted,
  (ar.state='RUNNING' AND (l.run_id IS NULL OR l.expires_at<=now())) AS lease_expired
 FROM agent_runs ar LEFT JOIN repository_leases l ON l.run_id=ar.run_id
 WHERE ar.credential_id=$1 AND ar.state IN ('ADMITTED','RUNNING','RECOVERING','UNKNOWN')
 ORDER BY ar.started_at ASC FOR UPDATE OF ar`;

function needsRecovery(run:LiveRun):boolean{
  const classification=activeSessionDiagnostic(run).classification;
  return classification!=="ACTIVE_LEASE"&&classification!=="ADMISSION_IN_PROGRESS";
}

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

    const active=await client.query<LiveRun>(ACTIVE_RUN_QUERY,[principal.credentialId]);
    const retired=new Set<string>();
    for (const previous of active.rows) {
      if (previous.state !== "ADMITTED" || !previous.stale_admitted) continue;
      // Abandoned admission with NO assignment or repository lease is safe to retire.
      // A stale running/leased execution is NEVER assumed dead just by elapsed time.
      const assignment = await client.query(
        "SELECT 1 FROM work_assignments WHERE run_id=$1 AND released_at IS NULL "+
        "UNION ALL SELECT 1 FROM repository_leases WHERE run_id=$1 LIMIT 1",
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
      retired.add(previous.run_id);
    }
    let previous=active.rows.find(run=>!retired.has(run.run_id));
    if(previous&&needsRecovery(previous)&&principal.provider==="chatgpt"){
      // GitHub's maintenance schedule is best-effort. Recover only this
      // authenticated credential in the same transaction as normal admission.
      // The credential/run locks serialize competing arrivals; SKIP LOCKED on
      // leases defers in-flight writes. No extra pooled connection is needed.
      await scanStaleSessionsLocked(client,1,principal.credentialId);
      await recoverFencedOAuthSessionsLocked(client,1,principal.credentialId);
      previous=(await client.query<LiveRun>(ACTIVE_RUN_QUERY,[principal.credentialId])).rows[0];
    }
    if(previous){
      const diagnostic=activeSessionDiagnostic(previous);
      await client.query("COMMIT"); committed = true;
      return {kind:"BUSY",runId:null,state:needsRecovery(previous)?"RECOVERY_REQUIRED":"ALREADY_ACTIVE",activeSession:diagnostic};
    }

    if(principal.provider==="chatgpt"){
      // Native fleet-wide budget: serialized across all named agents and instances.
      // A denied activation does not create a run, assignment, or lease.
      await client.query("SELECT pg_advisory_xact_lock($1)",[FLEET_ADMISSION_ADVISORY_LOCK]);
      const observed=await client.query<NativeBudgetObservation>(
        "SELECT count(*) FILTER (WHERE state IN ('ADMITTED','RUNNING','RECOVERING','UNKNOWN'))::text AS active_native, "+
        "count(*) FILTER (WHERE started_at>now()-interval '24 hours')::text AS starts_24h, "+
        "max(started_at) AS last_started_at, "+
        "(SELECT min(started_at) FROM "+
        "(SELECT started_at FROM agent_runs WHERE provider='chatgpt' "+
        "AND started_at>now()-interval '24 hours' ORDER BY started_at DESC LIMIT 4) recent) AS fourth_newest_started_at, "+
        "now() AS checked_at FROM agent_runs WHERE provider='chatgpt'");
      if(observed.rowCount!==1)throw new Error("Native admission budget unavailable");
      const decision=evaluateNativeBudget(observed.rows[0]);
      if(!decision.allowed){
        await client.query("COMMIT");committed=true;
        return {kind:"THROTTLED",runId:null,state:"BUDGET_PAUSED",budget:decision};
      }
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
