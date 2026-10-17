import test from "node:test";
import assert from "node:assert/strict";
import {githubWriteIdentity} from "../src/server/github-write-ledger.ts";

test("validated write intent has a stable content-bound identity, independent of object key order",()=>{
  const a=githubWriteIdentity("BR-055",{kind:"upsert_file",path:"src/a.ts",expectedSha:null,contentBase64:"YWJj",message:"Add fixture"});
  const b=githubWriteIdentity("BR-055",{message:"Add fixture",contentBase64:"YWJj",expectedSha:null,path:"src/a.ts",kind:"upsert_file"});
  assert.deepEqual(a,b);assert.match(a.digest,/^[a-f0-9]{64}$/);
  assert.notEqual(a.digest,githubWriteIdentity("BR-056",{kind:"upsert_file"}).digest);
  assert.notEqual(a.digest,githubWriteIdentity("BR-055",{kind:"upsert_file",path:"src/a.ts",expectedSha:null,contentBase64:"ZGVm",message:"Add fixture"}).digest);
  assert.ok(!JSON.stringify(a).includes("src/a.ts"));
});
test("file order, expected refs and deletion versus an empty file remain distinct intents",()=>{
  const files=[{path:"a.ts",contentBase64:null},{path:"b.ts",contentBase64:""}];
  const key=(files:unknown,expectedHeadSha="a".repeat(40))=>githubWriteIdentity("BR-055",{kind:"commit_files",files,expectedHeadSha}).key;
  assert.notEqual(key(files),key([...files].reverse()));
  assert.notEqual(key(files),key(files,"b".repeat(40)));
  assert.notEqual(key(files),key([{path:"a.ts",contentBase64:""},{path:"b.ts",contentBase64:""}]));
});
