"use client";
import {useState} from "react";
export default function RecoveryControls({runId}:{runId:string}){
  const [verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function recover(){
    if(!verified||busy)return;setBusy(true);
    try{
      const response=await fetch("/api/v1/owner/operations",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({kind:"recover",runId,externalExecutionStopped:true})});
      const value=await response.json();if(!response.ok)throw new Error(value.error??"Recovery failed");
      setMessage("Credential revoked and old run fenced. Repository released. Issue a new credential before restarting this named agent.");
    }catch(error){setMessage(error instanceof Error?error.message:"Recovery unavailable");}finally{setBusy(false);}
  }
  return <section><label><input type="checkbox" checked={verified} disabled={busy} onChange={e=>setVerified(e.target.checked)}/>
    I verified that the old execution stopped or was isolated, and that outside GitHub credentials cannot still write.</label>
    <button disabled={!verified||busy} onClick={recover}>{busy?"Fencing…":"Revoke, fence and recover repository"}</button>
    {message&&<p role="status">{message}</p>}</section>;
}
