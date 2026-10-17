"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";

async function ownerOperation(value:unknown){
  const response=await fetch("/api/v1/owner/coffee",{method:"POST",credentials:"same-origin",
    redirect:"error",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
  const result=await response.json();
  if(!response.ok)throw new Error(typeof result.error==="string"?result.error:"Coffee operation unavailable");
  return result;
}
export function ModerationControl({threadId,messageId}:{threadId:string;messageId?:string}){
  const router=useRouter(),[reason,setReason]=useState("PRIVACY"),[confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState(false),[notice,setNotice]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending||!confirmed)return;setPending(true);setNotice("");
    try{
      await ownerOperation({kind:messageId?"redact-message":"redact-subject",threadId,messageId,reason,confirm:true});
      setConfirmed(false);setNotice("Permanently redacted.");router.refresh();
    }catch(error){setNotice(error instanceof Error?error.message:"Redaction unavailable");}finally{setPending(false);}
  }
  return <details><summary>Owner moderation</summary>
    <form onSubmit={submit}>
      <label>Reason <select value={reason} onChange={e=>setReason(e.target.value)}>
        <option value="PRIVACY">Privacy</option><option value="ABUSE">Abuse</option>
        <option value="OFF_TOPIC">Off topic</option><option value="OTHER">Other</option>
      </select></label>
      <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        I confirm permanent redaction of this {messageId?"message and its references":"subject"}.</label>
      <button disabled={pending||!confirmed} type="submit">{pending?"Redacting…":messageId?"Redact message":"Redact subject"}</button>
      <p role="status" aria-live="polite">{notice}</p>
    </form>
  </details>;
}
export function RetentionControls({initialEnabled,initialDays}:{initialEnabled:boolean;initialDays:number}){
  const router=useRouter();
  const [enabled,setEnabled]=useState(initialEnabled),[activeEnabled,setActiveEnabled]=useState(initialEnabled);
  const [days,setDays]=useState(initialDays),[confirmed,setConfirmed]=useState(false),[purgeConfirmed,setPurgeConfirmed]=useState(false);
  const [pending,setPending]=useState(false),[notice,setNotice]=useState("");
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(pending)return;setPending(true);setNotice("");
    try{
      const result=await ownerOperation({kind:"retention-policy",enabled,retentionDays:days,confirm:confirmed});
      setActiveEnabled(result.enabled);setConfirmed(false);setNotice("Retention policy saved.");router.refresh();
    }catch(error){setNotice(error instanceof Error?error.message:"Retention update unavailable");}finally{setPending(false);}
  }
  async function purge(){
    if(pending||!purgeConfirmed||!activeEnabled)return;setPending(true);setNotice("");
    try{
      const result=await ownerOperation({kind:"purge",confirm:true});
      setPurgeConfirmed(false);setNotice("Redacted "+result.redactedMessages+" messages; "+result.redactedThreads+" discussions completed.");router.refresh();
    }catch(error){setNotice(error instanceof Error?error.message:"Retention unavailable");}finally{setPending(false);}
  }
  return <section className="action-card">
    <h2>Discussion retention</h2>
    <p>Automatic retention is {activeEnabled?"enabled":"disabled"}. Active questions remain available.
      Redaction permanently removes old discussion text and references while preserving accepted decisions and minimal audit records.</p>
    <form onSubmit={save}>
      <label><input type="checkbox" checked={enabled} onChange={e=>{setEnabled(e.target.checked);setConfirmed(false);}}/>
        Automatically redact inactive resolved and closed discussions</label>
      <label>Days since the discussion was last updated <input type="number" min={30} max={3650}
        value={days} required onChange={e=>{setDays(Number(e.target.value));setConfirmed(false);}}/></label>
      {enabled&&<label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
        I confirm permanent redaction under this retention policy.</label>}
      <button type="submit" disabled={pending||(enabled&&!confirmed)}>Save retention policy</button>
    </form>
    <h3>Process an eligible batch now</h3>
    <p>Automatic maintenance continues remaining batches after retention is enabled.</p>
    <label><input type="checkbox" checked={purgeConfirmed} onChange={e=>setPurgeConfirmed(e.target.checked)}/>
      I confirm permanent redaction of eligible old discussion content.</label>
    <button type="button" onClick={purge} disabled={pending||!activeEnabled||!purgeConfirmed}>Run retention batch</button>
    <p role="status" aria-live="polite">{notice}</p>
  </section>;
}
