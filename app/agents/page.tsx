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
        <Link className="priority-nav" href="/observatory">Usage observatory</Link>
        <Link className="priority-nav" href="/system">System status</Link>
        <Link className="priority-nav" href="/logical-agents">Future API agents</Link>
        <Link className="priority-nav" href="/launch">Five-agent launch</Link>
      </nav>
    </header>
    <p>Choose a stable approved name for each separate scheduled activation source. Every task uses the same instructions; its connected identity supplies the name. Boardroom verifies that identity independently of the prompt. Follow the <Link href="/launch">five-agent launch checklist</Link> to connect and test each worker.</p>
    <AgentAdminControls initialAgents={agents} approvedNames={roster.names}/>
  </main>;
}
