import OwnerNavigation from "../owner-navigation";
import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {getSystemStatus} from "../../src/server/system-status";
import VerifySetup from "./verify-controls";
import {githubDiagnosticHint} from "../../src/domain/github-setup-hints";
import {oauthEnabled} from "../../src/server/oauth-contract";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function BoardroomSystemPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const system=await getSystemStatus(getDatabase(),process.env);
  return <main className="owner-shell">
    <OwnerNavigation section="OPERATIONAL STATUS" title="System connections" activePath="/system"/>
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
        <p>{!system.github.configured?"Add the Boardroom GitHub App ID, installation ID and private key to Render secure environment.":system.github.verifiedConnected?
          "GitHub App authenticated with the necessary source, PR, CI and Actions permissions. Import repositories to populate Boardroom.":
          system.github.visibleRepositories===0?
          "GitHub App authenticated but has no authorized repositories. Add repository access under its installation settings.":
          system.github.missingPermissions.length?
          "GitHub App is missing required permissions. Update permissions and accept the revised installation permissions on GitHub.":
          "GitHub App configuration exists but could not be authenticated with the installation API."}</p>
        {system.github.missingPermissions.length>0&&<p><strong>Required permissions to add:</strong> {system.github.missingPermissions.join(", ")}</p>}
        {!system.github.verifiedConnected&&system.github.issueCode&&<p role="status"><strong>Connection diagnosis:</strong> {githubDiagnosticHint(system.github.issueCode)}</p>}
        {system.github.visibleRepositories!==null&&<p>Repositories visible to this installation: <strong>{system.github.visibleRepositories}</strong></p>}
      </section>
      <section className="work-card">
        <div className="card-top"><strong>Unattended development</strong><span className="status-label">NOT VERIFIED</span></div>
        <h2>Scheduled-task integration pending</h2>
        <p>Native ChatGPT connection: {oauthEnabled()?"OAuth is enabled; connect and test a named agent.":"OAuth is disabled. Enable BOARDROOM_OAUTH_ENABLED only when ready to authorize the native connection."}</p>
        <p>Neither a real ChatGPT scheduled Work run nor its authenticated code-write and safe release has been verified. Boardroom will not claim autonomous operation based on CI or deployment status alone.</p>
      </section>
    </div>
    <VerifySetup/>
    <div className="setup-links">
      <Link className="priority-nav" href="/system">Recheck connections</Link>
      <Link className="priority-nav" href="/owner-actions">View required owner actions</Link>
      <a className="priority-nav" target="_blank" rel="noopener noreferrer" href="https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug">Render environment</a>
    </div>
  </main>;
}
