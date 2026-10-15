import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {performFencedGithubWrite,parseGithubWriteRequest,GithubWriteValidation} from "../src/server/github-write-gateway.ts";
import {SessionConflict} from "../src/server/sessions.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Gateway fencing fixtures require the explicit boardroom_test database");

const db=new Pool({connectionString:url,max:2});
const repositoryId="997000001";
let runId="",credentialId="",otherCredentialId="";

before(async()=>{
  await db.query("INSERT INTO repositories(repository_id,full_name,enabled,archived,created_at) VALUES($1,'ci/gateway-fence',TRUE,FALSE,now())",[repositoryId]);
  await db.query("INSERT INTO repository_leases(repository_id,generation) VALUES($1,0)",[repositoryId]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'GATE-001','Gateway fixture',1,TRUE,'PENDING')",[repositoryId]);
  const credentials=await Promise.all([
    db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Gateway Owner','test',$1) RETURNING credential_id",["7".repeat(64)]),
    db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Gateway Other','test',$1) RETURNING credential_id",["8".repeat(64)])
  ]);
  credentialId=credentials[0].rows[0].credential_id;
  otherCredentialId=credentials[1].rows[0].credential_id;
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",[credentialId]);
  runId=run.rows[0].run_id;
  await db.query("UPDATE repository_leases SET run_id=$2,generation=1,expires_at=now()+interval '180 seconds',last_heartbeat_at=now(),assigned_at=now() WHERE repository_id=$1",[repositoryId,runId]);
  await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,1,'GATE-001')",[repositoryId,runId]);
});
after(async()=>db.end());

test("real gateway rejects wrong credentials and stale generations before GitHub access",async()=>{
  await assert.rejects(performFencedGithubWrite(db,runId,otherCredentialId,"1",{kind:"ensure_branch"}),SessionConflict);
  await assert.rejects(performFencedGithubWrite(db,runId,credentialId,"2",{kind:"ensure_branch"}),SessionConflict);
  const audit=await db.query<{count:string}>("SELECT COUNT(*)::text AS count FROM audit_events WHERE run_id=$1 AND kind LIKE 'github.write.%'",[runId]);
  assert.equal(audit.rows[0].count,"0");
});

test("caller-supplied repository authority is rejected rather than interpreted",()=>{
  const base={runId,generation:"1",kind:"ensure_branch"};
  for(const field of ["repository","repositoryId","fullName","owner","repo"])
    assert.throws(()=>parseGithubWriteRequest({...base,[field]:"attacker/other"}),GithubWriteValidation);
  assert.deepEqual(parseGithubWriteRequest(base).op,{kind:"ensure_branch"});
});
