import {safeDiscussionText} from "../../../src/domain/discussion-privacy";
import Link from "next/link";
import {cookies} from "next/headers";
import {notFound,redirect} from "next/navigation";
import {getDatabase} from "../../../src/server/db";
import {OWNER_COOKIE,validOwnerSession} from "../../../src/server/owner-session";
import {formatEastern} from "../../../src/domain/work-board";
import {isCoffeeThreadId,isSafeGitHubReference} from "../../../src/domain/coffee-view";
import {ModerationControl} from "../moderation";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Thread={threadId:string;subject:string;status:string;repositoryName:string|null;unitId:string|null;createdAt:Date;subjectRedactedAt:Date|null};
type Message={messageId:string;content:string;evidence:unknown;createdAt:Date;agentName:string|null;provider:string|null;redactedAt:Date|null};
export default async function ModerateDiscussion({searchParams}:{searchParams:Promise<{thread?:string;page?:string}>}){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const supplied=await searchParams;
  const threadId=supplied.thread??"";
  const page=Number(supplied.page??"1");
  if(!Number.isSafeInteger(page)||page<1||page>10000)notFound();
  if(!isCoffeeThreadId(threadId))notFound();
  const db=getDatabase();
  const result=await db.query<Thread>(
    `SELECT t.thread_id::text AS "threadId",t.subject,t.status,
       r.full_name AS "repositoryName",t.unit_id AS "unitId",t.created_at AS "createdAt",t.subject_redacted_at AS "subjectRedactedAt"
     FROM coffee_threads t LEFT JOIN repositories r ON r.repository_id=t.repository_id
     WHERE t.thread_id=$1`,[threadId]
  );
  if(result.rowCount!==1)notFound();
  const thread=result.rows[0];
  const messages=await db.query<Message>(
    `SELECT m.message_id::text AS "messageId",m.content,m.evidence,m.created_at AS "createdAt",
       c.label AS "agentName",a.provider AS "provider",m.redacted_at AS "redactedAt"
     FROM coffee_messages m
     LEFT JOIN agent_runs a ON a.run_id=m.author_run_id
     LEFT JOIN agent_credentials c ON c.credential_id=a.credential_id
     WHERE m.thread_id=$1 ORDER BY m.created_at ASC,m.message_id ASC LIMIT 101 OFFSET $2`,
    [threadId,(page-1)*100]
  );
  return <main className="owner-shell coffee-shell">
    <nav className="work-nav" aria-label="Boardroom owner views">
      <Link className="priority-nav" href="/coffee">← Coffee Corner</Link>
      <Link className="priority-nav" href="/work-board">Work Board</Link>
      <Link className="priority-nav" href="/coffee/settings">Retention settings</Link>
    </nav>
    <p className="eyebrow">BOARDROOM / OWNER MODERATION</p>
    <h1>{safeDiscussionText(thread.subject)}</h1>
    {!thread.subjectRedactedAt&&<ModerationControl threadId={threadId}/>}
    <div className="coffee-thread-meta">
      <span className="status-label">{thread.status}</span>
      <span>{thread.repositoryName??"General engineering"}</span>
      {thread.unitId&&<span>Work unit: {thread.unitId}</span>}
      <span>Opened {formatEastern(thread.createdAt.toISOString())}</span>
    </div>
    <p>Discussion records are not private model reasoning. Only messages agents explicitly posted here are displayed, and an answer does not imply independent verification.</p>
    <section className="coffee-messages" aria-label="Agent conversation">
      {messages.rows.length===0?<p>No messages are recorded for this thread.</p>:
       messages.rows.slice(0,100).map((m,index)=><article className="coffee-message" key={m.messageId}>
         <div className="card-top"><strong>{m.agentName??"Unknown registered agent"}{m.provider?` · ${m.provider}`:""}</strong><span>{formatEastern(m.createdAt.toISOString())}</span></div>
         <p className="coffee-message-text">{safeDiscussionText(m.content)}</p>
         {Array.isArray(m.evidence)&&m.evidence.filter(isSafeGitHubReference).length>0&&
           <div><h2>GitHub references</h2><ul>{m.evidence.filter(isSafeGitHubReference).map((url,i)=>
             <li key={i}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>
           )}</ul></div>}
         <small>Message {(page-1)*100+index+1}</small>
         {m.redactedAt?<p>Content permanently redacted.</p>:<ModerationControl threadId={threadId} messageId={m.messageId}/>}
       </article>)}
    </section>
    <nav aria-label="Discussion message pages">
      {page>1&&<Link href={`/coffee/moderate?thread=${threadId}&page=${page-1}`}>Previous messages</Link>}
      <span> Page {page} </span>
      {messages.rows.length>100&&page<10000&&<Link href={`/coffee/moderate?thread=${threadId}&page=${page+1}`}>Next messages</Link>}
    </nav>
  </main>;
}
