import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {getUsageObservatory} from "../../src/server/usage-observatory";
import ObservatoryPanel from "./panel";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export default async function ObservatoryPage(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const data=await getUsageObservatory(getDatabase());
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / AGENT INTELLIGENCE</p><h1>Usage observatory</h1></div>
      <nav className="work-nav" aria-label="Other owner views">
        <Link className="priority-nav" href="/operations">Operations</Link>
        <Link className="priority-nav" href="/agents">Agents</Link>
        <Link className="priority-nav" href="/work-board">Work board</Link>
        <Link className="priority-nav" href="/reports">Reports</Link>
      </nav>
    </header>
    <p>Measured Boardroom session activity, GitHub-verified work and token-priced hosted API estimates. Native ChatGPT Work credit balances and reasoning settings are not available from the Boardroom connection.</p>
    <ObservatoryPanel data={data}/>
  </main>;
}
