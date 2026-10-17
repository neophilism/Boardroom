"use client";
import {useState} from "react";
import type {RegisteredAgent,AgentProvider} from "../../src/server/agent-registration";

type Provisioned={name:string;provider:string;token:string};
export default function AgentAdminControls({initialAgents,approvedNames}:{
  initialAgents:RegisteredAgent[];approvedNames:string[]
}){
  const [agents,setAgents]=useState(initialAgents);
  const [name,setName]=useState("");
  const [accountEmail,setAccountEmail]=useState("");
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editEmail,setEditEmail]=useState("");
  const [provider,setProvider]=useState<AgentProvider>("chatgpt");
  const [authentication,setAuthentication]=useState<"oauth"|"bearer">("oauth");
  const [secret,setSecret]=useState<Provisioned|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [copied,setCopied]=useState(false);
  const available=approvedNames.filter(n=>!agents.some(a=>a.name===n));
  const valid=available.includes(name)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail.trim());
  async function register(){
    if(!valid||busy||secret)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/v1/owner/agents",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({name,provider,authentication,accountEmail})
      });
      const body=await response.json() as {
        error?:string;name?:string;provider?:string;credentialId?:string;token?:string;authentication?:string;accountEmail?:string
      };
      if(!response.ok)throw new Error(body.error||"Registration failed");
      if(!body.credentialId||!body.name||!body.provider||body.authentication!==authentication||
        (authentication==="bearer"&&!body.token))throw new Error("Incomplete server response");
      setAgents(old=>[...old,{credentialId:body.credentialId as string,name:body.name as string,
        provider:body.provider as string,createdAt:new Date().toISOString(),accountEmail:body.accountEmail??null}].sort((a,b)=>a.name.localeCompare(b.name)));
      if(authentication==="bearer")setSecret({name:body.name,provider:body.provider,token:body.token!});
      else setMessage(body.name+" is registered. Connect ChatGPT with OAuth and authorize this exact name; registration alone does not connect it.");
      setCopied(false);setName("");setAccountEmail("");
    }catch(e){setMessage(e instanceof Error?e.message:"Registration unavailable");}
    finally{setBusy(false);}
  }
  async function saveEmail(id:string){
    if(busy)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/v1/owner/agents/"+encodeURIComponent(id),{
        method:"PATCH",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},body:JSON.stringify({accountEmail:editEmail})
      });
      const body=await response.json() as {error?:string;accountEmail?:string};
      if(!response.ok||!body.accountEmail)throw new Error(body.error||"Unable to save email");
      setAgents(old=>old.map(a=>a.credentialId===id?{...a,accountEmail:body.accountEmail!}:a));
      setEditingId(null);setMessage("Account email updated.");
    }catch(e){setMessage(e instanceof Error?e.message:"Account email update unavailable");}
    finally{setBusy(false);}
  }
  async function revoke(id:string,nameToRevoke:string){
    if(busy||secret||!window.confirm("Revoke the active credential for "+nameToRevoke+"? The scheduled worker will lose Boardroom access."))return;
    setBusy(true);setMessage("");
    try{
      const result=await fetch("/api/v1/owner/agents/"+encodeURIComponent(id)+"/revoke",{
        method:"POST",credentials:"same-origin",cache:"no-store"
      });
      const response=await result.json() as {error?:string};
      if(!result.ok)throw new Error(response.error||"Revocation failed");
      setAgents(old=>old.filter(a=>a.credentialId!==id));setMessage("Credential revoked for "+nameToRevoke);
    }catch(e){setMessage(e instanceof Error?e.message:"Revocation unavailable");}
    finally{setBusy(false);}
  }
  async function copySecret(){
    if(!secret)return;
    try{await navigator.clipboard.writeText(secret.token);setCopied(true);}
    catch{setMessage("Clipboard access was denied. Manually copy from the temporary field.");}
  }
  return <section className="agent-admin">
    <div className="summary-strip"><strong>{agents.length}</strong> registered agent identities <span>·</span>
      <strong>{approvedNames.length}</strong> permitted names</div>
    <section className="action-card agent-provision">
      <h2>Register a named agent</h2>
      <p>Select an unused approved label and its provider. Native ChatGPT connects through owner-approved OAuth; no bearer credential needs to be copied. External workers can use a one-time credential stored in their protected secret manager. Never put credentials in scheduled instructions.</p>
      <label htmlFor="agent-name">Exact approved name</label>
      <input id="agent-name" list="agent-name-list" autoComplete="off" value={name}
        onChange={e=>setName(e.target.value)} placeholder="e.g. Smith" disabled={busy||!!secret}/>
      <datalist id="agent-name-list">{available.map(n=><option key={n} value={n}/>)}</datalist>
      <label htmlFor="agent-account-email">Account email (required)</label>
      <input id="agent-account-email" type="email" autoComplete="off" value={accountEmail}
        onChange={e=>setAccountEmail(e.target.value)} placeholder="user@example.com" disabled={busy||!!secret}/>
      <p>Use the email of the account where this agent runs. Saved privately in Boardroom's database; this is not login verification.</p>
      <label htmlFor="agent-provider">AI provider</label>
      <select id="agent-provider" value={provider} disabled={busy||!!secret}
        onChange={e=>{const next=e.target.value as AgentProvider;setProvider(next);setAuthentication(next==="chatgpt"?"oauth":"bearer");}}>
        <option value="chatgpt">ChatGPT</option><option value="claude">Claude</option>
        <option value="grok">Grok</option><option value="other">Other</option>
      </select>
      <label htmlFor="agent-authentication">Connection method</label>
      <select id="agent-authentication" value={authentication} disabled={busy||!!secret}
        onChange={e=>setAuthentication(e.target.value as "oauth"|"bearer")}>
        {provider==="chatgpt"&&<option value="oauth">Native ChatGPT OAuth</option>}
        <option value="bearer">External worker secure credential</option>
      </select>
      <button type="button" disabled={!valid||busy||!!secret} onClick={register}>
        {busy?"Registering…":authentication==="oauth"?"Register ChatGPT identity":"Create agent credential"}
      </button>
      {name&&!valid&&!secret&&<p>Enter an unused approved name and a valid account email.</p>}
      {secret&&<div className="credential-once" role="status">
        <h3>One-time credential for {secret.name}</h3>
        <p>Copy and store in a supported external worker&apos;s protected secret manager before closing this section. The raw value cannot be retrieved later.</p>
        <input aria-label="One-time agent credential" readOnly value={secret.token} onFocus={e=>e.target.select()}/>
        <button type="button" onClick={copySecret}>{copied?"Copied":"Copy credential"}</button>
        <button type="button" className="outline" onClick={()=>{setSecret(null);setCopied(false);}}>I have stored it securely</button>
      </div>}
    </section>
    <section className="agent-list-section">
      <h2>Current registered identities</h2>
      {agents.length===0?<p>No agent identities have been registered yet. This is not an agent activity simulator.</p>:
        <div className="agent-list">{agents.map(agent=><div className="agent-entry" key={agent.credentialId}>
          <div><strong>{agent.name}</strong><small>{agent.accountEmail??"Account email not set"} · {agent.provider} · Registered {new Date(agent.createdAt).toLocaleString()}</small>
          {editingId===agent.credentialId&&<div><label htmlFor={"edit-email-"+agent.credentialId}>Edit account email</label>
            <input id={"edit-email-"+agent.credentialId} type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} disabled={busy}/>
            <button type="button" disabled={busy||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim())} onClick={()=>saveEmail(agent.credentialId)}>Save email</button>
            <button type="button" className="outline" disabled={busy} onClick={()=>setEditingId(null)}>Cancel</button></div>}
          </div>
          <div><button className="outline" disabled={busy||!!secret} onClick={()=>{setEditingId(agent.credentialId);setEditEmail(agent.accountEmail??"");}}>Edit email</button>
          <button className="outline" disabled={busy||!!secret} onClick={()=>revoke(agent.credentialId,agent.name)}>Revoke credential</button></div>
        </div>)}</div>}
    </section>
    {message&&<p role="status" aria-live="polite">{message}</p>}
  </section>;
}
