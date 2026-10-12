"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {githubDiagnosticHint,type GitHubAppDiagnosticCode} from "../../src/domain/github-setup-hints";

type SetupEvidence={
  databaseReady:boolean;
  githubInstallationConnected:boolean;
  githubIssueCode:GitHubAppDiagnosticCode|null;
  githubMissingPermissions:string[];
  actions:{actionKey:string;verified:boolean;newlyVerified:boolean}[];
};
type SyncBatch={
  total:number;processed:number;nextAfterId:string|null;
  verified:number;missing:number;failed:number;
};
export default function VerifySetup(){
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const router=useRouter();

  async function verifyAndImport(){
    setBusy(true);
    setMessage("Verifying secure service configuration…");
    try{
      const response=await fetch("/api/v1/owner/setup/verify",{
        method:"POST",credentials:"same-origin",cache:"no-store"
      });
      if(response.status===401){
        setMessage("Your owner session was not accepted. Sign out and sign in again, then retry.");
        return;
      }
      if(response.status===403){
        setMessage("Boardroom rejected the browser origin security check. Use the official Boardroom address, not a proxy or alias, then retry.");
        return;
      }
      if(!response.ok)throw new Error("Unable to verify service settings ("+response.status+")");
      const result=await response.json() as SetupEvidence;
      if(!result.databaseReady){
        setMessage("Neon database or required owner credentials are not ready. Check the Render environment and /api/ready.");
        router.refresh();
        return;
      }
      if(!result.githubInstallationConnected){
        const hint=githubDiagnosticHint(result.githubIssueCode);
        const permissions=result.githubMissingPermissions?.length
          ? " Missing permissions: "+result.githubMissingPermissions.join(", ")+".":"";
        setMessage("Database verified, but GitHub App is not ready. "+
          (hint??"Check the App ID, installation ID, PEM key and repository installation.")+permissions);
        router.refresh();
        return;
      }

      let cursor:string|null=null;
      let processed=0;
      let verified=0;
      let missing=0;
      let failed=0;
      const seen=new Set<string>();
      setMessage("GitHub App verified. Importing authorized repositories…");
      for(let round=0;round<1000;round++){
        const sync=await fetch("/api/v1/owner/repositories/sync",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({afterId:cursor,limit:3})
        });
        if(sync.status===401)throw new Error("Owner session expired during repository import. Sign in again.");
        if(sync.status===403)throw new Error("Browser origin security check rejected during import. Use the official Boardroom address.");
        if(!sync.ok)throw new Error("Repository import failed at batch "+(round+1)+" (HTTP "+sync.status+")");
        const batch=await sync.json() as SyncBatch;
        if(!Number.isSafeInteger(batch.processed)||batch.processed<0||batch.processed>3||
           !Number.isSafeInteger(batch.total)||batch.total<0||
           !Number.isSafeInteger(batch.verified)||batch.verified<0||
           !Number.isSafeInteger(batch.missing)||batch.missing<0||
           !Number.isSafeInteger(batch.failed)||batch.failed<0)
          throw new Error("Repository importer returned an invalid response");
        processed+=batch.processed;
        verified+=batch.verified;
        missing+=batch.missing;
        failed+=batch.failed;
        setMessage("Imported "+processed+" of "+batch.total+" repositories; "+
          verified+" plans verified, "+missing+" missing, "+failed+" failed.");
        if(!batch.nextAfterId){
          setMessage("Setup verified. Import finished: "+processed+" repositories; "+
            verified+" approved plans, "+missing+" missing plans, "+failed+" failures."+
            (failed?" Open the Work Board to investigate failed imports.":""));
          router.refresh();
          return;
        }
        if(seen.has(batch.nextAfterId)||batch.nextAfterId===cursor)
          throw new Error("Repository importer repeated its cursor");
        seen.add(batch.nextAfterId);
        cursor=batch.nextAfterId;
      }
      throw new Error("Repository inventory exceeds the safe synchronization limit");
    }catch(error){
      setMessage("Verification/import stopped: "+(error instanceof Error?error.message:"Unexpected failure")+
        ". Existing successfully imported repositories are preserved. You can retry safely.");
    }finally{
      setBusy(false);
    }
  }
  return <div className="setup-verification">
    <button type="button" onClick={verifyAndImport} disabled={busy}>
      {busy?"Checking Boardroom…":"Verify setup and import repositories"}
    </button>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
