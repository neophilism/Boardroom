import type {Pool,PoolClient} from "pg";
import {synchronizeInstalledRepositories,synchronizeRepositoryById} from "./repository-sync.ts";
import {GitHubAppError} from "./github-app.ts";
import {inventoryPageOutcome} from "../domain/inventory-page.ts";
export function retryDelaySeconds(attempt:number):number{
  return Math.min(900,15*2**Math.max(0,Math.min(6,attempt-1)));
}
const QUEUE_LOCK_NAMESPACE=21410;
export function preferredMaintenanceKind(slot:number):"sync_inventory"|"sync_repository"{
  if(!Number.isSafeInteger(slot)||slot<0)throw new Error("Invalid maintenance slot");
  return slot%3===2?"sync_inventory":"sync_repository";
}

/**
 * GitHub webhook delivery IDs provide event replay protection; this separate
 * advisory lock coalesces events for the same repository. An existing RUNNING
 * refresh never masks a newly delivered event: a follow-up remains queued.
 */
export async function queueRepositoryRefresh(client:PoolClient,repositoryId:string,deliveryId:string){
  if(!/^[1-9][0-9]{0,18}$/.test(repositoryId)||!/^[a-f0-9-]{36}$/i.test(deliveryId))
    throw new Error("Invalid repository refresh identity");
  await client.query("SELECT pg_advisory_xact_lock($1,hashtext($2))",[QUEUE_LOCK_NAMESPACE,repositoryId]);
  const pending=await client.query<{outbox_id:string}>(`SELECT outbox_id FROM operation_outbox
    WHERE operation_type='sync_repository' AND state IN ('PENDING','RETRY')
      AND payload->>'repositoryId'=$1
    ORDER BY created_at DESC,outbox_id DESC FOR UPDATE`,[repositoryId]);
  if(pending.rows.length>1){
    const redundant=pending.rows.slice(1).map(row=>row.outbox_id);
    await client.query(`UPDATE operation_outbox SET state='SUPERSEDED',
      completed_at=now(),last_error_code='DUPLICATE_REPOSITORY_REFRESH'
      WHERE outbox_id=ANY($1::uuid[]) AND state IN ('PENDING','RETRY')`,[redundant]);
    await client.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.queue.coalesced',$2::jsonb)",
      [repositoryId,JSON.stringify({operation:"sync_repository",superseded:redundant.length})]);
  }
  if(pending.rows.length)return false;
  const inserted=await client.query(`INSERT INTO operation_outbox(idempotency_key,operation_type,payload)
    VALUES($1,'sync_repository',$2::jsonb) ON CONFLICT DO NOTHING RETURNING outbox_id`,
    ["github:"+deliveryId,JSON.stringify({repositoryId})]);
  return inserted.rowCount===1;
}

/**
 * A new inventory sweep is queued only when no active sweep or continuation
 * exists. Legacy redundant sweeps are explicitly SUPERSEDED (never falsified
 * as completed), and a fresh sweep replaces them under one advisory lock.
 */
export async function queueInventoryRefresh(db:Pool){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)",[QUEUE_LOCK_NAMESPACE,0]);
    const pending=await client.query<{outbox_id:string}>(`SELECT outbox_id FROM operation_outbox
      WHERE operation_type='sync_inventory' AND state IN ('PENDING','RETRY')
      ORDER BY created_at DESC,outbox_id DESC FOR UPDATE`);
    if(pending.rows.length>1){
      const duplicateIds=pending.rows.map(row=>row.outbox_id);
      await client.query(`UPDATE operation_outbox SET state='SUPERSEDED',
        completed_at=now(),last_error_code='COALESCED_INVENTORY_SWEEP'
        WHERE outbox_id=ANY($1::uuid[]) AND state IN ('PENDING','RETRY')`,[duplicateIds]);
      await client.query("INSERT INTO audit_events(kind,details) VALUES('maintenance.queue.coalesced',$1::jsonb)",
        [JSON.stringify({operation:"sync_inventory",superseded:duplicateIds.length})]);
    }
    const running=await client.query<{active:boolean}>(`SELECT EXISTS(SELECT 1 FROM operation_outbox
      WHERE operation_type='sync_inventory' AND state='RUNNING') AS active`);
    if(!running.rows[0]?.active&&(pending.rows.length===0||pending.rows.length>1))
      await client.query(`INSERT INTO operation_outbox(idempotency_key,operation_type,payload)
        VALUES('inventory-cycle:'||gen_random_uuid()::text,'sync_inventory','{}'::jsonb)`);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
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
      const ready=await client.query<NonNullable<typeof item>>("SELECT outbox_id,operation_type,payload,attempts FROM operation_outbox WHERE state IN ('PENDING','RETRY') AND available_at<=now() ORDER BY CASE WHEN operation_type=$1 THEN 0 ELSE 1 END,available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1",[preferredMaintenanceKind(i)]);
      item=ready.rows[0];
      if(item)await client.query("UPDATE operation_outbox SET state='RUNNING',attempts=attempts+1,claimed_at=now() WHERE outbox_id=$1",[item.outbox_id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    if(!item)break;
    let partialInventory=false;
    try{
      if(item.operation_type==="sync_repository")await synchronizeRepositoryById(String(item.payload.repositoryId));
      else if(item.operation_type==="sync_inventory"){
        const report=await synchronizeInstalledRepositories({limit:6,afterId:typeof item.payload.afterId==="string"?item.payload.afterId:null});
        // A failed repository remains ERROR/unapproved, but a partial page
        // must never strand the rest of the inventory behind the same cursor.
        const outcome=inventoryPageOutcome(report);
        if(outcome.partial){
          partialInventory=true;
          await db.query("INSERT INTO audit_events(kind,details) VALUES('maintenance.inventory.partial_failure',$1::jsonb)",
            [JSON.stringify({outboxId:item.outbox_id,processed:report.processed,failed:report.failed,
              repositories:outcome.failedRepositories})]);
        }
        if(outcome.nextAfterId)await db.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES($1,'sync_inventory',$2::jsonb) ON CONFLICT DO NOTHING",["inventory-continuation:"+item.outbox_id,JSON.stringify({afterId:outcome.nextAfterId})]);
      }else throw new Error("Unsupported outbox operation");
      await db.query("UPDATE operation_outbox SET state='DONE',completed_at=now(),last_error_code=$2 WHERE outbox_id=$1",
        [item.outbox_id,partialInventory?"PARTIAL_REPOSITORY_FAILURE":null]);report.done++;
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
