import {cookies} from "next/headers";
import Link from "next/link";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {getRecoveryOverview} from "../../src/server/recovery-overview";
import {formatEastern} from "../../src/domain/work-board";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function RecoveryPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const entries=await getRecoveryOverview(getDatabase());
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / SAFE RECOVERY</p><h1>Stalled session review</h1></div>
      <nav className="work-nav">
        <Link className="priority-nav" href="/work-board">Work Board</Link>
        <Link className="priority-nav" href="/owner-actions">Owner actions</Link>
      </nav>
    </header>
    <p>This page identifies repositories whose previous execution needs fencing or human verification. Expired heartbeats cannot, by themselves, prove that an agent has stopped. No controls on this page release a lease.</p>
    <div className="summary-strip"><strong>{entries.length}</strong> sessions requiring review</div>
    {entries.length===0?<section className="action-card"><h2>No recovery holds found</h2><p>The watchdog must be securely scheduled before this can be treated as active monitoring.</p></section>:
      <section className="work-grid">{entries.map(e=><article key={e.repositoryId} className="work-card">
        <div className="card-top"><span className="status-label">{e.runState}</span><span>Generation {e.leaseGeneration}</span></div>
        <h2>{e.repository}</h2>
        <dl className="work-details">
          <dt>Named agent</dt><dd>{e.agentName??"Unverified"}{e.provider?` · ${e.provider}`:""}</dd>
          <dt>Work unit</dt><dd>{e.workUnitId??"None recorded"}</dd>
          <dt>Run ID</dt><dd><code>{e.runId}</code></dd>
          <dt>Lease expiry</dt><dd>{formatEastern(e.leaseExpiredAt.toISOString())}</dd>
          <dt>Last heartbeat</dt><dd>{formatEastern(e.lastHeartbeatAt?.toISOString()??null)}</dd>
          <dt>Owner request</dt><dd>{e.ownerActionStatus??"Not created yet"}</dd>
        </dl>
        <p className="work-warning">Hold repository assignment until the former worker is proven terminated or its write capability is fenced.</p>
        {e.ownerActionId&&<Link className="priority-nav" href="/owner-actions">Review owner request</Link>}
      </article>)}</section>}
    {entries.length>=200&&<p>Showing the first 200 records. Investigate using audit evidence for additional sessions.</p>}
  </main>;
}
