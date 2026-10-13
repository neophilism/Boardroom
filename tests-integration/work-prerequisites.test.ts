import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {REPOSITORY_CLAIM_QUERY} from "../src/server/assignment.ts";
import {assertWorkPrerequisites} from "../src/server/work-prerequisites.ts";
import {SessionConflict} from "../src/server/sessions.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Dependency fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});
const repos=["950000001","950000002","950000003","950000004"];
before(async()=>{
  for(const [i,id] of repos.entries()){
    // Disabled fixtures cannot compete with the separate lease benchmark.
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at,enabled) VALUES($1,$2,$3,FALSE)",
      [id,"ci/dependency-"+i,i===3?"2020-01-01":"2026-01-01"]);
    await db.query("INSERT INTO repository_leases(repository_id) VALUES($1)",[id]);
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'CI-001','Dependency fixture',1,TRUE,'PENDING')",[id]);
  }
  await db.query("INSERT INTO repository_priority(repository_id,position) VALUES($1,950000001)",[repos[0]]);
  await db.query("INSERT INTO compatibility_dependencies(repository_id,unit_id,prerequisite_repository_id,prerequisite_unit_id) VALUES($1,'CI-001',$2,'CI-001'),($2,'CI-001',$3,'CI-001')",repos.slice(0,3));
});
after(async()=>db.end());
async function selected(){
  // Exercise the real recursive selector, isolating only the fixture inventory
  // so concurrently running integration files cannot influence the result.
  const query=REPOSITORY_CLAIM_QUERY.replace("WHERE r.enabled = TRUE AND r.archived = FALSE",
    "WHERE r.repository_id=ANY($1::bigint[]) AND r.archived=FALSE");
  const row=await db.query<{repository_id:string}>(query,[repos]);
  return row.rows[0]?.repository_id;
}
test("transitive prerequisites inherit owner priority ahead of unrelated older work",async()=>{
  assert.equal(await selected(),repos[2]);
  await db.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1",[repos[2]]);
  assert.equal(await selected(),repos[1]);
  await db.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1",[repos[1]]);
  assert.equal(await selected(),repos[0]);
  await assertWorkPrerequisites(db,repos[0],"CI-001");
});
test("a revoked prerequisite plan cannot authorize its downstream consumer",async()=>{
  await db.query("UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1",[repos[1]]);
  assert.equal(await selected(),repos[3]);
  await assert.rejects(assertWorkPrerequisites(db,repos[0],"CI-001"),/Cross-repository compatibility prerequisite unresolved/);
  await db.query("UPDATE roadmap_units SET approved=TRUE WHERE repository_id=$1",[repos[1]]);
});
test("a local dependency changed after admission blocks subsequent privileged work",async()=>{
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'CI-002','Local prerequisite',1,TRUE,'MERGED')",[repos[0]]);
  await db.query("UPDATE roadmap_units SET depends_on='[\"CI-002\"]'::jsonb WHERE repository_id=$1 AND unit_id='CI-001'",[repos[0]]);
  await assertWorkPrerequisites(db,repos[0],"CI-001");
  await db.query("UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1 AND unit_id='CI-002'",[repos[0]]);
  await assert.rejects(assertWorkPrerequisites(db,repos[0],"CI-001"),/Approved work-unit prerequisite unresolved/);
  await db.query("UPDATE roadmap_units SET approved=TRUE WHERE repository_id=$1 AND unit_id='CI-002'",[repos[0]]);
});
test("new or declined owner prerequisites block writes until independently resolved",async()=>{
  const action=await db.query<{action_id:string}>("INSERT INTO owner_actions(action_key,title,action_type,instructions,status) VALUES('ci:dependency-test','Fixture approval','APPROVAL','Private fixture instructions','OPEN') RETURNING action_id");
  const id=action.rows[0].action_id;
  await db.query("INSERT INTO owner_action_dependents(action_id,repository_id,unit_id) VALUES($1,$2,'CI-001')",[id,repos[0]]);
  for(const state of ["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION","DECLINED"]){
    await db.query("UPDATE owner_actions SET status=$2 WHERE action_id=$1",[id,state]);
    await assert.rejects(assertWorkPrerequisites(db,repos[0],"CI-001"),/Owner action prerequisite unresolved/);
  }
  await db.query("UPDATE owner_actions SET status='VERIFIED' WHERE action_id=$1",[id]);
  await assertWorkPrerequisites(db,repos[0],"CI-001");
  await assert.rejects(assertWorkPrerequisites(db,repos[0],"CI-999"),SessionConflict);
});
test("cyclic compatibility records terminate selection safely without double claims",async()=>{
  await db.query("UPDATE roadmap_units SET state='PENDING' WHERE repository_id=ANY($1::bigint[])",[repos.slice(0,3)]);
  await db.query("INSERT INTO compatibility_dependencies(repository_id,unit_id,prerequisite_repository_id,prerequisite_unit_id) VALUES($1,'CI-001',$2,'CI-001')",[repos[2],repos[0]]);
  const client=await db.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='2s'");
    const query=REPOSITORY_CLAIM_QUERY.replace("WHERE r.enabled = TRUE AND r.archived = FALSE","WHERE r.repository_id=ANY($1::bigint[]) AND r.archived=FALSE");
    assert.equal((await client.query(query,[repos])).rows[0]?.repository_id,repos[3]);
    await client.query("ROLLBACK");
  }finally{client.release();}
});
