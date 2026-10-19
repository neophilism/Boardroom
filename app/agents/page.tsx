import OwnerNavigation from "../owner-navigation";
import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import roster from "../../registry/agent-names.json";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {listRegisteredAgents} from "../../src/server/agent-registration";
import {listReservedAgentNames} from "../../src/server/agent-activity";
import AgentAdminControls from "./controls";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function AgentAdministrationPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const [agents,reservations]=await Promise.all([listRegisteredAgents(getDatabase()),listReservedAgentNames(getDatabase())]);
  return <main className="owner-shell">
    <OwnerNavigation section="AGENT IDENTITIES" title="Scheduled agents" activePath="/agents"/>
    <p>Record the provider account email privately so you can identify which account runs each agent. The email can be edited without revoking its credential. Choose a stable approved name for each separate scheduled activation source. Every task uses the same instructions; its connected identity supplies the name. Boardroom verifies that identity independently of the prompt. Follow the <Link href="/launch">five-agent launch checklist</Link> to connect and test each worker.</p>
    <AgentAdminControls initialAgents={agents} approvedNames={roster.names} reservations={reservations}/>
  </main>;
}
