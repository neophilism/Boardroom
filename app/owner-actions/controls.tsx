"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
export default function OwnerActionControls({actionId,status,actionType}:{actionId:string;status:string;actionType:string}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const router=useRouter();
  if(!["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"].includes(status))return null;
  async function change(next:string){
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/v1/owner-actions/"+encodeURIComponent(actionId)+"/respond",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status:next})
      });
      if(!response.ok)throw new Error("Update could not be saved");
      router.refresh();
    }catch{setError("Unable to update this request.");}
    finally{setBusy(false);}
  }
  return <div className="card-actions">
    {actionType==="APPROVAL"&&<button disabled={busy} onClick={()=>change("VERIFIED")}>Approve exact action</button>}
    {status==="OPEN"&&<button disabled={busy} onClick={()=>change("ACKNOWLEDGED")}>Acknowledge</button>}
    {status!=="AWAITING_VERIFICATION"&&<button disabled={busy} onClick={()=>change("AWAITING_VERIFICATION")}>Done — verify</button>}
    <button className="outline" disabled={busy} onClick={()=>change("DECLINED")}>Decline</button>
    {error&&<p role="alert" className="error">{error}</p>}
  </div>;
}
