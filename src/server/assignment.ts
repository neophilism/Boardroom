import type { Pool, PoolClient } from "pg";
import {queueAssignmentDispatch} from "./assignment-dispatch.ts";
import {TECHNICAL_RECOVERY_ELIGIBLE_SQL} from "./work-recovery.ts";

export type ClaimedAssignment = {
  assignmentId: string;
  repositoryId: string;
  fullName: string;
  unitId: string;
  generation: string;
  expiresAt: string;
  replay: boolean;
};

export class AssignmentConflict extends Error { constructor(message: string) { super(message); this.name = "AssignmentConflict"; } }

type Session = { run_id: string; state: string };
type Eligible = { repository_id: string; full_name: string; unit_id: string; unit_state:string };
type Lease = { generation: string; expires_at: Date };
type Existing = { assignment_id: string; repository_id: string; full_name: string; unit_id: string; generation: string; expires_at: Date };

/** The selected lease row is locked before state is modified.
 * Priority position takes precedence; otherwise sort by last actual GitHub development event.
 * Expired but still assigned leases are excluded until explicit fenced recovery.
 */
export const REPOSITORY_CLAIM_QUERY = String.raw`
  WITH RECURSIVE dependency_edges AS (
    SELECT repository_id,unit_id,prerequisite_repository_id,prerequisite_unit_id FROM compatibility_dependencies
    UNION
    SELECT w.repository_id,w.unit_id,r.repository_id,d.value->>'unitId'
    FROM roadmap_units w CROSS JOIN LATERAL jsonb_array_elements(w.external_dependencies) d(value)
    JOIN repositories r ON r.full_name=d.value->>'repository'
  ), inherited_priority(repository_id,position) AS (
    SELECT repository_id,position FROM repository_priority
    UNION
    SELECT d.prerequisite_repository_id,p.position
    FROM inherited_priority p JOIN dependency_edges d ON d.repository_id=p.repository_id
    JOIN roadmap_units consumer ON consumer.repository_id=d.repository_id AND consumer.unit_id=d.unit_id
    LEFT JOIN roadmap_units prerequisite ON prerequisite.repository_id=d.prerequisite_repository_id
      AND prerequisite.unit_id=d.prerequisite_unit_id
    WHERE consumer.approved=TRUE AND consumer.state NOT IN ('MERGED','ACCEPTED')
      AND (prerequisite.unit_id IS NULL OR prerequisite.approved IS NOT TRUE OR prerequisite.state NOT IN ('MERGED','ACCEPTED'))
  ), effective_priority AS (
    SELECT repository_id,MIN(position) AS position FROM inherited_priority GROUP BY repository_id
  )
  SELECT r.repository_id, r.full_name, chosen.unit_id, chosen.unit_state
  FROM repositories r
  JOIN repository_leases l ON l.repository_id = r.repository_id
  LEFT JOIN effective_priority p ON p.repository_id = r.repository_id
  JOIN LATERAL (
    SELECT w.unit_id,w.state AS unit_state
    FROM roadmap_units w
    WHERE w.repository_id = r.repository_id
      AND w.approved = TRUE
      AND registry_prerequisites_satisfied(w.repository_id,w.unit_id)
      AND w.state IN ('PENDING', 'ACTIVE', 'OPEN_PR','BLOCKED')
      AND ${TECHNICAL_RECOVERY_ELIGIBLE_SQL}
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(w.depends_on) AS dependency(id)
        LEFT JOIN roadmap_units prerequisite
          ON prerequisite.repository_id = w.repository_id AND prerequisite.unit_id = dependency.id
        WHERE prerequisite.unit_id IS NULL OR prerequisite.approved IS NOT TRUE OR prerequisite.state NOT IN ('MERGED','ACCEPTED')
      )
      AND NOT EXISTS (
        SELECT 1 FROM owner_action_dependents dep
        JOIN owner_actions action ON action.action_id = dep.action_id
        WHERE dep.repository_id = r.repository_id
          AND (dep.unit_id IS NULL OR dep.unit_id = w.unit_id)
          AND action.status NOT IN ('VERIFIED','CANCELLED')
      )
      AND NOT EXISTS (
        SELECT 1 FROM compatibility_dependencies d
        LEFT JOIN roadmap_units prerequisite ON prerequisite.repository_id=d.prerequisite_repository_id
          AND prerequisite.unit_id=d.prerequisite_unit_id
        WHERE d.repository_id=w.repository_id AND d.unit_id=w.unit_id
          AND (prerequisite.unit_id IS NULL OR prerequisite.approved IS NOT TRUE OR prerequisite.state NOT IN ('MERGED','ACCEPTED'))
      )
    ORDER BY CASE WHEN w.state IN ('ACTIVE','OPEN_PR','BLOCKED') THEN 0 ELSE 1 END, w.unit_id
    LIMIT 1
  ) chosen ON TRUE
  WHERE r.enabled = TRUE AND r.archived = FALSE
    AND l.run_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM execution_controls WHERE singleton=TRUE AND paused=TRUE)
  ORDER BY
    CASE WHEN p.position IS NULL THEN 1 ELSE 0 END,
    p.position ASC NULLS LAST,
    COALESCE(r.last_development_at, r.created_at) ASC,
    r.repository_id ASC
  FOR UPDATE OF l SKIP LOCKED
  LIMIT 1
`;

async function existingAssignment(client: PoolClient, runId: string): Promise<ClaimedAssignment | null> {
  const current = await client.query<Existing>(
    `SELECT a.assignment_id, a.repository_id, r.full_name, a.unit_id,
      l.generation::text AS generation, l.expires_at
     FROM work_assignments a
     JOIN repository_leases l ON l.repository_id = a.repository_id
       AND l.run_id = a.run_id AND l.generation = a.lease_generation
     JOIN repositories r ON r.repository_id = a.repository_id
     WHERE a.run_id = $1 AND a.released_at IS NULL`,
    [runId]
  );
  if (!current.rows.length) return null;
  const row = current.rows[0];
  return {
    assignmentId: row.assignment_id, repositoryId: row.repository_id,
    fullName: row.full_name, unitId: row.unit_id,
    generation: row.generation, expiresAt: row.expires_at.toISOString(), replay: true
  };
}

export async function claimAssignment(db: Pool, runId: string, credentialId: string): Promise<ClaimedAssignment | null> {
  const client = await db.connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    const result = await client.query<Session>(
      "SELECT run_id, state FROM agent_runs WHERE run_id=$1 AND credential_id=$2 FOR UPDATE",
      [runId, credentialId]
    );
    if (result.rowCount !== 1) throw new AssignmentConflict("Unknown or unauthorized run");
    const state = result.rows[0].state;
    if (state === "RUNNING") {
      const current = await existingAssignment(client, runId);
      if (!current) throw new AssignmentConflict("Running session has no current assignment");
      await client.query("COMMIT");
      committed = true;
      return current;
    }
    if (state !== "ADMITTED") throw new AssignmentConflict("This run cannot claim an assignment");

    const choice = await client.query<Eligible>(REPOSITORY_CLAIM_QUERY);
    if (!choice.rowCount) {
      await client.query("COMMIT");
      committed = true;
      return null;
    }
    const { repository_id: repositoryId, full_name: fullName, unit_id: unitId } = choice.rows[0];
    const changed = await client.query<Lease>(
      `UPDATE repository_leases SET
          run_id=$1, generation=generation+1,
          assigned_at=now(), last_heartbeat_at=now(),
          expires_at=now() + interval '180 seconds'
        WHERE repository_id=$2 AND run_id IS NULL
        RETURNING generation::text AS generation, expires_at`,
      [runId, repositoryId]
    );
    if (changed.rowCount !== 1) throw new AssignmentConflict("The repository was claimed concurrently");
    const lease = changed.rows[0];
    const assigned = await client.query<{assignment_id:string}>(
      `INSERT INTO work_assignments (repository_id,run_id,lease_generation,unit_id)
       VALUES($1,$2,$3,$4) RETURNING assignment_id`,
      [repositoryId,runId,lease.generation,unitId]
    );
    await queueAssignmentDispatch(client,assigned.rows[0].assignment_id,unitId);
    await client.query(
      "UPDATE agent_runs SET state='RUNNING', last_seen_at=now() WHERE run_id=$1",
      [runId]
    );
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'agent.assignment.claimed',$3::jsonb)",
      [runId,repositoryId,JSON.stringify({ unitId, generation:lease.generation, unitState:choice.rows[0].unit_state,
        eligibilityReason:choice.rows[0].unit_state==="BLOCKED"?"TECHNICAL_ANSWER_AVAILABLE":"APPROVED_PREREQUISITES_READY" })]
    );
    await client.query("COMMIT");
    committed = true;
    return {
      assignmentId:assigned.rows[0].assignment_id, repositoryId,
      fullName, unitId, generation:lease.generation,
      expiresAt:lease.expires_at.toISOString(), replay:false
    };
  } catch(error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
