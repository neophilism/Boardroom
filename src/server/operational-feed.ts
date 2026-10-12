import type {Pool} from "pg";
import {authorizedWatchdogToken} from "./watchdog.ts";
export const authorizedOperationalFeed=authorizedWatchdogToken;
export async function operationalFeed(db:Pool){
  const stats=await db.query(`SELECT
    (SELECT COUNT(*)::integer FROM repositories WHERE enabled=TRUE AND archived=FALSE) AS "registeredRepositories",
    (SELECT COUNT(*)::integer FROM agent_runs WHERE state='RUNNING') AS "runningSessions",
    (SELECT COUNT(*)::integer FROM agent_runs WHERE state IN ('RECOVERING','UNKNOWN')) AS "recoveryHolds",
    (SELECT COUNT(*)::integer FROM owner_actions WHERE status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')) AS "ownerBlockers",
    (SELECT MAX(occurred_at) FROM audit_events WHERE kind LIKE 'github.%') AS "lastObservedGitHubOperation"`);
  return {version:1,service:"boardroom",observedAt:new Date().toISOString(),...stats.rows[0],
    progressSource:"GitHub independently owns roadmap/PR progress",sensitiveDetailsExcluded:true};
}
