import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {parseCoffeeModeration,coffeeRetentionPolicy,saveCoffeeRetentionPolicy,moderateCoffee,purgeExpiredCoffee,REDACTED_MESSAGE,REDACTED_SUBJECT} from "../src/server/coffee-moderation.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Moderation fixtures require the explicit boardroom_test database");
const schema="br051_"+randomUUID().replaceAll("-","");
const admin=new Pool({connectionString:url,max:1});
const db=new Pool({connectionString:url,options:"-c search_path="+schema,max:4});
let created=false;
before(async()=>{
  await admin.query("CREATE SCHEMA "+schema);created=true;
  // Apply the exact production migrations in a private fixture namespace.
  for(const entry of MIGRATION_MANIFEST)
    await db.query(await readFile(new URL("../db/migrations/"+entry.filename,import.meta.url),"utf8"));
});
after(async()=>{await db.end();if(created)await admin.query("DROP SCHEMA "+schema+" CASCADE");await admin.end();});
async function thread(status:string,old=false){
  const row=await db.query<{thread_id:string}>(
    "INSERT INTO coffee_threads(subject,status,updated_at) VALUES('Private fixture subject',$1,"+
    (old?"now()-interval '400 days'":"now()")+") RETURNING thread_id",[status]);
  return row.rows[0].thread_id;
}
async function message(threadId:string,content="Private fixture body"){
  const row=await db.query<{message_id:string}>(
    "INSERT INTO coffee_messages(thread_id,content,evidence,message_kind) VALUES($1,$2,$3::jsonb,'ANSWER') RETURNING message_id",
    [threadId,content,JSON.stringify(["https://github.com/ci/repo/pull/7"])]);
  return row.rows[0].message_id;
}
test("owner redaction removes text and references, reopens unverified answers, and audits no content",async()=>{
  const id=await thread("ANSWERED"),mid=await message(id);
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES(998051001,'ci/moderation',now())");
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES(998051001,'PRIV-001','Fixture',1,TRUE,'OPEN_PR')");
  await db.query("UPDATE coffee_threads SET repository_id=998051001,unit_id='PRIV-001' WHERE thread_id=$1",[id]);
  const value={kind:"redact-message",threadId:id,messageId:mid,reason:"PRIVACY",confirm:true};
  assert.deepEqual(await moderateCoffee(db,value),{redacted:true,replay:false});
  assert.deepEqual(await moderateCoffee(db,value),{redacted:true,replay:true});
  const row=await db.query("SELECT content,evidence,author_run_id,redacted_at FROM coffee_messages WHERE message_id=$1",[mid]);
  assert.equal(row.rows[0].content,REDACTED_MESSAGE);
  assert.deepEqual(row.rows[0].evidence,[]);assert.equal(row.rows[0].author_run_id,null);
  assert.ok(row.rows[0].redacted_at);
  assert.equal((await db.query("SELECT status FROM coffee_threads WHERE thread_id=$1",[id])).rows[0].status,"OPEN");
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=998051001")).rows[0].state,"BLOCKED");
  const audit=await db.query("SELECT details FROM audit_events WHERE kind='owner.coffee.redacted'");
  assert.equal(audit.rowCount,1);assert.ok(!JSON.stringify(audit.rows).includes("Private fixture body"));
  const wrong=await thread("OPEN");
  await assert.rejects(moderateCoffee(db,{...value,threadId:wrong}),/Message unavailable in this discussion/);
  await moderateCoffee(db,{kind:"redact-subject",threadId:id,reason:"ABUSE",confirm:true});
  assert.equal((await db.query("SELECT subject FROM coffee_threads WHERE thread_id=$1",[id])).rows[0].subject,REDACTED_SUBJECT);
});
test("retention is opt-in, bounded across batches, preserves active work and accepted ADR references",async()=>{
  assert.equal((await coffeeRetentionPolicy(db)).enabled,false);
  const resolved=await thread("RESOLVED",true),active=await thread("OPEN",true),recent=await thread("CLOSED");
  const large=await thread("CLOSED",true);
  const accepted=await message(resolved),activeMessage=await message(active),recentMessage=await message(recent);
  await db.query("INSERT INTO coffee_messages(thread_id,content,evidence,message_kind) SELECT $1,'Old batch fixture','[]'::jsonb,'QUESTION' FROM generate_series(1,220)",[large]);
  const adr="https://github.com/ci/repo/blob/"+ "a".repeat(40)+"/docs/decisions/fixture.md";
  await db.query("INSERT INTO audit_events(kind,details) VALUES('coffee.answer.accepted_in_adr',$1::jsonb)",
    [JSON.stringify({threadId:resolved,messageId:accepted,adr})]);
  assert.deepEqual(await purgeExpiredCoffee(db),{enabled:false,redactedThreads:0,redactedMessages:0});
  assert.throws(()=>parseCoffeeModeration({kind:"retention-policy",enabled:true,retentionDays:180}),/Confirm permanent/);
  await saveCoffeeRetentionPolicy(db,{kind:"retention-policy",enabled:true,retentionDays:180,confirm:true});
  const first=await purgeExpiredCoffee(db);assert.equal(first.redactedMessages,200);
  const second=await purgeExpiredCoffee(db);assert.equal(first.redactedMessages+second.redactedMessages,221);
  assert.deepEqual(await purgeExpiredCoffee(db),{enabled:true,redactedThreads:0,redactedMessages:0});
  const rows=await db.query("SELECT message_id::text,content FROM coffee_messages WHERE message_id=ANY($1::uuid[])",[[accepted,activeMessage,recentMessage]]);
  const values=new Map(rows.rows.map(r=>[r.message_id,r.content]));
  assert.equal(values.get(accepted),REDACTED_MESSAGE);
  assert.equal(values.get(activeMessage),"Private fixture body");
  assert.equal(values.get(recentMessage),"Private fixture body");
  const decision=await db.query("SELECT details->>'adr' AS adr FROM audit_events WHERE kind='coffee.answer.accepted_in_adr'");
  assert.equal(decision.rows[0].adr,adr);
  const completed=await db.query("SELECT thread_id,status,retention_redacted_at FROM coffee_threads WHERE thread_id=ANY($1::uuid[])",[[resolved,large]]);
  assert.ok(completed.rows.every(r=>r.retention_redacted_at));
  assert.ok(completed.rows.some(r=>r.status==="RESOLVED"));
  const audits=await db.query("SELECT details FROM audit_events WHERE kind='coffee.retention.redacted'");
  assert.ok(!JSON.stringify(audits.rows).includes("fixture body"));
});
test("concurrent retention workers do not duplicate removals or audit batches",async()=>{
  const id=await thread("CLOSED",true);await message(id);
  const results=await Promise.all([purgeExpiredCoffee(db),purgeExpiredCoffee(db)]);
  assert.equal(results.reduce((sum,r)=>sum+r.redactedMessages,0),1);
  await saveCoffeeRetentionPolicy(db,{kind:"retention-policy",enabled:false,retentionDays:180});
  assert.equal((await coffeeRetentionPolicy(db)).enabled,false);
});
