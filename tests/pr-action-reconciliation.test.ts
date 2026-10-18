import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {parsePrActionReference,prApprovalDisposition,reconcilePrApprovalActions,type PendingPrApproval} from "../src/server/pr-action-reconciliation.ts";

const request:PendingPrApproval={
  actionId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",actionKey:"br051-pr107-owner-approval-199ae0e0",
  title:"Record owner approval: GitHub neophilism/Boardroom pull request #107; Boardroom self-update approval",
  repository:"neophilism/Boardroom",repositoryCount:1,
  instructions:"Review PR #107 at 199ae0e0dc1b6c556c8321bbc4164793fd9bc7d3 then approve."
};
const same={number:107,state:"open",merged:false,head:{sha:"199ae0e0dc1b6c556c8321bbc4164793fd9bc7d3"}};
test("parse numbered owner action and reject unrelated or ambiguous records",()=>{
  assert.deepEqual(parsePrActionReference(request),{repository:"neophilism/Boardroom",
    number:107,head:"199ae0e0dc1b6c556c8321bbc4164793fd9bc7d3"});
  for(const patch of [{repositoryCount:2},{actionKey:"approval:production_release:abc"},
    {title:"Approve deployment"},{actionKey:"br051-pr108-owner-approval"}])
    assert.equal(parsePrActionReference({...request,...patch}),null);
});
test("only GitHub-confirmed merge, closure, or stale requested head resolves owner action",()=>{
  assert.equal(prApprovalDisposition({...same,state:"closed",merged:true},107,null),"VERIFIED");
  assert.equal(prApprovalDisposition({...same,state:"closed"},107,null),"CANCELLED");
  assert.equal(prApprovalDisposition({...same,head:{sha:"b".repeat(40)}},107,same.head.sha),"CANCELLED");
  assert.equal(prApprovalDisposition(same,107,same.head.sha),null);
  assert.equal(prApprovalDisposition({...same,changedFileRisk:"ROUTINE"},107,same.head.sha),"CANCELLED");
  assert.equal(prApprovalDisposition({...same,changedFileRisk:"REVIEW_REQUIRED"},107,same.head.sha),null);
  assert.equal(prApprovalDisposition({...same,changedFileRisk:"UNVERIFIED"},107,same.head.sha),null);
  assert.equal(prApprovalDisposition({...same,number:108,state:"closed",merged:true},107,null),null);
});
test("bounded reconciliation records only evidence-confirmed changes with atomic audit",async()=>{
  const writes:{sql:string;params:unknown[]}[]=[];
  const client={query:async(sql:string,params:unknown[]=[])=>{
    writes.push({sql,params});
    return {rowCount:sql.startsWith("UPDATE")?1:0,rows:[]};
  },release:()=>{}};
  const db={query:async()=>({rows:[request,{...request,actionId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    title:"Record owner approval: GitHub Boardroom PR #106",actionKey:"br020-pr106-owner-approval"}]}),
    connect:async()=>client} as unknown as Pool;
  const result=await reconcilePrApprovalActions(db,async(_repo,number)=>number===107?
    {...same,state:"closed",merged:true}:({...same,number:106,state:"open",merged:false}));
  assert.deepEqual(result,{examined:2,verified:1,cancelled:0,unavailable:0});
  assert.equal(writes.filter(w=>w.sql.startsWith("UPDATE")).length,1);
  assert.equal(writes.filter(w=>w.sql.includes("owner_action.github_pr_reconciled")).length,1);
});
test("provider failures preserve approval and are reported, not assumed complete",async()=>{
  const db={query:async()=>({rows:[request]})} as unknown as Pool;
  // If the external source fails, no transaction or mutation occurs.
  const result=await reconcilePrApprovalActions(db,async()=>{throw Error("GitHub offline");});
  assert.equal(result.unavailable,1);
  assert.equal(result.verified,0);
});

test("a PR number in an unrelated project's request cannot resolve a different repository",()=>{
  assert.equal(parsePrActionReference({...request,repository:"neophilism/FOIA_Aggregator"}),null);
  assert.equal(parsePrActionReference({...request,title:"Record owner approval: Boardroom PR105 blocking FOIA_Aggregator",
    repository:"neophilism/FOIA_Aggregator"}),null);
  assert.equal(parsePrActionReference({...request,repositoryCount:0}),null);
});
test("legacy PR 105/106 merge evidence resolves requests without fabricating owner review",()=>{
  const titles=[
    "Record owner approval: GitHub neophilism/Boardroom pull request #105",
    "Record owner approval: GitHub neophilism/Boardroom PR #106",
    "Record owner approval: GitHub / neophilism/Boardroom PR110 — private workspace"
  ];
  const keys=["boardroom-pr-105-native-trial-collector","boardroom-pr-106-recovery-policy","br061-pr110-owner-approval"];
  for(let i=0;i<titles.length;i++){
    const result=parsePrActionReference({...request,title:titles[i],actionKey:keys[i]});
    assert.equal(result?.number,[105,106,110][i]);
    assert.equal(prApprovalDisposition({number:[105,106,110][i],state:"closed",merged:true},[105,106,110][i],null),"VERIFIED");
  }
});
