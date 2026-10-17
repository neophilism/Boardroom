import type {Pool} from "pg";

export const NAMED_AGENT_LAUNCH_QUERY = `SELECT c.credential_id AS "credentialId",c.label AS name,c.provider,c.account_email AS "accountEmail",
  EXISTS(SELECT 1 FROM oauth_grants g JOIN oauth_tokens t ON t.grant_id=g.grant_id
    WHERE g.credential_id=c.credential_id AND g.revoked_at IS NULL
      AND t.consumed_at IS NULL AND t.expires_at>now()) AS "connected",
  (SELECT count(*)::integer FROM agent_runs ar WHERE ar.credential_id=c.credential_id) AS "activations",
  (SELECT count(*)::integer FROM work_assignments wa JOIN agent_runs ar ON ar.run_id=wa.run_id
    WHERE ar.credential_id=c.credential_id) AS assignments,
  (SELECT max(ar.started_at) FROM agent_runs ar WHERE ar.credential_id=c.credential_id) AS "lastActivationAt"
  FROM agent_credentials c WHERE c.enabled=TRUE AND c.revoked_at IS NULL ORDER BY c.label`;

export type LaunchAgent={credentialId:string;name:string;provider:string;accountEmail:string|null;connected:boolean;
  activations:number;assignments:number;lastActivationAt:Date|null};
export type LaunchStatus={agents:LaunchAgent[];paused:boolean;lastMaintenanceAt:Date|null;verifiedPlanRepositories:number;
  automaticMergeRepositories:number;recordedIntegrationGates:string[];observedAt:string};

/** Read observations only. A grant or session never certifies scheduled work. */
export async function getLaunchStatus(db:Pool):Promise<LaunchStatus>{
  const [agents,configuration,gates]=await Promise.all([
    db.query<LaunchAgent>(NAMED_AGENT_LAUNCH_QUERY),
    db.query<{paused:boolean;plans:number;merges:number;maintenanceAt:Date|null}>(`SELECT
      COALESCE((SELECT paused FROM execution_controls WHERE singleton=TRUE),TRUE) AS paused,
      (SELECT max(occurred_at) FROM audit_events WHERE kind='maintenance.tick.completed') AS "maintenanceAt",
      (SELECT count(*)::integer FROM repositories r JOIN repository_sync_status s USING(repository_id)
        WHERE r.enabled=TRUE AND r.archived=FALSE AND s.plan_status='VERIFIED'
          AND EXISTS(SELECT 1 FROM roadmap_units w WHERE w.repository_id=r.repository_id AND w.approved=TRUE)) AS plans,
      (SELECT count(*)::integer FROM repository_execution_policy p JOIN repositories r USING(repository_id)
        WHERE r.enabled=TRUE AND r.archived=FALSE AND p.auto_merge=TRUE
          AND jsonb_array_length(p.required_checks)>0) AS merges`),
    db.query<{gate:string}>("SELECT gate FROM integration_evidence ORDER BY gate")
  ]);
  const config=configuration.rows[0];
  if(!config)throw new Error("Launch configuration unavailable");
  return {agents:agents.rows,paused:config.paused,lastMaintenanceAt:config.maintenanceAt??null,verifiedPlanRepositories:config.plans,
    automaticMergeRepositories:config.merges,recordedIntegrationGates:gates.rows.map(g=>g.gate),
    observedAt:new Date().toISOString()};
}
