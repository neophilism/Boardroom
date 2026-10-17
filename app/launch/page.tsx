import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getDatabase} from "../../src/server/db";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getLaunchStatus} from "../../src/server/launch-status";
import {oauthEnabled} from "../../src/server/oauth-contract";
import SharedAgentInstruction from "./instruction";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function LaunchPage(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const status=await getLaunchStatus(getDatabase());
  const native=status.agents.filter(a=>a.provider==="chatgpt");
  const connected=native.filter(a=>a.connected).length;
  return <main className="owner-shell">
    <header className="owner-header"><div><p className="eyebrow">BOARDROOM / FIVE-AGENT LAUNCH</p><h1>Start scheduled development</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views"><Link href="/system">System connections</Link><Link href="/agents">Scheduled agents</Link><Link href="/operations">Execution controls</Link><Link href="/agent-status">Robot project status</Link><Link href="/reports">Daily report</Link></nav></header>
    <p>Observed {status.observedAt}. This checklist reads real configuration and activity. Connections and assignments do not prove that a scheduled agent wrote, tested or merged useful code.</p>
    <div className="summary-strip"><strong>{native.length}/5</strong> ChatGPT identities registered <span>·</span><strong>{connected}/5</strong> with unexpired OAuth access or refresh credentials</div>
    <ol>
      <li><strong>Verify source access.</strong> On <Link href="/system">System connections</Link>, verify the GitHub App and import repositories. {status.verifiedPlanRepositories} enabled repositories currently have verified imported plans.</li>
      <li><strong>Register five distinct names.</strong> Use <Link href="/agents">Scheduled agents</Link> and select native ChatGPT OAuth registration. Each name must exactly match the approved roster. No bearer credential needs to be copied for this route.</li>
      <li><strong>Connect each named identity.</strong> Native OAuth is {oauthEnabled()?"enabled":"disabled"}. In ChatGPT Plugins, add the custom MCP server <code>https://boardroom-iamn.onrender.com/api/mcp</code>, select OAuth, and authorize the intended registered name. Select that connection in its task. In each account or connection, call <code>boardroom_profile</code> and verify the name before starting.</li>
      <li><strong>Enable intended PR chains.</strong> On <Link href="/operations">Execution controls</Link>, configure each intended repository&apos;s actual required checks and merge policy. {status.automaticMergeRepositories} enabled repositories currently permit automatic merges with explicit checks. Execution is {status.paused?"PAUSED":"not paused"}. GitHub rules and exact-commit control-plane approvals still apply.</li>
      <li><strong>Enable and verify maintenance.</strong> GitHub workflow authentication is {process.env.BOARDROOM_GITHUB_MAINTENANCE_OIDC_ENABLED==="true"?"enabled":"disabled"}. Follow <a href="https://github.com/neophilism/Boardroom/blob/main/docs/FIVE_AGENT_LAUNCH.md#maintenance-and-recovery">the maintenance setup steps</a>; the scoped GitHub OIDC route needs no copied scheduler secret. Last successful maintenance tick: {status.lastMaintenanceAt?.toISOString()??"None recorded"}. Verify continuing ten-minute runs before leaving the system unattended.</li>
      <li><strong>Run the shared instruction once manually.</strong> Confirm a useful change, mapped PR, actual checks and safe checkpoint/release in <Link href="/work-board">Work Board</Link> and <Link href="/reports">Daily report</Link>. Then test one scheduled activation and a second eligible unit. Record the evidence; source tests alone do not pass this step.</li>
      <li><strong>Expand to five hourly schedules.</strong> After the first loop and recovery trial pass, use the same instruction for each connected identity. Stagger starts at :00, :12, :24, :36 and :48 where the scheduler supports those start times. Hourly starts do not guarantee uninterrupted compute: runtime and account limits still apply. Busy identities and held repositories must be skipped safely.</li>
      <li><strong>Check the morning result.</strong> Open <Link href="/reports">Daily report</Link> for evidence-linked progress and <Link href="/owner-actions">Owner actions</Link> for manual prerequisites. If a session becomes uncertain, use <Link href="/recovery">Recovery</Link>; never release it solely because its heartbeat expired.</li>
    </ol>
    <h2>Named connection observations</h2>
    {native.length===0?<p>No ChatGPT identities are registered yet.</p>:<div className="work-grid">{native.map(agent=><article className="work-card" key={agent.credentialId}>
      <h3>{agent.name}</h3><p>Account: <strong>{agent.accountEmail??"Not recorded"}</strong> · <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Open ChatGPT</a> (select the displayed account)</p><p>{agent.connected?"Unexpired OAuth credential observed":"No usable OAuth credential observed"}</p>
      <p>{agent.activations} arrivals · {agent.assignments} assignments</p><p>Last arrival: {agent.lastActivationAt?.toISOString()??"None recorded"}</p>
    </article>)}</div>}
    <p>Recorded integration evidence labels: {status.recordedIntegrationGates.join(", ")||"None"}. Labels must be reviewed against their underlying run, PR, CI and recovery evidence before claiming acceptance.</p>
    <SharedAgentInstruction/>
  </main>;
}
