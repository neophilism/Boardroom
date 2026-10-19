import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {safePackagePatch,safeDependencyPaths,exactHeadChecksPass,
  isAutomatedReviewNoise,isVerifiedDependabot,scanDependabotMaintenance} from "../src/server/dependency-maintenance.ts";

const SHA="a".repeat(40),BASE="b".repeat(40);
const pr={
  number:12,state:"open",draft:false,mergeable:true,mergeable_state:"clean",
  changed_files:2,user:{login:"dependabot[bot]",id:49699333},
  requested_reviewers:[{login:"neophilism"}],
  head:{ref:"dependabot/npm_and_yarn/left-pad-1.2.4",sha:SHA,repo:{id:123}},
  base:{ref:"main",sha:BASE,repo:{id:123}}
};
const old={name:"example",version:"1.0.0",scripts:{test:"node --test"},
  dependencies:{"left-pad":"1.2.3"},devDependencies:{"@types/node":"22.15.0"}};
const current={...old,dependencies:{"left-pad":"1.2.4"}};
const data=(obj:unknown)=>{const text=JSON.stringify(obj);return {
  type:"file",encoding:"base64",content:Buffer.from(text).toString("base64"),size:Buffer.byteLength(text)
};};
const passing={
  runs:{total_count:2,check_runs:[{name:"verify",status:"completed",conclusion:"success"},
    {name:"database",status:"completed",conclusion:"success"}]},
  suites:{total_count:1,check_suites:[{status:"completed",conclusion:"success"}]},
  statuses:{statuses:[]}
};

test("the reviewer cleaner is limited to authenticated automated PR authors",()=>{
  assert.equal(isAutomatedReviewNoise(pr,"neophilism"),true);
  assert.equal(isAutomatedReviewNoise({...pr,user:{login:"neophilism",id:6145609}},"neophilism"),false);
  assert.equal(isAutomatedReviewNoise({...pr,user:{login:"dependabot[bot]",id:123}},"neophilism"),false);
  assert.equal(isAutomatedReviewNoise({...pr,requested_reviewers:[]},"neophilism"),false);
  assert.equal(isAutomatedReviewNoise({...pr,user:{login:"boardroom-coordinator[bot]",id:341668896}},"neophilism"),true);
});
test("PR is verified against immutable identity and the assigned repository",()=>{
  assert.equal(isVerifiedDependabot(pr,"123","main"),true);
  assert.equal(isVerifiedDependabot({...pr,head:{...pr.head,repo:{id:100}}},"123","main"),false);
  assert.equal(isVerifiedDependabot({...pr,user:{login:"dependabot[bot]",id:1}},"123","main"),false);
  assert.equal(isVerifiedDependabot({...pr,draft:true},"123","main"),false);
});
test("only strict manifest patch changes are eligible",()=>{
  assert.equal(safePackagePatch(old,current),true);
  assert.equal(safePackagePatch(old,{...current,scripts:{test:"rm -rf /tmp"}}),false);
  assert.equal(safePackagePatch(old,{...current,dependencies:{"left-pad":"2.0.0"}}),false);
  assert.equal(safePackagePatch(old,{...current,dependencies:{"left-pad":"1.3.0"}}),false);
  assert.equal(safePackagePatch(old,{...current,dependencies:{"left-pad":"1.2.2"}}),false);
  assert.equal(safePackagePatch(old,{...current,devDependencies:{"@types/node":"26.1.0"}}),false);
  assert.equal(safePackagePatch(old,{...current,dependencies:{"left-pad":"^1.2.4"}}),false);
  assert.equal(safePackagePatch(old,{...current,version:"1.0.1"}),false);
});
test("only manifests plus a lockfile may be merged automatically",()=>{
  const f=[{filename:"package.json",status:"modified"},{filename:"pnpm-lock.yaml",status:"modified"}];
  assert.deepEqual(safeDependencyPaths(f,2),["package.json"]);
  assert.equal(safeDependencyPaths(f,3),null);
  assert.equal(safeDependencyPaths([...f,{filename:".github/workflows/ci.yml",status:"modified"}],3),null);
  assert.equal(safeDependencyPaths([{...f[0],status:"renamed"},f[1]],2),null);
});
test("exact-head CI fails closed on incomplete or nonpassing checks",()=>{
  assert.equal(exactHeadChecksPass(passing.runs,passing.suites,passing.statuses),true);
  assert.equal(exactHeadChecksPass({...passing.runs,total_count:3},passing.suites,passing.statuses),false);
  assert.equal(exactHeadChecksPass({...passing.runs,check_runs:[{name:"verify",status:"completed",conclusion:"skipped"}]},passing.suites,passing.statuses),false);
  assert.equal(exactHeadChecksPass(passing.runs,{total_count:1,check_suites:[{status:"queued",conclusion:null}]},passing.statuses),false);
  assert.equal(exactHeadChecksPass(passing.runs,passing.suites,{statuses:[{state:"pending"}]}),false);
  assert.equal(exactHeadChecksPass({total_count:0,check_runs:[]},passing.suites,passing.statuses),false);
});
test("maintenance removes bot review requests and merges only exact-head tested patch",async()=>{
  const events:{kind:string;details?:unknown}[]=[];
  const db={
    connect:async()=>({
      query:async(sql:string,params?:unknown[])=>{
        if(sql.startsWith("SELECT r.repository_id"))return {rows:[{repository_id:"123",full_name:"neophilism/Repo"}]};
        if(sql.startsWith("INSERT INTO audit_events"))events.push({kind:String(params?.[0]),details:params?.[1]});
        return {rows:[]};
      },
      release:()=>{}
    }),
    query:async(sql:string,params?:unknown[])=>{
      if(sql.includes("FROM execution_controls"))return {rows:[{paused:false}]};
      if(sql.startsWith("INSERT INTO audit_events"))events.push({kind:String(params?.[0]),details:params?.[1]});
      return {rows:[]};
    }
  } as unknown as Pool;
  const calls:Array<{method:string;path:string;body:unknown}>=[];
  const request=async(method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE",path:string,body?:unknown):Promise<unknown>=>{
    calls.push({method,path,body});
    if(path==="/repos/neophilism/Repo")return {id:123,default_branch:"main"};
    if(path.includes("/pulls?"))return [pr];
    if(path.endsWith("/requested_reviewers"))return null;
    if(path.endsWith("/pulls/12"))return pr;
    if(path.includes("/pulls/12/files"))return [{filename:"package.json",status:"modified"},{filename:"pnpm-lock.yaml",status:"modified"}];
    if(path.includes("/contents/package.json?ref="))return data(path.endsWith("ref="+BASE)?old:current);
    if(path.includes("/check-runs?"))return passing.runs;
    if(path.includes("/check-suites?"))return passing.suites;
    if(path.includes("/status?"))return passing.statuses;
    if(method==="PUT"&&path.endsWith("/merge"))return {merged:true,sha:"c".repeat(40)};
    throw Error("Unexpected operation "+method+" "+path);
  };
  const result=await scanDependabotMaintenance(db,request,"neophilism");
  assert.equal(result.merged,1);
  assert.equal(result.ownerRequestsRemoved,1);
  assert.equal(result.errors,0);
  assert.equal(calls.filter(x=>x.method==="PUT").length,1);
  assert.ok(calls.some(x=>x.method==="DELETE"));
  assert.ok(calls.some(x=>x.method==="PUT"&&(x.body as {sha:string}).sha===SHA));
});
test("major upgrades are reserved for agent triage without any merge",async()=>{
  const db={
    connect:async()=>({
      query:async(sql:string)=>sql.startsWith("SELECT r.repository_id")?
        {rows:[{repository_id:"123",full_name:"neophilism/Repo"}]}:{rows:[]},
      release:()=>{}
    }),
    query:async(sql:string)=>sql.includes("execution_controls")?{rows:[{paused:false}]}:{rows:[]}
  } as unknown as Pool;
  let merged=false;
  const request=async(method:string,path:string):Promise<unknown>=>{
    if(path==="/repos/neophilism/Repo")return {id:123,default_branch:"main"};
    if(path.includes("/pulls?"))return [{...pr,requested_reviewers:[]}];
    if(path.endsWith("/pulls/12"))return pr;
    if(path.includes("/pulls/12/files"))return [{filename:"package.json",status:"modified"},{filename:"pnpm-lock.yaml",status:"modified"}];
    if(path.includes("/contents/package.json?ref="))return data(path.endsWith("ref="+BASE)?old:{...current,dependencies:{"left-pad":"2.0.0"}});
    if(method==="PUT"){merged=true;throw Error("not allowed");}
    throw Error("Unexpected "+method+" "+path);
  };
  const result=await scanDependabotMaintenance(db,request,"neophilism");
  assert.equal(result.merged,0);
  assert.equal(result.needsAgent,1);
  assert.equal(merged,false);
});
