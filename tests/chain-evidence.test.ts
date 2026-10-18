import test from "node:test";
import assert from "node:assert/strict";
import {evaluateChainMergeEvidence,type CurrentChainUnit} from "../src/server/chain-evidence.ts";
import type {CanonicalPlan,PlanUnit} from "../src/server/roadmap-import.ts";
const current:CurrentChainUnit={state:"ACTIVE",version:3,title:"Scheduled connectivity",acceptance_criteria:"Observed real session",
 depends_on:["BR-003"],external_dependencies:[],external_prerequisites:[]};
const item:PlanUnit={id:"BR-004",title:current.title,dependsOn:["BR-003"],status:"MERGED",
 pullRequests:[105],acceptanceCriteria:current.acceptance_criteria};
const plan:CanonicalPlan={version:3,verified:true,units:[item]};
test("previously merged exact unit PR is reconciled and can advance",()=>{
 const result=evaluateChainMergeEvidence(plan,"BR-004",current);
 assert.equal(result.canAdvance,true);assert.equal(result.nextState,"MERGED");
 assert.deepEqual(result.pullRequests,[105]);
});
test("already accepted units stay accepted without inventing new acceptance",()=>{
 assert.equal(evaluateChainMergeEvidence(plan,"BR-004",{...current,state:"ACCEPTED"}).nextState,"ACCEPTED");
 assert.equal(evaluateChainMergeEvidence({...plan,units:[{...item,status:"PENDING",pullRequests:[]}]},"BR-004",current).canAdvance,false);
});
test("open follow-up, closed unmerged and unknown PRs must not advance",()=>{
 for(const status of ["OPEN_PR","UNKNOWN"] as const){
   const result=evaluateChainMergeEvidence({...plan,units:[{...item,status}]},"BR-004",current);
   assert.equal(result.canAdvance,false);
 }
});
test("stale registry, changed criteria and unrelated work fail closed",()=>{
 assert.throws(()=>evaluateChainMergeEvidence({...plan,verified:false},"BR-004",current));
 assert.throws(()=>evaluateChainMergeEvidence(plan,"BR-999",current));
 assert.throws(()=>evaluateChainMergeEvidence({...plan,version:4},"BR-004",current));
 assert.throws(()=>evaluateChainMergeEvidence(plan,"BR-004",{...current,acceptance_criteria:"different"}));
 assert.throws(()=>evaluateChainMergeEvidence(plan,"BR-004",{...current,depends_on:[]}));
});
