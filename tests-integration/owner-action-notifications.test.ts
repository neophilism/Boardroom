import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {queueOwnerActionNotification} from "../src/server/owner-action-notifications.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Owner notification fixtures require the explicit boardroom_test database");

test("daily owner summary is consolidated, deduplicated, and redacted",async()=>{
  const db=new Pool({connectionString:url,max:2});
  const actionKey="ci:notification:private";
  try{
    // Both sides of the time comparison must share a fixed test clock.
    // Using now() made this test fail after its October 2026 fixture date.
    const observedAt=new Date("2026-10-15T12:00:00Z");
    const createdAt=new Date(observedAt.getTime()-8*24*60*60*1000);
    await db.query(
      "INSERT INTO owner_actions(action_key,title,action_type,instructions,status,created_at,secure_entry_location) VALUES($1,$2,'CREDENTIAL',$3,'OPEN',$4,$5)",
      [actionKey,"Private person and project name","token=must-not-appear",createdAt,"render://private/SECRET_NAME"]
    );
    const first=await queueOwnerActionNotification(db,"https://boardroom.example",observedAt);
    const second=await queueOwnerActionNotification(db,"https://boardroom.example",observedAt);
    assert.ok(first?.created);assert.equal(second?.created,false);
    assert.equal(first?.batchId,second?.batchId);
    assert.match(first?.notification.body??"",/OVERDUE/);
    for(const sensitive of ["Private person","must-not-appear","render://private","SECRET_NAME"])
      assert.doesNotMatch(first?.notification.body??"",new RegExp(sensitive));
    const rows=await db.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM owner_action_notification_batches WHERE reminder_date='2026-10-15'"
    );
    assert.equal(rows.rows[0].count,"1");
    const audits=await db.query<{count:string}>(
      "SELECT COUNT(*)::text AS count FROM audit_events WHERE kind='owner_action.notification_batched' AND details->>'batchId'=$1",
      [first?.batchId]
    );
    assert.equal(audits.rows[0].count,"1");
  }finally{
    await db.query("DELETE FROM audit_events WHERE kind='owner_action.notification_batched' AND details->>'reminderDate'='2026-10-15'");
    await db.query("DELETE FROM owner_action_notification_batches WHERE reminder_date='2026-10-15'");
    await db.query("DELETE FROM owner_actions WHERE action_key=$1",[actionKey]);
    await db.end();
  }
});
