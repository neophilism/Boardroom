import test,{after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {createHash} from "node:crypto";
import {openCoffeeThread,answerCoffeeThread} from "../src/server/coffee.ts";
import {searchCoffeeThreads} from "../src/server/coffee-search.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Coffee fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:5});
after(async()=>db.end());
test("concurrent repeated questions share one thread, and answer/ADR search is literal",async()=>{
  const credential=await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('The Entity','test',$1) RETURNING credential_id",
    [createHash("sha256").update("ci-coffee-fixture").digest("hex")]);
  const credentialId=credential.rows[0].credential_id;
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id) VALUES('test',$1) RETURNING run_id",[credentialId]);
  const deadlineAt=new Date(Date.now()+60*60*1000).toISOString();
  const input={runId:run.rows[0].run_id,subject:"Database migration API failure",
    question:"Which database migration fixes this API integration failure?",classification:"TEST_FAILURE",deadlineAt};
  const attempts=await Promise.all(Array.from({length:20},()=>openCoffeeThread(db,credentialId,input)));
  assert.equal(new Set(attempts.map(a=>a.threadId)).size,1);
  assert.equal(attempts.filter(a=>!a.reused).length,1);
  const threadId=attempts[0].threadId;
  await answerCoffeeThread(db,credentialId,input.runId,threadId,"The database API test needs the literal percent%_marker in its migration fixture.",["https://github.com/ci/repo/pull/7"]);
  const matches=await searchCoffeeThreads(db,"percent%_marker",null);
  assert.ok(matches.some(t=>t.thread_id===threadId&&t.blocker_classification==="TEST_FAILURE"&&
    t.deadline_at?.toISOString()===deadlineAt&&t.messages.some(m=>m.kind==="ANSWER")));
  assert.ok((await searchCoffeeThreads(db,"%_",null)).every(t=>t.thread_id===threadId));
  const adr="https://github.com/ci/repo/blob/"+"a".repeat(40)+"/docs/adr/database.md";
  await db.query("UPDATE coffee_threads SET status='RESOLVED' WHERE thread_id=$1",[threadId]);
  await db.query("INSERT INTO audit_events(kind,details) VALUES('coffee.answer.accepted_in_adr',$1::jsonb)",[JSON.stringify({threadId,adr})]);
  assert.equal((await searchCoffeeThreads(db,"percent%_marker","RESOLVED"))[0].adr,adr);
});
