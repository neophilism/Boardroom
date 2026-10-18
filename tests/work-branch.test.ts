import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {assertAssignedPull,assertAssignedEvidencePull,resolveAssignedWorkBranch,validWorkBranch,assignedPrNumbers,WorkMappingConflict,type WorkPull} from "../src/server/work-branch.ts";
import type {githubAppRequest} from "../src/server/github-app.ts";
const scope={repository_id:"1412357542",full_name:"ci/SceneSignal",unit_id:"SS-19"};
const pr:WorkPull={number:13,state:"open",head:{ref:"feat/ss19-speaker-topology-fades",sha:"a".repeat(40),repo:{id:1412357542}},base:{ref:"main",repo:{id:1412357542}}};
function fixture(pulls:WorkPull[],options:{protected?:boolean;defaultBranch?:string}={}){
  const writes:string[]=[];
  const db={query:async()=>({rows:[{planned_prs:pulls.map(p=>p.number),source_metadata:{id:scope.unit_id,prs:pulls.map(p=>p.number)}}]})} as unknown as Pool;
  const request=async(method:string,path:string)=>{
    writes.push(method+" "+path);
    if(path.includes("/pulls/"))return pulls.find(p=>p.number===Number(path.split("/").at(-1)));
    if(path.includes("/branches/"))return {name:decodeURIComponent(path.split("/").at(-1)!),protected:options.protected??false};
    return {default_branch:options.defaultBranch??"main"};
  };
  return {db,request:request as typeof githubAppRequest,writes};
}
test("an approved imported PR is authorized on its actual branch for evidence and source",async()=>{
  assert.equal(assertAssignedPull(scope,13,[13],pr),pr.head!.ref);
  const f=fixture([pr]);
  assert.equal(await resolveAssignedWorkBranch(f.db,scope,true,f.request),pr.head!.ref);
  assert.ok(f.writes.some(p=>p.includes("/branches/feat%2Fss19-speaker-topology-fades")));
  assert.ok(f.writes.every(p=>p.startsWith("GET ")));
});
test("unmapped, forked, cross-repository, malformed and mismatched-number PRs cannot grant scope",()=>{
  for(const candidate of [pr,{...pr,number:14},{...pr,head:{...pr.head,repo:{id:99}}},
    {...pr,base:{...pr.base,repo:{id:99}}},{...pr,head:{...pr.head,sha:"bad"}},
    {...pr,head:{...pr.head,ref:"../main"}}]){
    if(candidate===pr)assert.throws(()=>assertAssignedPull(scope,13,[],candidate),WorkMappingConflict);
    else assert.throws(()=>assertAssignedPull(scope,13,[13],candidate),WorkMappingConflict);
  }
  assert.equal(assertAssignedPull(scope,17,[],{...pr,number:17,head:{...pr.head,ref:"boardroom/SS-19"}}),"boardroom/SS-19");
});
test("default and protected branch writes and ambiguous mapped branches fail closed",async()=>{
  for(const options of [{protected:true},{defaultBranch:pr.head!.ref}]){
    const f=fixture([pr],options);
    await assert.rejects(resolveAssignedWorkBranch(f.db,scope,true,f.request),WorkMappingConflict);
  }
  const f=fixture([pr,{...pr,number:14,head:{...pr.head,ref:"feat/other"}}]);
  await assert.rejects(resolveAssignedWorkBranch(f.db,scope,true,f.request),/Multiple open branches/);
});
test("merged historical PRs leave new work on its deterministic branch",async()=>{
  const f=fixture([{...pr,state:"closed",merged_at:"2026-10-18T00:00:00Z"}]);
  assert.equal(await resolveAssignedWorkBranch(f.db,scope,true,f.request),"boardroom/SS-19");
  for(const value of ["main..x","feat//x","feat/.hidden","feat/a.lock","feat/x/","/main","feat/x."])
    assert.equal(validWorkBranch(value),false,value);
});

test("title-discovered PR numbers cannot authorize an imported branch",async()=>{
  const db={query:async()=>({rows:[{planned_prs:[13,99],source_metadata:{id:"SS-19",prs:[13]}}]})} as unknown as Pool;
  const links=await assignedPrNumbers(db,scope);assert.deepEqual(links,[13]);
  assert.throws(()=>assertAssignedPull(scope,99,links,{...pr,number:99}),WorkMappingConflict);
});

test("historical contribution reads do not authorize work-branch writes or merges",async()=>{
  const source_metadata={id:scope.unit_id,prs:[],contributingPrs:[13],priorEvidencePrs:[14]};
  const db={query:async()=>({rows:[{planned_prs:[99],source_metadata}]})} as unknown as Pool;
  const links=await assignedPrNumbers(db,scope);
  assert.deepEqual(links,[]);
  for(const [number,relationship] of [[13,"CONTRIBUTION"],[14,"PRIOR_EVIDENCE"]] as const){
    const historical={...pr,number,state:"closed",merged_at:"2026-10-18T00:00:00Z"};
    assert.deepEqual(assertAssignedEvidencePull({...scope,source_metadata},number,links,historical),
      {branch:pr.head!.ref,relationship});
    assert.throws(()=>assertAssignedPull(scope,number,links,historical),WorkMappingConflict);
  }
  const noRequests=async()=>{throw new Error("Historical evidence cannot select an imported work branch");};
  assert.equal(await resolveAssignedWorkBranch(db,scope,true,noRequests),"boardroom/SS-19");
  assert.throws(()=>assertAssignedEvidencePull({...scope,source_metadata},99,links,{...pr,number:99}),WorkMappingConflict);
});

test("evidence reads reject corrupted registry references and wrong GitHub identity",()=>{
  for(const source_metadata of [
    {id:"SS-20",contributingPrs:[13]},
    {id:scope.unit_id,contributingPrs:["13"]},
    {id:scope.unit_id,contributingPrs:[13,13]},
    {id:scope.unit_id,contributingPrs:[13],priorEvidencePrs:[0]},
    {id:scope.unit_id,priorEvidencePrs:Array.from({length:101},(_,i)=>i+1)}
  ])assert.throws(()=>assertAssignedEvidencePull({...scope,source_metadata},13,[],pr),WorkMappingConflict);
  const evidenceScope={...scope,source_metadata:{id:scope.unit_id,contributingPrs:[13]}};
  for(const candidate of [
    {...pr,number:14},{...pr,head:{...pr.head,repo:{id:99}}},
    {...pr,base:{...pr.base,repo:{id:99}}},{...pr,head:{...pr.head,sha:"not-a-sha"}}
  ])assert.throws(()=>assertAssignedEvidencePull(evidenceScope,13,[],candidate),WorkMappingConflict);
});
