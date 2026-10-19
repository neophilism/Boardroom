import OwnerNavigation from "../owner-navigation";
import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {getOperationalDigest} from "../../src/server/operational-digest";
import {formatEastern} from "../../src/domain/work-board";
export const dynamic="force-dynamic";
export default async function ReportsPage(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const report=await getOperationalDigest(getDatabase(),process.env);
  return <main className="owner-shell">
    <OwnerNavigation section="DAILY REPORT" title="Last 24 hours" activePath="/reports"/>
    <p>Observed {formatEastern(report.observedAt)}. This report gathers recorded GitHub activity, pending owner actions and operating problems. A session marked completed does not by itself establish accepted work.</p>
    <div className="summary-strip"><strong>{report.activity.length}</strong> GitHub operations <span>·</span><strong>{report.ownerActions.length}</strong> owner actions <span>·</span><strong>{report.queue?.recoveryHolds??0}</strong> recovery holds</div>
    <section className="work-card"><h2>Current release</h2><p>{report.deployment.ready?"Database readiness verified":"Readiness requires attention"}</p>
      {report.deployment.revision?<p>Serving revision <a href={`https://github.com/neophilism/Boardroom/commit/${report.deployment.revision}`} target="_blank" rel="noopener noreferrer"><code>{report.deployment.revision}</code></a></p>:<p>Deployment revision unavailable.</p>}
    </section>
    <h2>Recorded GitHub operations</h2>
    {report.activity.length===0?<p>No GitHub gateway receipts in this period.</p>:<div className="work-grid">{report.activity.map((a,i)=><article className="action-card" key={a.url+":"+i}>
      <div className="card-top"><strong>{a.kind.replaceAll("_"," ")}</strong><span>{formatEastern(a.observedAt)}</span></div><h3>{a.repository}</h3><p>{a.unitId??"Work unit unavailable"}</p>
      <a href={a.url} target="_blank" rel="noopener noreferrer">View GitHub evidence</a>{a.checksUrl&&<> · <a href={a.checksUrl} target="_blank" rel="noopener noreferrer">Inspect current checks</a></>}
    </article>)}</div>}
    {report.activityMayBeTruncated&&<p>Showing the most recent 200 receipts.</p>}
    <h2>Pending owner actions</h2>
    {report.ownerActions.length===0?<p>No pending owner actions.</p>:<div className="work-grid">{report.ownerActions.map(a=><article className="action-card" key={a.actionId}>
      <div className="card-top"><strong>{a.attention}</strong><span>{a.days} days waiting</span></div><h3><Link href={a.href}>{a.title}</Link></h3><p>{a.status} · {a.affectedRepositories} affected repositories</p>
    </article>)}</div>}
    {report.actionsMayBeTruncated&&<p>Showing the oldest 250 pending actions.</p>}
    <h2>Operating problems</h2><p>{report.queue?.failedJobs??0} failed reconciliation jobs · {report.queue?.retryingJobs??0} retrying jobs · {report.queue?.staleSources??0} repositories need fresh source checks.</p>
    <h2>Reported session outcomes</h2>{report.reportedSessionOutcomes.length?<ul>{report.reportedSessionOutcomes.map(s=><li key={s.state}>{s.state}: {s.count}</li>)}</ul>:<p>No sessions started in this period.</p>}
    <h2>Reported model usage</h2><p>{report.reportedUsage?.tokens??"0"} tokens · ${Number(report.reportedUsage?.chargedMicroUsd??0)/1000000} reported charges · ${Number(report.reportedUsage?.unsettledMicroUsd??0)/1000000} still reserved.</p>
    <h2>Owner priorities</h2>{report.priorities.length?<ol>{report.priorities.map(p=><li key={p.repository}>{p.repository} · plan {p.planStatus??"not reconciled"} · source checked {formatEastern(p.sourceObservedAt)}</li>)}</ol>:<p>No imported priority repositories.</p>}
  </main>;
}
