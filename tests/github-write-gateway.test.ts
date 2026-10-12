import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRepositoryPath,safeWorkBranch,parseGithubWrite,parseGithubWriteRequest,
  GithubWriteValidation
} from "../src/server/github-write-gateway.ts";

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
});
