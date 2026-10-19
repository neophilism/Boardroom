import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {admitAgentRun} from "../src/server/admission.ts";
import {executeAgentTool} from "../src/server/agent-tools.ts";
import {digestActivation} from "../src/server/agent-auth.ts";
import {claimAssignment} from "../src/server/assignment.ts";
import {heartbeatRun,saveCheckpoint,SessionConflict} from "../src/server/sessions.ts";
import {performFencedGithubWrite} from "../src/server/github-write-gateway.ts";
import {scanStaleSessions,recoverFencedOAuthSessions} from "../src/server/watchdog.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Native recovery fixtures require an isolated boardroom_test database");
const schema="native_recovery_"+randomUUID().replaceAll("-","");
const admin=new Pool({connectionString:url,max:1});
let db:Pool;
let sequence=0;
before(async()=>{
  await admin.query('CREATE SCHEMA "'+schema+'"');
  db=new Pool({connectionString:url,max:8,options:'-c search_path='+schema+',public'});
  for(const migration of MIGRATION_MANIFEST)
    await db.query(await readFile(new URL("../db/migrations/"+migration.filename,import.meta.url),"utf8"));
});
after(async()=>{
  if(db)await db.end();
  await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
  await admin.end();
});

async function fixture(options:{seconds?:number;provider?:string;oauth?:boolean;state?:string;lease?:boolean;assignment?:boolean}={}){
  const number=++sequence,repositoryId=String(978000000+number),label="Native recovery fixture "+number;
  const provider=options.provider??"chatgpt",state=options.state??"RUNNING";
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at,enabled) VALUES($1,$2,now(),FALSE)",
    [repositoryId,"ci/native-recovery-"+number]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved) VALUES($1,'RECOVERY-001','Recovery fixture',1,TRUE)",[repositoryId]);
  await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) VALUES($1,now(),'VERIFIED')",[repositoryId]);
  const credentialId=(await db.query<{credential_id:string}>(
    "INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,$2,$3) RETURNING credential_id",
    [label,provider,createHash("sha256").update(label).digest("hex")])).rows[0].credential_id;
  const runId=(await db.query<{run_id:string}>(
    "INSERT INTO agent_runs(provider,credential_id,state,started_at,last_seen_at) VALUES($1,$2,$3,now()-interval '5 minutes',now()-interval '5 minutes') RETURNING run_id",
    [provider,credentialId,state])).rows[0].run_id;
  if(options.lease!==false){
    await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,assigned_at,last_heartbeat_at,expires_at) "+
      "VALUES($1,$2,7,now()-interval '5 minutes',now()-interval '5 minutes',now()+make_interval(secs=>$3))",
      [repositoryId,runId,options.seconds??-120]);
  }else await db.query("INSERT INTO repository_leases(repository_id,generation) VALUES($1,7)",[repositoryId]);
  if(options.assignment!==false)
    await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,7,'RECOVERY-001')",[repositoryId,runId]);
  if(options.oauth!==false)
    await db.query("INSERT INTO oauth_grants(credential_id,client_id,resource,scope) VALUES($1,'https://chatgpt.com','https://boardroom.example/api/mcp','boardroom:agent')",[credentialId]);
  return {repositoryId,runId,credentialId,principal:{credentialId,label,provider}};
}

test("fresh overlapping OAuth activation reports live timestamps and grants no old authority",async()=>{
  const current=await fixture({seconds:180});
  const result=await executeAgentTool(db,current.principal,"boardroom_arrive",{}) as {
    state:string;shouldWork:boolean;runId:string|null;activeSession:{classification:string;startedAt:string;lastSeenAt:string;leaseExpiresAt:string};
  };
  assert.equal(result.state,"ALREADY_ACTIVE");assert.equal(result.shouldWork,false);assert.equal(result.runId,null);
  assert.equal(result.activeSession.classification,"ACTIVE_LEASE");
  assert.ok(Date.parse(result.activeSession.startedAt)<Date.now());
  assert.ok(Date.parse(result.activeSession.lastSeenAt)<Date.now());
  assert.ok(Date.parse(result.activeSession.leaseExpiresAt)>Date.now());
  assert.ok(!JSON.stringify(result).includes(current.runId));
  assert.ok(!JSON.stringify(result).includes("generation"));
  assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"RUNNING");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE run_id=$1",[current.runId])).rows[0].n,0);
});

test("arrival recovers only its expired OAuth credential, preserves the connection, and fences old writes",async()=>{
  const current=await fixture(),other=await fixture();
  const result=await admitAgentRun(db,current.principal,null);
  assert.equal(result.kind,"CREATED");
  if(result.kind!=="CREATED")throw new Error("Expected fresh admission after fenced recovery");
  assert.notEqual(result.runId,current.runId);
  assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"CANCELLED");
  assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[other.runId])).rows[0].state,"RUNNING");
  assert.deepEqual((await db.query("SELECT run_id,generation::text FROM repository_leases WHERE repository_id=$1",[other.repositoryId])).rows[0],
    {run_id:other.runId,generation:"7"});
  assert.deepEqual((await db.query("SELECT enabled,revoked_at FROM agent_credentials WHERE credential_id=$1",[current.credentialId])).rows[0],
    {enabled:true,revoked_at:null});
  assert.equal((await db.query("SELECT count(*)::int AS n FROM oauth_grants WHERE credential_id=$1 AND revoked_at IS NULL",[current.credentialId])).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM owner_actions WHERE source_run_id=$1",[current.runId])).rows[0].n,0);
  assert.deepEqual((await db.query("SELECT run_id,generation::text FROM repository_leases WHERE repository_id=$1",[current.repositoryId])).rows[0],
    {run_id:null,generation:"8"});
  await db.query("UPDATE repositories SET enabled=TRUE WHERE repository_id=$1",[current.repositoryId]);
  const assigned=await claimAssignment(db,result.runId,current.credentialId,async()=>{throw new Error("Unexpected external reconciliation");});
  assert.equal(assigned?.repositoryId,current.repositoryId);assert.equal(assigned?.generation,"9");
  await assert.rejects(heartbeatRun(db,current.runId,current.credentialId,"7"),SessionConflict);
  await assert.rejects(saveCheckpoint(db,current.runId,current.credentialId,"7",{state:{evidence:"late old activation"}}),SessionConflict);
  await assert.rejects(performFencedGithubWrite(db,current.runId,current.credentialId,"7",{kind:"ensure_branch"}),SessionConflict);
});

test("simultaneous stale arrivals create exactly one replacement activation",async()=>{
  const current=await fixture();
  const results=await Promise.all([admitAgentRun(db,current.principal,null),admitAgentRun(db,current.principal,null)]);
  assert.equal(results.filter(result=>result.kind==="CREATED").length,1);
  assert.equal(results.filter(result=>result.kind==="BUSY").length,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM agent_runs WHERE credential_id=$1 AND state='ADMITTED'",[current.credentialId])).rows[0].n,1);
  assert.equal((await db.query("SELECT generation::text FROM repository_leases WHERE repository_id=$1",[current.repositoryId])).rows[0].generation,"8");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE run_id=$1 AND kind='agent.run.oauth_fenced_and_released'",[current.runId])).rows[0].n,1);
});

test("recent expiry enters recovery hold until the existing grace period elapses",async()=>{
  const current=await fixture({seconds:-10});
  const result=await admitAgentRun(db,current.principal,null);
  assert.equal(result.kind,"BUSY");assert.equal(result.state,"RECOVERY_REQUIRED");
  if(result.kind!=="BUSY")throw new Error("Expected a recovery hold");
  assert.equal(result.activeSession.classification,"RECOVERY_HELD");
  assert.equal((await db.query("SELECT generation::text,run_id FROM repository_leases WHERE repository_id=$1",[current.repositoryId])).rows[0].run_id,current.runId);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM owner_actions WHERE source_run_id=$1",[current.runId])).rows[0].n,0);
  await db.query("UPDATE repository_leases SET expires_at=now()-interval '2 minutes' WHERE repository_id=$1",[current.repositoryId]);
  assert.equal((await admitAgentRun(db,current.principal,null)).kind,"CREATED");
});

for(const state of ["INTENDED","UNCERTAIN"]){
  test("unresolved "+state+" GitHub effects remain held with the old generation intact",async()=>{
    const current=await fixture();
    await db.query("INSERT INTO github_operations(repository_id,unit_id,run_id,idempotency_key,request_digest,state) "+
      "VALUES($1,'RECOVERY-001',$2,$3,$4,$5)",[current.repositoryId,current.runId,"unresolved-"+state,"f".repeat(64),state]);
    const result=await admitAgentRun(db,current.principal,null);
    assert.equal(result.kind,"BUSY");assert.equal(result.state,"RECOVERY_REQUIRED");
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"RECOVERING");
    assert.deepEqual((await db.query("SELECT run_id,generation::text FROM repository_leases WHERE repository_id=$1",[current.repositoryId])).rows[0],
      {run_id:current.runId,generation:"7"});
    assert.equal((await db.query("SELECT count(*)::int AS n FROM owner_actions WHERE source_run_id=$1",[current.runId])).rows[0].n,0);
  });
}

test("recovery reconciles recorded staging effects within one pooled connection",async()=>{
  const current=await fixture();
  await db.query("INSERT INTO github_operations(repository_id,unit_id,run_id,idempotency_key,request_digest,state,result) "+
    "VALUES($1,'RECOVERY-001',$2,'staging-effect',$3,'INTENDED',$4::jsonb)",
    [current.repositoryId,current.runId,"e".repeat(64),JSON.stringify({version:1,
      fullName:"ci/native-recovery-"+sequence,generation:"7",intent:{kind:"CREATE_COMMIT"},outcome:"PENDING"})]);
  const single=new Pool({connectionString:url,max:1,options:'-c search_path='+schema+',public'});
  try{
    assert.equal((await admitAgentRun(single,current.principal,null)).kind,"CREATED");
  }finally{await single.end();}
  assert.deepEqual((await db.query("SELECT state,result->>'outcome' AS outcome FROM github_operations WHERE run_id=$1",[current.runId])).rows[0],
    {state:"CONFIRMED",outcome:"RECONCILED"});
});

test("a busy in-flight lease lock defers recovery without blocking arrival",async()=>{
  const current=await fixture(),holder=await db.connect();
  let timer:NodeJS.Timeout|undefined;
  try{
    await holder.query("BEGIN");
    await holder.query("SELECT 1 FROM repository_leases WHERE repository_id=$1 FOR UPDATE",[current.repositoryId]);
    const result=await Promise.race([
      admitAgentRun(db,current.principal,null),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Recovery blocked on an in-flight lease")),1500);})
    ]);
    assert.equal(result.kind,"BUSY");assert.equal(result.state,"RECOVERY_REQUIRED");
    if(result.kind!=="BUSY")throw new Error("Expected a deferred recovery");
    assert.equal(result.activeSession.classification,"EXPIRED_LEASE");
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"RUNNING");
  }finally{
    if(timer)clearTimeout(timer);
    await holder.query("ROLLBACK");holder.release();
  }
  assert.equal((await admitAgentRun(db,current.principal,null)).kind,"CREATED");
});

test("an old trusted activation replay never triggers recovery or grants work",async()=>{
  const current=await fixture(),key="native-recovery-replay",pepper="test-native-recovery-pepper-only".repeat(2);
  const previousPepper=process.env.BOARDROOM_TOKEN_PEPPER;
  try{
    process.env.BOARDROOM_TOKEN_PEPPER=pepper;
    await db.query("UPDATE agent_runs SET activation_dedupe_hash=$2 WHERE run_id=$1",
      [current.runId,digestActivation(current.credentialId,key,pepper)]);
    const result=await executeAgentTool(db,current.principal,"boardroom_arrive",{activationKey:key}) as {runId:null;shouldWork:boolean;replay:boolean};
    assert.equal(result.runId,null);assert.equal(result.shouldWork,false);assert.equal(result.replay,true);
    assert.ok(!JSON.stringify(result).includes(current.runId));
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"RUNNING");
  }finally{
    if(previousPepper===undefined)delete process.env.BOARDROOM_TOKEN_PEPPER;else process.env.BOARDROOM_TOKEN_PEPPER=previousPepper;
  }
});

test("unleased and orphaned-lease states are diagnosed without unsafe cancellation",async()=>{
  const unleased=await fixture({lease:false,assignment:false});
  const missing=await admitAgentRun(db,unleased.principal,null);
  assert.equal(missing.kind,"BUSY");
  if(missing.kind!=="BUSY")throw new Error("Expected missing-lease hold");
  assert.equal(missing.state,"RECOVERY_REQUIRED");assert.equal(missing.activeSession.classification,"MISSING_LEASE");
  const orphan=await fixture({state:"ADMITTED",assignment:false});
  await db.query("UPDATE agent_runs SET last_seen_at=now()-interval '20 minutes' WHERE run_id=$1",[orphan.runId]);
  const held=await admitAgentRun(db,orphan.principal,null);
  assert.equal(held.kind,"BUSY");assert.equal(held.state,"RECOVERY_REQUIRED");
  assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[orphan.runId])).rows[0].state,"ADMITTED");
  const abandoned=await fixture({state:"ADMITTED",lease:false,assignment:false});
  await db.query("UPDATE agent_runs SET last_seen_at=now()-interval '20 minutes' WHERE run_id=$1",[abandoned.runId]);
  assert.equal((await admitAgentRun(db,abandoned.principal,null)).kind,"CREATED");
  assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[abandoned.runId])).rows[0].state,"CANCELLED");
});

test("automatic recovery cannot release hosted or grantless credentials",async()=>{
  for(const options of [{provider:"test"},{oauth:false}]){
    const current=await fixture(options);
    await scanStaleSessions(db,1,current.credentialId);
    assert.equal((await recoverFencedOAuthSessions(db,1,current.credentialId)).released,0);
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[current.runId])).rows[0].state,"RECOVERING");
    assert.equal((await db.query("SELECT enabled FROM agent_credentials WHERE credential_id=$1",[current.credentialId])).rows[0].enabled,true);
  }
});
