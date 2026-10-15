import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {performFencedGithubWrite,parseGithubWriteRequest} from "../src/server/github-write-gateway.ts";
import {SessionConflict} from "../src/server/sessions.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Refusing to run integration fixtures outside an explicitly named boardroom_test database");

const db=new Pool({connectionString:url,max:4});
const repositoryId="960000034";
let credentialId="",wrongCredentialId="",runId="";

before(async()=>{
  await db.query("INSERT INTO repositories(repository_id,full_name,enabled,archived,created_at) VALUES($1,'ci/fenced-gateway',TRUE,FALSE,now())",[repositoryId]);
  await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,expires_at,last_heartbeat_at,assigned_at) VALUES($1,NULL,0,NULL,NULL,NULL)",[repositoryId]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'BR-034','Fenced gateway fixture',1,TRUE,'PENDING')",[repositoryId]);
  const credentials=await Promise.all([
    db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Gateway owner','test',$1) RETURNING credential_id",["7".repeat(64)]),
    db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Wrong gateway caller','test',$1) RETURNING credential_id",["8".repeat(64)])
  ]);
  credentialId=credentials[0].rows[0].credential_id;
  wrongCredentialId=credentials[1].rows[0].credential_id;
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",[credentialId]);
  runId=run.rows[0].run_id;
  await db.query("UPDATE repository_leases SET run_id=$2,generation=1,expires_at=now()+interval '180 seconds',last_heartbeat_at=now(),assigned_at=now() WHERE repository_id=$1",[repositoryId,runId]);
  await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,1,'BR-034')",[repositoryId,runId]);
});
after(async()=>{await db.end();});

test("real PostgreSQL fencing rejects stale and wrong principals before the GitHub adapter",async()=>{
  let adapterCalls=0;
  const adapter=async()=>{adapterCalls++;return {kind:"ensure_branch",created:false};};
  const request=parseGithubWriteRequest({
    runId,generation:"1",kind:"ensure_branch",repository:"ci/caller-supplied-target"
  });
  await assert.rejects(
    performFencedGithubWrite(db,runId,credentialId,"2",request.op,adapter),
    SessionConflict
  );
  await assert.rejects(
    performFencedGithubWrite(db,runId,wrongCredentialId,"1",request.op,adapter),
    SessionConflict
  );
  assert.equal(adapterCalls,0);

  let observedScope:{repository_id:string;full_name:string;unit_id:string}|null=null;
  const accepted=await performFencedGithubWrite(db,runId,credentialId,"1",request.op,async scope=>{
    observedScope={repository_id:scope.repository_id,full_name:scope.full_name,unit_id:scope.unit_id};
    return {kind:"ensure_branch",branch:"boardroom/BR-034",created:false};
  });
  assert.deepEqual(observedScope,{repository_id:repositoryId,full_name:"ci/fenced-gateway",unit_id:"BR-034"});
  assert.equal(accepted.repository,"ci/fenced-gateway");
  assert.equal((await db.query<{repository_id:string}>(
    "SELECT repository_id::text FROM audit_events WHERE run_id=$1 AND kind='github.write.ensure_branch' ORDER BY event_id DESC LIMIT 1",
    [runId]
  )).rows[0].repository_id,repositoryId);
});
