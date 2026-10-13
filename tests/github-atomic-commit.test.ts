import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {commitAssignedFiles} from "../src/server/github-atomic-commit.ts";
import {parseGithubWrite,performFencedGithubWrite,GithubWriteValidation,type GithubWrite} from "../src/server/github-write-gateway.ts";
import {GitHubAppError,type githubAppRequest} from "../src/server/github-app.ts";
import {SessionConflict} from "../src/server/sessions.ts";
const base="a".repeat(40),baseTree="b".repeat(40),newTree="c".repeat(40),newCommit="d".repeat(40),other="e".repeat(40);
const encode=(value:string)=>Buffer.from(value).toString("base64");
const operation=():Extract<GithubWrite,{kind:"commit_files"}>=>({kind:"commit_files",expectedHeadSha:base,message:"BR-035: coordinated source change",files:[
  {path:"src/a.ts",contentBase64:encode("export const value = 2;\n")},
  {path:"src/b.ts",contentBase64:encode("export {value} from './a';\n")},
  {path:"src/obsolete.ts",contentBase64:null}
]});
function fixture(options:{head?:string;fail?:"tree"|"commit"|"ref"|"response";race?:boolean;tree?:string;entries?:unknown[];truncated?:boolean;replayMessage?:string}={}){
  let head=options.head??base,reads=0;
  const calls:{method:string;path:string;body?:unknown}[]=[];
  const transport:typeof githubAppRequest=async(method,path,body)=>{
    calls.push({method,path,body});
    if(method==="GET"&&path.includes("/git/ref/")){
      if(options.race&&reads++>0)head=other;
      return {object:{sha:head}};
    }
    if(method==="GET"&&path.includes("/git/commits/"))return path.endsWith(newCommit)?
      {tree:{sha:newTree},parents:[{sha:base}],message:options.replayMessage??operation().message}:
      {tree:{sha:baseTree},parents:[{sha:other}],message:"Base commit"};
    if(method==="GET"&&path.includes("/git/trees/"))return {truncated:options.truncated??false,tree:options.entries??[
      {path:"src",type:"tree",mode:"040000",sha:other},
      {path:"src/a.ts",type:"blob",mode:"100755",sha:other},
      {path:"src/obsolete.ts",type:"blob",mode:"100644",sha:other}
    ]};
    if(method==="POST"&&path.endsWith("/trees")){
      if(options.fail==="tree")throw new GitHubAppError(503);
      return {sha:options.tree??newTree};
    }
    if(method==="POST"&&path.endsWith("/commits")){
      if(options.fail==="commit")throw new GitHubAppError(503);
      return {sha:newCommit};
    }
    if(method==="PATCH"){
      if(options.fail==="ref")throw new GitHubAppError(409);
      head=(body as {sha:string}).sha;
      if(options.fail==="response")throw new GitHubAppError(503);
      return {object:{sha:head}};
    }
    throw new Error("Unexpected GitHub fixture operation");
  };
  return {transport,calls,head:()=>head};
}
const run=(f:ReturnType<typeof fixture>,op=operation())=>commitAssignedFiles("/repos/ci/repo","boardroom/BR-035",op,f.transport);

test("one non-force ref update atomically publishes additions, edits and deletions",async()=>{
  const f=fixture(),result=await run(f);
  assert.equal(result.commitSha,newCommit);assert.equal(f.head(),newCommit);
  const tree=f.calls.find(c=>c.method==="POST"&&c.path.endsWith("/trees"))?.body;
  assert.deepEqual(tree,{base_tree:baseTree,tree:[
    {path:"src/a.ts",mode:"100755",type:"blob",content:"export const value = 2;\n"},
    {path:"src/b.ts",mode:"100644",type:"blob",content:"export {value} from './a';\n"},
    {path:"src/obsolete.ts",mode:"100644",type:"blob",sha:null}
  ]});
  assert.deepEqual(f.calls.find(c=>c.method==="POST"&&c.path.endsWith("/commits"))?.body,
    {message:operation().message,tree:newTree,parents:[base]});
  assert.deepEqual(f.calls.filter(c=>c.method==="PATCH").map(c=>c.body),[{sha:newCommit,force:false}]);
});
test("a failed staged object or ref update never partially changes the branch",async()=>{
  for(const fail of ["tree","commit","ref"] as const){
    const f=fixture({fail});await assert.rejects(run(f),GitHubAppError);assert.equal(f.head(),base);
    if(fail!=="ref")assert.equal(f.calls.filter(c=>c.method==="PATCH").length,0);
  }
});
test("a lost successful response reconciles the exact commit without duplicating it",async()=>{
  const first=fixture({fail:"response"});await assert.rejects(run(first));assert.equal(first.head(),newCommit);
  const replay=fixture({head:first.head()});assert.equal((await run(replay)).replay,true);
  assert.ok(replay.calls.every(c=>c.method!=="PATCH"&&!(c.method==="POST"&&c.path.endsWith("/commits"))));
  await assert.rejects(run(fixture({head:newCommit,replayMessage:"An unrelated commit"})),GitHubAppError);
  await assert.rejects(run(fixture({head:newCommit,tree:other})),GitHubAppError);
});
test("stale heads and concurrent branch changes never overwrite outside work",async()=>{
  const stale=fixture({head:other});await assert.rejects(run(stale),GitHubAppError);
  assert.ok(stale.calls.every(c=>c.method==="GET"));
  const race=fixture({race:true});await assert.rejects(run(race),GitHubAppError);
  assert.equal(race.head(),other);assert.ok(race.calls.every(c=>c.method!=="PATCH"));
});
test("unchanged trees do not create an empty commit",async()=>{
  const f=fixture({tree:baseTree});assert.equal((await run(f)).changed,false);
  assert.ok(f.calls.every(c=>c.method!=="PATCH"&&!(c.method==="POST"&&c.path.endsWith("/commits"))));
});
test("symlinks, gitlinks, directories and incomplete trees cannot become source edits",async()=>{
  for(const [path,type,mode] of [["src","blob","120000"],["src/a.ts","blob","120000"],
    ["src/a.ts","commit","160000"],["src/a.ts","tree","040000"]]){
    const f=fixture({entries:[{path,type,mode,sha:other}]});
    await assert.rejects(run(f),SessionConflict);assert.ok(f.calls.every(c=>c.method==="GET"));
  }
  await assert.rejects(run(fixture({truncated:true})),SessionConflict);
});
test("batch validation preserves protected-path and secret checks, including deletions",()=>{
  assert.deepEqual(parseGithubWrite(operation()),operation());
  for(const path of [".github/workflows/ci.yml",".circleci/config.yml","registry/roadmap.json","AGENTS.md","../escape"])
    for(const contentBase64 of [null,encode("safe text")])
      assert.throws(()=>parseGithubWrite({...operation(),files:[{path,contentBase64}]}),GithubWriteValidation);
  assert.throws(()=>parseGithubWrite({...operation(),files:[{path:"src/a.ts",contentBase64:encode("ghp_"+"x".repeat(30))}]}),GithubWriteValidation);
  for(const files of [[],Array(51).fill(operation().files[0]),[operation().files[0],operation().files[0]],
    [{path:"src/a.ts",contentBase64:""},{path:"src/a.ts/child",contentBase64:""}],
    [{path:"src/a.ts",contentBase64:encode("x".repeat(110000))},{path:"src/b.ts",contentBase64:encode("x".repeat(110000))}]])
    assert.throws(()=>parseGithubWrite({...operation(),files}),GithubWriteValidation);
  assert.throws(()=>parseGithubWrite({...operation(),expectedHeadSha:"not-a-sha"}),GithubWriteValidation);
  assert.throws(()=>parseGithubWrite({...operation(),files:[{path:"src/a.ts",contentBase64:"",mode:"120000"}]}),GithubWriteValidation);
  assert.doesNotThrow(()=>parseGithubWrite({...operation(),files:[{path:"src/empty.ts",contentBase64:""}]}));
});
test("an unauthorized or stale lease blocks the entire batch before GitHub access",async(t)=>{
  let calls=0,released=false;
  t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("No network call permitted");});
  const client={query:async()=>({rowCount:0,rows:[]}),release:()=>{released=true;}};
  const db={connect:async()=>client} as unknown as Pool;
  await assert.rejects(performFencedGithubWrite(db,"26741e83-9694-4fb3-8174-783b2f9bf61c","credential","1",operation()),SessionConflict);
  assert.equal(calls,0);assert.equal(released,true);
});
