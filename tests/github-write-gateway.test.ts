import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRepositoryPath,safeWorkBranch,parseGithubWrite,parseGithubWriteRequest,
  canonicalPullRequest,pullRequestChanges,doWrite,GithubWriteValidation
} from "../src/server/github-write-gateway.ts";
import {GitHubAppError,type githubAppRequest} from "../src/server/github-app.ts";

const runId="26741e83-9694-4fb3-8174-783b2f9bf61c";
const b64=Buffer.from("export const answer = 42;\n","utf8").toString("base64");
test("branch names are derived solely from approved work-unit IDs",()=>{
  assert.equal(safeWorkBranch("BR-034"),"boardroom/BR-034");
  assert.equal(safeWorkBranch("SIE-002"),"boardroom/SIE-002");
  for(const id of ["..",".evil","foo/bar","a","my unit","bad..foo"])
    assert.throws(()=>safeWorkBranch(id),GithubWriteValidation);
});
test("source paths block CI, plans, secrets and path traversal",()=>{
  assert.equal(safeRepositoryPath("src/lib/component.ts"),"src/lib/component.ts");
  for(const file of ["../secret","src//foo.ts","/etc/passwd",".github/workflows/ci.yml",
    "registry/roadmap.json","AGENTS.md","render.yaml",".env",".env.production",
    "src/private.key","src/../oops.ts","foo\\bar.ts","secrets/token.txt"])
    assert.throws(()=>safeRepositoryPath(file),GithubWriteValidation);
});
test("upsert requires bounded utf8, explicit optimistic SHA and safe message",()=>{
  const x=parseGithubWrite({kind:"upsert_file",path:"src/index.ts",contentBase64:b64,
    message:"feat(BR-034): add source",expectedSha:null});
  assert.equal(x.kind,"upsert_file");
  for(const contents of ["###",Buffer.from([0xff,0xff]).toString("base64"),
    Buffer.from("ghp_"+"x".repeat(30)).toString("base64")])
    assert.throws(()=>parseGithubWrite({kind:"upsert_file",path:"src/index.ts",
      contentBase64:contents,message:"feat: change"}),GithubWriteValidation);
  assert.throws(()=>parseGithubWrite({kind:"upsert_file",path:"src/index.ts",
    contentBase64:b64,message:"feat: change",expectedSha:"notasha"}),GithubWriteValidation);
});
test("branch, draft PR and review readiness do not grant arbitrary merge or deletion",()=>{
  assert.deepEqual(parseGithubWrite({kind:"ensure_branch"}),{kind:"ensure_branch"});
  assert.deepEqual(parseGithubWrite({kind:"open_draft_pr",description:"Tests passed."}),
    {kind:"open_draft_pr",description:"Tests passed."});
  assert.throws(()=>parseGithubWrite({kind:"merge_pr"}),GithubWriteValidation);
  assert.deepEqual(parseGithubWrite({kind:"ready_pr",number:1}),{kind:"ready_pr",number:1});
  assert.throws(()=>parseGithubWrite({kind:"delete_branch"}),GithubWriteValidation);
});
test("run and lease generation must be explicitly provided",()=>{
  const out=parseGithubWriteRequest({runId,generation:"4",kind:"ensure_branch"});
  assert.equal(out.runId,runId);
  assert.equal(out.generation,"4");
  assert.throws(()=>parseGithubWriteRequest({runId,generation:0,kind:"ensure_branch"}),
    GithubWriteValidation);
  for(const target of [
    {repository:"neophilism/other"},{repositoryId:"999"},{fullName:"neophilism/other"},{owner:"neophilism"},{repo:"other"}
  ])assert.throws(()=>parseGithubWriteRequest({runId,generation:"4",kind:"ensure_branch",...target}),
    /derived only from the current assignment/);
});

test("work-unit PR metadata is canonical and existing PRs are updated in place",()=>{
  const intended=canonicalPullRequest("BR-036","Work-unit-linked PR creation and updates","New evidence.");
  assert.equal(intended.title,"BR-036: Work-unit-linked PR creation and updates");
  assert.deepEqual(pullRequestChanges({number:7,html_url:"https://example.test/7",draft:true,
    title:"manual title",body:"old",base:{ref:"staging"}},intended,"main"),{
    title:intended.title,body:"New evidence.",base:"main"
  });
  const preserve=canonicalPullRequest("BR-036","Work-unit-linked PR creation and updates","");
  assert.deepEqual(pullRequestChanges({number:7,html_url:"https://example.test/7",draft:false,
    title:preserve.title,body:"maintainer notes",base:{ref:"main"}},preserve,"main"),{});
  assert.equal(canonicalPullRequest("BR-036","x".repeat(300),"").title.length,220);
});


test("ledger replay never restores branch or pull-request state changed outside Boardroom",async()=>{
  const scope={repository_id:"123",full_name:"ci/repo",unit_id:"BR-055",title:"Transactional delivery"};
  const sha="a".repeat(40);

  const branchCalls:string[]=[];
  const missingBranch:typeof githubAppRequest=async(method,path)=>{
    branchCalls.push(method+" "+path);
    if(path==="/repos/ci/repo")return {default_branch:"main"};
    if(path.endsWith("/git/ref/heads/main"))return {object:{sha}};
    if(path.endsWith("/git/ref/heads/boardroom/BR-055"))throw new GitHubAppError(404);
    throw new Error("Unexpected branch fixture operation");
  };
  await assert.rejects(doWrite(scope,{kind:"ensure_branch"},missingBranch,true),/Prior branch intent needs source reconciliation/);
  assert.ok(branchCalls.every(call=>!call.startsWith("POST ")));

  const readyCalls:string[]=[];
  const redrafted:typeof githubAppRequest=async(method,path)=>{
    readyCalls.push(method+" "+path);
    if(method==="GET"&&path.endsWith("/pulls/7"))return {
      node_id:"PR_fixture",draft:true,head:{ref:"boardroom/BR-055",repo:{id:123}}
    };
    throw new Error("Unexpected ready fixture operation");
  };
  await assert.rejects(doWrite(scope,{kind:"ready_pr",number:7},redrafted,true),/Prior ready intent needs pull-request reconciliation/);
  assert.ok(readyCalls.every(call=>!call.startsWith("POST ")));

  const prCalls:string[]=[];
  const editedPullRequest:typeof githubAppRequest=async(method,path)=>{
    prCalls.push(method+" "+path);
    if(path==="/repos/ci/repo")return {default_branch:"main"};
    if(path.endsWith("/git/ref/heads/main"))return {object:{sha}};
    if(path.includes("/pulls?state=all"))return [{
      number:7,html_url:"https://example.test/7",draft:true,state:"open",
      title:"Outside edit",body:"Maintainer notes",base:{ref:"main"}
    }];
    throw new Error("Unexpected pull request fixture operation");
  };
  await assert.rejects(doWrite(scope,{kind:"open_draft_pr",description:"Intended body"},editedPullRequest,true),/Prior pull-request intent needs reconciliation/);
  assert.ok(prCalls.every(call=>!call.startsWith("PATCH ")));
});
