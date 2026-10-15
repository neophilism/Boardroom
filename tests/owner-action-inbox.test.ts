import test from "node:test";
import assert from "node:assert/strict";
import {parseOwnerActionInboxView,selectOwnerActionInbox} from "../src/server/owner-action-inbox.ts";

const actions = [
  {action_id:"3",title:"Verify access",status:"AWAITING_VERIFICATION",created_at:"2026-10-13T00:00:00Z"},
  {action_id:"2",title:"Buy service",status:"ACKNOWLEDGED",created_at:"2026-10-12T00:00:00Z"},
  {action_id:"1",title:"Create account",status:"OPEN",created_at:"2026-10-11T00:00:00Z"},
  {action_id:"4",title:"Approve release",status:"VERIFIED",created_at:"2026-10-14T00:00:00Z"},
  {action_id:"5",title:"Declined request",status:"DECLINED",created_at:"2026-10-15T00:00:00Z"}
];

test("inbox query parsing rejects unsupported filter and sort values",()=>{
  assert.deepEqual(parseOwnerActionInboxView({status:"blocked",sort:"newest"}),{filter:"BLOCKED",sort:"NEWEST"});
  assert.deepEqual(parseOwnerActionInboxView({status:"secret",sort:"random"}),{filter:"ALL",sort:"OLDEST"});
});

test("inbox status groups distinguish outstanding, blocked, verification, complete, and declined",()=>{
  assert.deepEqual(selectOwnerActionInbox(actions,"OUTSTANDING","OLDEST").map(x=>x.action_id),["1"]);
  assert.deepEqual(selectOwnerActionInbox(actions,"BLOCKED","OLDEST").map(x=>x.action_id),["2"]);
  assert.deepEqual(selectOwnerActionInbox(actions,"AWAITING_VERIFICATION","OLDEST").map(x=>x.action_id),["3"]);
  assert.deepEqual(selectOwnerActionInbox(actions,"COMPLETE","OLDEST").map(x=>x.action_id),["4"]);
  assert.deepEqual(selectOwnerActionInbox(actions,"DECLINED","OLDEST").map(x=>x.action_id),["5"]);
});

test("inbox sorts deterministically without mutating database results",()=>{
  const original=actions.map(x=>x.action_id);
  assert.deepEqual(selectOwnerActionInbox(actions,"ALL","NEWEST").map(x=>x.action_id),["5","4","3","2","1"]);
  assert.deepEqual(selectOwnerActionInbox(actions,"ALL","TITLE").map(x=>x.action_id),["4","2","1","5","3"]);
  assert.deepEqual(actions.map(x=>x.action_id),original);
});
