"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";

type Repository={repositoryId:string;fullName:string;description:string|null;position:number|null;lastDevelopmentAt:string|null;createdAt:string};
export default function PriorityControls({repositories}:{repositories:Repository[]}){
  const initial=repositories.filter(r=>r.position!==null).sort((a,b)=>(a.position??0)-(b.position??0)).map(r=>r.repositoryId);
  const [ordered,setOrdered]=useState<string[]>(initial);
  const [candidate,setCandidate]=useState("");
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const router=useRouter();
  const byId=new Map(repositories.map(r=>[r.repositoryId,r]));
  const available=repositories.filter(r=>!ordered.includes(r.repositoryId));
  const move=(index:number,direction:number)=>{
    const next=index+direction;
    if(next<0||next>=ordered.length)return;
    setOrdered(current=>{const result=[...current];[result[index],result[next]]=[result[next],result[index]];return result;});
    setNotice("");
  };
  const add=()=>{
    if(!candidate||ordered.includes(candidate))return;
    setOrdered(current=>[...current,candidate]);setCandidate("");setNotice("");
  };
  const remove=(id:string)=>{setOrdered(current=>current.filter(x=>x!==id));setNotice("");};
  const changed=ordered.join("\u0000")!==initial.join("\u0000");
  async function save(){
    setSaving(true);setNotice("");
    try{
      const res=await fetch("/api/v1/owner/priorities",{
        method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({repositoryIds:ordered})
      });
      if(!res.ok)throw new Error("Priority changes were not saved");
      setNotice("Priority order saved.");router.refresh();
    }catch{setNotice("Unable to save. Check your session and repository eligibility.");}
    finally{setSaving(false);}
  }
  return <section className="priority-panel" aria-label="Repository priority editor">
    <h2>Priority order</h2>
    <p>The top entry is assigned first. Each repository can appear only once.</p>
    {ordered.length===0?<p>No priority repositories selected. Agents will use the least-recently-updated fallback.</p>:
      <ol className="priority-list">{ordered.map((id,i)=>{
        const r=byId.get(id);
        return <li key={id} className="priority-list-item">
          <div className="priority-repo"><strong>{r?.fullName??id}</strong><small>{r?.description||"No description available"}</small></div>
          <div className="priority-item-controls">
            <button aria-label={`Move ${r?.fullName??id} higher`} disabled={saving||i===0} onClick={()=>move(i,-1)}>↑</button>
            <button aria-label={`Move ${r?.fullName??id} lower`} disabled={saving||i===ordered.length-1} onClick={()=>move(i,1)}>↓</button>
            <button className="outline" aria-label={`Remove ${r?.fullName??id} from priorities`} disabled={saving} onClick={()=>remove(id)}>Remove</button>
          </div>
        </li>;
      })}</ol>}
    <div className="priority-add">
      <label htmlFor="priority-add-repo">Add repository</label>
      <select id="priority-add-repo" value={candidate} onChange={e=>setCandidate(e.target.value)} disabled={saving||available.length===0}>
        <option value="">Select an eligible repository</option>
        {available.map(r=><option value={r.repositoryId} key={r.repositoryId}>{r.fullName}</option>)}
      </select>
      <button disabled={saving||!candidate} onClick={add}>Add</button>
    </div>
    {repositories.length===0&&<p>No repositories have been registered yet. The GitHub inventory import must be configured and run first.</p>}
    <div className="priority-footer">
      <button disabled={saving||!changed} onClick={save}>{saving?"Saving…":"Save priority order"}</button>
      <span role="status" aria-live="polite">{notice}</span>
    </div>
    <h2>Ordinary repository fallback</h2>
    <p>The following eligible repositories are not on the priority list. The oldest genuine development timestamp wins when no priority repository is available.</p>
    <ul className="priority-fallback">{available.map(r=><li key={r.repositoryId}>
      <strong>{r.fullName}</strong>
      <span>{new Date(r.lastDevelopmentAt??r.createdAt).toLocaleString()}</span>
    </li>)}</ul>
  </section>;
}
