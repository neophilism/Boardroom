import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {REPOSITORY_CLAIM_QUERY} from "../src/server/assignment.ts";
import {assertWorkPrerequisites} from "../src/server/work-prerequisites.ts";
import {recoverRun} from "../src/server/operations.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Recovery fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});
const technical="996020001",owner="996020002",recovery="996020003",fallback="996020004";
let firstThread:string,secondThread:string;
const evidence=JSON.stringify(["https://github.com/neophilism/Boardroom/blob/main/README.md"]);
const isolated=REPOSITORY_CLAIM_QUERY.replace("WHERE r.enabled = TRUE AND r.archived = FALSE",
  "WHERE r.repository_id=ANY($1::bigint[]) AND r.archived=FALSE");
async function selected(id:string){
  const result=await db.query<{repository_id:string}>(isolated,[[id,fallback]]);
  return result.rows[0]?.repository_id;
}
async function question(status="OPEN"){
  const row=await db.query<{thread_id:string}>(
    "INSERT INTO coffee_threads(repository_id,unit_id,subject,status,created_at) VALUES($1,'REC-001','Recovery policy fixture',$2,now()-interval '1 day') RETURNING thread_id",
    [technical,status]);
  return row.rows[0].thread_id;
}
async function answer(thread:string,proof:string,timestamp="now()"){
  // Timestamp expressions are fixed fixture inputs, never application input.
  await db.query("INSERT INTO coffee_messages(thread_id,content,message_kind,evidence,created_at) VALUES($1,'Fixture source answer','ANSWER',$2::jsonb,"+timestamp+")",[thread,proof]);
}
before(async()=>{
  for(const [i,id] of [technical,owner,recovery,fallback].entries()){
    await db.query("INSERT INTO repositories(repository_id,full_name,enabled,created_at) VALUES($1,$2,FALSE,$3)",
      [id,"ci/br020-recovery-"+i,id===fallback?"2026-01-01":"2020-01-01"]);
    await db.query("INSERT INTO repository_leases(repository_id) VALUES($1)",[id]);
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'REC-001','Recovery fixture',1,TRUE,'PENDING')",[id]);
  }
});
after(async()=>db.end());

test("ready approved work remains selectable",async()=>{
  assert.equal(await selected(technical),technical);
  await assertWorkPrerequisites(db,technical,"REC-001");
});
test("an unresolved question blocks admission and late writes even for an existing open PR",async()=>{
  await db.query("UPDATE roadmap_units SET state='OPEN_PR' WHERE repository_id=$1",[technical]);
  firstThread=await question();
  assert.equal(await selected(technical),fallback);
  await assert.rejects(assertWorkPrerequisites(db,technical,"REC-001"),/Technical question prerequisite unresolved/);
});
test("an answer without evidence does not recover work; a source-backed answer permits verification",async()=>{
  await db.query("UPDATE coffee_threads SET status='ANSWERED' WHERE thread_id=$1",[firstThread]);
  await answer(firstThread,"[]","now()-interval '2 minutes'");
  assert.equal(await selected(technical),fallback);
  await answer(firstThread,evidence,"now()-interval '2 minutes'");
  assert.equal(await selected(technical),technical);
});
test("a blocked retry consumes old answers instead of reassigning the same unrecoverable work",async()=>{
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,state,started_at,ended_at) VALUES('test','BLOCKED',now()-interval '1 minute',now()) RETURNING run_id");
  await db.query("INSERT INTO work_assignments(repository_id,unit_id,run_id,lease_generation,released_at,outcome) VALUES($1,'REC-001',$2,1,now(),'BLOCKED')",[technical,run.rows[0].run_id]);
  await db.query("UPDATE roadmap_units SET state='BLOCKED' WHERE repository_id=$1",[technical]);
  assert.equal(await selected(technical),fallback);
  await assert.rejects(assertWorkPrerequisites(db,technical,"REC-001"),/retry evidence consumed/);
  await answer(firstThread,evidence);
  assert.equal(await selected(technical),technical);
  await assertWorkPrerequisites(db,technical,"REC-001");
});
test("every unresolved question must have fresh evidence; another old answer cannot hide a new blocker",async()=>{
  secondThread=await question();
  assert.equal(await selected(technical),fallback);
  await db.query("UPDATE coffee_threads SET status='ANSWERED' WHERE thread_id=$1",[secondThread]);
  await answer(secondThread,evidence);
  assert.equal(await selected(technical),technical);
  await db.query("UPDATE coffee_threads SET status='RESOLVED' WHERE thread_id=ANY($1::uuid[])",[[firstThread,secondThread]]);
  await db.query("UPDATE roadmap_units SET state='ACTIVE' WHERE repository_id=$1",[technical]);
  assert.equal(await selected(technical),technical);
});
test("owner acknowledgement or claimed fulfillment is insufficient; verified resolution re-enables work",async()=>{
  const row=await db.query<{action_id:string}>("INSERT INTO owner_actions(action_key,title,action_type,instructions) VALUES('ci:br020:owner','Recovery owner fixture','CREDENTIAL','Fixture instructions') RETURNING action_id");
  const id=row.rows[0].action_id;
  await db.query("INSERT INTO owner_action_dependents(action_id,repository_id,unit_id) VALUES($1,$2,'REC-001')",[id,owner]);
  for(const state of ["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION","DECLINED"]){
    await db.query("UPDATE owner_actions SET status=$2 WHERE action_id=$1",[id,state]);
    assert.equal(await selected(owner),fallback);
    await assert.rejects(assertWorkPrerequisites(db,owner,"REC-001"),/Owner action prerequisite unresolved/);
  }
  await db.query("UPDATE owner_actions SET status='VERIFIED',resolved_at=now() WHERE action_id=$1",[id]);
  assert.equal(await selected(owner),owner);
  await assertWorkPrerequisites(db,owner,"REC-001");
});
test("expired recovery leases stay excluded until the actual fenced recovery operation succeeds",async()=>{
  const credential=await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('BR020 recovery fixture','test',$1) RETURNING credential_id",["d020".repeat(16)]);
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,state,credential_id) VALUES('test','RECOVERING',$1) RETURNING run_id",[credential.rows[0].credential_id]);
  const id=run.rows[0].run_id;
  await db.query("INSERT INTO work_assignments(repository_id,unit_id,run_id,lease_generation) VALUES($1,'REC-001',$2,1)",[recovery,id]);
  await db.query("UPDATE repository_leases SET generation=1,run_id=$2,assigned_at=now()-interval '10 minutes',last_heartbeat_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes' WHERE repository_id=$1",[recovery,id]);
  assert.equal(await selected(recovery),fallback);
  await assert.rejects(recoverRun(db,id,false),/Verify outside execution stopped/);
  assert.equal(await selected(recovery),fallback);
  assert.deepEqual(await recoverRun(db,id,true),{state:"CANCELLED",replay:false,credentialRevoked:true});
  assert.equal(await selected(recovery),recovery);
  const audit=await db.query<{kind:string}>("SELECT kind FROM audit_events WHERE run_id=$1 AND kind='owner.run.fenced_and_recovered'",[id]);
  assert.equal(audit.rowCount,1);
  const lease=await db.query<{generation:string;run_id:string|null}>("SELECT generation::text,run_id FROM repository_leases WHERE repository_id=$1",[recovery]);
  assert.deepEqual(lease.rows[0],{generation:"2",run_id:null});
});
