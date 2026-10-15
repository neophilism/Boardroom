import {cookies} from "next/headers";
import {notFound,redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../../src/server/owner-session";
import {getDatabase} from "../../../src/server/db";
import {describeOwnerActionUrgency,getOwnerActionDetail,ownerActionLinks} from "../../../src/server/owner-action-detail";
import OwnerActionControls from "../controls";
import {isRiskApprovalKey} from "../../../src/server/risk-approval";

export const dynamic="force-dynamic";

export default async function OwnerActionDetailPage({params}:{params:Promise<{actionId:string}>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const {actionId}=await params;
  const action=await getOwnerActionDetail(getDatabase(),actionId);
  if(!action)notFound();
  const links=ownerActionLinks(action.instructions,action.secure_entry_location);
  return <main className="owner-shell action-detail">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / OWNER ACTION</p><h1>{action.title}</h1></div>
      <Link className="priority-nav" href="/owner-actions">Back to inbox</Link>
    </header>
    <div className="action-detail-summary">
      <span className="action-type">{action.action_type.replaceAll("_"," ")}</span>
      <span className="status-label">{action.status.replaceAll("_"," ")}</span>
      <strong>{describeOwnerActionUrgency(action.status)}</strong>
    </div>
    <section>
      <h2>Why this is needed</h2>
      <p>{action.reason?.replaceAll("_"," ")??action.action_type.replaceAll("_"," ")+" requested by an authorized agent"}</p>
    </section>
    <section>
      <h2>What to do</h2>
      <p className="detail-instructions">{action.instructions}</p>
    </section>
    <section className="action-detail-grid">
      <div><h2>Exact permission or secret</h2>
        {action.requested_permissions.length>0?<ul>{action.requested_permissions.map((permission,index)=><li key={index}>{permission}</li>)}</ul>:<p>No additional permission scope was specified.</p>}
      </div>
      <div><h2>Destination</h2><p>{action.secure_entry_location??"No external secure-entry destination is required."}</p></div>
      <div><h2>Affected work</h2>
        {action.affected.length>0?<ul>{action.affected.map(item=><li key={item.repositoryId}>{item.fullName}{item.unitId?" / "+item.unitId:""}</li>)}</ul>:<p>No repository dependency was recorded.</p>}
      </div>
      <div><h2>Links</h2>
        {links.length>0?<ul>{links.map(link=><li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul>:<p>No direct HTTPS link was supplied.</p>}
      </div>
    </section>
    {action.price_estimate_cents!==null&&<p><strong>Expected expense:</strong> {"$"+(Number(action.price_estimate_cents)/100).toFixed(2)}</p>}
    <p><strong>Requested:</strong> {new Date(action.created_at).toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})} UTC</p>
    <OwnerActionControls actionId={action.action_id} status={action.status} canApprove={isRiskApprovalKey(action.action_key)}/>
  </main>;
}
