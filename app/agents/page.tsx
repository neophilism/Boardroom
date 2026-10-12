import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import roster from "../../registry/agent-names.json";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {listRegisteredAgents} from "../../src/server/agent-registration";
import AgentAdminControls from "./controls";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function AgentAdministrationPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const agents=await listRegisteredAgents(getDatabase());
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / AGENT IDENTITIES</p><h1>Scheduled agents</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views">
        <Link className="priority-nav" href="/owner-actions">Owner actions</Link>
        <Link className="priority-nav" href="/work-board">Work Board</Link>
        <Link className="priority-nav" href="/priorities">Priorities</Link>
        <Link className="priority-nav" href="/coffee">Coffee Corner</Link>
      </nav>
    </header>
    <p>Choose a stable approved name for each separate scheduled activation source. Every task may use the same instructions, apart from the name. Boardroom verifies names using separately registered credentials; saying a name never grants access.</p>
    <AgentAdminControls initialAgents={agents} approvedNames={roster.names}/>
  </main>;
}
