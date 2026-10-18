import assert from "node:assert/strict";
import { test } from "node:test";
import { trialProblems, type TrialProof } from "../src/domain/trial-proof.ts";
const proof: TrialProof = { origin:"scheduled", runId:"test", generation:"1", repository:"example/repo", branch:"trial", headSha:"a".repeat(40), prUrl:"https://github.com/example/repo/pull/1", ciHeadSha:"a".repeat(40), ciStatus:"success", arrivedAt:"2026-10-18T10:00:00Z", claimedAt:"2026-10-18T10:01:00Z", committedAt:"2026-10-18T10:02:00Z", prOpenedAt:"2026-10-18T10:03:00Z", ciObservedAt:"2026-10-18T10:04:00Z", finishedAt:"2026-10-18T10:05:00Z", released:true };
test("complete proof is structurally valid", () => assert.deepEqual(trialProblems(proof), []));
test("manual activation cannot pass", () => assert.ok(trialProblems({...proof,origin:"manual"}).length));
test("pending CI and unreleased lease cannot pass", () => assert.equal(trialProblems({...proof,ciStatus:"pending",released:false}).length,2));
test("inconsistent event chronology cannot pass", () => assert.match(trialProblems({...proof,claimedAt:"2026-10-18T09:00:00Z"}).join(" "),/chronology/));
