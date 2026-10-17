import type {Pool} from "pg";
import {classifyLease} from "../domain/work-board.ts";

export type ReservedAgentName={name:string;accountSlot:number};
export async function listReservedAgentNames(db:Pool):Promise<ReservedAgentName[]>{
  const result=await db.query<{name:string;accountSlot:number}>(
    'SELECT name,account_slot AS "accountSlot" FROM agent_name_reservations ORDER BY account_slot,name'
  );
  return result.rows;
}

/** Private, read-only, on-demand snapshot. A lease records ownership, not proof of coding progress. */
export const AGENT_ACTIVITY_QUERY=`
WITH identities AS (
  SELECT c.credential_id,c.label AS name,c.provider,c.account_email,r.account_slot
  FROM agent_credentials c LEFT JOIN agent_name_reservations r ON r.name=c.label
  WHERE c.enabled=TRUE AND c.revoked_at IS NULL
  UNION ALL
  SELECT NULL::uuid,p.name,'chatgpt'::text,NULL::text,p.account_slot
  FROM agent_name_reservations p
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_credentials c
    WHERE c.label=p.name AND c.enabled=TRUE AND c.revoked_at IS NULL
  )
)
SELECT i.name,i.provider,i.account_email AS "accountEmail",i.account_slot AS "accountSlot",
  i.credential_id::text AS "credentialId",
  lr.state AS "lastRunState",lr.started_at AS "lastStartedAt",
  aa.run_id::text AS "activeRunId",aa.state AS "activeRunState",
  aa.unit_id AS "currentUnitId",aa.assigned_at AS "assignedAt",
  cr.full_name AS "currentProject",aa.expires_at AS "leaseExpiresAt",
  aa.last_heartbeat_at AS "lastHeartbeatAt",aa.lease_matches AS "leaseMatches",
  prior.full_name AS "previousProject",prior.unit_id AS "previousUnitId",
  prior.released_at AS "previousReleasedAt"
FROM identities i
LEFT JOIN LATERAL (
  SELECT run_id,state,started_at FROM agent_runs
  WHERE credential_id=i.credential_id ORDER BY started_at DESC,run_id DESC LIMIT 1
) lr ON TRUE
LEFT JOIN LATERAL (
  SELECT wa.repository_id,wa.run_id,wa.unit_id,wa.assigned_at,ar.state,
    l.expires_at,l.last_heartbeat_at,
    (l.run_id=wa.run_id AND l.generation=wa.lease_generation) AS lease_matches
  FROM work_assignments wa
  JOIN agent_runs ar ON ar.run_id=wa.run_id
  LEFT JOIN repository_leases l ON l.repository_id=wa.repository_id
  WHERE ar.credential_id=i.credential_id AND wa.released_at IS NULL
  ORDER BY wa.assigned_at DESC LIMIT 1
) aa ON TRUE
LEFT JOIN repositories cr ON cr.repository_id=aa.repository_id
LEFT JOIN LATERAL (
  SELECT r.full_name,wa.unit_id,wa.released_at
  FROM work_assignments wa JOIN agent_runs ar ON ar.run_id=wa.run_id
  JOIN repositories r ON r.repository_id=wa.repository_id
  WHERE ar.credential_id=i.credential_id AND wa.released_at IS NOT NULL
  ORDER BY wa.released_at DESC,wa.assignment_id DESC LIMIT 1
) prior ON TRUE
ORDER BY i.account_slot ASC NULLS FIRST,i.name ASC
`;

export type AgentActivityRow={
  name:string;provider:string;accountEmail:string|null;accountSlot:number|null;credentialId:string|null;
  lastRunState:string|null;lastStartedAt:Date|null;
  activeRunId:string|null;activeRunState:string|null;currentUnitId:string|null;
  assignedAt:Date|null;currentProject:string|null;leaseExpiresAt:Date|null;
  lastHeartbeatAt:Date|null;leaseMatches:boolean|null;previousProject:string|null;
  previousUnitId:string|null;previousReleasedAt:Date|null;
};
export type AgentActivityState="NOT REGISTERED"|"IDLE"|"ARRIVED"|"RUNNING"|"RECOVERING"|"UNKNOWN";
export function classifyAgentActivity(row:AgentActivityRow,now=Date.now()):AgentActivityState{
  if(!row.credentialId)return "NOT REGISTERED";
  if(row.activeRunId){
    if(!row.leaseMatches)return "UNKNOWN";
    const status=classifyLease({runId:row.activeRunId,runState:row.activeRunState,
      leaseExpiresAt:row.leaseExpiresAt?.toISOString()??null,
      lastHeartbeatAt:row.lastHeartbeatAt?.toISOString()??null},now);
    return status==="UNASSIGNED"?"UNKNOWN":status;
  }
  if(row.lastRunState==="ADMITTED")return "ARRIVED";
  if(row.lastRunState==="RECOVERING"||row.lastRunState==="UNKNOWN")return "UNKNOWN";
  return "IDLE";
}
export async function getAgentActivity(db:Pool):Promise<{observedAt:string;agents:AgentActivityRow[]}>{
  const now=new Date();
  const result=await db.query<AgentActivityRow>(AGENT_ACTIVITY_QUERY);
  return {observedAt:now.toISOString(),agents:result.rows};
}
