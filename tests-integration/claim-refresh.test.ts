import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {claimAssignment,AssignmentRefreshPending} from "../src/server/assignment.ts";
import {agentToolFailure} from "../src/server/agent-tool-failure.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Claim fixtures require an isolated boardroom_test database");

test("stale-project failure and concurrent claim races cannot deny healthy work or report false idle",async()=>{
  const admin=new Pool({connectionString:url,max:1});
  const schema="claim_refresh_"+randomUUID().replaceAll("-","");
  let db:Pool|undefined;
  try{
    await admin.query('CREATE SCHEMA "'+schema+'"');
    db=new Pool({connectionString:url,max:6,options:'-c search_path='+schema+',public'});
    for(const m of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+m.filename,import.meta.url),"utf8"));
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) SELECT i,'ci/refresh-'||i,now() FROM generate_series(1,6) i");
    await db.query("INSERT INTO repository_leases(repository_id) SELECT repository_id FROM repositories");
    await db.query("INSERT INTO repository_priority(repository_id,position) SELECT repository_id,repository_id FROM repositories");
    await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) SELECT repository_id,now()-interval '5 minutes','VERIFIED' FROM repositories");
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) SELECT repository_id,'CI-001','Fixture',1,TRUE,'PENDING' FROM repositories");
    const principal=async(label:string)=>{
      const cred=(await db!.query("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",[label,createHash('sha256').update(label).digest('hex')])).rows[0].credential_id;
      const run=(await db!.query("INSERT INTO agent_runs(provider,credential_id) VALUES('test',$1) RETURNING run_id",[cred])).rows[0].run_id;
      return {cred,run};
    };
    const a=await principal('Healthy fallback');
    await db.query("UPDATE repository_sync_status SET last_success_at=now() WHERE repository_id=6");
    const attempted:string[]=[];
    const healthy=await claimAssignment(db,a.run,a.cred,async id=>{attempted.push(id);throw new Error('Unreachable project');});
    assert.deepEqual(attempted,['1','2','3','4']);
    assert.equal(healthy?.repositoryId,'6');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM repository_leases WHERE run_id=$1",[a.run])).rows[0].n,1);
    const b=await principal('Race victim'),c=await principal('Concurrent winner');
    let raced=false;
    await assert.rejects(claimAssignment(db,b.run,b.cred,async id=>{
      // Only the first candidate refreshes; a concurrent run acquires it before
      // this caller enters its lease transaction. Remaining candidates stay stale.
      if(!raced){
        raced=true;
        await db!.query("UPDATE repository_sync_status SET last_success_at=now() WHERE repository_id=$1",[id]);
        const won=await claimAssignment(db!,c.run,c.cred);assert.equal(won?.repositoryId,id);
      }else throw new Error('Temporary GitHub failure');
    }),AssignmentRefreshPending);
    assert.equal((await db.query("SELECT state FROM agent_runs WHERE run_id=$1",[b.run])).rows[0].state,'ADMITTED');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM repository_leases WHERE run_id=$1",[b.run])).rows[0].n,0);
    const failure=agentToolFailure(new AssignmentRefreshPending()).structuredContent.error;
    assert.equal(failure.retryable,true);assert.equal(failure.code,'ASSIGNMENT_REFRESH_PENDING');
    const resumed=await claimAssignment(db,b.run,b.cred,async id=>{
      await db!.query("UPDATE repository_sync_status SET last_success_at=now() WHERE repository_id=$1",[id]);
    });
    assert.equal(resumed?.repositoryId,'2');
    await db.query("UPDATE repositories SET enabled=FALSE WHERE repository_id IN (1,2,6)");
    await db.query("UPDATE repository_sync_status SET last_success_at=now()-interval '5 minutes'");
    const d=await principal('Merged candidate refresh');
    const afterMerge=await claimAssignment(db,d.run,d.cred,async id=>{
      await db!.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1",[id]);
      await db!.query("UPDATE repository_sync_status SET last_success_at=now() WHERE repository_id=$1",[id]);
    });
    assert.equal(afterMerge,null);
    // Four reconciliations can consume the entire preflight bound while each
    // candidate becomes merged. A fifth stale project is not an empty queue.
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) SELECT i,'ci/refresh-'||i,now() FROM generate_series(7,11) i");
    await db.query("INSERT INTO repository_leases(repository_id) SELECT i FROM generate_series(7,11) i");
    await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) SELECT i,now()-interval '5 minutes','VERIFIED' FROM generate_series(7,11) i");
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) SELECT i,'CI-001','Fixture',1,TRUE,'PENDING' FROM generate_series(7,11) i");
    const e=await principal('Refresh bound');
    await assert.rejects(claimAssignment(db,e.run,e.cred,async id=>{
      await db!.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1",[id]);
    }),AssignmentRefreshPending);
    const fifth=await claimAssignment(db,e.run,e.cred,async id=>{
      await db!.query("UPDATE repository_sync_status SET last_success_at=now() WHERE repository_id=$1",[id]);
    });
    assert.equal(fifth?.repositoryId,'11');
  }finally{
    if(db)await db.end();
    await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
  }
});
