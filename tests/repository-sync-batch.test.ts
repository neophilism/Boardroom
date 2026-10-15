import test from "node:test";
import assert from "node:assert/strict";
import {latestDevelopmentAt,selectRepositorySyncBatch} from "../src/server/repository-sync.ts";
import {selectRepository} from "../src/domain/selection.ts";
import type {GitHubPull,GitHubRepository} from "../src/server/github-app.ts";

const data=[5,2,9,12,4].map(id=>({
  id,full_name:id===12?"someone/Other":"neophilism/repo-"+id,created_at:"2026-10-12T00:00:00Z",
  pushed_at:null,updated_at:"2026-10-12T00:00:00Z",description:null,archived:false
} satisfies GitHubRepository));
test("batched sync deterministically traverses every authorized repo once",()=>{
  const a=selectRepositorySyncBatch(data,"neophilism",{limit:2});
  assert.deepEqual(a.selected.map(x=>x.id),[2,4]);
  assert.equal(a.total,4);
  assert.equal(a.nextAfterId,"4");
  const b=selectRepositorySyncBatch(data,"neophilism",{limit:2,afterId:a.nextAfterId});
  assert.deepEqual(b.selected.map(x=>x.id),[5,9]);
  assert.equal(b.nextAfterId,null);
});
test("full sync default is backwards-compatible with CLI",()=>{
  const a=selectRepositorySyncBatch(data,"neophilism");
  assert.deepEqual(a.selected.map(x=>x.id),[2,4,5,9]);
  assert.equal(a.nextAfterId,null);
});
test("rejects invalid limits or cursor values before syncing",()=>{
  assert.throws(()=>selectRepositorySyncBatch(data,"neophilism",{limit:0}));
  assert.throws(()=>selectRepositorySyncBatch(data,"neophilism",{limit:11}));
  assert.throws(()=>selectRepositorySyncBatch(data,"neophilism",{afterId:"1;drop"}));
});


const pull=(number:number,createdAt:string,updatedAt:string,mergedAt:string|null=null):GitHubPull=>({
  number,title:"BR-013: fixture",state:mergedAt?"closed":"open",
  created_at:createdAt,updated_at:updatedAt,merged_at:mergedAt
});
test("development time ignores comment, label, and review metadata churn",()=>{
  const repository={...data[0],pushed_at:"2026-10-02T00:00:00Z"};
  const observed=latestDevelopmentAt(repository,[
    pull(1,"2026-10-03T00:00:00Z","2026-10-20T00:00:00Z"),
  ]);
  assert.equal(observed,"2026-10-03T00:00:00Z");
});
test("development time uses the latest real push, PR creation, or merge",()=>{
  const repository={...data[0],pushed_at:"2026-10-04T00:00:00Z"};
  assert.equal(latestDevelopmentAt(repository,[
    pull(1,"2026-10-03T00:00:00Z","2026-10-30T00:00:00Z"),
    pull(2,"2026-10-02T00:00:00Z","2026-10-30T00:00:00Z","2026-10-05T00:00:00Z"),
  ]),"2026-10-05T00:00:00Z");
});
test("missing or malformed activity falls back through the repository comparator",()=>{
  const repository={...data[0],pushed_at:null};
  assert.equal(latestDevelopmentAt(repository,[]),null);
  assert.equal(latestDevelopmentAt(repository,[pull(1,"invalid","2026-10-30T00:00:00Z")]),null);
  assert.equal(selectRepository([
    {id:9,fullName:"owner/newer",createdAt:"2026-10-09T00:00:00Z",lastDevelopmentAt:null,eligible:true,leaseHeld:false},
    {id:3,fullName:"owner/older",createdAt:"2026-10-03T00:00:00Z",lastDevelopmentAt:null,eligible:true,leaseHeld:false},
  ],[])?.id,3);
});
