import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {listOwnerActions,OWNER_ACTION_STATUSES} from "../../src/server/owner-actions";
import {arrangeOwnerInbox,OWNER_ACTION_TYPES,OWNER_INBOX_SORTS,parseOwnerInboxFilters} from "../../src/server/owner-inbox";
import OwnerActionControls from "./controls";
export const dynamic="force-dynamic";
type ActionRow={
  action_id:string;title:string;action_type:string;instructions:string;status:string;
  requested_permissions:string[];secure_entry_location:string|null;
  price_estimate_cents:string|null;created_at:Date;
  affected:{repositoryId:string;fullName:string;unitId:string|null}[];
};
export default async function OwnerActionsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const filters=parseOwnerInboxFilters(await searchParams);
  const records=await listOwnerActions(getDatabase(),filters.status) as ActionRow[];
  const actions=arrangeOwnerInbox(records,filters);
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
    <p>Agent-submitted requests requiring an account, permission, purchase, or decision. Enter credentials only in the designated external service's secure configuration.</p>
    <div className="summary-strip"><strong>{open.length}</strong> open or awaiting verification <span>·</span> <strong>{actions.length}</strong> matching filters</div>
    <form className="owner-action-filters" method="get">
      <label>Status<select name="status" defaultValue={filters.status??""}>
        <option value="">All statuses</option>
        {OWNER_ACTION_STATUSES.map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
      </select></label>
      <label>Type<select name="type" defaultValue={filters.type??""}>
        <option value="">All types</option>
        {OWNER_ACTION_TYPES.map(type=><option key={type} value={type}>{type.replaceAll("_"," ")}</option>)}
      </select></label>
      <label>Sort<select name="sort" defaultValue={filters.sort}>
        {OWNER_INBOX_SORTS.map(sort=><option key={sort} value={sort}>{sort.replaceAll("_"," ")}</option>)}
      </select></label>
      <button type="submit">Apply</button>
      <Link className="priority-nav" href="/owner-actions">Clear</Link>
    </form>
    {actions.length===0?<section className="action-card"><h2>No matching requests</h2><p>Change or clear the inbox filters to view other owner actions.</p></section>:
      <div className="action-grid">{actions.map(a=><article className="action-card" id={"action-"+a.action_id} key={a.action_id}>
        <div className="card-top"><span className="action-type">{a.action_type.replaceAll("_"," ")}</span><span className="status-label">{a.status.replaceAll("_"," ")}</span></div>
        <h2>{a.title}</h2><p className="instruction">{a.instructions}</p>
        {a.requested_permissions.length>0&&<div><h3>Required permissions</h3><ul>{a.requested_permissions.map((permission,index)=><li key={index}>{permission}</li>)}</ul></div>}
        {a.secure_entry_location&&<p><strong>Secure entry location:</strong> {a.secure_entry_location}</p>}
        {a.price_estimate_cents!==null&&<p><strong>Estimated cost:</strong> {"$"+(Number(a.price_estimate_cents)/100).toFixed(2)}</p>}
        <p><strong>Affected repositories:</strong> {a.affected.map(item=>item.fullName+(item.unitId?" ("+item.unitId+")":"")).join(", ")||"Not recorded"}</p>
        <OwnerActionControls actionId={a.action_id} status={a.status}/>
      </article>)}</div>}
  </main>;
}
