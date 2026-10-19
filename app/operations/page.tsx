import OwnerNavigation from "../owner-navigation";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {operationsOverview} from "../../src/server/operations";
import OperationsControls from "./controls";
export const dynamic="force-dynamic";
export default async function OperationsPage(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const info=await operationsOverview(getDatabase());
  return <main className="owner-shell"><OwnerNavigation section="OPERATIONS" title="Execution controls" activePath="/operations"/>
    <OperationsControls paused={info.paused} repositories={info.repositories}/>
    <h2>Maintenance queue</h2>
    <p>Server-observed queue operations, including coalesced requests. SUPERSEDED means deliberately skipped as redundant, not completed.</p>
    {info.outbox.length===0?<p>No maintenance operations are recorded.</p>:<div className="work-grid">{info.outbox.map((item,index)=><article className="action-card" key={index}>
      <h3>{item.operationType}</h3>
      <p>{item.state}: <strong>{item.count}</strong></p>
      {item.errorCode&&<p>Result code: {item.errorCode}</p>}
      <p>Oldest request: {item.oldestCreatedAt?new Date(item.oldestCreatedAt).toISOString():"Unavailable"}</p>
    </article>)}</div>}
    <h2>Repository synchronization</h2>
    <p>GitHub reconciliation timestamps, not agent self-reports. A repository without a successful sync cannot be assumed current.</p>
    {info.repositoryFreshness.length===0?<p>No enabled repositories recorded.</p>:<div className="work-grid">{info.repositoryFreshness.map(r=><article className="action-card" key={r.fullName}>
      <h3>{r.fullName}</h3><p>Plan status: {r.planStatus??"UNVERIFIED"}</p>
      <p>Last successful sync: {r.lastSuccessAt?new Date(r.lastSuccessAt).toISOString():"Never"}</p>
      {r.lastError&&<p>Last error: {r.lastError}</p>}
    </article>)}</div>}
    <h2>Sessions</h2>
    {info.runs.length===0?<p>No sessions have run.</p>:<div className="work-grid">{info.runs.map(r=><article className="action-card" key={r.run_id}>
      <h3>{r.label}</h3><p>{r.state} · {r.provider}</p><p>{r.full_name??"No active assignment"} {r.unit_id??""}</p><p>Last seen: {new Date(r.last_seen_at).toISOString()}</p>
    </article>)}</div>}
    <h2>Verified activity</h2>
    {info.audit.length===0?<p>No recorded events.</p>:<ul>{info.audit.map(e=><li key={String(e.event_id)}>{new Date(e.occurred_at).toISOString()} · {e.kind}</li>)}</ul>}
    <h2>Reported usage in the last 24 hours</h2><p>{info.last24HoursReportedUsage?.tokens??"0"} tokens · ${Number(info.last24HoursReportedUsage?.cost_microusd??0)/1000000}</p>
  </main>;
}

