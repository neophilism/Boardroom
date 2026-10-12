import type {Pool} from "pg";
import {synchronizeInstalledRepositories,synchronizeRepositoryById} from "./repository-sync.ts";
import {GitHubAppError} from "./github-app.ts";
export function retryDelaySeconds(attempt:number):number{
  return Math.min(900,15*2**Math.max(0,Math.min(6,attempt-1)));
}
export async function queueInventoryRefresh(db:Pool){
  const key="inventory:"+Math.floor(Date.now()/(15*60*1000));
  await db.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES($1,'sync_inventory','{}'::jsonb) ON CONFLICT DO NOTHING",[key]);
}
/** Crash replay is safe because handlers read authoritative GitHub state.
 * This dispatcher never retries an unrecorded privileged source write.
 */
export async function dispatchOutbox(db:Pool,limit=5){
  const report={done:0,retry:0,failed:0};
  if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new Error("Invalid dispatch limit");
  await db.query("UPDATE operation_outbox SET state='RETRY',available_at=now(),claimed_at=NULL WHERE state='RUNNING' AND claimed_at<now()-interval '5 minutes'");
  for(let i=0;i<limit;i++){
    const client=await db.connect();let item:{outbox_id:string;operation_type:string;payload:Record<string,unknown>;attempts:number}|undefined;
    try{
      await client.query("BEGIN");
      const ready=await client.query<NonNullable<typeof item>>("SELECT outbox_id,operation_type,payload,attempts FROM operation_outbox WHERE state IN ('PENDING','RETRY') AND available_at<=now() ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1");
      item=ready.rows[0];
      if(item)await client.query("UPDATE operation_outbox SET state='RUNNING',attempts=attempts+1,claimed_at=now() WHERE outbox_id=$1",[item.outbox_id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    if(!item)break;
    try{
      if(item.operation_type==="sync_repository")await synchronizeRepositoryById(String(item.payload.repositoryId));
      else if(item.operation_type==="sync_inventory"){
        const report=await synchronizeInstalledRepositories({limit:3,afterId:typeof item.payload.afterId==="string"?item.payload.afterId:null});
        if(report.failed)throw new Error("Reconciliation failure");
        if(report.nextAfterId)await db.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES($1,'sync_inventory',$2::jsonb) ON CONFLICT DO NOTHING",["inventory-continuation:"+item.outbox_id,JSON.stringify({afterId:report.nextAfterId})]);
      }else throw new Error("Unsupported outbox operation");
      await db.query("UPDATE operation_outbox SET state='DONE',completed_at=now(),last_error_code=NULL WHERE outbox_id=$1",[item.outbox_id]);report.done++;
    }catch(error){
      const attempt=item.attempts+1,permanent=attempt>=5||(error instanceof GitHubAppError&&[401,403,404,422].includes(error.httpStatus));
      const code=error instanceof GitHubAppError?"GITHUB_HTTP_"+error.httpStatus:"RECONCILIATION_UNAVAILABLE";
      await db.query("UPDATE operation_outbox SET state=$2,last_error_code=$3,available_at=now()+make_interval(secs=>$4),claimed_at=NULL WHERE outbox_id=$1",
        [item.outbox_id,permanent?"FAILED":"RETRY",code,retryDelaySeconds(attempt)]);
      if(permanent)report.failed++;else report.retry++;
    }
  }
  return report;
}
