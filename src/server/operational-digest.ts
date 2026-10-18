import type {Pool} from "pg";
import {recordedGitHubActivity,actionAge} from "../domain/operational-digest.ts";
import {deploymentRevision} from "../domain/deployment-revision.ts";
import {checkReadiness} from "./readiness.ts";

/** A private read-only report. Outcomes are model/session reports; only gateway
 * receipts are presented as observed GitHub operations. No notification sends. */
export async function getOperationalDigest(db:Pool,env:NodeJS.ProcessEnv,observedAt=new Date()){
  const since=new Date(observedAt.getTime()-86400000);
  const [events,outcomes,actions,queue,usage,priorities,ready]=await Promise.all([
    db.query<{kind:string;repository:string|null;details:unknown;occurredAt:Date}>(
      `SELECT a.kind,r.full_name AS repository,a.details,a.occurred_at AS "occurredAt"
       FROM audit_events a LEFT JOIN repositories r ON r.repository_id=a.repository_id
       WHERE a.occurred_at>=$1 AND a.occurred_at<=$2 AND a.kind IN
       ('github.write.upsert_file','github.write.commit_files','github.write.open_draft_pr','github.write.ready_pr','github.pr.merged')
       ORDER BY a.occurred_at DESC,a.event_id DESC LIMIT 200`,[since,observedAt]),
    db.query<{state:string;count:number}>("SELECT state,COUNT(*)::integer AS count FROM agent_runs WHERE started_at>=$1 AND started_at<=$2 GROUP BY state ORDER BY state",[since,observedAt]),
    db.query<{actionId:string;title:string;type:string;status:string;createdAt:Date;affectedRepositories:number}>(
      `SELECT a.action_id::text AS "actionId",a.title,a.action_type AS type,a.status,a.created_at AS "createdAt",
       (SELECT COUNT(*)::integer FROM owner_action_dependents d WHERE d.action_id=a.action_id) AS "affectedRepositories"
       FROM owner_actions a WHERE a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
       ORDER BY a.created_at,a.action_id LIMIT 250`),
    db.query<{recoveryHolds:number;failedJobs:number;retryingJobs:number;staleSources:number}>(
      `SELECT (SELECT COUNT(*)::integer FROM repository_leases l JOIN agent_runs a ON a.run_id=l.run_id
        WHERE a.state IN ('RECOVERING','UNKNOWN') OR l.expires_at<=now()) AS "recoveryHolds",
       (SELECT COUNT(*)::integer FROM operation_outbox WHERE state='FAILED') AS "failedJobs",
       (SELECT COUNT(*)::integer FROM operation_outbox WHERE state='RETRY') AS "retryingJobs",
       (SELECT COUNT(*)::integer FROM repositories WHERE enabled AND NOT archived
        AND (source_observed_at IS NULL OR source_observed_at<now()-interval '1 hour')) AS "staleSources"`),
    db.query<{tokens:string;chargedMicroUsd:string;unsettledMicroUsd:string}>(
      `SELECT (SELECT COALESCE(SUM(input_tokens+output_tokens),0)::text FROM usage_events WHERE created_at>=$1 AND created_at<=$2) AS tokens,
       (SELECT COALESCE(SUM(cost_microusd),0)::text FROM usage_events WHERE created_at>=$1 AND created_at<=$2) AS "chargedMicroUsd",
       (SELECT COALESCE(SUM(reserved_microusd),0)::text FROM runner_budget_reservations
        WHERE state='RESERVED' AND created_at>=$1 AND created_at<=$2) AS "unsettledMicroUsd"`,[since,observedAt]),
    db.query<{repository:string;position:number;planStatus:string|null;sourceObservedAt:Date|null}>(
      `SELECT r.full_name AS repository,p.position,s.plan_status AS "planStatus",r.source_observed_at AS "sourceObservedAt"
       FROM repository_priority p JOIN repositories r ON r.repository_id=p.repository_id
       LEFT JOIN repository_sync_status s ON s.repository_id=r.repository_id WHERE r.enabled AND NOT r.archived ORDER BY p.position LIMIT 20`),
    checkReadiness(db,env)
  ]);
  const activity=events.rows.map(recordedGitHubActivity).filter(x=>x!==null);
  return {
    observedAt:observedAt.toISOString(),since:since.toISOString(),
    deployment:{revision:deploymentRevision(env),ready},
    activity,activityMayBeTruncated:events.rows.length===200,
    reportedSessionOutcomes:outcomes.rows,
    ownerActions:actions.rows.map(a=>({...a,createdAt:a.createdAt.toISOString(),...actionAge(a.createdAt,observedAt),href:"/owner-actions#action-"+a.actionId})),
    actionsMayBeTruncated:actions.rows.length===250,
    queue:queue.rows[0],reportedUsage:usage.rows[0],
    priorities:priorities.rows.map(p=>({...p,sourceObservedAt:p.sourceObservedAt?.toISOString()??null})),
    provenance:"GitHub gateway receipts and current private coordination records; session outcomes do not establish work acceptance"
  };
}
