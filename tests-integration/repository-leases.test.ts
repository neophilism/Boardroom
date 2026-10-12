import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {claimAssignment,type ClaimedAssignment} from "../src/server/assignment.ts";
import {heartbeatRun,saveCheckpoint,finishRun,SessionConflict} from "../src/server/sessions.ts";
import {finishIdleSession} from "../src/server/idle-session.ts";
import {admitAgentRun} from "../src/server/admission.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Refusing to run integration fixtures outside an explicitly named boardroom_test database");

const db=new Pool({connectionString:url,max:8});
const credentials:string[]=[];
const runs:string[]=[];
const repoIds=["920000001","920000002"];
let assigned:ClaimedAssignment[]=[];

before(async()=>{
  await db.query(
    "INSERT INTO repositories(repository_id,full_name,enabled,archived,created_at,last_development_at) "+
    "VALUES($1,'ci/oldest',TRUE,FALSE,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),"+
    "($2,'ci/priority',TRUE,FALSE,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z')",
    repoIds
  );
  await db.query(
    "INSERT INTO repository_leases(repository_id,generation) VALUES ($1,0),($2,0)",repoIds
  );
  await db.query(
    "INSERT INTO repository_priority(repository_id,position) VALUES($1,1)",[repoIds[1]]
  );
  await db.query(
    "INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) "+
    "VALUES($1,'CI-001','Oldest fixture',1,TRUE,'PENDING'),"+
    "($2,'CI-002','Priority fixture',1,TRUE,'PENDING')",
    repoIds
  );
  for(const [i,name] of ["Smith","Eve","Gort","C-3PO"].entries()){
    const key=String(i+1).repeat(64);
    const result=await db.query<{credential_id:string}>(
      "INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",
      [name,key]
    );
    credentials.push(result.rows[0].credential_id);
  }
  for(let i=0;i<3;i++){
    const result=await db.query<{run_id:string}>(
      "INSERT INTO agent_runs(provider,activation_source,credential_id) VALUES('test',$1,$2) RETURNING run_id",
      [["Smith","Eve","Gort"][i],credentials[i]]
    );
    runs.push(result.rows[0].run_id);
  }
});
after(async()=>{await db.end();});

test("two concurrent sessions claim distinct repositories with top priority included",async()=>{
  const results=await Promise.all([
    claimAssignment(db,runs[0],credentials[0]),
    claimAssignment(db,runs[1],credentials[1])
  ]);
  assert.ok(results[0]);
  assert.ok(results[1]);
  assigned=results as ClaimedAssignment[];
  assert.deepEqual(new Set(assigned.map(a=>a.repositoryId)),new Set(repoIds));
  assert.equal(assigned.filter(a=>a.repositoryId===repoIds[1]).length,1);
  assert.equal(assigned.filter(a=>a.repositoryId===repoIds[0]).length,1);
  assert.ok(assigned.every(a=>!a.replay));
});

test("current owner may heartbeat/checkpoint, but stale lease generations fail closed",async()=>{
  const grant=assigned[0];
  const renewal=await heartbeatRun(db,runs[0],credentials[0],grant.generation);
  assert.ok(Date.parse(renewal)>Date.now());
  const stored=await saveCheckpoint(db,runs[0],credentials[0],grant.generation,{
    branch:"boardroom/CI-001",headSha:null,state:{checkpoint:"recorded",evidence:["real postgres"]}
  });
  assert.match(stored,/^[0-9a-f-]{36}$/i);
  const stale=(BigInt(grant.generation)+1n).toString();
  await assert.rejects(heartbeatRun(db,runs[0],credentials[0],stale),SessionConflict);
  const results=await db.query<{number:string}>(
    "SELECT COUNT(*)::text AS number FROM checkpoints WHERE run_id=$1",[runs[0]]
  );
  assert.equal(results.rows[0].number,"1");
});

test("expired but still assigned repo stays unavailable to other scheduled agents",async()=>{
  const grant=assigned[1];
  await db.query(
    "UPDATE repository_leases SET expires_at=now()-interval '2 seconds' WHERE repository_id=$1",
    [grant.repositoryId]
  );
  const result=await claimAssignment(db,runs[2],credentials[2]);
  assert.equal(result,null);
  const count=await db.query<{n:string}>(
    "SELECT COUNT(*)::text AS n FROM work_assignments WHERE released_at IS NULL"
  );
  assert.equal(count.rows[0].n,"2");
  const idle=await finishIdleSession(db,runs[2],credentials[2]);
  assert.equal(idle.state,"YIELDED");
});

test("fenced owner completes and releases, then a distinct activation becomes eligible",async()=>{
  for(let i=0;i<2;i++){
    const result=await finishRun(db,runs[i],credentials[i],assigned[i].generation,"COMPLETED");
    assert.equal(result.state,"COMPLETED");
    assert.equal(result.replay,false);
  }
  const outstanding=await db.query<{n:string}>(
    "SELECT COUNT(*)::text AS n FROM repository_leases WHERE run_id IS NOT NULL"
  );
  assert.equal(outstanding.rows[0].n,"0");
  const result=await admitAgentRun(db,
    {credentialId:credentials[3],label:"C-3PO",provider:"test"},null);
  assert.equal(result.kind,"CREATED");
  if(result.kind!=="CREATED")throw new Error("Expected new session");
  const claim=await claimAssignment(db,result.runId,credentials[3]);
  assert.equal(claim?.repositoryId,repoIds[1],"Highest-priority repo wins after release");
});
