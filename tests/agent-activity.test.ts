import test from "node:test";
import assert from "node:assert/strict";
import {activityCursor,eventDescription,githubEvidenceUrl,safeEventPaths,safeUuidLink} from "../src/domain/agent-activity.ts";
test("activity pages accept bounded integer pagination only",()=>{
  assert.equal(activityCursor("12345"),"12345");
  for(const v of [undefined,null,"0","01","-1","1 OR 1=1","1".repeat(50)])assert.equal(activityCursor(v),null);
});
test("evidence links are limited to valid GitHub repository identities",()=>{
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","pull","15"),"https://github.com/neophilism/TrackZero/pull/15");
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","commit","a".repeat(40)),"https://github.com/neophilism/TrackZero/commit/"+"a".repeat(40));
  assert.equal(githubEvidenceUrl("evil/a/../../x","pull","15"),null);
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","commit","javascript:alert(1)"),null);
  assert.equal(githubEvidenceUrl("neophilism/TrackZero","pull","1?hack"),null);
});
test("safe activity fields are bounded without revealing raw audit payloads",()=>{
  assert.equal(eventDescription("github.write.commit_files"),"Files committed");
  assert.deepEqual(safeEventPaths(["src/main.ts",4,"bad\nname","x".repeat(300)]),["src/main.ts"]);
  assert.equal(safeUuidLink("not-a-uuid"),null);
  assert.equal(safeUuidLink("db226a76-256f-42ba-b510-6a3803aabbee"),"db226a76-256f-42ba-b510-6a3803aabbee");
});
