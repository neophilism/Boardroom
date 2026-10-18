"use client";
import {useState} from "react";
import type {LogicalAgentRole,LogicalAgentRow} from "../../src/server/logical-agents";

type Page={agents:LogicalAgentRow[];nextCursor:string|null};
const roles:LogicalAgentRole[]=["development","sales","funding","research","operations","support","mission","other"];
export default function LogicalAgentInventory({initial}:{initial:Page}){
  const [data,setData]=useState<Page>(initial);
  const [cursor,setCursor]=useState<string|null>(null);
  const [history,setHistory]=useState<Array<string|null>>([]);
  const [name,setName]=useState("");
  const [role,setRole]=useState<LogicalAgentRole>("development");
  const [team,setTeam]=useState("general");
  const [labels,setLabels]=useState("");
  const [lastCreated,setLastCreated]=useState<LogicalAgentRow|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function refresh(next:string|null){
    if(busy)return false;
    setBusy(true);setMessage("");
    try{
      const url="/api/v1/owner/logical-agents?limit=30"+(next?"&cursor="+encodeURIComponent(next):"");
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store"});
      const body=await response.json() as Page & {error?:string};
      if(!response.ok)throw Error(body.error??"Could not load registry");
      if(!Array.isArray(body.agents)||!body.agents.every(a=>typeof a.agentId==="string"))
        throw Error("Incomplete registry response");
      setData({agents:body.agents,nextCursor:body.nextCursor??null});
      setCursor(next);return true;
    }catch(error){setMessage(error instanceof Error?error.message:"Registry unavailable");return false;}
    finally{setBusy(false);}
  }
  async function create(){
    if(busy||!name.trim())return;
    setBusy(true);setMessage("");setLastCreated(null);
    try{
      const capabilityLabels=labels.split(",").map(s=>s.trim()).filter(Boolean);
      const response=await fetch("/api/v1/owner/logical-agents",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({displayName:name.trim(),role,teamKey:team.trim(),capabilityLabels})
      });
      const body=await response.json() as {agent?:LogicalAgentRow;error?:string};
      if(!response.ok)throw Error(body.error??"Registration unavailable");
      if(body.agent?.state!=="DORMANT"||typeof body.agent.agentId!=="string")
        throw Error("Server did not confirm dormant registration");
      setLastCreated(body.agent);
      setName("");setLabels("");
      setMessage("Registered dormant identity. No API calls, credentials, or schedules created.");
    }catch(error){setMessage(error instanceof Error?error.message:"Registration unavailable");}
    finally{setBusy(false);}
  }
  return <section className="logical-inventory">
    <div className="summary-strip"><strong>{data.agents.length}</strong> logical identities displayed on this page
      <span>·</span><strong>0</strong> paid API calls authorized by registry creation</div>
    <section className="action-card">
      <h2>Register dormant logical agent</h2>
      <p>This does not register another ChatGPT scheduled robot. Names can repeat; secure server-generated IDs distinguish logical agents. Capability labels are notes, never permissions.</p>
      <div className="logical-fields">
        <label>Agent display name<input value={name} maxLength={100} autoComplete="off" placeholder="e.g. Researcher Nova" onChange={e=>setName(e.target.value)} disabled={busy}/></label>
        <label>Role<select value={role} onChange={e=>setRole(e.target.value as LogicalAgentRole)} disabled={busy}>
          {roles.map(r=><option key={r} value={r}>{r}</option>)}
        </select></label>
        <label>Team identifier<input value={team} maxLength={40} onChange={e=>setTeam(e.target.value)} disabled={busy}/></label>
        <label>Capability labels (optional, comma-separated)<input value={labels} placeholder="research:policy, draft" onChange={e=>setLabels(e.target.value)} disabled={busy}/></label>
      </div>
      <button type="button" disabled={busy||!name.trim()} onClick={create}>{busy?"Saving…":"Register dormant agent"}</button>
      {lastCreated&&<p role="status"><strong>{lastCreated.displayName}</strong> · ID <code>{lastCreated.agentId}</code> · {lastCreated.state}</p>}
    </section>
    <section className="action-card">
      <div className="card-top"><h2>Registered logical identities</h2>
        <button type="button" className="outline" disabled={busy} onClick={()=>{setHistory([]);void refresh(null);}}>Refresh first page</button>
      </div>
      <p>30 records per page. All records remain dormant until subsequent security, budgeting and executor phases are implemented. No automatic polling.</p>
      {data.agents.length? <div className="logical-list">
        {data.agents.map(a=><article className="logical-row" key={a.agentId}>
          <div><strong>{a.displayName}</strong><small>{a.agentId}</small></div>
          <div><span>{a.role}</span><small>Team {a.teamKey}</small></div>
          <div><strong>{a.state}</strong>{a.capabilityLabels.length>0&&<small>{a.capabilityLabels.join(", ")}</small>}</div>
        </article>)}
      </div>:<p>No logical agents on this page. No simulated agent data is shown.</p>}
      <div className="card-actions">
        <button type="button" className="outline" disabled={busy||history.length===0} onClick={async()=>{
          const previous=history.at(-1)??null;
          if(await refresh(previous))setHistory(old=>old.slice(0,-1));
        }}>Previous</button>
        <button type="button" className="outline" disabled={busy||!data.nextCursor} onClick={async()=>{
          const next=data.nextCursor;
          if(next&&await refresh(next))setHistory(old=>[...old,cursor]);
        }}>Next</button>
      </div>
      <p>Page {history.length+1}. Cursor pagination does not load the entire fleet into your browser.</p>
    </section>
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}
