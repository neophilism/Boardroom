import test from "node:test";
import assert from "node:assert/strict";
import {evaluateNativeBudget,NATIVE_MAX_SESSION_SECONDS,NATIVE_TARGET_WORK_SECONDS,effectiveSessionSecondsSql} from "../src/server/native-budget.ts";
const now=new Date("2026-10-19T12:00:00Z");
const row=(data:Record<string,unknown>={})=>({active_native:0,starts_24h:0,last_started_at:null,
  fourth_newest_started_at:null,checked_at:now,...data});
test("fleet refuses a second live agent",()=>{
  assert.deepEqual(evaluateNativeBudget(row({active_native:1})),{allowed:false,reason:"FLEET_BUSY",retryAfterAt:null});
  assert.equal(evaluateNativeBudget(row()).allowed,true);
});
test("rolling daily cap rejects even if sessions ended; cooldown also applies",()=>{
  assert.deepEqual(evaluateNativeBudget(row({starts_24h:"4",last_started_at:new Date("2026-10-19T11:00:00Z"),
    fourth_newest_started_at:new Date("2026-10-19T08:00:00Z")})),
    {allowed:false,reason:"DAILY_ADMISSION_CAP",retryAfterAt:"2026-10-20T08:00:00.000Z"});
  assert.deepEqual(evaluateNativeBudget(row({starts_24h:1,last_started_at:new Date("2026-10-19T10:00:00Z")})),
    {allowed:false,reason:"START_COOLDOWN",retryAfterAt:"2026-10-19T14:00:00.000Z"});
  assert.equal(evaluateNativeBudget(row({starts_24h:2,last_started_at:new Date("2026-10-19T07:00:00Z")})).allowed,true);
});
test("native hard deadline does not increase hosted runtime",()=>{
  assert.equal(NATIVE_MAX_SESSION_SECONDS,900);
  assert.equal(NATIVE_TARGET_WORK_SECONDS,720);
  assert.match(effectiveSessionSecondsSql("ar.provider","p.max_session_seconds"),/chatgpt.*LEAST/);
  assert.match(effectiveSessionSecondsSql("ar.provider","p.max_session_seconds"),/900/);
  assert.match(effectiveSessionSecondsSql("ar.provider","p.max_session_seconds"),/ELSE COALESCE/);
});
