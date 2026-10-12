import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRoadmap} from "../src/server/roadmap-import.ts";
import type {GitHubPull} from "../src/server/github-app.ts";
const prs:GitHubPull[]=[
  {number:7,title:"AB-001: Setup",state:"closed",merged_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z"},
  {number:8,title:"AB-002: Implement",state:"open",merged_at:null,updated_at:"2026-10-05T00:00:00Z"}
];
const plan={
  repository:"owner/example",version:1,planVerified:true,plannedPrCount:3,
  milestones:[
    {id:"AB-001",title:"Bootstrap",dependsOn:[],pullRequests:[7]},
    {id:"AB-002",title:"Next",dependsOn:["AB-001"],pullRequests:[]},
    {id:"AB-003",title:"Future",dependsOn:["AB-002"],pullRequests:[]}
  ]
};
test("canonical import preserves linked and exact-title PR evidence",()=>{
  const result=normalizeRoadmap(plan,"owner/example",prs);
  assert.equal(result.units.length,3);
  assert.deepEqual(result.units.map(x=>x.status),["MERGED","OPEN_PR","PENDING"]);
  assert.equal(result.units[1].pullRequests[0],8);
});
test("malformed plan fails closed without inventing progress",()=>{
  assert.throws(()=>normalizeRoadmap({...plan,plannedPrCount:22},"owner/example",prs));
  assert.throws(()=>normalizeRoadmap({...plan,milestones:[plan.milestones[0],plan.milestones[0]],plannedPrCount:2},"owner/example",prs));
  assert.equal(normalizeRoadmap(null,"owner/example",prs).verified,false);
  assert.equal(normalizeRoadmap(plan,"another/repo",prs).verified,false);
});
test("cross-repo PR links cannot count as approved work",()=>{
  const bad={...plan,milestones:[{...plan.milestones[0],pullRequests:["https://github.com/evil/repo/pull/7"]}],plannedPrCount:1};
  assert.throws(()=>normalizeRoadmap(bad,"owner/example",prs));
});
