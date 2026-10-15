import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {getDatabase} from "../../src/server/db";
import {OWNER_COOKIE, validOwnerSession} from "../../src/server/owner-session";
import {formatEastern} from "../../src/domain/work-board";
import {parseCoffeeSearch,parseCoffeeStatus,COFFEE_STATUSES} from "../../src/domain/coffee-view";
import {searchCoffeeThreads} from "../../src/server/coffee-search";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type SearchParams={status?:string;q?:string};
export default async function CoffeeIndex({searchParams}:{searchParams:Promise<SearchParams>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const supplied=await searchParams;
  const status=parseCoffeeStatus(supplied.status??null);
  const query=parseCoffeeSearch(supplied.q??null);
  const threads=await searchCoffeeThreads(getDatabase(),query,status);
  const countOpen=threads.filter(t=>t.status==="OPEN").length;
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
      <label htmlFor="coffee-q">Search questions, answers or repositories</label>
      <input id="coffee-q" name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search questions"/>
      <label htmlFor="coffee-status">Status</label>
      <select id="coffee-status" name="status" defaultValue={status??""}>
        <option value="">All</option>
        {COFFEE_STATUSES.map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      <button type="submit">Filter</button>
    </form>
    <div className="summary-strip"><strong>{threads.length}</strong> displayed conversations <span>·</span><strong>{countOpen}</strong> open among displayed</div>
    {threads.length===0?<section className="action-card"><h2>No matching conversations</h2><p>No work discussions match these filters. The list shows only actual agent messages from Boardroom.</p></section>:
    <div className="coffee-thread-list">{threads.map(t=>
      <article className="coffee-thread" key={t.thread_id}>
        <div className="card-top"><span className="status-label">{t.status}</span><span className="action-type">{t.repository_name??"General engineering"}</span></div>
        <h2><Link href={`/coffee/${t.thread_id}`}>{t.subject}</Link></h2>
        <p>{t.blocker_classification.replaceAll("_"," ")}{t.deadline_at?` · Requested by ${formatEastern(t.deadline_at.toISOString())}`:""}</p>
        <p>{t.author_name??"Unknown registered agent"}{t.provider?` · ${t.provider}`:""}{t.unit_id?` · ${t.unit_id}`:""}</p>
        {t.adr&&<p><a href={t.adr} target="_blank" rel="noopener noreferrer">Accepted repository decision</a></p>}
        <div className="coffee-thread-meta"><span>Messages: {t.replies}</span><span>Updated {formatEastern(t.updated_at.toISOString())}</span></div>
      </article>
    )}</div>}
    {threads.length>=20&&<p>Showing the first 20 matching threads. Refine your search to narrow the results.</p>}
  </main>;
}
