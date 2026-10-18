"use client";
import {useState} from "react";
import type {UsageObservatory,AgentUsageRow} from "../../src/server/usage-observatory";
const usd=(n:number)=>"$"+n.toFixed(n<0.01?5:n<1?4:2);
function Meter({value,max}:{value:number;max:number}){
  const fraction=max>0?Math.min(100,100*value/max):0;
  return <div className="usage-meter" aria-hidden="true"><span style={{width:fraction+"%"}}/></div>;
}
export default function ObservatoryPanel({data}:{data:UsageObservatory}){
  const [sort,setSort]=useState<"usage"|"merges"|"failures"|"sessions">("usage");
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [showNotes,setShowNotes]=useState(false);
  const agents=[...data.agents].filter(a=>a.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>{
    const rank=(r:AgentUsageRow)=>sort==="usage"?r.reportedUsd7d:sort==="merges"?r.verifiedMerges7d:sort==="failures"?r.failed7d:r.sessions7d;
    return rank(b)-rank(a)||a.name.localeCompare(b.name);
  });
  const max=Math.max(0,...agents.map(a=>a.reportedUsd7d));
  const peak=Math.max(0,...data.days.map(x=>x.reportedUsd));
  const focus=selected?data.agents.find(a=>a.credentialId===selected):null;
  return <section className="usage-observatory">
    <div className="usage-kpis" aria-label="Fleet monitoring metrics">
      <article><small>Running right now</small><strong>{data.summary.active}</strong></article>
      <article><small>Arrivals / 24h</small><strong>{data.summary.sessions24h}</strong></article>
      <article><small>Reported API cost / 24h</small><strong>{usd(data.summary.reportedUsd24h)}</strong></article>
      <article><small>Unreconciled reservation maximum / 24h</small><strong>{usd(data.summary.pendingMaximumUsd24h)}</strong></article>
      <article><small>GitHub-verified merges / 7d</small><strong>{data.summary.verifiedMerges7d}</strong></article>
      <article><small>Agents with no metered API calls / 7d</small><strong>{data.summary.unmeteredAgents}</strong></article>
    </div>
    <section className="action-card">
      <div className="card-top"><h2>Low-cost automation health</h2><button type="button" className="outline" onClick={()=>window.location.reload()}>Manual refresh</button></div>
      <p>Existing GitHub Actions maintenance triggers deterministic Boardroom/Neon work without running an AI model. Data loads on request, not by live polling.</p>
      <dl className="usage-stats">
        <div><dt>Last completed maintenance tick</dt><dd>{data.summary.lastMaintenanceAt??"Not observed"}</dd></div>
        <div><dt>Outbox pending / retrying / running</dt><dd>{data.summary.outboxPending}</dd></div>
        <div><dt>Outbox permanently failed</dt><dd>{data.summary.outboxFailed}</dd></div>
        <div><dt>Sessions in recovery / uncertain</dt><dd>{data.summary.recovering}</dd></div>
        <div><dt>Open owner actions</dt><dd>{data.summary.openOwnerActions}</dd></div>
      </dl>
      <p>Maintenance handles watchdog recovery holds, repository inventory and bounded outbox dispatch. Existing GitHub Actions run CI. Sensitive merges still require exact-head checks and the server&apos;s authorization gates.</p>
    </section>
    <section className="action-card">
      <h2>14-day usage and productivity</h2>
      <p>Calendar days are UTC. Bars represent hosted token-priced dollars, not ChatGPT Work credits. Runs and merges use separate units.</p>
      <div className="usage-days">{data.days.map(day=><div className="usage-day" key={day.day}>
        <span>{day.day.slice(5)}</span><Meter value={day.reportedUsd} max={peak}/><strong>{usd(day.reportedUsd)}</strong>
        <small>{day.verifiedMerges} merges · {day.sessions} arrivals</small>
      </div>)}</div>
    </section>
    <section className="action-card">
      <h2>Per-agent usage meters</h2>
      <div className="usage-filters">
        <label htmlFor="usage-agent-search">Find robot <input id="usage-agent-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Agent name"/></label>
        <label htmlFor="usage-sort">Sort by <select id="usage-sort" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}>
          <option value="usage">Reported hosted cost</option>
          <option value="merges">Verified merges</option>
          <option value="failures">Failed runs</option>
          <option value="sessions">Arrivals</option>
        </select></label>
      </div>
      <div className="usage-table-wrap"><table className="usage-table">
        <thead><tr><th>Agent / provider</th><th>Hosted API cost / 7d</th><th>ChatGPT credits</th><th>Runs / 7d</th><th>PR merges / 7d</th><th>Failed / blocked</th><th>Currently assigned</th></tr></thead>
        <tbody>{agents.map(agent=><tr key={agent.credentialId}>
          <th><button type="button" className="outline" onClick={()=>setSelected(agent.credentialId)} aria-label={"View usage for "+agent.name}>{agent.name}</button><small>{agent.provider}</small></th>
          <td><strong>{agent.metering==="not-observed"?"Not measured":usd(agent.reportedUsd7d)}</strong><Meter value={agent.reportedUsd7d} max={max}/></td>
          <td>Unavailable</td><td>{agent.sessions7d}</td><td>{agent.verifiedMerges7d}</td>
          <td>{agent.failed7d} / {agent.blocked7d}</td><td>{agent.activeRepository??"No active assignment"}</td>
        </tr>)}</tbody>
      </table></div>
      {agents.length===0&&<p>No matching registered agents.</p>}
    </section>
    {focus&&<section className="action-card">
      <div className="card-top"><h2>{focus.name}: detailed usage</h2><button type="button" className="outline" onClick={()=>setSelected(null)}>Close</button></div>
      <p>Last observed: {focus.lastSeenAt??"Never"} · Running sessions: {focus.activeNow} · Cost evidence: {focus.metering==="hosted-reported"?"Hosted token-price estimate":"No recent hosted usage evidence"}</p>
      <dl className="usage-stats">
        <div><dt>Arrivals / 24h · 7d · 30d</dt><dd>{focus.sessions24h} · {focus.sessions7d} · {focus.sessions30d}</dd></div>
        <div><dt>Input / output tokens / 24h</dt><dd>{focus.inputTokens24h.toLocaleString()} / {focus.outputTokens24h.toLocaleString()}</dd></div>
        <div><dt>Hosted token-priced $ / 24h · 7d · 30d</dt><dd>{usd(focus.reportedUsd24h)} · {usd(focus.reportedUsd7d)} · {usd(focus.reportedUsd30d)}</dd></div>
        <div><dt>Unreconciled reservation ceiling / 24h</dt><dd>{usd(focus.pendingMaximumUsd24h)}</dd></div>
        <div><dt>Recorded paid model calls / 7d</dt><dd>{focus.reportedCalls7d}</dd></div>
        <div><dt>Completed · failed · blocked / 7d</dt><dd>{focus.completed7d} · {focus.failed7d} · {focus.blocked7d}</dd></div>
        <div><dt>GitHub-verified merges · merge denials / 7d</dt><dd>{focus.verifiedMerges7d} · {focus.mergeDenials7d}</dd></div>
        <div><dt>Completed run duration / 7d</dt><dd>{focus.completedRuntimeHours7d.toFixed(2)} hours</dd></div>
        <div><dt>API estimated dollars per GitHub-verified merge / 7d</dt><dd>{focus.verifiedMerges7d?usd(focus.reportedUsd7d/focus.verifiedMerges7d):"Insufficient merge evidence"}</dd></div>
        <div><dt>Native Work credits / effort / model</dt><dd>Unavailable via Boardroom MCP connection</dd></div>
      </dl>
      <p>Merge efficiency is descriptive, not a quality-adjusted comparison: difficulty, review time and deferred defects are not normalized.</p>
    </section>}
    <section className="action-card">
      <div className="card-top"><h2>Meter provenance and limitations</h2><button type="button" className="outline" onClick={()=>setShowNotes(!showNotes)}>{showNotes?"Hide":"Read"} definitions</button></div>
      <p>Hosted rolling 24-hour server spending cap: {data.hostedRollingCapUsd===null?"Not configured":usd(data.hostedRollingCapUsd)}. Captured {data.observedAt}.</p>
      {showNotes&&<ul>{data.limitations.map(note=><li key={note}>{note}</li>)}</ul>}
    </section>
  </section>;
}
