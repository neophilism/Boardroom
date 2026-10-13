import test,{after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {reconcileRoadmapUnits,recordReconciliationFailure} from "../src/server/roadmap-reconciliation.ts";
import type {CanonicalPlan} from "../src/server/roadmap-import.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Reconciliation fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});
after(async()=>db.end());
test("source refresh preserves a technical hold but opens a follow-up after prior acceptance",async()=>{
  const repositoryId=940000001;
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,'ci/reconciliation',now())",[repositoryId]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'CI-001','Blocked',1,TRUE,'BLOCKED'),($1,'CI-002','Active',1,TRUE,'ACTIVE'),($1,'CI-003','Accepted',1,TRUE,'ACCEPTED')",[repositoryId]);
  const plan:CanonicalPlan={version:1,verified:true,units:[
    {id:"CI-001",title:"Blocked",dependsOn:[],pullRequests:[],status:"PENDING",acceptanceCriteria:null},
    {id:"CI-002",title:"Active",dependsOn:[],pullRequests:[],status:"PENDING",acceptanceCriteria:null},
    {id:"CI-003",title:"Accepted",dependsOn:[],pullRequests:[8],status:"OPEN_PR",acceptanceCriteria:null}
  ]};
  await reconcileRoadmapUnits(db,repositoryId,plan);
  const states=await db.query<{state:string}>("SELECT state FROM roadmap_units WHERE repository_id=$1 ORDER BY unit_id",[repositoryId]);
  assert.deepEqual(states.rows.map(r=>r.state),["BLOCKED","ACTIVE","OPEN_PR"]);
  await recordReconciliationFailure(db,{id:repositoryId,full_name:"ci/reconciliation",description:null,archived:false,created_at:new Date().toISOString(),pushed_at:null,updated_at:new Date().toISOString()});
  assert.equal((await db.query("SELECT COUNT(*)::integer AS count FROM roadmap_units WHERE repository_id=$1 AND approved",[repositoryId])).rows[0].count,0);
  assert.equal((await db.query("SELECT plan_status,last_error FROM repository_sync_status WHERE repository_id=$1",[repositoryId])).rows[0].plan_status,"ERROR");
  await reconcileRoadmapUnits(db,repositoryId,plan);
  assert.equal((await db.query("SELECT COUNT(*)::integer AS count FROM roadmap_units WHERE repository_id=$1 AND approved",[repositoryId])).rows[0].count,3);
});
