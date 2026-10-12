"use client";
import {useRouter} from "next/navigation";
import {useState} from "react";
type Batch={total:number;processed:number;nextAfterId:string|null;verified:number;missing:number;failed:number};
export default function RepositorySyncControls(){
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState("");
  const router=useRouter();
  async function run(){
    setWorking(true);setMessage("Synchronizing with GitHub…");
    let afterId:string|null=null,processed=0,verified=0,missing=0,failed=0,total=0;
    const seen=new Set<string>();
    try{
      for(let round=0;round<1000;round++){
        const response=await fetch("/api/v1/owner/repositories/sync",{
          method:"POST",credentials:"same-origin",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({afterId,limit:3})
        });
        if(!response.ok)throw new Error("Sync API returned "+response.status);
        const batch=await response.json() as Batch;
        if(!Number.isSafeInteger(batch.processed)||batch.processed<0||batch.processed>3||
           !Number.isSafeInteger(batch.total)||batch.total<0)
          throw new Error("Unexpected repository sync response");
        total=batch.total;processed+=batch.processed;
        verified+=batch.verified;missing+=batch.missing;failed+=batch.failed;
        setMessage("Processed "+processed+" of "+total+" · plans verified "+verified+
          " · missing "+missing+" · failures "+failed);
        if(!batch.nextAfterId){
          setMessage("Finished: "+processed+" repositories · verified "+verified+
            " · missing plans "+missing+" · failures "+failed);
          router.refresh();
          return;
        }
        if(seen.has(batch.nextAfterId))throw new Error("Repeated sync cursor");
        seen.add(batch.nextAfterId);afterId=batch.nextAfterId;
      }
      throw new Error("Too many batches; try again after investigating the inventory");
    }catch(error){
      setMessage("Sync stopped: "+(error instanceof Error?error.message:"Unexpected error")+
        ". Verify Boardroom's GitHub App connection and try again.");
    }finally{setWorking(false);}
  }
  return <div className="repo-sync-controls">
    <button type="button" onClick={run} disabled={working}>{working?"Refreshing repositories…":"Refresh from GitHub"}</button>
    <span role="status" aria-live="polite">{message}</span>
  </div>;
}
