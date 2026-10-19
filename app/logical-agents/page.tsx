import OwnerNavigation from "../owner-navigation";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
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
    <OwnerNavigation section="FUTURE API AGENTS" title="Logical agent registry" activePath="/logical-agents"/>
    <p>Prepare future API workers without spending anything. Creating a logical agent only registers a dormant identity. It cannot call an API, run a schedule, access tools, or obtain credentials until separate verified authorization and spending controls are developed.</p>
    <LogicalAgentInventory initial={inventory}/>
  </main>;
}
