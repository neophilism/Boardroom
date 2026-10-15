import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRoadmap} from "../src/server/roadmap-import.ts";
import type {GitHubPull} from "../src/server/github-app.ts";
const prs:GitHubPull[]=[
  {number:7,title:"AB-001: Setup",state:"closed",created_at:"2026-10-01T00:00:00Z",merged_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z"},
  {number:8,title:"AB-002: Implement",state:"open",created_at:"2026-10-05T00:00:00Z",merged_at:null,updated_at:"2026-10-05T00:00:00Z"}
];
const plan={
  repository:"owner/example",schemaVersion:1,roadmapVersion:1,observedAt:"2026-10-13T00:00:00Z",pullRequests:[],planVerified:true,plannedPrCount:3,
  units:[
    {id:"AB-001",title:"Bootstrap",dependsOn:[],prs:[7]},
    {id:"AB-002",title:"Next",dependsOn:["AB-001"],prs:[]},
    {id:"AB-003",title:"Future",dependsOn:["AB-002"],prs:[]}
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
  assert.throws(()=>normalizeRoadmap({...plan,units:[plan.units[0],plan.units[0]],plannedPrCount:2},"owner/example",prs));
  assert.equal(normalizeRoadmap(null,"owner/example",prs).verified,false);
  assert.throws(()=>normalizeRoadmap(plan,"another/repo",prs));
});
test("cross-repo PR links cannot count as approved work",()=>{
  const bad={...plan,units:[{...plan.units[0],prs:["https://github.com/evil/repo/pull/7"]}],plannedPrCount:1};
  assert.throws(()=>normalizeRoadmap(bad,"owner/example",prs));
});


test("explicit mappings can include multiple merged PRs",()=>{
  const p={...plan,plannedPrCount:1,units:[{id:"AB-001",title:"Bootstrap",dependsOn:[],prs:[1,2]}]};
  const records:GitHubPull[]=[
    {...prs[0],number:1,title:"AB-001: Initial work"},
    {...prs[0],number:2,title:"AB-001 follow-up: Additional verified changes"}
  ];
  const result=normalizeRoadmap(p,"owner/example",records);
  assert.equal(result.units[0].status,"MERGED");
  assert.deepEqual(result.units[0].pullRequests,[1,2]);
});
test("open follow-up PR means work remains open even after a merged PR",()=>{
  const p={...plan,plannedPrCount:1,units:[{id:"AB-001",title:"Bootstrap",dependsOn:[],prs:[7]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    prs[0],{...prs[1],number:10,title:"AB-001: Follow-up"}
  ]);
  assert.deepEqual(result.units[0].pullRequests,[7,10]);
  assert.equal(result.units[0].status,"OPEN_PR");
});
test("compound PR prefixes map to every included stable ID without inventing units",()=>{
  const p={...plan,plannedPrCount:2,units:[
    {id:"AB-009",title:"First",dependsOn:[],prs:[]},
    {id:"AB-010",title:"Second",dependsOn:[],prs:[]}
  ]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:33,title:"AB-009/010: Combined implementation"}
  ]);
  assert.deepEqual(result.units.map(u=>u.pullRequests),[[33],[33]]);
  assert.deepEqual(result.units.map(u=>u.status),["MERGED","MERGED"]);
});
test("closed-unmerged changes remain UNKNOWN rather than falsely counted done",()=>{
  const p={...plan,plannedPrCount:1,units:[{id:"AB-001",title:"Bootstrap",dependsOn:[],prs:[5]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:5,state:"closed",created_at:"2026-10-01T00:00:00Z",merged_at:null,title:"AB-001: Abandoned attempt"}
  ]);
  assert.equal(result.units[0].status,"UNKNOWN");
});
test("partial unit ID prefixes do not map unrelated PRs",()=>{
  const p={...plan,plannedPrCount:1,units:[{id:"AB-01",title:"Bootstrap",dependsOn:[],prs:[]}]};
  const result=normalizeRoadmap(p,"owner/example",[
    {...prs[0],number:99,title:"AB-010: Different unit"}
  ]);
  assert.deepEqual(result.units[0].pullRequests,[]);
  assert.equal(result.units[0].status,"PENDING");
});
test("approved dependency graphs reject unknown, duplicate, cyclic and unsafe units",()=>{
  const variations=[
    [{id:"AB-001",title:"Unknown",dependsOn:["AB-999"]}],
    [{id:"AB-001",title:"Self",dependsOn:["AB-001"]}],
    [{id:"AB-001",title:"Cycle A",dependsOn:["AB-002"]},{id:"AB-002",title:"Cycle B",dependsOn:["AB-001"]}],
    [{id:"AB-001",title:"Root",dependsOn:[]},{id:"AB-002",title:"Duplicate",dependsOn:["AB-001","AB-001"]}],
    [{id:"../unsafe",title:"Unsafe branch",dependsOn:[]}]
  ];
  for(const units of variations)assert.throws(()=>normalizeRoadmap({...plan,plannedPrCount:units.length,units},"owner/example",[]));
});
test("long acyclic approved plans validate without recursive stack use",()=>{
  const units=Array.from({length:5000},(_,i)=>({id:"LOAD-"+i,title:"Unit "+i,prs:[],dependsOn:i?["LOAD-"+(i-1)]:[]}));
  assert.equal(normalizeRoadmap({...plan,plannedPrCount:units.length,units},"owner/example",[]).units.length,5000);
});
