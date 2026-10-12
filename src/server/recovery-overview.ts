import type {Pool} from "pg";

export type RecoveryEntry={
  repositoryId:string;repository:string;runId:string;agentName:string|null;
  provider:string|null;runState:string;leaseGeneration:string;
  leaseExpiredAt:Date;lastHeartbeatAt:Date|null;
  workUnitId:string|null;ownerActionId:string|null;ownerActionStatus:string|null;
};

export async function getRecoveryOverview(db:Pool):Promise<RecoveryEntry[]>{
  const result=await db.query<RecoveryEntry>(
    `SELECT r.repository_id::text AS "repositoryId",r.full_name AS "repository",
       ar.run_id::text AS "runId",ac.label AS "agentName",ar.provider AS "provider",
       ar.state AS "runState",l.generation::text AS "leaseGeneration",
       l.expires_at AS "leaseExpiredAt",l.last_heartbeat_at AS "lastHeartbeatAt",
       wa.unit_id AS "workUnitId",oa.action_id::text AS "ownerActionId",
       oa.status AS "ownerActionStatus"
     FROM repository_leases l
     JOIN repositories r ON r.repository_id=l.repository_id
     JOIN agent_runs ar ON ar.run_id=l.run_id
     LEFT JOIN agent_credentials ac ON ac.credential_id=ar.credential_id
     LEFT JOIN work_assignments wa ON wa.repository_id=l.repository_id
       AND wa.run_id=l.run_id AND wa.released_at IS NULL
     LEFT JOIN LATERAL (
       SELECT action_id,status FROM owner_actions
       WHERE action_key='boardroom:recovery:' || r.repository_id::text
         AND status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
       ORDER BY created_at DESC LIMIT 1
     ) oa ON TRUE
     WHERE ar.state IN ('RECOVERING','UNKNOWN')
       OR (ar.state='RUNNING' AND l.expires_at<=now())
     ORDER BY l.expires_at ASC,r.repository_id ASC LIMIT 200`
  );
  return result.rows;
}
