import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {claimAssignment} from "../src/server/assignment.ts";
import {yieldAndClaim} from "../src/server/continuation.ts";
import {heartbeatRun,saveCheckpoint,finishRun} from "../src/server/sessions.ts";
import {finishIdleSession} from "../src/server/idle-session.ts";
import {assignedScope} from "../src/server/assignment-scope.ts";
import {workSession} from "../src/domain/work-session.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Continuation fixtures require an isolated boardroom_test database");

test("pending CI hands off same-project then cross-project, replay is safe, another run resumes, and one clock governs all leases",async()=>{
  const admin=new Pool({connectionString:url,max:1});
  const schema="continuation_"+randomUUID().replaceAll("-","");
  let db:Pool|undefined;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    db=new Pool({connectionString:url,max:6,options:'-c search_path='+schema+',public'});
    for(const migration of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+migration.filename,import.meta.url),"utf8"));
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES(1,'ci/first',now()),(2,'ci/second',now())");
    await db.query("INSERT INTO repository_leases(repository_id) VALUES(1),(2)");
    await db.query("INSERT INTO repository_priority(repository_id,position) VALUES(1,1),(2,2)");
    await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) VALUES(1,now(),'VERIFIED'),(2,now(),'VERIFIED')");
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state,depends_on) VALUES(1,'CI-001','Waiting PR',1,TRUE,'OPEN_PR','[]'),(1,'CI-002','Independent',1,TRUE,'PENDING','[]'),(1,'CI-003','Dependent',1,TRUE,'PENDING','[\"CI-001\"]'),(2,'OTHER-001','Other project',1,TRUE,'PENDING','[]')");
    const principal=async(label:string)=>{
      const cred=(await db!.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",[label,createHash('sha256').update(label).digest('hex')])).rows[0].credential_id;
      const run=(await db!.query<{run_id:string;started_at:Date}>("INSERT INTO agent_runs(provider,credential_id,started_at) VALUES('test',$1,now()-interval '2 minutes') RETURNING run_id,started_at",[cred])).rows[0];
      return {cred,...run};
    };
    const worker=await principal('Continuation fixture');
    const first=await claimAssignment(db,worker.run_id,worker.cred);assert.equal(first?.unitId,'CI-001');
    await assert.rejects(yieldAndClaim(db,worker.run_id,worker.cred,first!.generation,'YIELDED'),/Checkpoint current work/);
    await saveCheckpoint(db,worker.run_id,worker.cred,first!.generation,{branch:'feat/imported',headSha:'a'.repeat(40),state:{prNumber:13,checks:'PENDING',nextAction:'Inspect CI and merge when green'}});
    const same=await yieldAndClaim(db,worker.run_id,worker.cred,first!.generation,'YIELDED');
    assert.equal(same.assignment?.repositoryId,'1');assert.equal(same.assignment?.unitId,'CI-002');
    assert.notEqual(same.assignment?.generation,first?.generation);
    const replay=await yieldAndClaim(db,worker.run_id,worker.cred,first!.generation,'YIELDED');
    assert.equal(replay.assignment?.assignmentId,same.assignment?.assignmentId);
    await saveCheckpoint(db,worker.run_id,worker.cred,same.assignment!.generation,{state:{nextAction:'Resume independent implementation'}});
    // Keep one freshness preview open while the duplicate handoff claims. A
    // preview must not reserve the only available lease or make its sibling
    // report IDLE. The real claim still serializes on the shared run row.
    const previewClient=await db.connect();
    let signalPreview!:()=>void,releasePreview!:()=>void;
    const previewStarted=new Promise<void>(resolve=>{signalPreview=resolve;});
    const previewReleased=new Promise<void>(resolve=>{releasePreview=resolve;});
    let previewHeld=false;
    const heldPreviewDb={
      connect:()=>db!.connect(),
      query:async(sql:string,parameters?:unknown[])=>{
        if(!previewHeld&&sql.includes('WITH RECURSIVE dependency_edges')){
          previewHeld=true;
          await previewClient.query('BEGIN');
          try{
            const result=await previewClient.query(sql,parameters);
            signalPreview();await previewReleased;
            await previewClient.query('COMMIT');return result;
          }catch(error){await previewClient.query('ROLLBACK');throw error;}
        }
        return db!.query(sql,parameters);
      }
    } as unknown as Pool;
    const delayed=yieldAndClaim(heldPreviewDb,worker.run_id,worker.cred,same.assignment!.generation,'YIELDED');
    let duplicate:Awaited<ReturnType<typeof yieldAndClaim>>|undefined;
    try{
      await Promise.race([previewStarted,delayed.then(()=>{throw new Error('Handoff bypassed its freshness preview');})]);
      duplicate=await yieldAndClaim(db,worker.run_id,worker.cred,same.assignment!.generation,'YIELDED');
    }finally{
      releasePreview();await delayed.catch(()=>undefined);previewClient.release();
    }
    const concurrent=[await delayed,duplicate!];
    assert.equal(concurrent[0].status,'ASSIGNED');assert.equal(concurrent[1].status,'ASSIGNED');
    const other=concurrent[0].assignment!;
    assert.equal(other.repositoryId,'2');assert.equal(other.unitId,'OTHER-001');
    assert.equal(concurrent[1].assignment?.assignmentId,other.assignmentId);
    assert.ok(BigInt(other.generation)>BigInt(same.assignment!.generation));
    await assert.rejects(assignedScope(db,worker.run_id,worker.cred,first!.generation));
    assert.equal((await db.query("SELECT state FROM roadmap_units WHERE unit_id='CI-001'")).rows[0].state,'OPEN_PR');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM repository_leases WHERE run_id=$1",[worker.run_id])).rows[0].n,1);
    const later=await principal('Later fixture');
    const resumed=await claimAssignment(db,later.run_id,later.cred);assert.equal(resumed?.unitId,'CI-001');
    assert.equal((await db.query("SELECT state->>'checks' AS checks FROM checkpoints WHERE unit_id='CI-001'")).rows[0].checks,'PENDING');
    await db.query("UPDATE agent_runs SET started_at=now()-interval '49 minutes' WHERE run_id=$1",[worker.run_id]);
    await heartbeatRun(db,worker.run_id,worker.cred,other.generation);
    const clock=(await db.query<{started_at:Date}>("SELECT started_at FROM agent_runs WHERE run_id=$1",[worker.run_id])).rows[0].started_at;
    assert.equal(workSession(clock).remainingWorkSeconds<=61,true);
    await db.query("UPDATE agent_runs SET started_at=now()-interval '56 minutes' WHERE run_id=$1",[worker.run_id]);
    await assert.rejects(heartbeatRun(db,worker.run_id,worker.cred,other.generation),/time budget exhausted/);
    await finishRun(db,worker.run_id,worker.cred,other.generation,'YIELDED');
    await finishRun(db,later.run_id,later.cred,resumed!.generation,'CANCELLED');
    const empty=await principal('Empty fixture');
    await db.query("UPDATE repositories SET enabled=FALSE");
    assert.equal(await claimAssignment(db,empty.run_id,empty.cred),null);
    await finishIdleSession(db,empty.run_id,empty.cred);
    const defaults=(await db.query("INSERT INTO repository_execution_policy(repository_id) VALUES(1) RETURNING max_session_seconds,max_tool_calls,max_tokens")).rows[0];
    assert.deepEqual(defaults,{max_session_seconds:3300,max_tool_calls:100,max_tokens:100000});
  }finally{
    if(db)await db.end();
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
  }
});
