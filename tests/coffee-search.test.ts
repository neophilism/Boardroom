import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {searchCoffeeThreads} from "../src/server/coffee-search.ts";
import {isSafeGitHubReference} from "../src/domain/coffee-view.ts";
test("Coffee search uses literal input and strips unsafe source references",async()=>{
  let parameters:unknown;
  const db={query:async(_sql:string,args:unknown)=>{
    parameters=args;
    return {rows:[{thread_id:"fixture",adr:"https://github.com/ci/repo/blob/"+"a".repeat(40)+"/docs/adr/decision.md",
      messages:[{messageId:"answer",kind:"ANSWER",content:"Database source evidence",evidence:["https://github.com/ci/repo/pull/1","https://github.com/ci/repo?token=private-value","javascript:bad"]}]}]};
  }} as unknown as Pool;
  const result=await searchCoffeeThreads(db,"  %_  ","RESOLVED");
  assert.deepEqual(parameters,["RESOLVED","%_"]);
  assert.deepEqual(result[0].messages[0].evidence,["https://github.com/ci/repo/pull/1"]);
  assert.ok(result[0].adr?.includes("/docs/adr/decision.md"));
  assert.ok(!JSON.stringify(result).includes("private-value"));
});
test("malformed filters fail before accessing discussion data",async()=>{
  const db={query:async()=>{throw new Error("must not query");}} as unknown as Pool;
  await assert.rejects(searchCoffeeThreads(db,null,"invalid"));
});
test("evidence links cannot contain credentials, query strings or fragments",()=>{
  for(const ref of ["https://github.com/ci/repo?token=secret","https://github.com/ci/repo#private","https://user:secret@github.com/ci/repo"])
    assert.equal(isSafeGitHubReference(ref),false);
});
