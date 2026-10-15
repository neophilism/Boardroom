import test,{after,before} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {advanceAssignedWork} from "../src/server/chain.ts";
import {SessionConflict} from "../src/server/sessions.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Chain fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});
const repositoryId="946000001",otherRepositoryId="946000002";
let credentialId="",runId="",assignmentId="";

before(async()=>{
  await db.query(
    "INSERT INTO repositories(repository_id,full_name,created_at,enabled) "+
    "VALUES($1,'ci/chain-primary',now(),FALSE),($2,'ci/chain-other',now(),FALSE)",
    [repositoryId,otherRepositoryId]
  );
  await db.query("INSERT INTO repository_leases(repository_id) VALUES($1),($2)",
    [repositoryId,otherRepositoryId]);
  await db.query(
    "INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state,depends_on) VALUES "+
    "($1,'CHAIN-001','Merged chain fixture',1,TRUE,'MERGED','[]'::jsonb),"+
    "($1,'CHAIN-002','Next chain fixture',1,TRUE,'PENDING','[\"CHAIN-001\"]'::jsonb),"+
    "($2,'OTHER-001','Other repository fixture',1,TRUE,'PENDING','[]'::jsonb)",
    [repositoryId,otherRepositoryId]
  );
  const credential=await db.query<{credential_id:string}>(
    "INSERT INTO agent_credentials(label,provider,token_digest) "+
    "VALUES('Chain Acceptance','test',$1) RETURNING credential_id",
    ["9".repeat(64)]
  );
  credentialId=credential.rows[0].credential_id;
  const run=await db.query<{run_id:string}>(
    "INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",
    [credentialId]
  );
  runId=run.rows[0].run_id;
  await db.query(
    "UPDATE repository_leases SET run_id=$2,generation=1,expires_at=now()+interval '180 seconds',"+
    "last_heartbeat_at=now(),assigned_at=now() WHERE repository_id=$1",
    [repositoryId,runId]
  );
  const assignment=await db.query<{assignment_id:string}>(
    "INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) "+
    "VALUES($1,$2,1,'CHAIN-001') RETURNING assignment_id",
    [repositoryId,runId]
  );
  assignmentId=assignment.rows[0].assignment_id;
  await db.query("UPDATE repositories SET enabled=TRUE WHERE repository_id=$1",[repositoryId]);
});
after(async()=>db.end());

test("verified completion advances only within the held repository lease",async()=>{
  const result=await advanceAssignedWork(db,runId,credentialId,"1");
  assert.deepEqual(result,{status:"NEXT_UNIT",repository:"ci/chain-primary",
    unitId:"CHAIN-002",generation:"1"});

  const assignment=await db.query<{
    assignment_id:string;repository_id:string;lease_generation:string;unit_id:string;released_at:Date|null;
  }>("SELECT assignment_id::text,repository_id::text,lease_generation::text,unit_id,released_at "+
    "FROM work_assignments WHERE run_id=$1",[runId]);
  assert.deepEqual(assignment.rows[0],{
    assignment_id:assignmentId,repository_id:repositoryId,lease_generation:"1",
    unit_id:"CHAIN-002",released_at:null
  });

  const lease=await db.query<{run_id:string;generation:string}>(
    "SELECT run_id::text,generation::text FROM repository_leases WHERE repository_id=$1",
    [repositoryId]
  );
  assert.deepEqual(lease.rows[0],{run_id:runId,generation:"1"});
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=$1 AND unit_id='OTHER-001'",
    [otherRepositoryId])).rows[0].state,"PENDING");
  assert.equal((await db.query("SELECT details FROM audit_events WHERE run_id=$1 AND kind='agent.work.advanced'",
    [runId])).rows[0].details.to,"CHAIN-002");

  await assert.rejects(advanceAssignedWork(db,runId,credentialId,"1"),SessionConflict);
  await db.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1 AND unit_id='CHAIN-002'",
    [repositoryId]);
  assert.deepEqual(await advanceAssignedWork(db,runId,credentialId,"1"),
    {status:"EXHAUSTED",repository:"ci/chain-primary"});
});
