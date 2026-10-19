import Link from "next/link";
import {cookies} from "next/headers";
import {notFound,redirect} from "next/navigation";
import OwnerNavigation from "../../owner-navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../../src/server/owner-session";
import {validCredentialId} from "../../../src/server/agent-registration";
import {getAgentProfile} from "../../../src/server/agent-activity";
import {getDatabase} from "../../../src/server/db";
import {formatEastern} from "../../../src/domain/work-board";
import {activityCursor,eventDescription,githubEvidenceUrl,safeEventPaths,safeUuidLink} from "../../../src/domain/agent-activity";

export const dynamic="force-dynamic";
export const runtime="nodejs";

function agoDate(value:Date|null){return value?formatEastern(value.toISOString()):"Not recorded";}
export default async function AgentProfilePage({params,searchParams}:{
  params:Promise<{credentialId:string}>;
  searchParams:Promise<{before?:string|string[]}>;
}){
  // Authenticate before querying any identity, event, repository, or usage data.
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const {credentialId}=await params;
  if(!validCredentialId(credentialId))notFound();
  const requested=(await searchParams).before;
  const before=activityCursor(typeof requested==="string"?requested:null);
  const profile=await getAgentProfile(getDatabase(),credentialId,before);
  if(!profile)notFound();
  const {identity,runs,events,checkpoints,coffee,usage,nextBefore,observedAt}=profile;
  const latest=runs[0];
  const current=runs.find(run=>run.state==="RUNNING"&&!!run.leaseExpiresAt&&run.leaseExpiresAt>observedAt);
  return <main className="owner-shell agent-profile">
    <OwnerNavigation section="AGENT ACTIVITY" title={identity.name} activePath="/agents"/>
    <p><Link href="/agents">← Agent directory</Link> · <Link href="/observatory">Usage observatory</Link></p>
    <p>Read-only observations from Boardroom&apos;s existing database. No provider calls, AI tokens,
      automatic refresh, additional logging jobs or paid API requests are made by this page.
      A recorded lease or heartbeat does not prove the model is actively generating code.</p>
    <div className="agent-profile-summary">
      <article className="action-card"><h2>Identity</h2><strong>{identity.provider}</strong>
        <p>{identity.enabled&&!identity.revokedAt?"Registered credential enabled":"Credential revoked or disabled"}</p>
        <small>Registered {agoDate(identity.createdAt)}</small></article>
      <article className="action-card"><h2>Current assignment</h2>
        <strong>{current?.repository??"No verified live repository lease"}</strong>
        <p>{current?.unitId??"No current work unit recorded"}</p>
        {current&&<small>Lease expires {agoDate(current.leaseExpiresAt)}</small>}</article>
      <article className="action-card"><h2>Last activity</h2>
        <strong>{latest?.state??"No run recorded"}</strong>
        <p>Heartbeat {agoDate(latest?.lastSeenAt??null)}</p>
        <small>Observed {agoDate(observedAt)}</small></article>
      <article className="action-card"><h2>Hosted API usage · 30 days</h2>
        <strong>{usage.hostedCalls} metered calls</strong>
        <p>{Number(usage.inputTokens).toLocaleString()} input · {Number(usage.outputTokens).toLocaleString()} output tokens</p>
        <small>{(Number(usage.microUsd)/1000000).toFixed(4)} USD estimated by Boardroom rate settings</small></article>
    </div>
    <p>Native ChatGPT model selection, reasoning effort, credit usage and remaining balance
      are unavailable to Boardroom. No reported hosted calls does <strong>not</strong> mean a ChatGPT agent used no credits.</p>

    <section className="action-card agent-profile-section" aria-label="Agent event log">
      <div className="card-top"><h2>Recorded activity log</h2><span className="status-label">75 events per page</span></div>
      <p>Newest first. Audit events include assignments, GitHub operations, PR activity, handoffs,
        recovery and Coffee Corner. Only allowlisted metadata is shown; raw payloads and secrets are excluded.</p>
      {events.length===0?<p>No matching activity records.</p>:
        <ol className="agent-event-list">{events.map(e=>{
          const commit=githubEvidenceUrl(e.repository,"commit",e.commitSha);
          const pull=githubEvidenceUrl(e.repository,"pull",e.prNumber);
          const thread=safeUuidLink(e.threadId);
          const action=safeUuidLink(e.actionId);
          const paths=safeEventPaths(e.paths);
          return <li key={e.eventId} className="agent-event">
            <div className="agent-event-title">
              <strong>{eventDescription(e.kind)}</strong>
              <time dateTime={e.occurredAt.toISOString()}>{agoDate(e.occurredAt)}</time>
            </div>
            <div className="agent-event-meta">
              {e.repository&&<span>{e.repository}</span>}
              {e.unitId&&<span>Unit {e.unitId}</span>}
              {e.outcome&&<span>Outcome {e.outcome}</span>}
              {e.branch&&<span>Branch {e.branch}</span>}
            </div>
            {(commit||pull||thread||action)&&<div className="agent-event-links">
              {commit&&<a href={commit} target="_blank" rel="noopener noreferrer">Commit {e.commitSha?.slice(0,9)}</a>}
              {pull&&<a href={pull} target="_blank" rel="noopener noreferrer">PR #{e.prNumber}</a>}
              {thread&&<Link href={"/coffee/"+thread}>Discussion</Link>}
              {action&&<Link href={"/owner-actions/"+action}>Owner action</Link>}
            </div>}
            {paths.length>0&&<details className="agent-event-paths"><summary>{paths.length} recorded file paths</summary>
              <ul>{paths.map((path,i)=><li key={path+i}><code>{path}</code></li>)}</ul>
            </details>}
          </li>;
        })}</ol>}
      <nav className="agent-event-pagination" aria-label="Activity history pages">
        {before&&<Link href={"/agents/"+credentialId}>Latest activity</Link>}
        {nextBefore&&<Link href={"/agents/"+credentialId+"?before="+nextBefore}>Older recorded events →</Link>}
      </nav>
    </section>
    <section className="action-card agent-profile-section">
      <h2>Recent sessions</h2>
      <p>Recorded states and last assignments, not proof of continuous model execution. The newest 25 sessions are shown.</p>
      {runs.length===0?<p>No recorded sessions.</p>:<div className="agent-records">{runs.map(r=>
        <div className="agent-record" key={r.runId}>
          <strong>{r.state}</strong> · {r.repository??"No assignment"} {r.unitId?"· "+r.unitId:""}
          <small>Started {agoDate(r.startedAt)} · last heartbeat {agoDate(r.lastSeenAt)}
            {r.endedAt?" · ended "+agoDate(r.endedAt):""}</small>
        </div>)}</div>}
    </section>
    <section className="action-card agent-profile-section">
      <h2>Saved checkpoints</h2>
      {checkpoints.length===0?<p>No checkpoints saved.</p>:<div className="agent-records">{checkpoints.map(cp=>{
        const link=githubEvidenceUrl(cp.repository,"commit",cp.headSha);
        return <div className="agent-record" key={cp.checkpointId}>
          <strong>{cp.unitId}</strong> · {cp.repository??"Unknown repository"} · {cp.branch}
          <small>Saved {agoDate(cp.createdAt)} {link&&<> · <a href={link} target="_blank" rel="noopener noreferrer">Remote head {cp.headSha?.slice(0,9)}</a></>}</small>
        </div>;
      })}</div>}
    </section>
    <section className="action-card agent-profile-section">
      <h2>Coffee Corner contributions</h2>
      {coffee.length===0?<p>No agent-authored Coffee Corner messages recorded.</p>:<div className="agent-records">{coffee.map((message,i)=>
        <div className="agent-record" key={message.threadId+i}>
          <Link href={"/coffee/"+message.threadId}>{message.subject}</Link>
          <small>{agoDate(message.createdAt)} · {message.repository??"General engineering"}</small>
        </div>)}</div>}
      <p>Conversations and audit records are existing platform data. Private model reasoning and unreported
        steps cannot be reconstructed from these records.</p>
    </section>
  </main>;
}
