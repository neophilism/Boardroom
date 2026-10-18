import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {finishRun,saveCheckpoint,heartbeatRun,ContinuationRequired,ReleaseReconciliationRequired,SESSION_OUTCOMES} from "../src/server/sessions.ts";
import {assignedScope} from "../src/server/assignment-scope.ts";
import {recoverRun} from "../src/server/operations.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Finish fixtures require an isolated boardroom_test database");

test("analysis-only finish preserves its lease; explicit early stop releases and remains replay-safe",async()=>{
  const admin=new Pool({connectionString:url,max:1}),schema="activation_finish_"+randomUUID().replaceAll("-","");
  let db:Pool|undefined;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    db=new Pool({connectionString:url,max:3,options:'-c search_path='+schema+',public'});
    for(const migration of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+migration.filename,import.meta.url),"utf8"));
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES(1,'ci/finish',now())");
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES(1,'CI-001','Incomplete implementation',1,TRUE,'ACTIVE')");
    const credentialId=(await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Finish fixture','test',$1) RETURNING credential_id",['f'.repeat(64)])).rows[0].credential_id;
    const runId=(await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state,started_at) VALUES('test',$1,'RUNNING',now()-interval '93 seconds') RETURNING run_id",[credentialId])).rows[0].run_id;
    await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,assigned_at,last_heartbeat_at,expires_at) VALUES(1,$1,1,now(),now(),now()+interval '180 seconds')",[runId]);
    await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES(1,$1,1,'CI-001')",[runId]);
    await saveCheckpoint(db,runId,credentialId,'1',{state:{reason:'Current interactive execution ending before safe scoped implementation and verification; preserve assignment state',checks:'Not executed or verified for current SHA',remoteChanges:'None'}});
    const stagingId=(await db.query<{operation_id:string}>(
      "INSERT INTO github_operations(repository_id,unit_id,run_id,idempotency_key,request_digest,state,result) VALUES(1,'CI-001',$1,'staging',$2,'INTENDED',$3::jsonb) RETURNING operation_id",
      [runId,'b'.repeat(64),JSON.stringify({version:1,fullName:'ci/finish',generation:'1',intent:{kind:'CREATE_COMMIT'},outcome:'PENDING'})])).rows[0].operation_id;
    await assert.rejects(finishRun(db,runId,credentialId,'1','YIELDED'),ContinuationRequired);
    assert.equal((await db.query("SELECT state FROM github_operations WHERE operation_id=$1",[stagingId])).rows[0].state,'CONFIRMED','Continuation must preserve positive source-bound reconciliation');
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[runId])).rows[0].state,'RUNNING');
    assert.equal((await db.query("SELECT run_id FROM repository_leases WHERE repository_id=1")).rows[0].run_id,runId);
    assert.equal((await db.query("SELECT released_at FROM work_assignments WHERE run_id=$1",[runId])).rows[0].released_at,null);
    const detail='The owner explicitly requested cancellation of this activation after reviewing its current progress.';
    await saveCheckpoint(db,runId,credentialId,'1',{state:{activationStop:{reason:'USER_STOP',detail}}});
    assert.deepEqual(await finishRun(db,runId,credentialId,'1','YIELDED'),{state:'YIELDED',replay:false});
    assert.equal((await db.query("SELECT run_id FROM repository_leases WHERE repository_id=1")).rows[0].run_id,null);
    assert.deepEqual((await db.query("SELECT details->'finishBasis' AS basis FROM audit_events WHERE run_id=$1 AND kind='agent.run.finished'",[runId])).rows[0].basis,{source:'AGENT_REPORTED',reason:'USER_STOP',detail});
    assert.deepEqual(await finishRun(db,runId,credentialId,'1','YIELDED'),{state:'YIELDED',replay:true});
  }finally{
    if(db)await db.end();
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
  }
});

test("every terminal outcome and owner recovery retain unresolved effects while revoking write and heartbeat authority",async()=>{
  const admin=new Pool({connectionString:url,max:1}),schema="release_hold_"+randomUUID().replaceAll("-","");
  let db:Pool|undefined;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    db=new Pool({connectionString:url,max:3,options:'-c search_path='+schema+',public'});
    for(const migration of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+migration.filename,import.meta.url),"utf8"));
    let repositoryId=0;
    for(const outcome of SESSION_OUTCOMES)for(const state of ['INTENDED','UNCERTAIN']){
      repositoryId++;
      await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,$2,now())",[repositoryId,'ci/release-'+repositoryId]);
      await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'CI-001','Unresolved remote effect',1,TRUE,'ACTIVE')",[repositoryId]);
      const credentialId=(await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",['Release fixture '+repositoryId,String(repositoryId).padStart(64,'0')])).rows[0].credential_id;
      const runId=(await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state,started_at) VALUES('test',$1,'RUNNING',now()-interval '93 seconds') RETURNING run_id",[credentialId])).rows[0].run_id;
      await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,assigned_at,last_heartbeat_at,expires_at) VALUES($1,$2,1,now(),now(),now()+interval '180 seconds')",[repositoryId,runId]);
      await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,1,'CI-001')",[repositoryId,runId]);
      let stagingId:string|null=null;
      if(repositoryId===1)stagingId=(await db.query<{operation_id:string}>(
        "INSERT INTO github_operations(repository_id,unit_id,run_id,idempotency_key,request_digest,state,result) VALUES($1,'CI-001',$2,'staging',$3,'INTENDED',$4::jsonb) RETURNING operation_id",
        [repositoryId,runId,'b'.repeat(64),JSON.stringify({version:1,fullName:'ci/release-'+repositoryId,generation:'1',intent:{kind:'CREATE_TREE'},outcome:'PENDING'})])).rows[0].operation_id;
      const operationId=(await db.query<{operation_id:string}>("INSERT INTO github_operations(repository_id,unit_id,run_id,idempotency_key,request_digest,state,result) VALUES($1,'CI-001',$2,'uncertain',$3,$4,'{}'::jsonb) RETURNING operation_id",[repositoryId,runId,'a'.repeat(64),state])).rows[0].operation_id;
      await assert.rejects(finishRun(db,runId,credentialId,'1',outcome),error=>error instanceof ReleaseReconciliationRequired&&error.operationId===operationId);
      if(stagingId)assert.equal((await db.query("SELECT state FROM github_operations WHERE operation_id=$1",[stagingId])).rows[0].state,'CONFIRMED','A retained hold must commit positive sibling reconciliation');
      assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[runId])).rows[0].state,'RECOVERING');
      const lease=(await db.query("SELECT run_id,generation::text,expires_at<=now() AS expired FROM repository_leases WHERE repository_id=$1",[repositoryId])).rows[0];
      assert.deepEqual(lease,{run_id:runId,generation:'1',expired:true});
      assert.equal((await db.query("SELECT released_at FROM work_assignments WHERE run_id=$1",[runId])).rows[0].released_at,null);
      assert.equal((await db.query("SELECT state FROM github_operations WHERE operation_id=$1",[operationId])).rows[0].state,state);
      await assert.rejects(heartbeatRun(db,runId,credentialId,'1'),/Run is not active/);
      await assert.rejects(assignedScope(db,runId,credentialId,'1'),/Current authorized repository lease unavailable/);
      const held=(await db.query("SELECT details FROM audit_events WHERE run_id=$1 AND kind='agent.run.release_held'",[runId])).rows[0].details;
      assert.equal(held.requestedOutcome,outcome);assert.equal(held.assignmentReleased,false);
      assert.equal(held.externalExecutionTerminationVerified,false);
      await assert.rejects(recoverRun(db,runId,true),ReleaseReconciliationRequired);
      assert.equal((await db.query("SELECT run_id FROM repository_leases WHERE repository_id=$1",[repositoryId])).rows[0].run_id,runId);
      await db.query("UPDATE github_operations SET state='CONFIRMED',confirmed_at=now() WHERE operation_id=$1",[operationId]);
      assert.deepEqual(await recoverRun(db,runId,true),{state:'CANCELLED',replay:false,credentialRevoked:true});
      assert.equal((await db.query("SELECT run_id FROM repository_leases WHERE repository_id=$1",[repositoryId])).rows[0].run_id,null);
    }
  }finally{
    if(db)await db.end();
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
  }
});
