import type {Pool} from "pg";
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
