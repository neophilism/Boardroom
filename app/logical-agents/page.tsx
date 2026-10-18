import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {listLogicalAgents} from "../../src/server/logical-agents";
import LogicalAgentInventory from "./controls";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function LogicalAgentsPage(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const inventory=await listLogicalAgents(getDatabase(),null,30);
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / FUTURE API AGENTS</p><h1>Logical agent registry</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views">
        <Link className="priority-nav" href="/agents">Scheduled agents</Link>
        <Link className="priority-nav" href="/observatory">Usage observatory</Link>
        <Link className="priority-nav" href="/work-board">Work board</Link>
        <Link className="priority-nav" href="/operations">Operations</Link>
      </nav>
    </header>
    <p>Prepare future API workers without spending anything. Creating a logical agent only registers a dormant identity. It cannot call an API, run a schedule, access tools, or obtain credentials until separate verified authorization and spending controls are developed.</p>
    <LogicalAgentInventory initial={inventory}/>
  </main>;
}
