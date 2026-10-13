"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {safeOwnerReturnTo} from "../../src/domain/owner-return";
export default function LoginPage(){
  const [token,setToken]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const router=useRouter();
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError("");
    try{
      const r=await fetch("/api/v1/owner/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({token}),cache:"no-store"});
      if(!r.ok){
        if(r.status===401)
          setError("Boardroom did not accept that owner credential. Use the exact BOARDROOM_OWNER_API_TOKEN from Render—not the session secret or credential pepper. No extra quotation marks or spaces.");
        else if(r.status===503)
          setError("Boardroom owner sign-in is unavailable because of its server configuration. Check the Render service environment and redeploy, then try again.");
        else if(r.status===429)
          setError("Too many sign-in attempts. Wait before trying again.");
        else
          setError("The sign-in request was rejected (HTTP "+r.status+"). Please retry.");
        return;
      }
      setToken("");router.replace(safeOwnerReturnTo(new URL(window.location.href).searchParams.get("next")));router.refresh();
    }catch{setError("Boardroom is unreachable.");}
    finally{setBusy(false);}
  }
  return <main className="owner-shell">
    <section className="login-panel">
      <p className="eyebrow">BOARDROOM / PRIVATE OWNER ACCESS</p>
      <h1>Sign in</h1>
      <p>Enter your Boardroom owner credential. A signed, HTTP-only session cookie is used after sign-in.</p>
      <form onSubmit={submit}>
        <label htmlFor="owner-token">Owner access credential</label>
        <input id="owner-token" type="password" autoComplete="off" spellCheck={false} value={token} onChange={e=>setToken(e.target.value)} required minLength={32}/>
        <button type="submit" disabled={busy}>{busy?"Verifying…":"Open Boardroom"}</button>
      </form>
      {error&&<p role="alert" className="error">{error}</p>}
      <p className="fineprint">This initial owner-secret login must be upgraded to MFA-backed identity before production security acceptance.</p>
    </section>
  </main>;
}
