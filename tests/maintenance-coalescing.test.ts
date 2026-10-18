import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {queueInventoryRefresh,queueRepositoryRefresh,preferredMaintenanceKind} from "../src/server/outbox.ts";
import {claimAssignment,reconciliationExpired,REPOSITORY_CLAIM_QUERY,REPOSITORY_CONTINUATION_CLAIM_QUERY,AssignmentConflict} from "../src/server/assignment.ts";

type Recorded={sql:string;params:unknown[]};
function mockInventory(queued:number,running=false){
  const calls:Recorded[]=[];
  const client={
    query:async(sql:string,params:unknown[]=[])=>{
      calls.push({sql,params});
      if(sql.includes("SELECT outbox_id FROM operation_outbox"))
        return {rows:Array.from({length:queued},(_,i)=>({outbox_id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0")})),rowCount:queued};
      if(sql.includes("SELECT EXISTS(SELECT 1 FROM operation_outbox"))return {rows:[{active:running}],rowCount:1};
      return {rows:[],rowCount:1};
    },release:()=>{}
  };
  return {db:{connect:async()=>client} as unknown as Pool,calls};
}
test("15 duplicate inventory requests are superseded once and replaced by one sweep",async()=>{
  const {db,calls}=mockInventory(15);
  await queueInventoryRefresh(db);
  const changes=calls.filter(x=>x.sql.includes("SET state='SUPERSEDED'"));
  assert.equal(changes.length,1);
  assert.equal((changes[0].params[0] as string[]).length,15);
  assert.equal(calls.filter(x=>x.sql.includes("VALUES('inventory-cycle:'")).length,1);
  assert.equal(calls.filter(x=>x.sql==="COMMIT").length,1);
});
test("one pending inventory continuation is preserved and no new sweep is queued",async()=>{
  const {db,calls}=mockInventory(1);
  await queueInventoryRefresh(db);
  assert.equal(calls.some(x=>x.sql.includes("SET state='SUPERSEDED'")),false);
  assert.equal(calls.some(x=>x.sql.includes("VALUES('inventory-cycle:'")),false);
});
test("running inventory prevents duplicate scheduling even after consolidation",async()=>{
  const {db,calls}=mockInventory(15,true);
  await queueInventoryRefresh(db);
  assert.equal(calls.some(x=>x.sql.includes("SET state='SUPERSEDED'")),true);
  assert.equal(calls.some(x=>x.sql.includes("VALUES('inventory-cycle:'")),false);
});
function mockRepository(queued:number){
  const calls:Recorded[]=[];
  const client={
    query:async(sql:string,params:unknown[]=[])=>{
      calls.push({sql,params});
      if(sql.includes("SELECT outbox_id FROM operation_outbox"))
        return {rows:Array.from({length:queued},(_,i)=>({outbox_id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0")})),rowCount:queued};
      if(sql.includes("RETURNING outbox_id"))return {rows:[{outbox_id:"created"}],rowCount:1};
      return {rows:[],rowCount:1};
    }
  };
  return {client:client as unknown as PoolClient,calls};
}
test("webhook repository events coalesce by repository without losing replay identity",async()=>{
  const delivery="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const queued=mockRepository(2);
  assert.equal(await queueRepositoryRefresh(queued.client,"1415596507",delivery),false);
  assert.equal(queued.calls.filter(x=>x.sql.includes("SET state='SUPERSEDED'")).length,1);
  assert.equal(queued.calls.filter(x=>x.sql.includes("RETURNING outbox_id")).length,0);
  const empty=mockRepository(0);
  assert.equal(await queueRepositoryRefresh(empty.client,"1415596507",delivery),true);
  assert.equal(empty.calls.some(x=>x.params[0]==="github:"+delivery),true);
  await assert.rejects(queueRepositoryRefresh(empty.client,"0",delivery));
});
test("repository updates are preferred with a periodic inventory fairness slot",()=>{
  assert.deepEqual(Array.from({length:7},(_,i)=>preferredMaintenanceKind(i)),[
    "sync_repository","sync_repository","sync_inventory","sync_repository","sync_repository","sync_inventory","sync_repository"]);
  assert.throws(()=>preferredMaintenanceKind(-1));
});
test("stale or unknown repository observations block claim until GitHub verification",()=>{
  const now=Date.parse("2026-10-18T16:00:00Z");
  assert.equal(reconciliationExpired(null,now),true);
  assert.equal(reconciliationExpired("bad",now),true);
  assert.equal(reconciliationExpired("2026-10-18T15:58:59Z",now),true);
  assert.equal(reconciliationExpired("2026-10-18T15:59:30Z",now),false);
  assert.equal(reconciliationExpired("2026-10-18T16:02:00Z",now),true);
  assert.match(REPOSITORY_CLAIM_QUERY,/repository_sync_status sync/);
  assert.match(REPOSITORY_CLAIM_QUERY,/sync.last_success_at/);
  assert.match(REPOSITORY_CLAIM_QUERY,/FOR UPDATE OF l SKIP LOCKED/);
});

test("fresh GitHub reconciliation removes merged work before a lease can be allocated",async()=>{
  let selections=0,refreshes=0,leaseWrites=0;
  const client={
    query:async(sql:string)=>{
      if(sql.includes(" AS within_budget "))return {rows:[{within_budget:true}],rowCount:1};
      if(sql.includes("SELECT run_id, state FROM agent_runs"))return {rows:[{state:"ADMITTED"}],rowCount:1};
      if(sql===REPOSITORY_CONTINUATION_CLAIM_QUERY)return {rows:[],rowCount:0};
      if(sql.includes("UPDATE repository_leases"))leaseWrites++;
      return {rows:[],rowCount:0};
    },release:()=>{}
  };
  const db={
    query:async(sql:string)=>{
      if(sql.includes("SELECT state FROM agent_runs"))return {rows:[{state:"ADMITTED"}],rowCount:1};
      if(sql===REPOSITORY_CONTINUATION_CLAIM_QUERY){
        selections++;
        return selections===1?{rows:[{repository_id:"1415596507",last_success_at:new Date(0)}],rowCount:1}
          :{rows:[],rowCount:0};
      }
      throw new Error("Unexpected read before lease");
    },connect:async()=>client
  } as unknown as Pool;
  const claim=await claimAssignment(db,"00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002",async id=>{
    assert.equal(id,"1415596507");refreshes++;
  });
  assert.equal(claim,null);
  assert.equal(refreshes,1);
  assert.equal(leaseWrites,0);
});
test("GitHub preclaim outage fails closed before acquiring a lease",async()=>{
  let connected=false;
  const db={
    query:async(sql:string)=>{
      if(sql.includes("SELECT state FROM agent_runs"))return {rows:[{state:"ADMITTED"}],rowCount:1};
      if(sql===REPOSITORY_CONTINUATION_CLAIM_QUERY)return {rows:[{repository_id:"1415596507",last_success_at:new Date(0)}],rowCount:1};
      throw new Error("Unexpected SQL read");
    },connect:async()=>{connected=true;throw new Error("Should not acquire a lease");}
  } as unknown as Pool;
  await assert.rejects(claimAssignment(db,"00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002",
    async()=>{throw new Error("GitHub outage");}),AssignmentConflict);
  assert.equal(connected,false);
});
