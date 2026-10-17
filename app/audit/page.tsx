import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import {auditBefore,auditKind} from "../../src/domain/owner-audit";
import {formatEastern} from "../../src/domain/work-board";
export const dynamic="force-dynamic";
type AuditRow={eventId:string;kind:string;occurredAt:Date;repository:string|null};
export default async function AuditPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login?next=%2Faudit");
  const before=auditBefore((await searchParams).before);
  const result=await getDatabase().query<AuditRow>(`SELECT e.event_id::text AS "eventId",e.kind,e.occurred_at AS "occurredAt",r.full_name AS repository
    FROM audit_events e LEFT JOIN repositories r ON r.repository_id=e.repository_id
    WHERE ($1::bigint IS NULL OR e.event_id<$1::bigint) ORDER BY e.event_id DESC LIMIT 51`,[before]);
  const rows=result.rows.slice(0,50),next=result.rows.length>50?auditBefore(rows.at(-1)?.eventId):null;
  return <main className="owner-shell"><header className="owner-header"><div><p className="eyebrow">BOARDROOM / AUDIT</p><h1>Coordination audit trail</h1></div></header>
    <p>Recorded control-plane events, newest first. An event records an action, not proof of completed development. Request contents, secret references and raw provider payloads are not displayed here.</p>
    <p className="audit-caption">{rows.length} events on this page · times shown in Eastern time</p>
    {rows.length===0?<section className="action-card"><h2>No recorded events</h2><p>No events were found in this part of the audit trail.</p></section>:
      <ol className="audit-events">{rows.map(row=><li key={row.eventId} className="audit-event"><div><code>{auditKind(row.kind)}</code><p>{row.repository??"Boardroom system"}</p></div><time dateTime={row.occurredAt.toISOString()}>{formatEastern(row.occurredAt.toISOString())}</time></li>)}</ol>}
    <nav className="audit-pagination" aria-label="Audit pagination">{before&&<Link className="priority-nav" href="/audit">Newest events</Link>}{next&&<Link className="priority-nav" href={"/audit?before="+next}>Older events</Link>}</nav>
  </main>;
}
