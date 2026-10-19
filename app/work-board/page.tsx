import OwnerNavigation from "../owner-navigation";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {classifyLease,formatEastern} from "../../src/domain/work-board";
import RepositorySyncControls from "./repository-sync-controls";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type WorkBoardRow={
  repositoryId:string;fullName:string;description:string|null;enabled:boolean;archived:boolean;
  priorityPosition:number|null;lastDevelopmentAt:Date|null;createdAt:Date;
  runId:string|null;runState:string|null;agentName:string|null;provider:string|null;
  leaseExpiresAt:Date|null;lastHeartbeatAt:Date|null;lastGitHubWriteAt:Date|null;unitId:string|null;
  planStatus:string|null;planRefreshedAt:Date|null;openUnitCount:string;
  planError:string|null;
};

async function loadBoard():Promise<{rows:WorkBoardRow[];observedAt:number}>{
  const observedAt=Date.now();
  const rows=await getDatabase().query<WorkBoardRow>(
    `SELECT r.repository_id::text AS "repositoryId",r.full_name AS "fullName",r.description AS "description",
      r.enabled AS "enabled",r.archived AS "archived",p.position AS "priorityPosition",
      r.last_development_at AS "lastDevelopmentAt",r.created_at AS "createdAt",
      l.run_id::text AS "runId",ar.state AS "runState",ac.label AS "agentName",ar.provider AS "provider",
      l.expires_at AS "leaseExpiresAt",l.last_heartbeat_at AS "lastHeartbeatAt",wa.unit_id AS "unitId",
      activity.last_github_write_at AS "lastGitHubWriteAt",
      rs.plan_status AS "planStatus",rs.last_success_at AS "planRefreshedAt",rs.last_error AS "planError",
      COALESCE(work.open_count,0)::text AS "openUnitCount"
     FROM repositories r
     LEFT JOIN repository_priority p ON p.repository_id=r.repository_id
     LEFT JOIN repository_leases l ON l.repository_id=r.repository_id
     LEFT JOIN agent_runs ar ON ar.run_id=l.run_id
     LEFT JOIN agent_credentials ac ON ac.credential_id=ar.credential_id
     LEFT JOIN work_assignments wa ON wa.repository_id=r.repository_id AND wa.run_id=l.run_id
       AND wa.lease_generation=l.generation AND wa.released_at IS NULL
     LEFT JOIN LATERAL (
       SELECT MAX(a.occurred_at) AS last_github_write_at FROM audit_events a
       WHERE a.run_id=l.run_id AND a.repository_id=r.repository_id AND a.kind LIKE 'github.write.%'
     ) activity ON TRUE
     LEFT JOIN repository_sync_status rs ON rs.repository_id=r.repository_id
     LEFT JOIN (
       SELECT repository_id,COUNT(*) FILTER (WHERE approved=TRUE AND state IN ('PENDING','ACTIVE','OPEN_PR')) AS open_count
       FROM roadmap_units GROUP BY repository_id
     ) work ON work.repository_id=r.repository_id
     ORDER BY CASE WHEN p.position IS NULL THEN 1 ELSE 0 END,
       p.position ASC NULLS LAST,
       COALESCE(r.last_development_at,r.created_at) ASC,r.repository_id ASC`
  );
  return {rows:rows.rows,observedAt};
}

export default async function WorkBoardPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const {rows,observedAt}=await loadBoard();
  const statusOf=(r:WorkBoardRow)=>!r.enabled||r.archived?"DISABLED":classifyLease({
    runId:r.runId,runState:r.runState,
    leaseExpiresAt:r.leaseExpiresAt?.toISOString()??null,
    lastHeartbeatAt:r.lastHeartbeatAt?.toISOString()??null
  },observedAt);
  const active=rows.filter(r=>statusOf(r)==="RUNNING").length;
  const attention=rows.filter(r=>["RECOVERING","UNKNOWN"].includes(statusOf(r))).length;
  return <main className="owner-shell work-board-shell">
    <OwnerNavigation section="LIVE WORK BOARD" title="Repository assignments" activePath="/work-board"/>
    <p>This board shows recorded named-agent assignments and GitHub reconciliation evidence, not unverified claims of completed work. A heartbeat or active lease alone does not prove that code is progressing.</p>
    <div className="summary-strip"><strong>{active}</strong> active leases <span>·</span><strong>{attention}</strong> need recovery or verification <span>·</span><strong>{rows.length}</strong> repositories</div>
    <RepositorySyncControls/>
    {rows.length===0?<section className="action-card"><h2>No registered repositories</h2><p>The GitHub inventory sync must populate Neon before the board can show actual assignments.</p></section>:
      <section className="work-grid" aria-label="Repository status cards">
        {rows.map(r=>{
          const status=statusOf(r);
          return <article key={r.repositoryId} className="work-card">
            <div className="card-top"><span className="action-type">{r.priorityPosition!==null?`PRIORITY #${r.priorityPosition}`:"ORDINARY QUEUE"}</span><span className="status-label">{status}</span></div>
            <h2><a href={`https://github.com/${r.fullName}`} target="_blank" rel="noopener noreferrer">{r.fullName}</a></h2>
            {r.description&&<p>{r.description}</p>}
            <dl className="work-details">
              <dt>Assigned agent</dt><dd>{r.agentName||"None verified"}{r.provider?` · ${r.provider}`:""}</dd>
              <dt>Current work unit</dt><dd>{r.unitId||"None recorded"}</dd>
              <dt>Approved open units</dt><dd>{r.openUnitCount}</dd>
              <dt>Last verified development</dt><dd>{formatEastern(r.lastDevelopmentAt?.toISOString()??null)}</dd>
              <dt>Heartbeat</dt><dd>{formatEastern(r.lastHeartbeatAt?.toISOString()??null)}</dd>
              <dt>Last recorded GitHub write</dt><dd>{formatEastern(r.lastGitHubWriteAt?.toISOString()??null)}</dd>
              <dt>Roadmap source</dt><dd>{r.planStatus||"Not reconciled"}</dd>
              {r.planStatus==="ERROR"&&<><dt>Plan validation</dt><dd>GitHub reconciliation failed ({r.planError||"unclassified"}). Verify the canonical registry and repository access, then refresh.</dd></>}
              {r.planStatus==="MISSING"&&<><dt>Plan availability</dt><dd>No verified canonical PR plan is available. This is not a failed lease or an active development assignment.</dd></>}
              <dt>Last plan reconciliation</dt><dd>{formatEastern(r.planRefreshedAt?.toISOString()??null)}</dd>
            </dl>
            {status==="RECOVERING"||status==="UNKNOWN"?<p role="status" className="work-warning">Execution health is unverified. Do not assume this repository can be reassigned until recovery/fencing succeeds.</p>:null}
          </article>;
        })}
      </section>}
  </main>;
}

