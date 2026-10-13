import type {Pool,PoolClient} from "pg";
import {SessionConflict} from "./sessions.ts";

/** Recheck under the caller's assignment lease lock immediately before a
 * privileged write or merge. Admission-time eligibility can become stale. */
export async function assertWorkPrerequisites(db:Pool|PoolClient,repositoryId:string,unitId:string){
  const result=await db.query<{dependencies_pending:boolean;compatibility_pending:boolean;owner_pending:boolean}>(`
    SELECT EXISTS(
      SELECT 1 FROM jsonb_array_elements_text(w.depends_on) d(id)
      LEFT JOIN roadmap_units p ON p.repository_id=w.repository_id AND p.unit_id=d.id
      WHERE p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED')
    ) AS dependencies_pending,
    EXISTS(
      SELECT 1 FROM compatibility_dependencies d LEFT JOIN roadmap_units p
        ON p.repository_id=d.prerequisite_repository_id AND p.unit_id=d.prerequisite_unit_id
      WHERE d.repository_id=w.repository_id AND d.unit_id=w.unit_id
        AND (p.unit_id IS NULL OR p.approved IS NOT TRUE OR p.state NOT IN ('MERGED','ACCEPTED'))
    ) AS compatibility_pending,
    EXISTS(
      SELECT 1 FROM owner_action_dependents d JOIN owner_actions a ON a.action_id=d.action_id
      WHERE d.repository_id=w.repository_id AND (d.unit_id IS NULL OR d.unit_id=w.unit_id)
        AND a.status NOT IN ('VERIFIED','CANCELLED')
    ) AS owner_pending
    FROM roadmap_units w WHERE w.repository_id=$1 AND w.unit_id=$2 AND w.approved=TRUE`,[repositoryId,unitId]);
  const status=result.rows[0];
  if(!status)throw new SessionConflict("Approved work unit unavailable");
  if(status.dependencies_pending)throw new SessionConflict("Approved work-unit prerequisite unresolved");
  if(status.compatibility_pending)throw new SessionConflict("Cross-repository compatibility prerequisite unresolved");
  if(status.owner_pending)throw new SessionConflict("Owner action prerequisite unresolved");
}
