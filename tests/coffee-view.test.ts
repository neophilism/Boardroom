import test from "node:test";
import assert from "node:assert/strict";
import {COFFEE_STATUSES,isCoffeeThreadId,isSafeGitHubReference,parseCoffeeSearch,parseCoffeeStatus} from "../src/domain/coffee-view.ts";

test("status filtering accepts only existing thread states",()=>{
  assert.deepEqual(COFFEE_STATUSES,["OPEN","ANSWERED","RESOLVED","CLOSED"]);
  assert.equal(parseCoffeeStatus("OPEN"),"OPEN");
  assert.equal(parseCoffeeStatus("answerED"),null);
  assert.equal(parseCoffeeStatus("DROP TABLE"),null);
  assert.equal(parseCoffeeStatus(null),null);
});

test("search is trimmed and bounded without treating it as executable SQL",()=>{
  assert.equal(parseCoffeeSearch("  repository failure  "),"repository failure");
  assert.equal(parseCoffeeSearch("x".repeat(400)).length,100);
});

test("thread routes require well-formed UUIDs",()=>{
  assert.equal(isCoffeeThreadId("26741e83-9694-4fb3-8174-783b2f9bf61c"),true);
  assert.equal(isCoffeeThreadId("../other"),false);
  assert.equal(isCoffeeThreadId("26741e83-9694-4fb3-8174-783b2f9bf61g"),false);
});

test("only valid GitHub links from evidence are displayed",()=>{
  assert.equal(isSafeGitHubReference("https://github.com/neophilism/Boardroom/pull/16"),true);
  assert.equal(isSafeGitHubReference("https://github.com.evil.example/neophilism/Boardroom"),false);
  assert.equal(isSafeGitHubReference("javascript:alert(1)"),false);
  assert.equal(isSafeGitHubReference("https://other.example/secret"),false);
  assert.equal(isSafeGitHubReference({url:"https://github.com/neophilism/Boardroom"}),false);
});
