import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {parseOwnerActionInboxView,selectOwnerActionInbox} from "../../src/server/owner-action-inbox";
import OwnerActionControls from "./controls";
import {isRiskApprovalKey} from "../../src/server/risk-approval";
export const dynamic="force-dynamic";
type ActionRow={
  action_id:string; action_key:string; title:string; action_type:string; instructions:string;status:string;
  requested_permissions:string[];secure_entry_location:string|null;
  price_estimate_cents:string|null;created_at:Date;
  affected:{repositoryId:string;fullName:string|null;unitId:string|null}[];
};
const filterOptions=[
  ["ALL","All"],["OUTSTANDING","Outstanding"],["BLOCKED","Blocked"],
  ["AWAITING_VERIFICATION","Awaiting verification"],["COMPLETE","Complete"],["DECLINED","Declined"]
] as const;
const sortOptions=[["OLDEST","Oldest first"],["NEWEST","Newest first"],["STATUS","Status"],["TITLE","Title"]] as const;
export default async function OwnerActionsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const view=parseOwnerActionInboxView(await searchParams);
  const results=await getDatabase().query<ActionRow>(
    "SELECT a.action_id,a.action_key,a.title,a.action_type,a.instructions,a.requested_permissions,a.secure_entry_location,a.price_estimate_cents,a.status,a.created_at,COALESCE(json_agg(json_build_object('repositoryId',d.repository_id::text,'fullName',r.full_name,'unitId',d.unit_id) ORDER BY r.full_name,d.repository_id,d.unit_id) FILTER (WHERE d.repository_id IS NOT NULL),'[]'::json) AS affected FROM owner_actions a LEFT JOIN owner_action_dependents d ON d.action_id=a.action_id LEFT JOIN repositories r ON r.repository_id=d.repository_id GROUP BY a.action_id LIMIT 250"
  );
  const allActions=results.rows;
  const actions=selectOwnerActionInbox(allActions,view.filter,view.sort);
  const open=allActions.filter(a=>["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"].includes(a.status));
  return <main className="owner-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / OWNER ACTION BOARD</p><h1>Needs your attention</h1></div>
      <Link className="priority-nav" href="/priorities">Repository priorities</Link>
      <Link className="priority-nav" href="/work-board">Live Work Board</Link>
      <Link className="priority-nav" href="/coffee">Coffee Corner</Link>
      <Link className="priority-nav" href="/agents">Scheduled agents</Link>
      <Link className="priority-nav" href="/observatory">Usage observatory</Link>
      <Link className="priority-nav" href="/system">System status</Link>
      <form action="/api/v1/owner/logout" method="post"><button type="submit" className="outline">Sign out</button></form>
    </header>
    <p>Agent-submitted requests requiring an account, permission, purchase, or decision. Enter credentials only in the designated external service&apos;s secure configuration.</p>
    <div className="summary-strip"><strong>{open.length}</strong> blocking or awaiting verification <span>·</span> <strong>{allActions.length}</strong> total recorded</div>
    <form className="action-inbox-filters" method="get">
      <label htmlFor="action-status">Show</label>
      <select id="action-status" name="status" defaultValue={view.filter}>{filterOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
      <label htmlFor="action-sort">Sort</label>
      <select id="action-sort" name="sort" defaultValue={view.sort}>{sortOptions.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select>
      <button type="submit">Apply</button>
      <Link href="/owner-actions">Reset</Link>
    </form>
    <p className="action-inbox-result" aria-live="polite">Showing {actions.length} of {allActions.length} actions.</p>
    {actions.length===0?<section className="action-card"><h2>No matching requests</h2><p>Change or reset the inbox filters to inspect other owner actions.</p></section>:
      <div className="action-grid">{actions.map(a=><article className="action-card" id={"action-"+a.action_id} key={a.action_id}>
        <div className="card-top"><span className="action-type">{a.action_type.replaceAll("_"," ")}</span><span className="status-label">{a.status.replaceAll("_"," ")}</span></div>
        <h2><Link href={"/owner-actions/"+a.action_id}>{a.title}</Link></h2>
        <details>
          <summary>Inspect request</summary>
          <p className="instruction">{a.instructions}</p>
          {a.requested_permissions.length>0&&<div><h3>Required permissions</h3><ul>{a.requested_permissions.map((p,i)=><li key={i}>{p}</li>)}</ul></div>}
          {a.secure_entry_location&&<p><strong>Secure entry location:</strong> {a.secure_entry_location}</p>}
          {a.price_estimate_cents!==null&&<p><strong>Estimated cost:</strong> {"$"+(Number(a.price_estimate_cents)/100).toFixed(2)}</p>}
          <p><strong>Affected repositories:</strong> {a.affected.map(x=>x.fullName||x.repositoryId).join(", ")||"Not recorded"}</p>
          <p><strong>Requested:</strong> {new Date(a.created_at).toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})} UTC</p>
        </details>
        <OwnerActionControls actionId={a.action_id} status={a.status} canApprove={isRiskApprovalKey(a.action_key)}/>
      </article>)}</div>}
  </main>;
}
