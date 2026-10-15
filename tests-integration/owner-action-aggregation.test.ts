import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {createOwnerAction,listOwnerActions,parseOwnerAction} from "../src/server/owner-actions.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Owner-action aggregation fixtures require the explicit boardroom_test database");

test("concurrent requests for one prerequisite create one card listing every affected repository",async()=>{
  const db=new Pool({connectionString:url,max:4});
  const repositoryIds=["970000001","970000002"];
  const fullNames=["ci/owner-action-alpha","ci/owner-action-beta"];
  const credentialIds:string[]=[];
  const runIds:string[]=[];
  const actionKey="provider:shared:ci-account";
  try{
    for(let i=0;i<2;i++){
      await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,$2,now())",[repositoryIds[i],fullNames[i]]);
      await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved) VALUES($1,'ACT-001','Owner action fixture',1,TRUE)",[repositoryIds[i]]);
      const credential=await db.query<{credential_id:string}>(
        "INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",
        ["Owner action "+i,String(i+7).repeat(64)]
      );
      credentialIds.push(credential.rows[0].credential_id);
      const run=await db.query<{run_id:string}>(
        "INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",
        [credentialIds[i]]
      );
      runIds.push(run.rows[0].run_id);
      await db.query(
        "INSERT INTO repository_leases(repository_id,run_id,generation,expires_at,last_heartbeat_at,assigned_at) VALUES($1,$2,1,now()+interval '180 seconds',now(),now())",
        [repositoryIds[i],runIds[i]]
      );
      await db.query(
        "INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,1,'ACT-001')",
        [repositoryIds[i],runIds[i]]
      );
    }

    const inputs=runIds.map(runId=>parseOwnerAction({
      runId,generation:"1",actionKey,title:"Create shared provider account",type:"ACCOUNT",
      condition:"OWNER_ACCOUNT_CREATION",
      instructions:"Create the single shared provider account required by both repositories.",
      requestedPermissions:[],secureEntryLocation:null,priceEstimateCents:null
    }));
    const created=await Promise.all(inputs.map((input,i)=>createOwnerAction(db,credentialIds[i],input)));
    assert.equal(new Set(created.map(item=>item.actionId)).size,1);

    const count=await db.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM owner_actions WHERE action_key=$1",[actionKey]
    );
    assert.equal(count.rows[0].count,"1");
    const actions=await listOwnerActions(db,"OPEN");
    const card=actions.find(row=>row.action_id===created[0].actionId);
    assert.ok(card);
    assert.deepEqual(card.affected,[
      {repositoryId:repositoryIds[0],fullName:fullNames[0],unitId:"ACT-001"},
      {repositoryId:repositoryIds[1],fullName:fullNames[1],unitId:"ACT-001"}
    ]);
  }finally{
    await db.query("DELETE FROM audit_events WHERE run_id=ANY($1::uuid[])",[runIds]);
    await db.query("DELETE FROM owner_actions WHERE action_key=$1",[actionKey]);
    await db.query("DELETE FROM work_assignments WHERE run_id=ANY($1::uuid[])",[runIds]);
    await db.query("DELETE FROM repository_leases WHERE repository_id=ANY($1::bigint[])",[repositoryIds]);
    await db.query("DELETE FROM roadmap_units WHERE repository_id=ANY($1::bigint[])",[repositoryIds]);
    await db.query("DELETE FROM agent_runs WHERE run_id=ANY($1::uuid[])",[runIds]);
    await db.query("DELETE FROM agent_credentials WHERE credential_id=ANY($1::uuid[])",[credentialIds]);
    await db.query("DELETE FROM repositories WHERE repository_id=ANY($1::bigint[])",[repositoryIds]);
    await db.end();
  }
});
