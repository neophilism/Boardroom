import test,{after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {createHash} from "node:crypto";
import {openCoffeeThread,answerCoffeeThread,CoffeeError,CoffeeRateLimit} from "../src/server/coffee.ts";
import {searchCoffeeThreads} from "../src/server/coffee-search.ts";
import {WITHHELD_DISCUSSION_TEXT} from "../src/domain/discussion-privacy.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Coffee privacy fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:6});
after(async()=>db.end());

test("parallel Coffee writes share a credential budget across runs, and revoked identities cannot post",async()=>{
  const credential=await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Skynet','test',$1) RETURNING credential_id",
    [createHash("sha256").update("ci-coffee-privacy-fixture").digest("hex")]);
  const credentialId=credential.rows[0].credential_id;
  const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id) VALUES('test',$1) RETURNING run_id",[credentialId]);
  const runId=run.rows[0].run_id;
  const input={runId,subject:"Coffee privacy API test fixture",question:"Which repository API migration prevents this database failure?"};
  const threads=await Promise.all(Array.from({length:5},(_,i)=>openCoffeeThread(db,credentialId,{...input,question:input.question+" Case "+i+"."})));
  await assert.rejects(()=>openCoffeeThread(db,credentialId,{...input,question:input.question+" Excess."}),CoffeeRateLimit);
  await db.query("UPDATE agent_runs SET state='COMPLETED',ended_at=now() WHERE run_id=$1",[runId]);
  const next=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id) VALUES('test',$1) RETURNING run_id",[credentialId]);
  const nextId=next.rows[0].run_id;
  await assert.rejects(()=>openCoffeeThread(db,credentialId,{...input,runId:nextId,question:input.question+" Next activation."}),CoffeeRateLimit);
  const duplicate=await openCoffeeThread(db,credentialId,{...input,runId:nextId,question:input.question+" Case 0."});
  assert.equal(duplicate.reused,true);
  const answers=await Promise.allSettled(Array.from({length:16},(_,i)=>answerCoffeeThread(db,credentialId,nextId,threads[0].threadId,
    "The repository API test requires a database migration fixture. Answer "+i+".",
    ["https://github.com/ci/repo/pull/7"],"The production database API has not been inspected.")));
  assert.equal(answers.filter(result=>result.status==="fulfilled").length,15);
  assert.ok(answers.some(result=>result.status==="rejected"&&result.reason instanceof CoffeeRateLimit));
  await db.query("UPDATE agent_credentials SET enabled=FALSE,revoked_at=now() WHERE credential_id=$1",[credentialId]);
  await assert.rejects(()=>answerCoffeeThread(db,credentialId,nextId,threads[0].threadId,
    "The repository API needs another database migration fixture.",
    ["https://github.com/ci/repo/pull/7"],"The production database API has not been inspected."),CoffeeError);
  const secret="ghp_"+"z".repeat(30);
  await db.query("INSERT INTO coffee_messages(thread_id,content,evidence,message_kind) VALUES($1,$2,$3::jsonb,'ANSWER')",
    [threads[0].threadId,"The repository API leaked "+secret,JSON.stringify(["https://github.com/ci/repo/blob/main/"+secret])]);
  const results=await searchCoffeeThreads(db,"Coffee privacy",null);
  const exposed=JSON.stringify(results);
  assert.ok(!exposed.includes(secret));
  assert.ok(results.some(thread=>thread.messages.some(message=>message.content===WITHHELD_DISCUSSION_TEXT)));
});
