import test,{after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {getOperationalDigest} from "../src/server/operational-digest.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Digest fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});
after(async()=>db.end());
test("real schema produces a private digest from receipts and pending actions",async()=>{
  const repositoryId="930000001",sha="a".repeat(40);
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,'ci/digest',now())",[repositoryId]);
  await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'github.write.upsert_file',$2::jsonb)",
    [repositoryId,JSON.stringify({unitId:"REPORT-001",result:{commitSha:sha,privateField:"must-not-appear"}})]);
  await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'agent.run.finished',$2::jsonb)",
    [repositoryId,JSON.stringify({outcome:"COMPLETED",unverifiedClaim:"must-not-appear"})]);
  await db.query("INSERT INTO owner_actions(action_key,title,action_type,instructions,created_at) VALUES('ci:digest:credential','Configure fixture credential','CREDENTIAL','Private fixture instructions must-not-appear',now()-interval '8 days')");
  const report=await getOperationalDigest(db,{NODE_ENV:"test"});
  assert.ok(report.activity.some(a=>a.repository==="ci/digest"&&a.url.endsWith("/commit/"+sha)));
  assert.ok(report.ownerActions.some(a=>a.title==="Configure fixture credential"&&a.attention==="OVERDUE"));
  assert.ok(!JSON.stringify(report).includes("must-not-appear"));
  assert.equal(report.deployment.ready,true);
});
