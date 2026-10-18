"use client";
import {useState} from "react";
type Policy={repositoryId:string;fullName:string;autoMerge:boolean;requiredChecks:string[];maxSessionSeconds:number;maxToolCalls:number;maxTokens:number};
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
    <h2>Repository limits and merge policies</h2>
    {repositories.map(r=><PolicyEditor key={r.repositoryId} initial={r} send={send} busy={busy}/>)}
    {message&&<p role="status">{message}</p>}
  </section>;
}
function PolicyEditor({initial,send,busy}:{initial:Policy;send:(body:Record<string,unknown>)=>Promise<boolean>;busy:boolean}){
  const [enabled,setEnabled]=useState(initial.autoMerge),[checks,setChecks]=useState(initial.requiredChecks.join("\n"));
  const [seconds,setSeconds]=useState(initial.maxSessionSeconds),[calls,setCalls]=useState(initial.maxToolCalls),[tokens,setTokens]=useState(initial.maxTokens);
  return <details className="action-card"><summary>{initial.fullName}</summary>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Enable automatic merges of approved work</label>
    <label>Required CI check names (one per line)<textarea value={checks} onChange={e=>setChecks(e.target.value)}/></label>
    <label>Maximum session duration in seconds<input type="number" min="60" max="14400" value={seconds} onChange={e=>setSeconds(Number(e.target.value))}/></label>
    <label>Maximum tools per hosted session<input type="number" min="1" max="1000" value={calls} onChange={e=>setCalls(Number(e.target.value))}/></label>
    <label>Maximum tokens per hosted session<input type="number" min="1" max="10000000" value={tokens} onChange={e=>setTokens(Number(e.target.value))}/></label>
    <p>GitHub&apos;s actual branch-protection and review requirements are enforced at merge time; Boardroom does not require an additional human approval. Required CI must pass on the PR&apos;s current head.</p>
    <p>Hosted workers obey the tighter repository or runtime limit. The separate shared daily spending cap also applies.</p>
    <button disabled={busy} onClick={()=>send({kind:"policy",repositoryId:initial.repositoryId,autoMerge:enabled,requiredChecks:checks.split("\n").map(s=>s.trim()).filter(Boolean),maxSessionSeconds:seconds,maxToolCalls:calls,maxTokens:tokens})}>Save limits and merge policy</button>
  </details>;
}
