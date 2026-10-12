"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export default function VerifySetup(){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const router=useRouter();
  async function check(){
    setBusy(true);setMessage("");
    try{
      const r=await fetch("/api/v1/owner/setup/verify",{method:"POST",credentials:"same-origin"});
      if(!r.ok)throw new Error("Check failed");
      const data=await r.json();
      setMessage(data.actions.filter((x:{verified:boolean})=>x.verified).length+" setup checks verified");
      router.refresh();
    }catch{setMessage("Cannot verify current setup");}
    finally{setBusy(false);}
  }
  return <div><button onClick={check} disabled={busy}>{busy?"Verifying…":"Verify setup now"}</button><p role="status">{message}</p></div>;
}
