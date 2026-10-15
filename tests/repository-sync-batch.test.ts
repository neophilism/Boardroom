import test from "node:test";
import assert from "node:assert/strict";
import {activityDate,selectRepositorySyncBatch} from "../src/server/repository-sync.ts";
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
test("authoritative GitHub activity excludes local observation and repository metadata refreshes",()=>{
  const repository:GitHubRepository={
    id:1,full_name:"neophilism/repo",created_at:"2026-01-01T00:00:00Z",
    pushed_at:"2026-04-01T00:00:00Z",updated_at:"2099-12-31T23:59:59Z",
    description:null,archived:false
  };
  const pulls:GitHubPull[]=[
    {number:1,title:"work",state:"closed",updated_at:"2026-03-01T00:00:00Z",merged_at:"2026-03-01T00:00:00Z"},
    {number:2,title:"newer work",state:"open",updated_at:"2026-05-01T00:00:00Z",merged_at:null}
  ];
  assert.equal(activityDate(repository,pulls),"2026-05-01T00:00:00Z");
  assert.equal(activityDate({...repository,pushed_at:null},[]),null);
});
