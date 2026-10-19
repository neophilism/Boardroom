import type {Pool} from "pg";
import {classifyLease} from "../domain/work-board.ts";
import {activityCursor} from "../domain/agent-activity.ts";

export type ProfileIdentity={credentialId:string;name:string;provider:string;enabled:boolean;createdAt:Date;revokedAt:Date|null};
export type ProfileRun={runId:string;state:string;startedAt:Date;lastSeenAt:Date;endedAt:Date|null;
  repository:string|null;unitId:string|null;leaseExpiresAt:Date|null};
export type ProfileEvent={eventId:string;kind:string;occurredAt:Date;runId:string;repository:string|null;
  unitId:string|null;outcome:string|null;branch:string|null;commitSha:string|null;prNumber:string|null;
  paths:unknown;threadId:string|null;actionId:string|null};
export type ProfileCheckpoint={checkpointId:string;createdAt:Date;repository:string|null;unitId:string;
  branch:string;headSha:string|null};
export type ProfileCoffee={threadId:string;createdAt:Date;subject:string;repository:string|null};
export type ProfileUsage={hostedCalls:number;inputTokens:string;outputTokens:string;microUsd:string};
export type AgentProfile={identity:ProfileIdentity;runs:ProfileRun[];events:ProfileEvent[];
  checkpoints:ProfileCheckpoint[];coffee:ProfileCoffee[];usage:ProfileUsage;
  nextBefore:string|null;observedAt:Date};

/** Only existing owner-only records, read in bounded queries on demand. No AI or GitHub requests. */
export async function getAgentProfile(db:Pool,id:string,before:string|null):Promise<AgentProfile|null>{
  const found=await db.query<ProfileIdentity>(
    'SELECT credential_id::text AS "credentialId",label AS name,provider,enabled,created_at AS "createdAt",revoked_at AS "revokedAt" FROM agent_credentials WHERE credential_id=$1::uuid',[id]);
  const identity=found.rows[0];
  if(!identity)return null;
  const cursor=activityCursor(before);
  const [runs,events,checkpoints,coffee,usage]=await Promise.all([
    db.query<ProfileRun>([
      'SELECT ar.run_id::text AS "runId",ar.state,ar.started_at AS "startedAt",',
      'ar.last_seen_at AS "lastSeenAt",ar.ended_at AS "endedAt",',
      'a.full_name AS repository,a.unit_id AS "unitId",l.expires_at AS "leaseExpiresAt"',
      'FROM agent_runs ar',
      'LEFT JOIN LATERAL (SELECT rr.full_name,wa.unit_id FROM work_assignments wa',
      'JOIN repositories rr ON rr.repository_id=wa.repository_id',
      'WHERE wa.run_id=ar.run_id ORDER BY wa.assigned_at DESC LIMIT 1) a ON TRUE',
      'LEFT JOIN repository_leases l ON l.run_id=ar.run_id',
      'WHERE ar.credential_id=$1::uuid ORDER BY ar.started_at DESC LIMIT 25'
    ].join(" "),[id]),
    db.query<ProfileEvent>([
      'SELECT e.event_id::text AS "eventId",e.kind,e.occurred_at AS "occurredAt",',
      'e.run_id::text AS "runId",rr.full_name AS repository,',
      'e.details->>\'unitId\' AS "unitId",e.details->>\'outcome\' AS outcome,',
      'e.details->\'result\'->>\'branch\' AS branch,',
      'e.details->\'result\'->>\'commitSha\' AS "commitSha",',
      'e.details->\'result\'->>\'number\' AS "prNumber",',
      'CASE WHEN jsonb_typeof(e.details->\'paths\')=\'array\' THEN e.details->\'paths\' ELSE \'[]\'::jsonb END AS paths,',
      'e.details->>\'threadId\' AS "threadId",e.details->>\'actionId\' AS "actionId"',
      'FROM audit_events e JOIN agent_runs ar ON ar.run_id=e.run_id',
      'LEFT JOIN repositories rr ON rr.repository_id=e.repository_id',
      'WHERE ar.credential_id=$1::uuid AND ($2::bigint IS NULL OR e.event_id<$2::bigint)',
      'ORDER BY e.event_id DESC LIMIT 76'
    ].join(" "),[id,cursor]),
    db.query<ProfileCheckpoint>([
      'SELECT cp.checkpoint_id::text AS "checkpointId",cp.created_at AS "createdAt",',
      'rr.full_name AS repository,cp.unit_id AS "unitId",cp.branch,cp.head_sha AS "headSha"',
      'FROM checkpoints cp JOIN agent_runs ar ON ar.run_id=cp.run_id',
      'LEFT JOIN repositories rr ON rr.repository_id=cp.repository_id',
      'WHERE ar.credential_id=$1::uuid ORDER BY cp.created_at DESC LIMIT 20'
    ].join(" "),[id]),
    db.query<ProfileCoffee>([
      'SELECT m.thread_id::text AS "threadId",m.created_at AS "createdAt",t.subject,rr.full_name AS repository',
      'FROM coffee_messages m JOIN agent_runs ar ON ar.run_id=m.author_run_id',
      'JOIN coffee_threads t ON t.thread_id=m.thread_id',
      'LEFT JOIN repositories rr ON rr.repository_id=t.repository_id',
      'WHERE ar.credential_id=$1::uuid ORDER BY m.created_at DESC LIMIT 12'
    ].join(" "),[id]),
    db.query<ProfileUsage>([
      'SELECT count(*)::int AS "hostedCalls",',
      'COALESCE(sum(ue.input_tokens),0)::text AS "inputTokens",',
      'COALESCE(sum(ue.output_tokens),0)::text AS "outputTokens",',
      'COALESCE(sum(ue.cost_microusd),0)::text AS "microUsd"',
      'FROM usage_events ue JOIN agent_runs ar ON ar.run_id=ue.run_id',
      'WHERE ar.credential_id=$1::uuid AND ue.created_at>=now()-interval \'30 days\''
    ].join(" "),[id])
  ]);
  const hasMore=events.rows.length>75;
  const listed=events.rows.slice(0,75);
  return {identity,runs:runs.rows,events:listed,checkpoints:checkpoints.rows,
    coffee:coffee.rows,usage:usage.rows[0],observedAt:new Date(),
    nextBefore:hasMore?listed[listed.length-1].eventId:null};
}


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
