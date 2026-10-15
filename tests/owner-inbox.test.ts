import test from "node:test";
import assert from "node:assert/strict";
import {arrangeOwnerInbox,parseOwnerInboxFilters} from "../src/server/owner-inbox.ts";

const rows=[
  {id:"verified",action_type:"APPROVAL",status:"VERIFIED",created_at:"2026-10-01T00:00:00Z"},
  {id:"new-purchase",action_type:"PURCHASE",status:"OPEN",created_at:"2026-10-03T00:00:00Z"},
  {id:"old-credential",action_type:"CREDENTIAL",status:"ACKNOWLEDGED",created_at:"2026-10-02T00:00:00Z"}
];

test("owner inbox accepts known filters and ignores ambiguous or invalid input",()=>{
  assert.deepEqual(parseOwnerInboxFilters({status:"OPEN",type:"PURCHASE",sort:"NEWEST"}),{
    status:"OPEN",type:"PURCHASE",sort:"NEWEST"
  });
  assert.deepEqual(parseOwnerInboxFilters({status:["OPEN","VERIFIED"],type:"unknown",sort:"random"}),{
    status:null,type:null,sort:"ATTENTION"
  });
});

test("attention order keeps active actions ahead of completed work, oldest first",()=>{
  assert.deepEqual(arrangeOwnerInbox(rows,parseOwnerInboxFilters({})).map(row=>row.id),[
    "old-credential","new-purchase","verified"
  ]);
});

test("type filter and explicit sort modes are deterministic",()=>{
  assert.deepEqual(arrangeOwnerInbox(rows,parseOwnerInboxFilters({type:"PURCHASE"})).map(row=>row.id),["new-purchase"]);
  assert.deepEqual(arrangeOwnerInbox(rows,parseOwnerInboxFilters({sort:"NEWEST"})).map(row=>row.id),[
    "new-purchase","old-credential","verified"
  ]);
  assert.deepEqual(arrangeOwnerInbox(rows,parseOwnerInboxFilters({sort:"STATUS"})).map(row=>row.id),[
    "old-credential","new-purchase","verified"
  ]);
});
