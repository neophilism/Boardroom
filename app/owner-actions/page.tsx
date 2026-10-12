import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import OwnerActionControls from "./controls";
export const dynamic="force-dynamic";
type ActionRow={
  action_id:string; title:string; action_type:string; instructions:string;status:string;
  requested_permissions:string[];secure_entry_location:string|null;
  price_estimate_cents:string|null;created_at:Date;
  affected:{repositoryId:string;unitId:string|null}[];
};
export default async function OwnerActionsPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const results=await getDatabase().query<ActionRow>(
    "SELECT a.action_id,a.title,a.action_type,a.instructions,a.requested_permissions,a.secure_entry_location,a.price_estimate_cents,a.status,a.created_at,COALESCE(json_agg(json_build_object('repositoryId',d.repository_id,'unitId',d.unit_id)) FILTER (WHERE d.repository_id IS NOT NULL),'[]'::json) AS affected FROM owner_actions a LEFT JOIN owner_action_dependents d ON d.action_id=a.action_id GROUP BY a.action_id ORDER BY CASE WHEN a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') THEN 0 ELSE 1 END,a.created_at DESC LIMIT 250"
  );
  const actions=results.rows;
  const open=actions.filter(a=>["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"].includes(a.status));
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / OWNER ACTION BOARD</p><h1>Needs your attention</h1></div>
      <Link className="priority-nav" href="/priorities">Repository priorities</Link>
      <Link className="priority-nav" href="/work-board">Live Work Board</Link>
      <Link className="priority-nav" href="/coffee">Coffee Corner</Link>
      <Link className="priority-nav" href="/agents">Scheduled agents</Link>
      <Link className="priority-nav" href="/system">System status</Link>
      <form action="/api/v1/owner/logout" method="post"><button type="submit" className="outline">Sign out</button></form>
    </header>
    <p>Agent-submitted requests requiring an account, permission, purchase, or decision. Enter credentials only in the designated external service’s secure configuration.</p>
    <div className="summary-strip"><strong>{open.length}</strong> open or awaiting verification <span>·</span> <strong>{actions.length}</strong> total recorded</div>
    {actions.length===0?<section className="action-card"><h2>No requests</h2><p>No owner-only blockers have been registered yet.</p></section>:
      <div className="action-grid">{actions.map(a=><article className="action-card" key={a.action_id}>
        <div className="card-top"><span className="action-type">{a.action_type.replaceAll("_"," ")}</span><span className="status-label">{a.status.replaceAll("_"," ")}</span></div>
        <h2>{a.title}</h2><p className="instruction">{a.instructions}</p>
        {a.requested_permissions.length>0&&<div><h3>Required permissions</h3><ul>{a.requested_permissions.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}
        {a.secure_entry_location&&<p><strong>Secure entry location:</strong> {a.secure_entry_location}</p>}
        {a.price_estimate_cents!==null&&<p><strong>Estimated cost:</strong> {"$"+(Number(a.price_estimate_cents)/100).toFixed(2)}</p>}
        <p><strong>Affected repositories:</strong> {a.affected.map(x=>x.repositoryId).join(", ")||"Not recorded"}</p>
        <OwnerActionControls actionId={a.action_id} status={a.status}/>
      </article>)}</div>}
  </main>;
}
