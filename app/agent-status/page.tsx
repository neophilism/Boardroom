import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getDatabase} from "../../src/server/db";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getAgentActivity,classifyAgentActivity} from "../../src/server/agent-activity";
import {formatEastern} from "../../src/domain/work-board";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;

export default async function AgentStatusPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const snapshot=await getAgentActivity(getDatabase());
  const now=Date.parse(snapshot.observedAt);
  const running=snapshot.agents.filter(r=>classifyAgentActivity(r,now)==="RUNNING").length;
  const held=snapshot.agents.filter(r=>["RECOVERING","UNKNOWN"].includes(classifyAgentActivity(r,now))).length;
  return <main className="owner-shell">
    <header className="owner-header"><div><p className="eyebrow">BOARDROOM / AGENT ASSIGNMENTS</p><h1>Who is working on what?</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views">
        <Link href="/agents">Manage agents</Link><Link href="/work-board">Work Board</Link>
        <Link href="/launch">Launch instructions</Link><Link href="/recovery">Recovery</Link>
      </nav>
    </header>
    <p>Snapshot as of {formatEastern(snapshot.observedAt)}. Nothing updates automatically: use Refresh to read current Boardroom database records. A recorded running lease does not prove code is actively being written.</p>
    <form method="get" action="/agent-status"><button type="submit">Refresh assignments</button></form>
    <div className="summary-strip"><strong>{running}</strong> current leases <span>·</span>
      <strong>{held}</strong> uncertain/recovering <span>·</span>
      <strong>{snapshot.agents.length}</strong> registered and reserved robots</div>
    <section className="action-card" style={{overflowX:"auto"}}>
      <h2>Robot assignments</h2>
      <table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
        <thead><tr><th scope="col">Robot</th><th scope="col">ChatGPT account</th><th scope="col">Status</th>
          <th scope="col">Current project</th><th scope="col">Work unit</th><th scope="col">Heartbeat</th></tr></thead>
        <tbody>{snapshot.agents.map(r=>{
          const state=classifyAgentActivity(r,now);
          const project=r.currentProject;
          const hasCurrent=Boolean(r.activeRunId&&project);
          return <tr key={r.credentialId??r.name} style={{borderTop:"1px solid var(--line, #8884)"}}>
            <th scope="row" style={{padding:"0.65rem 0.5rem"}}>{r.name}<div><small>{r.provider}</small></div></th>
            <td style={{padding:"0.65rem 0.5rem"}}>{r.accountEmail??(r.accountSlot?"Account "+r.accountSlot+" — email pending":"Email not recorded")}</td>
            <td style={{padding:"0.65rem 0.5rem"}}>{state}{r.lastStartedAt&&<div><small>Last arrival: {formatEastern(r.lastStartedAt.toISOString())}</small></div>}</td>
            <td style={{padding:"0.65rem 0.5rem"}}>{hasCurrent?
              <a href={`https://github.com/${project}`} target="_blank" rel="noopener noreferrer">{project}</a>:
              <span>No current assignment</span>}
              {!hasCurrent&&r.previousProject&&<div><small>Previous: {r.previousProject} ({formatEastern(r.previousReleasedAt?.toISOString()??null)})</small></div>}
            </td>
            <td style={{padding:"0.65rem 0.5rem"}}>{hasCurrent?(r.currentUnitId??"Not assigned a work unit"):"—"}</td>
            <td style={{padding:"0.65rem 0.5rem"}}>{hasCurrent?formatEastern(r.lastHeartbeatAt?.toISOString()??null):"—"}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>
    <p>If a lease is expired or uncertain, use <Link href="/recovery">Recovery</Link> rather than assuming another robot may take that project. Reserved names are not yet connected and do not consume run credits.</p>
  </main>;
}
