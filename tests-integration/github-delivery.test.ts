import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {acceptGitHubWebhook,GitHubDeliveryError} from "../src/server/webhook.ts";
import {synchronizeRepositorySnapshot} from "../src/server/repository-sync.ts";
import {reserveRepositoryObservation} from "../src/server/repository-observation.ts";
import type {GitHubRepository,GitHubPull} from "../src/server/github-app.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Webhook fixtures require the explicit boardroom_test database");
const schema="github_delivery_"+randomUUID().replaceAll("-","");
const admin=new Pool({connectionString:url,max:1});
const db=new Pool({connectionString:url,max:8,options:"-c search_path="+schema+",public"});
const repository=(id:number,name="ci/webhook-"+id):GitHubRepository=>({id,full_name:name,created_at:"2026-01-01T00:00:00Z",updated_at:"2026-01-02T00:00:00Z",pushed_at:"2026-01-02T00:00:00Z",description:null,archived:false});
const body=(id:number,extra:Record<string,unknown>={})=>JSON.stringify({installation:{id:7},repository:{id},...extra});
const plan=(name:string)=>({schemaVersion:1,repository:name,roadmapVersion:1,planVerified:true,plannedPrCount:1,observedAt:"2026-01-01T00:00:00Z",units:[{id:"WEB-001",title:"Webhook fixture",dependsOn:[],prs:[7]}],pullRequests:[]});
const pull=(merged:boolean):GitHubPull=>({number:7,title:"WEB-001: Fixture",state:merged?"closed":"open",created_at:"2026-01-02T00:00:00Z",updated_at:"2026-01-03T00:00:00Z",merged_at:merged?"2026-01-03T00:00:00Z":null});
const services=(repo:GitHubRepository,merged=true)=>({request:async()=>repo,roadmap:async()=>plan(repo.full_name),pulls:async()=>[pull(merged)]});
async function seed(id:number){
  const repo=repository(id);
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at,enabled) VALUES($1,$2,$3,FALSE)",[id,repo.full_name,repo.created_at]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'WEB-001','Webhook fixture',1,TRUE,'ACCEPTED')",[id]);
  return repo;
}
before(async()=>{
  await admin.query('CREATE SCHEMA "'+schema+'"');
  for(const item of MIGRATION_MANIFEST){
    const sql=await readFile(new URL("../db/migrations/"+item.filename,import.meta.url),"utf8");
    assert.equal(createHash("sha256").update(sql).digest("hex"),item.sha256);await db.query(sql);
  }
});
after(async()=>{await db.end();await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();});

test("parallel duplicate IDs and identical-body replays enqueue once without retaining private payloads",async()=>{
  await seed(1);const delivery=randomUUID(),raw=body(1,{action:"private-owner-name",commits:[{message:"private fixture source"}],pull_request:{state:"open",merged:false}});
  const results=await Promise.all(Array.from({length:12},()=>acceptGitHubWebhook(db,delivery,"push",raw,"7")));
  assert.equal(results.filter(x=>x.replay===false).length,1);
  assert.equal((await db.query("SELECT * FROM github_events")).rowCount,1);
  assert.equal((await db.query("SELECT * FROM operation_outbox")).rowCount,1);
  const stored=(await db.query("SELECT payload,received_at FROM github_events")).rows[0];
  assert.ok(!JSON.stringify(stored).includes("private-owner-name"));assert.ok(!JSON.stringify(stored).includes("private fixture source"));
  await db.query("UPDATE operation_outbox SET state='DONE'");
  assert.equal((await acceptGitHubWebhook(db,delivery.toUpperCase(),"push",raw,"7")).replay,true);
  assert.equal((await acceptGitHubWebhook(db,randomUUID(),"push",raw,"7")).replay,true);
  assert.equal((await db.query("SELECT * FROM operation_outbox")).rowCount,1);
  assert.equal((await db.query("SELECT received_at FROM github_events")).rows[0].received_at.getTime(),stored.received_at.getTime());
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=1")).rows[0].state,"ACCEPTED");
});
test("delivery-ID collisions fail closed and never overwrite the recorded event or queue",async()=>{
  await seed(2);const id=randomUUID();await acceptGitHubWebhook(db,id,"repository",body(2,{action:"edited"}),"7");
  await assert.rejects(acceptGitHubWebhook(db,id,"repository",body(2,{action:"renamed"}),"7"),GitHubDeliveryError);
  await assert.rejects(acceptGitHubWebhook(db,id,"workflow_run",body(2,{action:"edited"}),"7"),GitHubDeliveryError);
  assert.equal((await db.query("SELECT * FROM github_events WHERE delivery_id=$1",[id])).rowCount,1);
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE idempotency_key LIKE $1",["github:"+id+":%"])).rowCount,1);
});
test("queue insertion failure rolls back event deduplication, so redelivery remains actionable",async()=>{
  await seed(3);const id=randomUUID(),raw=body(3);
  await db.query(`CREATE FUNCTION reject_delivery_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected queue failure'; END $$;
    CREATE TRIGGER reject_delivery_queue BEFORE INSERT ON operation_outbox FOR EACH ROW EXECUTE FUNCTION reject_delivery_queue()`);
  try{await assert.rejects(acceptGitHubWebhook(db,id,"pull_request",raw,"7"),/Injected queue failure/);}
  finally{await db.query("DROP TRIGGER reject_delivery_queue ON operation_outbox; DROP FUNCTION reject_delivery_queue()");}
  assert.equal((await db.query("SELECT * FROM github_events WHERE delivery_id=$1",[id])).rowCount,0);
  assert.equal((await acceptGitHubWebhook(db,id,"pull_request",raw,"7")).replay,false);
});
test("installation changes queue current reads for known IDs plus inventory, without applying payload state",async()=>{
  await seed(4);const id=randomUUID(),raw=JSON.stringify({installation:{id:7},repositories_added:[{id:999,name:"not-authority"}],repositories_removed:[{id:4,archived:true}]});
  await acceptGitHubWebhook(db,id,"installation_repositories",raw,"7");
  const jobs=await db.query("SELECT operation_type,payload FROM operation_outbox WHERE idempotency_key LIKE $1 OR idempotency_key=$2",["github:"+id+":%","github-inventory:"+id]);
  assert.deepEqual(new Set(jobs.rows.map(x=>x.operation_type)),new Set(["sync_repository","sync_inventory"]));
  assert.equal((await db.query("SELECT approved FROM roadmap_units WHERE repository_id=4")).rows[0].approved,true);
  assert.equal((await db.query("SELECT * FROM repositories WHERE repository_id=999")).rowCount,0);
  const ping=randomUUID();await acceptGitHubWebhook(db,ping,"ping","{}","7");
  assert.equal((await acceptGitHubWebhook(db,ping,"ping","{}","7")).replay,true);
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE idempotency_key LIKE $1",["github:"+ping+":%"])).rowCount,0);
  assert.equal((await acceptGitHubWebhook(db,randomUUID(),"push",body(999),"7")).unregistered,true);
});
test("out-of-order event claims never replace authoritative merged state or advance source freshness",async()=>{
  const repo=await seed(5);
  await db.query("UPDATE roadmap_units SET state='PENDING' WHERE repository_id=5");
  await acceptGitHubWebhook(db,randomUUID(),"pull_request",body(5,{action:"closed",pull_request:{merged:true}}),"7");
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=5")).rows[0].state,"PENDING");
  assert.equal(await synchronizeRepositorySnapshot(repo,db,services(repo)),"VERIFIED");
  const before=(await db.query("SELECT source_observed_at FROM repositories WHERE repository_id=5")).rows[0].source_observed_at;
  await acceptGitHubWebhook(db,randomUUID(),"pull_request",body(5,{action:"opened",pull_request:{merged:false,state:"open"}}),"7");
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=5")).rows[0].state,"MERGED");
  assert.equal((await db.query("SELECT source_observed_at FROM repositories WHERE repository_id=5")).rows[0].source_observed_at.getTime(),before.getTime());
  await synchronizeRepositorySnapshot(repo,db,services(repo));
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=5")).rows[0].state,"MERGED");
});
test("a delayed older snapshot cannot overwrite a newer merged and renamed observation",async()=>{
  const repo=await seed(6);await db.query("UPDATE roadmap_units SET state='PENDING' WHERE repository_id=6");
  let started!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const old=synchronizeRepositorySnapshot(repo,db,{...services(repo,false),request:async()=>{started();await gate;return repo;}});
  await waiting;
  const fresh={...repo,full_name:"ci/webhook-renamed-6",pushed_at:"2026-01-04T00:00:00Z"};
  assert.equal(await synchronizeRepositorySnapshot(repo,db,services(fresh)),"VERIFIED");
  release();assert.equal(await old,"SUPERSEDED");
  const observed=(await db.query("SELECT full_name,last_development_at,enabled FROM repositories WHERE repository_id=6")).rows[0];
  assert.equal(observed.full_name,fresh.full_name);assert.equal(observed.last_development_at.toISOString(),fresh.pushed_at.replace("Z",".000Z"));assert.equal(observed.enabled,false);
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=6")).rows[0].state,"MERGED");
});
test("late old failures cannot revoke a newer verified plan; current failures hold approval without stale metadata",async()=>{
  const repo=await seed(7);let started!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const old=synchronizeRepositorySnapshot(repo,db,{...services(repo),request:async()=>{started();await gate;throw new Error("Old private API error");}});
  await waiting;const fresh={...repo,full_name:"ci/webhook-renamed-7"};
  await synchronizeRepositorySnapshot(repo,db,services(fresh));release();assert.equal(await old,"SUPERSEDED");
  assert.equal((await db.query("SELECT approved FROM roadmap_units WHERE repository_id=7")).rows[0].approved,true);
  await assert.rejects(synchronizeRepositorySnapshot({...repo,archived:true},db,{...services(repo),request:async()=>{throw new Error("Never expose this API body");}}),/GitHub or approved roadmap verification failed/);
  assert.equal((await db.query("SELECT approved FROM roadmap_units WHERE repository_id=7")).rows[0].approved,false);
  assert.equal((await db.query("SELECT full_name,archived FROM repositories WHERE repository_id=7")).rows[0].full_name,fresh.full_name);
  const status=(await db.query("SELECT plan_status,last_error FROM repository_sync_status WHERE repository_id=7")).rows[0];
  assert.equal(status.plan_status,"ERROR");assert.ok(!status.last_error.includes("API body"));
  await synchronizeRepositorySnapshot(repo,db,services(fresh));
  assert.equal((await db.query("SELECT approved FROM roadmap_units WHERE repository_id=7")).rows[0].approved,true);
});
test("an authoritative merge transaction invalidates snapshots started before its verified state change",async()=>{
  const repo=await seed(8);let started!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const old=synchronizeRepositorySnapshot(repo,db,{...services(repo,false),request:async()=>{started();await gate;return repo;}});
  await waiting;const client=await db.connect();
  try{
    await client.query("BEGIN");await reserveRepositoryObservation(client,8);
    await client.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=8");await client.query("COMMIT");
  }finally{client.release();}
  release();assert.equal(await old,"SUPERSEDED");
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=8")).rows[0].state,"MERGED");
});
test("a newer failed observation remains fail-closed even if an older successful read completes later",async()=>{
  const repo=await seed(9);let started!:()=>void,release!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  const old=synchronizeRepositorySnapshot(repo,db,{...services(repo),request:async()=>{started();await gate;return repo;}});
  await waiting;
  await assert.rejects(synchronizeRepositorySnapshot(repo,db,{...services(repo),request:async()=>{throw new Error("Current read unavailable");}}),/verification failed/);
  release();assert.equal(await old,"SUPERSEDED");
  assert.equal((await db.query("SELECT approved FROM roadmap_units WHERE repository_id=9")).rows[0].approved,false);
  assert.equal((await db.query("SELECT plan_status FROM repository_sync_status WHERE repository_id=9")).rows[0].plan_status,"ERROR");
});
