import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {getSystemStatus} from "../../src/server/system-status";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function BoardroomSystemPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const system=await getSystemStatus(getDatabase(),process.env);
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / OPERATIONAL STATUS</p><h1>System connections</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views">
        <Link className="priority-nav" href="/owner-actions">Owner actions</Link>
        <Link className="priority-nav" href="/work-board">Work Board</Link>
        <Link className="priority-nav" href="/agents">Scheduled agents</Link>
      </nav>
    </header>
    <p>These are live server-side connection checks. This page never displays credentials, private keys, or fake development activity. Green infrastructure checks do not imply that scheduled agents are working.</p>
    <div className="work-grid">
      <section className="work-card">
        <div className="card-top"><strong>Neon database</strong><span className="status-label">{system.database.migrationsReady?"VERIFIED":system.database.connected?"INCOMPLETE":"UNAVAILABLE"}</span></div>
        <h2>{system.database.connected?"Database connected":"Database unavailable"}</h2>
        <p>{system.database.migrationsReady?"All required initial schema migrations are recorded.":"Required database settings or migrations are missing. Check Render Environment and Neon."}</p>
        <p><strong>{system.database.repositories}</strong> repositories imported · <strong>{system.database.registeredAgents}</strong> named agents · <strong>{system.database.openOwnerActions}</strong> outstanding owner actions</p>
      </section>
      <section className="work-card">
        <div className="card-top"><strong>GitHub App</strong><span className="status-label">{system.github.verifiedConnected?"VERIFIED":"NEEDS SETUP"}</span></div>
        <h2>{system.github.verifiedConnected?"GitHub installation authenticated":"GitHub installation not verified"}</h2>
        <p>{!system.github.configured?"Add the Boardroom GitHub App ID, installation ID and private key to Render's secure environment.":system.github.verifiedConnected?
          "Authenticated as an installation. A repository import is still needed to populate Boardroom.":
          "GitHub App configuration exists but could not be authenticated with the installation API."}</p>
        {system.github.visibleRepositories!==null&&<p>Repositories visible to this installation: <strong>{system.github.visibleRepositories}</strong></p>}
      </section>
      <section className="work-card">
        <div className="card-top"><strong>Unattended development</strong><span className="status-label">NOT VERIFIED</span></div>
        <h2>Scheduled-task integration pending</h2>
        <p>Neither a real ChatGPT scheduled Work run nor its authenticated code-write and safe release has been verified. Boardroom will not claim autonomous operation based on CI or deployment status alone.</p>
      </section>
    </div>
    <div className="setup-links">
      <Link className="priority-nav" href="/system">Recheck connections</Link>
      <Link className="priority-nav" href="/owner-actions">View required owner actions</Link>
      <a className="priority-nav" target="_blank" rel="noopener noreferrer" href="https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug">Render environment</a>
    </div>
  </main>;
}
