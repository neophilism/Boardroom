import Link from "next/link";
import {environmentReady} from "../../src/server/readiness";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default function SetupPage(){
  const configured=environmentReady(process.env);
  return <main className="owner-shell setup-shell">
    <p className="eyebrow">BOARDROOM / SYSTEM SETUP</p>
    <h1>{configured?"Owner configuration detected":"Boardroom needs secure configuration"}</h1>
    <p>This application has been deployed, but a running web server alone is not evidence that its private database, GitHub App, or autonomous development workflow is ready.</p>
    {!configured&&<section className="action-card">
      <h2>1. Connect Boardroom to its existing Neon database</h2>
      <p>In the Render service environment, set <code>DATABASE_URL</code> to the Boardroom project&apos;s pooled Neon connection string. Copy it directly between the trusted provider consoles; do not paste credentials into GitHub or a public discussion.</p>
      <p><a href="https://console.neon.tech/" target="_blank" rel="noopener noreferrer">Open Neon console</a></p>
    </section>}
    {!configured&&<section className="action-card">
      <h2>2. Configure owner access</h2>
      <p>Create three distinct random secrets of at least 32 characters and enter them directly in Render&apos;s secure environment settings:</p>
      <ul><li><code>BOARDROOM_OWNER_API_TOKEN</code></li><li><code>BOARDROOM_SESSION_SECRET</code></li><li><code>BOARDROOM_TOKEN_PEPPER</code></li></ul>
      <p>Do not include these values in a scheduled agent&apos;s name or prompt.</p>
    </section>}
    <section className="action-card">
      <h2>3. Install a scoped GitHub App</h2>
      <p>Give the Boardroom GitHub App the minimum repository permissions specified in the deployment runbook. Configure its App ID, installation ID and private key only in Render&apos;s protected environment. This is necessary before real repository inventory and code-writing operations can work.</p>
    </section>
    <div className="setup-links">
      <a className="priority-nav" href="https://dashboard.render.com/web/srv-db6jnrlg1s2s739jt9ug" target="_blank" rel="noopener noreferrer">Open Boardroom settings on Render</a>
      <Link className="priority-nav" href="/login">Owner sign-in</Link>
      <Link className="priority-nav" href="/api/ready">Check backend readiness</Link>
    </div>
    <p className="fineprint">No secret values or private owner tasks are exposed on this public setup page. Readiness checks only cover current core configuration and schema; they do not claim that scheduled-task integration or safe autonomous development has been proven.</p>
  </main>;
}
