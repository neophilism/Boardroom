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


test("a single work unit may have multiple valid merged PRs",()=>{
  const p={...plan,plannedPrCount:1,milestones:[{id:"AB-001",title:"Bootstrap",dependsOn:[],pullRequests:[]}]};
  const records:GitHubPull[]=[
    {...prs[0],number:1,title:"AB-001: Initial work"},
    {...prs[0],number:2,title:"AB-001 follow-up: Additional verified changes"}
  ];
  const result=normalizeRoadmap(p,"owner/example",records);
  assert.equal(result.units[0].status,"MERGED");
  assert.deepEqual(result.units[0].pullRequests,[1,2]);
});
test("open follow-up PR means work remains open even after a merged PR",()=>{
  const p={...plan,plannedPrCount:1,milestones:[{id:"AB-001",title:"Bootstrap",dependsOn:[],pullRequests:[7]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    prs[0],{...prs[1],number:10,title:"AB-001: Follow-up"}
  ]);
  assert.deepEqual(result.units[0].pullRequests,[7,10]);
  assert.equal(result.units[0].status,"OPEN_PR");
});
test("compound PR prefixes map to every included stable ID without inventing units",()=>{
  const p={...plan,plannedPrCount:2,milestones:[
    {id:"AB-009",title:"First",dependsOn:[],pullRequests:[]},
    {id:"AB-010",title:"Second",dependsOn:[],pullRequests:[]}
  ]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:33,title:"AB-009/010: Combined implementation"}
  ]);
  assert.deepEqual(result.units.map(u=>u.pullRequests),[[33],[33]]);
  assert.deepEqual(result.units.map(u=>u.status),["MERGED","MERGED"]);
});
test("closed-unmerged changes remain UNKNOWN rather than falsely counted done",()=>{
  const p={...plan,plannedPrCount:1,milestones:[{id:"AB-001",title:"Bootstrap",dependsOn:[],pullRequests:[5]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:5,state:"closed",merged_at:null,title:"AB-001: Abandoned attempt"}
  ]);
  assert.equal(result.units[0].status,"UNKNOWN");
});
test("partial unit ID prefixes do not map unrelated PRs",()=>{
  const p={...plan,plannedPrCount:1,milestones:[{id:"AB-01",title:"Bootstrap",dependsOn:[],pullRequests:[]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:99,title:"AB-010: Different unit"}
  ]);
  assert.deepEqual(result.units[0].pullRequests,[]);
  assert.equal(result.units[0].status,"PENDING");
});
