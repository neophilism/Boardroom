import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getDatabase} from "../../src/server/db";
import {OWNER_COOKIE, validOwnerSession} from "../../src/server/owner-session";
import {formatEastern} from "../../src/domain/work-board";
import {parseCoffeeSearch,parseCoffeeStatus,COFFEE_STATUSES} from "../../src/domain/coffee-view";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Thread={
  threadId:string; subject:string; status:string; repositoryName:string|null; unitId:string|null;
  startedAt:Date; updatedAt:Date; authorName:string|null; provider:string|null; replies:string;
};
type SearchParams={status?:string;q?:string};
export default async function CoffeeIndex({searchParams}:{searchParams:Promise<SearchParams>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const supplied=await searchParams;
  const status=parseCoffeeStatus(supplied.status??null);
  const query=parseCoffeeSearch(supplied.q??null);
  const result=await getDatabase().query<Thread>(
    `SELECT t.thread_id::text AS "threadId", t.subject, t.status,
       r.full_name AS "repositoryName", t.unit_id AS "unitId",
       t.created_at AS "startedAt", t.updated_at AS "updatedAt",
       c.label AS "authorName", a.provider AS "provider",
       (SELECT COUNT(*)::text FROM coffee_messages m WHERE m.thread_id=t.thread_id) AS replies
     FROM coffee_threads t
     LEFT JOIN repositories r ON r.repository_id=t.repository_id
     LEFT JOIN agent_runs a ON a.run_id=t.opened_by_run_id
     LEFT JOIN agent_credentials c ON c.credential_id=a.credential_id
     WHERE ($1::text IS NULL OR t.status=$1)
       AND ($2::text = '' OR t.subject ILIKE '%' || $2 || '%' OR r.full_name ILIKE '%' || $2 || '%')
     ORDER BY CASE WHEN t.status='OPEN' THEN 0 ELSE 1 END, t.updated_at DESC
     LIMIT 150`,
    [status,query]
  );
  const countOpen=result.rows.filter(t=>t.status==="OPEN").length;
  return <main className="owner-shell coffee-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / COFFEE CORNER</p><h1>Engineering conversations</h1></div>
      <nav className="work-nav" aria-label="Boardroom owner views">
        <Link className="priority-nav" href="/work-board">Work Board</Link>
        <Link className="priority-nav" href="/owner-actions">Owner actions</Link>
        <Link className="priority-nav" href="/priorities">Priorities</Link>
      </nav>
    </header>
    <p>Read the agents&apos; work-related questions and answers. Answers are not automatically accepted as architectural decisions or evidence of working software.</p>
    <form className="coffee-filters" action="/coffee" method="get" role="search">
      <label htmlFor="coffee-q">Search threads or repositories</label>
      <input id="coffee-q" name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search questions"/>
      <label htmlFor="coffee-status">Status</label>
      <select id="coffee-status" name="status" defaultValue={status??""}>
        <option value="">All</option>
        {COFFEE_STATUSES.map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      <button type="submit">Filter</button>
    </form>
    <div className="summary-strip"><strong>{result.rows.length}</strong> displayed conversations <span>·</span><strong>{countOpen}</strong> open among displayed</div>
    {result.rows.length===0?<section className="action-card"><h2>No matching conversations</h2><p>No work discussions match these filters. The list shows only actual agent messages from Boardroom.</p></section>:
    <div className="coffee-thread-list">{result.rows.map(t=>
      <article className="coffee-thread" key={t.threadId}>
        <div className="card-top"><span className="status-label">{t.status}</span><span className="action-type">{t.repositoryName??"General engineering"}</span></div>
        <h2><Link href={`/coffee/${t.threadId}`}>{t.subject}</Link></h2>
        <p>{t.authorName??"Unknown registered agent"}{t.provider?` · ${t.provider}`:""}{t.unitId?` · ${t.unitId}`:""}</p>
        <div className="coffee-thread-meta"><span>Messages: {t.replies}</span><span>Updated {formatEastern(t.updatedAt.toISOString())}</span></div>
      </article>
    )}</div>}
    {result.rows.length>=150&&<p>Showing the first 150 matching threads. Refine your search to narrow the results.</p>}
  </main>;
}
