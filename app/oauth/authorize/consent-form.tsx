"use client";
import {useSyncExternalStore,useState,type FormEvent} from "react";
import {submitOAuthConsent,ConsentSubmissionError} from "../../../src/sdk/oauth-consent-client";
const subscribe=()=>()=>{};
const clientReady=()=>true,serverReady=()=>false;

export default function ConsentForm({fields,agents,issuer}:{fields:Record<string,string>;
  agents:Array<{credentialId:string;name:string;provider:string}>;issuer:string}){
  const ready=useSyncExternalStore(subscribe,clientReady,serverReady);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!ready||busy)return;
    const button=(event.nativeEvent as SubmitEvent).submitter;
    if(!(button instanceof HTMLButtonElement)||!["allow","deny"].includes(button.value)){
      setError("Choose Authorize or Deny to continue.");return;
    }
    const form=new URLSearchParams();
    new FormData(event.currentTarget).forEach((value,key)=>{if(typeof value==="string")form.append(key,value);});
    form.set("decision",button.value);setBusy(true);setError("");
    try{window.location.assign(await submitOAuthConsent(form,issuer));}
    catch(error){setError(error instanceof ConsentSubmissionError?error.message:"Connection unavailable. Restart it from ChatGPT.");setBusy(false);}
  }
  return <form onSubmit={submit}>
    {Object.entries(fields).map(([name,value])=><input type="hidden" name={name} value={value} key={name}/>)}
    <label htmlFor="oauth-agent">Named agent</label>
    <select id="oauth-agent" name="credential_id" required disabled={busy}>
      {agents.map(a=><option key={a.credentialId} value={a.credentialId}>{a.name} · {a.provider}</option>)}
    </select>
    <button type="submit" name="decision" value="allow" disabled={!ready||busy}>{busy?"Connecting…":"Authorize this named agent"}</button>
    <button type="submit" name="decision" value="deny" className="outline" disabled={!ready||busy}>Deny connection</button>
    <noscript>JavaScript is required to complete this secure connection.</noscript>
    {error&&<p role="alert" className="error">{error}</p>}
  </form>;
}
