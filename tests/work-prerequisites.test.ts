import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {performFencedGithubWrite} from "../src/server/github-write-gateway.ts";
import {mergeAssignedPullRequest} from "../src/server/merge-policy.ts";
import {SessionConflict} from "../src/server/sessions.ts";
import {agentToolFailure} from "../src/server/agent-tool-failure.ts";
test("a late owner blocker stops source writes and merges before any GitHub operation",async(t)=>{
  let networkCalls=0;
  t.mock.method(globalThis,"fetch",async()=>{networkCalls++;throw new Error("No GitHub call permitted");});
  const client={query:async(sql:string)=>{
    if(sql.includes("AS dependencies_pending"))return {rowCount:1,rows:[{dependencies_pending:false,compatibility_pending:false,owner_pending:true}]};
    if(sql.includes("SELECT paused"))return {rowCount:1,rows:[{paused:false}]};
    if(sql.includes("SELECT auto_merge"))return {rowCount:1,rows:[{auto_merge:true,required_checks:["verify"],minimum_reviews:0}]};
    return {rowCount:1,rows:[{repository_id:"1",full_name:"ci/repo",unit_id:"CI-001",title:"Fixture",assignment_id:"assignment"}]};
  },release:()=>{}};
  const db={connect:async()=>client} as unknown as Pool,id="26741e83-9694-4fb3-8174-783b2f9bf61c";
  await assert.rejects(performFencedGithubWrite(db,id,"credential","1",{kind:"ensure_branch"}),/Owner action prerequisite unresolved/);
  await assert.rejects(mergeAssignedPullRequest(db,id,"credential","1",1,"a".repeat(40)),/Owner action prerequisite unresolved/);
  assert.equal(networkCalls,0);
  assert.equal(agentToolFailure(new SessionConflict("Owner action prerequisite unresolved")).structuredContent.error.code,"PREREQUISITE_BLOCKED");
});

test("a late technical blocker stops fenced source writes and merges before network access",async(t)=>{
  let networkCalls=0;
  t.mock.method(globalThis,"fetch",async()=>{networkCalls++;throw new Error("No GitHub call permitted");});
  const client={query:async(sql:string)=>{
    if(sql.includes("AS dependencies_pending"))return {rowCount:1,rows:[{dependencies_pending:false,compatibility_pending:false,owner_pending:false,registry_pending:false,technical_pending:true}]};
    if(sql.includes("SELECT paused"))return {rowCount:1,rows:[{paused:false}]};
    if(sql.includes("SELECT auto_merge"))return {rowCount:1,rows:[{auto_merge:true,required_checks:["verify"],minimum_reviews:0}]};
    return {rowCount:1,rows:[{repository_id:"1",full_name:"ci/repo",unit_id:"CI-001",title:"Fixture",assignment_id:"assignment"}]};
  },release:()=>{}};
  const db={connect:async()=>client} as unknown as Pool,id="26741e83-9694-4fb3-8174-783b2f9bf61c";
  await assert.rejects(performFencedGithubWrite(db,id,"credential","1",{kind:"ensure_branch"}),/Technical question prerequisite unresolved/);
  await assert.rejects(mergeAssignedPullRequest(db,id,"credential","1",1,"a".repeat(40)),/Technical question prerequisite unresolved/);
  assert.equal(networkCalls,0);
  assert.equal(agentToolFailure(new SessionConflict("Technical question prerequisite unresolved or retry evidence consumed")).structuredContent.error.code,"PREREQUISITE_BLOCKED");
});
