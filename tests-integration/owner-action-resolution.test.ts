import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {resolveVerifiedOwnerAction} from "../src/server/owner-action-resolution.ts";
import {assertWorkPrerequisites} from "../src/server/work-prerequisites.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Owner-action resolution fixtures require the explicit boardroom_test database");

test("one verified shared prerequisite re-enables every dependent repository",async()=>{
  const db=new Pool({connectionString:url,max:2});
  const repositoryIds=["960000101","960000102"];
  let actionId="";
  try{
    for(const [index,repositoryId] of repositoryIds.entries()){
      await db.query(
        "INSERT INTO repositories(repository_id,full_name,created_at,enabled) VALUES($1,$2,now(),FALSE)",
        [repositoryId,"ci/owner-resolution-"+index]
      );
      await db.query(
        "INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'RES-001','Resolution fixture',1,TRUE,'PENDING')",
        [repositoryId]
      );
    }
    const action=await db.query<{action_id:string}>(
      "INSERT INTO owner_actions(action_key,title,action_type,instructions,status) VALUES('ci:shared:verified-account','Verify shared account','ACCOUNT','Verify the shared provider account exists.','AWAITING_VERIFICATION') RETURNING action_id"
    );
    actionId=action.rows[0].action_id;
    for(const repositoryId of repositoryIds)
      await db.query(
        "INSERT INTO owner_action_dependents(action_id,repository_id,unit_id) VALUES($1,$2,'RES-001')",
        [actionId,repositoryId]
      );

    for(const repositoryId of repositoryIds)
      await assert.rejects(assertWorkPrerequisites(db,repositoryId,"RES-001"),/Owner action prerequisite unresolved/);

    const resolution=await resolveVerifiedOwnerAction(db,actionId,{
      kind:"account_probe",evidenceId:"provider-account:ready-17",verified:true
    });
    assert.deepEqual(resolution.requeued,[
      {repositoryId:repositoryIds[0],unitId:"RES-001"},
      {repositoryId:repositoryIds[1],unitId:"RES-001"}
    ]);
    for(const repositoryId of repositoryIds)
      await assertWorkPrerequisites(db,repositoryId,"RES-001");

    const audit=await db.query<{details:{requeued:unknown[]}}>(
      "SELECT details FROM audit_events WHERE kind='owner_action.fulfillment_verified' AND details->>'actionId'=$1",
      [actionId]
    );
    assert.equal(audit.rows[0].details.requeued.length,2);
  }finally{
    if(actionId)await db.query("DELETE FROM audit_events WHERE details->>'actionId'=$1",[actionId]);
    if(actionId)await db.query("DELETE FROM owner_actions WHERE action_id=$1",[actionId]);
    await db.query("DELETE FROM roadmap_units WHERE repository_id=ANY($1::bigint[])",[repositoryIds]);
    await db.query("DELETE FROM repositories WHERE repository_id=ANY($1::bigint[])",[repositoryIds]);
    await db.end();
  }
});
