import test from "node:test";
import assert from "node:assert/strict";
import {recordedGitHubActivity,actionAge,safeRevision} from "../src/domain/operational-digest.ts";
const occurredAt=new Date("2026-10-13T12:00:00Z"),repository="ci/repo";
test("only GitHub gateway receipts become evidence links",()=>{
  const d={unitId:"CI-001",result:{commitSha:"a".repeat(40),url:"https://attacker.invalid/?secret=value",privateText:"omit me"}};
  const entry=recordedGitHubActivity({kind:"github.write.upsert_file",repository,details:d,occurredAt});
  assert.equal(entry?.url,"https://github.com/ci/repo/commit/"+"a".repeat(40));
  assert.ok(!JSON.stringify(entry).includes("attacker"));assert.ok(!JSON.stringify(entry).includes("privateText"));
  assert.equal(recordedGitHubActivity({kind:"agent.run.finished",repository,details:{...d,accepted:true},occurredAt}),null);
});
test("PR receipts link to source and current checks without inventing check success",()=>{
  for(const kind of ["github.write.open_draft_pr","github.write.ready_pr","github.pr.merged"]){
    const entry=recordedGitHubActivity({kind,repository,details:{unitId:"CI-001",number:7,result:{number:7}},occurredAt});
    assert.equal(entry?.url,"https://github.com/ci/repo/pull/7");
    assert.equal(entry?.checksUrl,"https://github.com/ci/repo/pull/7/checks");
    assert.ok(!JSON.stringify(entry).includes("checksPassed"));
  }
});
test("atomic multi-file commits appear in the morning report while no-ops do not",()=>{
  const input={kind:"github.write.commit_files",repository,occurredAt,
    details:{unitId:"CI-001",result:{commitSha:"b".repeat(40),changed:true}}};
  const entry=recordedGitHubActivity(input);
  assert.equal(entry?.kind,"COMMIT");
  assert.equal(entry?.url,"https://github.com/ci/repo/commit/"+"b".repeat(40));
  assert.equal(recordedGitHubActivity({...input,details:{result:{commitSha:"b".repeat(40),changed:false}}}),null);
});
test("malformed receipts and repository URLs cannot become report evidence",()=>{
  for(const input of [
    {kind:"github.write.upsert_file",repository,details:{result:{commitSha:"bad"}},occurredAt},
    {kind:"github.pr.merged",repository:"ci/repo?token=value",details:{number:7},occurredAt},
    {kind:"github.pr.merged",repository,details:{number:"7"},occurredAt}
  ])assert.equal(recordedGitHubActivity(input),null);
});
test("one private action ages into a reminder without making new requests",()=>{
  assert.deepEqual(actionAge(occurredAt,occurredAt),{days:0,attention:"NEW"});
  assert.deepEqual(actionAge(new Date(occurredAt.getTime()-86400000),occurredAt),{days:1,attention:"PENDING"});
  assert.deepEqual(actionAge(new Date(occurredAt.getTime()-7*86400000),occurredAt),{days:7,attention:"OVERDUE"});
  assert.deepEqual(actionAge(new Date(occurredAt.getTime()+86400000),occurredAt),{days:0,attention:"NEW"});
});
test("deployment evidence requires an actual full revision",()=>{
  assert.equal(safeRevision("a".repeat(40)),"a".repeat(40));
  assert.equal(safeRevision("latest"),null);assert.equal(safeRevision("private credential"),null);
});
