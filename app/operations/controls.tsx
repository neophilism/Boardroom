"use client";
import {useState} from "react";
type Policy={repositoryId:string;fullName:string;autoMerge:boolean;requiredChecks:string[];minimumReviews:number};
export default function OperationsControls({paused,repositories}:{paused:boolean;repositories:Policy[]}){
  const [pause,setPause]=useState(paused),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  async function send(body:Record<string,unknown>){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/v1/owner/operations",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Update failed");
      setMessage("Saved.");return true;
    }catch(error){setMessage(error instanceof Error?error.message:"Update unavailable");return false;}
    finally{setBusy(false);}
  }
  return <section>
    <button disabled={busy} onClick={async()=>{if(await send({kind:"pause",paused:!pause}))setPause(!pause);}}>{pause?"Resume repository work":"Pause new claims and GitHub writes"}</button>
    <p>{pause?"Work is paused. Active sessions can checkpoint and finish.":"Eligible named agents can claim work. Merges follow each repository's policy."}</p>
    <h2>Repository merge policies</h2>
    {repositories.map(r=><PolicyEditor key={r.repositoryId} initial={r} send={send} busy={busy}/>)}
    {message&&<p role="status">{message}</p>}
  </section>;
}
function PolicyEditor({initial,send,busy}:{initial:Policy;send:(body:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){
  const [enabled,setEnabled]=useState(initial.autoMerge),[checks,setChecks]=useState(initial.requiredChecks.join("\n")),[reviews,setReviews]=useState(initial.minimumReviews);
  return <details className="action-card"><summary>{initial.fullName}</summary>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable automatic merges of approved work</label>
    <label>Required CI check names (one per line)<textarea value={checks} onChange={e=>setChecks(e.target.value)}/></label>
    <label>Approvals required on the latest commit<input type="number" min="0" max="10" value={reviews} onChange={e=>setReviews(Number(e.target.value))}/></label>
    <button disabled={busy} onClick={()=>send({kind:"policy",repositoryId:initial.repositoryId,autoMerge:enabled,requiredChecks:checks.split("\n").map(s=>s.trim()).filter(Boolean),minimumReviews:reviews})}>Save merge policy</button>
  </details>;
}
