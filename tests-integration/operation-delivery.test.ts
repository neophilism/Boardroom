import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {claimAssignment} from "../src/server/assignment.ts";
import {advanceAssignedWork} from "../src/server/chain.ts";
import {receiveAssignmentDispatch} from "../src/server/assignment-dispatch.ts";
import {dispatchOutbox} from "../src/server/outbox.ts";
import {performFencedGithubWrite,type GithubWrite} from "../src/server/github-write-gateway.ts";
import {GitHubAppError,type githubAppRequest} from "../src/server/github-app.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import {mergeAssignedPullRequest} from "../src/server/merge-policy.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Operation delivery fixtures require the explicit boardroom_test database");
const schema="operation_delivery_"+randomUUID().replaceAll("-","");
const admin=new Pool({connectionString:url,max:1});
const db=new Pool({connectionString:url,max:8,options:"-c search_path="+schema+",public"});
let ordinal=0;
before(async()=>{
  await admin.query('CREATE SCHEMA "'+schema+'"');
  for(const item of MIGRATION_MANIFEST){
    const source=await readFile(new URL("../db/migrations/"+item.filename,import.meta.url),"utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"),item.sha256);
    await db.query(source);
  }
});
after(async()=>{await db.end();await admin.query('DROP SCHEMA "'+schema+'" CASCADE');await admin.end();});

async function eligible(){
  const n=++ordinal,repo=String(910000000+n),unit="OUT-"+String(n).padStart(3,"0");
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,$2,now())",[repo,"ci/outbox-"+n]);
  await db.query("INSERT INTO repository_leases(repository_id) VALUES($1)",[repo]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved) VALUES($1,$2,'Outbox fixture',1,TRUE)",[repo,unit]);
  const credential=(await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",["Outbox fixture "+n,createHash("sha256").update(randomUUID()).digest("hex")])).rows[0].credential_id;
  const run=(await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id) VALUES('test',$1) RETURNING run_id",[credential])).rows[0].run_id;
  return {repo,unit,credential,run};
}
async function assigned(){
  const f=await eligible(),grant=await claimAssignment(db,f.run,f.credential);
  assert.ok(grant);assert.equal(grant.repositoryId,f.repo);
  return {...f,grant};
}
async function receive(f:Awaited<ReturnType<typeof assigned>>){
  const client=await db.connect();
  try{await client.query("BEGIN");const receipt=await receiveAssignmentDispatch(client,f.run,f.credential,f.grant.generation);await client.query("COMMIT");return receipt;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

test("assignment commit survives loss of its caller; restart delivers one durable inbox receipt",async()=>{
  const f=await assigned();
  // No queue submission occurred in the claim process. A separate dispatcher
  // starts after the committed assignment and its response have been lost.
  const pending=await db.query("SELECT * FROM operation_outbox WHERE operation_type='assignment_ready'");
  assert.equal(pending.rowCount,1);assert.equal(pending.rows[0].state,"PENDING");
  assert.equal((await claimAssignment(db,f.run,f.credential))?.replay,true);
  assert.equal((await dispatchOutbox(db,1)).done,1);
  assert.equal((await db.query("SELECT * FROM assignment_dispatches")).rowCount,1);
  await db.query("UPDATE operation_outbox SET state='RETRY',available_at=now() WHERE outbox_id=$1",[pending.rows[0].outbox_id]);
  await Promise.all([dispatchOutbox(db,1),dispatchOutbox(db,1)]);
  assert.equal((await db.query("SELECT * FROM assignment_dispatches")).rowCount,1);
  assert.equal((await receive(f))?.received,true);
  const first=(await db.query("SELECT received_at FROM assignment_dispatches")).rows[0].received_at;
  await receive(f);
  assert.equal((await db.query("SELECT received_at FROM assignment_dispatches")).rows[0].received_at.getTime(),first.getTime());
});

test("an assignment rollback cannot leave an orphan dispatch notification",async()=>{
  const f=await eligible();
  await db.query(`CREATE FUNCTION reject_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.kind='agent.assignment.claimed' THEN RAISE EXCEPTION 'Injected commit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_assignment_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_assignment_audit()`);
  try{await assert.rejects(claimAssignment(db,f.run,f.credential),/Injected commit failure/);}
  finally{await db.query("DROP TRIGGER reject_assignment_audit ON audit_events; DROP FUNCTION reject_assignment_audit()");}
  assert.equal((await db.query("SELECT * FROM work_assignments WHERE run_id=$1",[f.run])).rowCount,0);
  assert.equal((await db.query("SELECT * FROM repository_leases WHERE repository_id=$1 AND run_id IS NOT NULL",[f.repo])).rowCount,0);
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE payload->>'unitId'=$1",[f.unit])).rowCount,0);
  await db.query("UPDATE repositories SET enabled=FALSE WHERE repository_id=$1",[f.repo]);
});

test("context drains a notification without maintenance, but stale generations cannot receive it",async()=>{
  const f=await assigned(),client=await db.connect();
  try{
    await client.query("BEGIN");
    await assert.rejects(receiveAssignmentDispatch(client,f.run,f.credential,"999"),SessionConflict);
    await client.query("ROLLBACK");
  }finally{client.release();}
  assert.equal((await db.query("SELECT * FROM assignment_dispatches WHERE assignment_id=$1",[f.grant.assignmentId])).rowCount,0);
  assert.ok(await receive(f));
  assert.equal((await db.query("SELECT state FROM operation_outbox WHERE payload->>'assignmentId'=$1",[f.grant.assignmentId])).rows[0].state,"DONE");
  // A chained unit has a distinct transactional notification in the same lease.
  await db.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1 AND unit_id=$2",[f.repo,f.unit]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved) VALUES($1,'OUT-NEXT','Next fixture',1,TRUE)",[f.repo]);
  assert.equal((await advanceAssignedWork(db,f.run,f.credential,f.grant.generation)).status,"NEXT_UNIT");
  await receive(f);
  assert.equal((await db.query("SELECT * FROM assignment_dispatches WHERE assignment_id=$1",[f.grant.assignmentId])).rowCount,2);
});

test("expired assignment notification never restarts a worker or grants a receipt",async()=>{
  const f=await assigned();
  await db.query("UPDATE repository_leases SET expires_at=now()-interval '1 second' WHERE repository_id=$1",[f.repo]);
  assert.equal((await dispatchOutbox(db,10)).failed,0);
  assert.equal((await db.query("SELECT * FROM assignment_dispatches WHERE assignment_id=$1",[f.grant.assignmentId])).rowCount,0);
  await assert.rejects(receive(f),SessionConflict);
});

test("old dispatcher completion cannot overwrite a newer claim or terminal state",async()=>{
  const queued=(await db.query<{outbox_id:string}>("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES('stale-worker','sync_repository','{\"repositoryId\":\"1\"}') RETURNING outbox_id")).rows[0].outbox_id;
  let release!:()=>void,started!:()=>void;
  const waiting=new Promise<void>(resolve=>{started=resolve;});
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const services={repository:async()=>{started();await gate;return "VERIFIED" as const;},inventory:async()=>({total:0,processed:0,nextAfterId:null,verified:0,missing:0,failed:0,errors:[]})};
  const old=dispatchOutbox(db,1,services);await waiting;
  await db.query("UPDATE operation_outbox SET claimed_at=now()-interval '6 minutes' WHERE outbox_id=$1",[queued]);
  const fresh=await dispatchOutbox(db,1,{...services,repository:async()=>"VERIFIED" as const});
  assert.equal(fresh.done,1);release();assert.equal((await old).superseded,1);
  assert.equal((await db.query("SELECT state,attempts,claim_token FROM operation_outbox WHERE outbox_id=$1",[queued])).rows[0].state,"DONE");
});

test("a durable GitHub intent exists before effects; lost success is reconciled without duplicate PUT",async()=>{
  const f=await assigned();
  const op:GithubWrite={kind:"upsert_file",path:"src/fixture.ts",contentBase64:Buffer.from("export const fixture = true;\n").toString("base64"),expectedSha:null,message:"OUT: fixture source"};
  let remote=false,puts=0,calls=0;
  const transport:typeof githubAppRequest=async(method,path)=>{
    calls++;
    if(method==="GET"&&path.includes("/contents/")){
      if(!remote)throw new GitHubAppError(404);
      return {encoding:"base64",content:op.contentBase64,sha:"b".repeat(40)};
    }
    if(method==="GET"&&path.includes("/git/ref/"))return {object:{sha:"c".repeat(40)}};
    if(method==="PUT"){
      // Read through ANOTHER connection: an uncommitted intention is insufficient.
      const rows=await db.query("SELECT state FROM github_operations WHERE repository_id=$1",[f.repo]);
      assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].state,"INTENDED");
      remote=true;puts++;throw new Error("Injected lost GitHub response");
    }
    throw new Error("Unexpected fixture operation");
  };
  await assert.rejects(performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,op,transport),/lost GitHub response/);
  assert.equal((await db.query("SELECT state FROM github_operations WHERE repository_id=$1",[f.repo])).rows[0].state,"UNCERTAIN");
  assert.equal((await performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,op,transport)).operation.kind,"upsert_file");
  assert.equal(puts,1);
  const confirmed=await db.query("SELECT state,result,request_digest FROM github_operations WHERE repository_id=$1",[f.repo]);
  assert.equal(confirmed.rowCount,1);assert.equal(confirmed.rows[0].state,"CONFIRMED");
  assert.ok(!JSON.stringify(confirmed.rows).includes(op.contentBase64));
  remote=false; // An outside writer deletes the successfully created file.
  await assert.rejects(performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,op,transport),/Prior file intent needs source reconciliation/);
  assert.equal(puts,1,"A prior intent must not recreate content after an outside deletion");
  await db.query("UPDATE agent_credentials SET enabled=FALSE,revoked_at=now() WHERE credential_id=$1",[f.credential]);
  const before=calls;
  await assert.rejects(performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,op,transport),SessionConflict);
  assert.equal(calls,before);assert.equal(puts,1);
});

test("authority is checked again after the durable intent commit, before external access",async()=>{
  const f=await assigned();
  await db.query(`CREATE FUNCTION expire_intended_lease() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    UPDATE repository_leases SET expires_at=now()-interval '1 second' WHERE repository_id=NEW.repository_id;
    RETURN NEW; END $$;
    CREATE TRIGGER expire_intended_lease AFTER INSERT ON github_operations FOR EACH ROW EXECUTE FUNCTION expire_intended_lease()`);
  let calls=0;
  try{
    await assert.rejects(performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,{kind:"ensure_branch"},async()=>{calls++;throw new Error("Must not call GitHub");}),SessionConflict);
  }finally{await db.query("DROP TRIGGER expire_intended_lease ON github_operations; DROP FUNCTION expire_intended_lease()");}
  assert.equal(calls,0);
  assert.equal((await db.query("SELECT state FROM github_operations WHERE repository_id=$1",[f.repo])).rows[0].state,"UNCERTAIN");
});

test("a lost PR response followed by closure cannot create a duplicate PR",async()=>{
  const f=await assigned();let posts=0;
  const transport:typeof githubAppRequest=async(method,path)=>{
    if(path.endsWith("/git/ref/heads/main"))return {object:{sha:"a".repeat(40)}};
    if(path.includes("/pulls?state=all"))return [{number:7,state:"closed",base:{ref:"main"}}];
    if(method==="GET")return {default_branch:"main"};
    posts++;throw new Error("No mutation expected");
  };
  await assert.rejects(performFencedGithubWrite(db,f.run,f.credential,f.grant.generation,{kind:"open_draft_pr",description:"Fixture request"},transport),/closed PR/);
  assert.equal(posts,0);
});

test("inventory continuation and completion commit atomically even after a completion failure",async()=>{
  const services={repository:async()=>"VERIFIED" as const,inventory:async()=>({total:2,processed:1,nextAfterId:"2",verified:1,missing:0,failed:0,errors:[]})};
  await dispatchOutbox(db,10,services); // Drain preceding assignment notifications.
  await db.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES('inventory-fixture','sync_inventory','{}')");
  await db.query(`CREATE FUNCTION reject_continuation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.idempotency_key LIKE 'inventory-continuation:%' THEN RAISE EXCEPTION 'Injected continuation failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_continuation BEFORE INSERT ON operation_outbox FOR EACH ROW EXECUTE FUNCTION reject_continuation()`);
  try{assert.equal((await dispatchOutbox(db,1,services)).retry,1);}
  finally{await db.query("DROP TRIGGER reject_continuation ON operation_outbox; DROP FUNCTION reject_continuation()");}
  assert.equal((await db.query("SELECT state FROM operation_outbox WHERE idempotency_key='inventory-fixture'")).rows[0].state,"RETRY");
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE idempotency_key LIKE 'inventory-continuation:%'")).rowCount,0);
  await db.query("UPDATE operation_outbox SET available_at=now() WHERE idempotency_key='inventory-fixture'");
  assert.equal((await dispatchOutbox(db,1,services)).done,1);
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE idempotency_key LIKE 'inventory-continuation:%'")).rowCount,1);
  const parent=(await db.query("SELECT outbox_id FROM operation_outbox WHERE idempotency_key='inventory-fixture'")).rows[0].outbox_id;
  await db.query("UPDATE operation_outbox SET state='RETRY',available_at=now()-interval '1 minute' WHERE outbox_id=$1",[parent]);
  await dispatchOutbox(db,1,services);
  assert.equal((await db.query("SELECT * FROM operation_outbox WHERE idempotency_key=$1",["inventory-continuation:"+parent])).rowCount,1);
});

test("a lost merge response is reconciled at the exact intended head, without another merge",async()=>{
  const f=await assigned(),head="d".repeat(40);
  await db.query("INSERT INTO repository_execution_policy(repository_id,auto_merge,required_checks) VALUES($1,TRUE,'[\"verify\"]')",[f.repo]);
  let merged=false,puts=0;
  const request:typeof githubAppRequest=async(method,path)=>{
    if(method==="PUT"){
      const ledger=await db.query("SELECT state,request_metadata FROM github_operations WHERE repository_id=$1",[f.repo]);
      assert.equal(ledger.rows[0].state,"INTENDED");assert.equal(ledger.rows[0].request_metadata.expectedSha,head);
      merged=true;puts++;throw new Error("Injected lost merge response");
    }
    if(path==="/graphql")return {data:{repository:{pullRequest:{mergeStateStatus:"CLEAN",reviewDecision:null,headRefOid:head}}}};
    if(path.includes("/check-runs"))return {total_count:1,check_runs:[{id:1,name:"verify",status:"completed",conclusion:"success"}]};
    if(path.includes("/check-suites"))return {total_count:1,check_suites:[{id:2,status:"completed",conclusion:"success"}]};
    if(path.includes("/status"))return {total_count:0,statuses:[]};
    if(path.includes("/reviews"))return [];
    if(path.endsWith("/pulls/1"))return {state:merged?"closed":"open",draft:false,merged,head:{sha:head,ref:"boardroom/"+f.unit,repo:{id:Number(f.repo)}},html_url:"https://github.com/ci/fixture/pull/1"};
    throw new Error("Unexpected merge fixture operation");
  };
  const services={request,pulls:async()=>[]};
  await assert.rejects(mergeAssignedPullRequest(db,f.run,f.credential,f.grant.generation,1,head,services),/lost merge response/);
  assert.equal((await db.query("SELECT state FROM github_operations WHERE repository_id=$1",[f.repo])).rows[0].state,"UNCERTAIN");
  const result=await mergeAssignedPullRequest(db,f.run,f.credential,f.grant.generation,1,head,services);
  assert.equal(result.replay,true);assert.equal(result.unitState,"MERGED");assert.equal(puts,1);
  await assert.rejects(mergeAssignedPullRequest(db,f.run,f.credential,f.grant.generation,1,"e".repeat(40),services),/outside the assigned intent/);
  assert.equal(puts,1);
  assert.equal((await db.query("SELECT state FROM github_operations WHERE repository_id=$1 AND request_metadata->>'expectedSha'=$2",[f.repo,head])).rows[0].state,"CONFIRMED");
});
