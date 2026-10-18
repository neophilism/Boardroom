import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {claimAssignment} from "../src/server/assignment.ts";
import {saveCheckpoint} from "../src/server/sessions.ts";
import {executeAgentTool} from "../src/server/agent-tools.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Completion fixtures require an isolated boardroom_test database");

test("native finish at 90 seconds continues the same run, preserves fences, and permits evidenced hard stops",async()=>{
  const admin=new Pool({connectionString:url,max:1});
  const schema="completion_"+randomUUID().replaceAll("-","");
  let db:Pool|undefined;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    db=new Pool({connectionString:url,max:6,options:'-c search_path='+schema+',public'});
    for(const m of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+m.filename,import.meta.url),"utf8"));
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES(1,'ci/first',now()),(2,'ci/second',now())");
    await db.query("INSERT INTO repository_leases(repository_id) VALUES(1),(2)");
    await db.query("INSERT INTO repository_priority(repository_id,position) VALUES(1,1),(2,2)");
    await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) VALUES(1,now(),'VERIFIED'),(2,now(),'VERIFIED')");
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES(1,'CI-001','Waiting PR',1,TRUE,'OPEN_PR'),(2,'CI-002','Implementation remains',1,TRUE,'PENDING')");
    const principal=async(label:string)=>{
      const credentialId=(await db!.query("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'chatgpt',$2) RETURNING credential_id",[label,createHash('sha256').update(label).digest('hex')])).rows[0].credential_id;
      const runId=(await db!.query("INSERT INTO agent_runs(provider,credential_id,started_at) VALUES('chatgpt',$1,now()-interval '90 seconds') RETURNING run_id",[credentialId])).rows[0].run_id;
      const agent={credentialId,label,provider:'chatgpt'};
      const finish=(generation:string,sessionStop?:unknown)=>executeAgentTool(db!,agent,'boardroom_finish',{runId,generation,outcome:'YIELDED',...(sessionStop?{sessionStop}:{})});
      const idle=(sessionStop?:unknown)=>executeAgentTool(db!,agent,'boardroom_finish_idle',{runId,...(sessionStop?{sessionStop}:{})});
      return {agent,runId,finish,idle};
    };
    const a=await principal('Early finish fixture');
    const first=(await claimAssignment(db,a.runId,a.agent.credentialId))!;
    const withoutCheckpoint=await a.finish(first.generation);
    assert.ok('runEnded' in withoutCheckpoint);assert.equal(withoutCheckpoint.runEnded,false);
    assert.equal(withoutCheckpoint.state,'RUNNING');
    await saveCheckpoint(db,a.runId,a.agent.credentialId,first.generation,{state:{checks:'PENDING',nextAction:'Continue implementation'}});
    const early=await a.finish(first.generation);
    assert.ok('runEnded' in early);assert.equal(early.runEnded,false);
    assert.equal(early.state,'ADMITTED');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM repository_leases WHERE run_id=$1",[a.runId])).rows[0].n,0);
    assert.equal((await db.query("SELECT ended_at FROM agent_runs WHERE run_id=$1",[a.runId])).rows[0].ended_at,null);
    assert.equal((await a.finish(first.generation)).state,'ADMITTED');
    const idleBypass=await a.idle();
    assert.ok('runEnded' in idleBypass);assert.equal(idleBypass.runEnded,false);
    const next=(await claimAssignment(db,a.runId,a.agent.credentialId))!;
    assert.equal(next.repositoryId,'2');assert.notEqual(next.generation,first.generation);
    await assert.rejects(a.finish(first.generation),/Stale or missing assignment/);
    await assert.rejects(executeAgentTool(db,{...a.agent,credentialId:randomUUID()},'boardroom_finish',{
      runId:a.runId,generation:next.generation,outcome:'YIELDED'}),/unauthorized run/);
    await assert.rejects(a.finish(next.generation,{reason:'RESOURCE_LIMIT',evidence:'short'}));
    await assert.rejects(saveCheckpoint(db,a.runId,a.agent.credentialId,next.generation,{state:{oversized:'x'.repeat(17000)}}));
    // A failed checkpoint cannot prevent a genuine hard-stop release. The test
    // diagnostic is explicitly agent-reported, never verified platform evidence.
    const stopped=await a.finish(next.generation,{reason:'CAPABILITY_UNAVAILABLE',evidence:'Fixture: execution capability unavailable across this activation'});
    assert.ok('runEnded' in stopped);assert.equal(stopped.runEnded,true);
    assert.equal((await db.query("SELECT details->>'evidenceSource' AS source FROM audit_events WHERE run_id=$1 AND kind='agent.run.stop_reported'",[a.runId])).rows[0].source,'AGENT_REPORTED');
    assert.equal((await a.finish(next.generation)).state,'YIELDED');
    const b=await principal('Target reached fixture');
    const atTarget=(await claimAssignment(db,b.runId,b.agent.credentialId))!;
    await db.query("UPDATE agent_runs SET started_at=now()-interval '50 minutes' WHERE run_id=$1",[b.runId]);
    const done=await b.finish(atTarget.generation);assert.ok('runEnded' in done);assert.equal(done.runEnded,true);
    const c=await principal('Older connection checkpoint stop fixture');
    const older=(await claimAssignment(db,c.runId,c.agent.credentialId))!;
    await saveCheckpoint(db,c.runId,c.agent.credentialId,older.generation,{state:{sessionStop:{reason:'RUNTIME_LIMIT',evidence:'Fixture: actual host deadline reached; no further execution available'}}});
    const oldDone=await c.finish(older.generation);assert.ok('runEnded' in oldDone);assert.equal(oldDone.runEnded,true);
    const d=await principal('Unassigned outage fixture');
    const outage=await d.idle({reason:'CAPABILITY_UNAVAILABLE',evidence:'Fixture: bounded authoritative GitHub synchronization retries exhausted'});
    assert.ok('runEnded' in outage);assert.equal(outage.runEnded,true);
    const e=await principal('Actually empty fixture');
    await db.query("UPDATE repositories SET enabled=FALSE");
    const empty=await e.idle();assert.ok('runEnded' in empty);assert.equal(empty.runEnded,true);
  }finally{
    if(db)await db.end();
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
  }
});
