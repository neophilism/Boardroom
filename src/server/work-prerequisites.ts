import type {Pool,PoolClient} from "pg";
import {SessionConflict} from "./sessions.ts";
import {TECHNICAL_RECOVERY_ELIGIBLE_SQL} from "./work-recovery.ts";

/** Recheck under the caller's assignment lease lock immediately before a
 * privileged write or merge. Admission-time eligibility can become stale. */
export async function assertWorkPrerequisites(db:Pool|PoolClient,repositoryId:string,unitId:string,requireResolvedQuestions=false){
  const result=await db.query<{dependencies_pending:boolean;compatibility_pending:boolean;owner_pending:boolean;registry_pending:boolean;technical_pending:boolean}>(`
    SELECT NOT registry_prerequisites_satisfied(w.repository_id,w.unit_id) AS registry_pending, EXISTS(
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
    ) AS owner_pending,
    (NOT ${TECHNICAL_RECOVERY_ELIGIBLE_SQL} OR ($3::boolean AND EXISTS(
      SELECT 1 FROM coffee_threads unresolved
      WHERE unresolved.repository_id=w.repository_id AND unresolved.unit_id=w.unit_id
        AND unresolved.status IN ('OPEN','ANSWERED')
    ))) AS technical_pending
    FROM roadmap_units w WHERE w.repository_id=$1 AND w.unit_id=$2 AND w.approved=TRUE`,[repositoryId,unitId,requireResolvedQuestions]);
  const status=result.rows[0];
  if(!status)throw new SessionConflict("Approved work unit unavailable");
  if(status.registry_pending)throw new SessionConflict("Registry external prerequisite unresolved");
  if(status.dependencies_pending)throw new SessionConflict("Approved work-unit prerequisite unresolved");
  if(status.compatibility_pending)throw new SessionConflict("Cross-repository compatibility prerequisite unresolved");
  if(status.owner_pending)throw new SessionConflict("Owner action prerequisite unresolved");
  if(status.technical_pending)throw new SessionConflict("Technical question prerequisite unresolved or retry evidence consumed");
}
