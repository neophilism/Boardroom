import assert from "node:assert/strict";
import { test } from "node:test";
import { trialProblems, type TrialProof } from "../src/domain/trial-proof.ts";

const proof: TrialProof = {
  origin: "scheduled",
  runId: "00000000-0000-4000-8000-000000000001",
  generation: "1",
  repository: "example/repo",
  branch: "boardroom/BR-042",
  headSha: "a".repeat(40),
  prUrl: "https://github.com/example/repo/pull/1",
  ciHeadSha: "a".repeat(40),
  ciStatus: "success",
  arrivedAt: "2026-10-18T10:00:00Z",
  claimedAt: "2026-10-18T10:01:00Z",
  committedAt: "2026-10-18T10:02:00Z",
  prOpenedAt: "2026-10-18T10:03:00Z",
  ciObservedAt: "2026-10-18T10:04:00Z",
  finishedAt: "2026-10-18T10:05:00Z",
  released: true
};

test("new mapped PR proof is structurally valid", () =>
  assert.deepEqual(trialProblems(proof), []));
test("resumed mapped PR requires independent observation after current commit", () => {
  const resumed = { ...proof, prOpenedAt: "2026-10-17T10:03:00Z",
    prObservedAt: "2026-10-18T10:03:00Z" };
  assert.deepEqual(trialProblems(resumed), []);
  assert.match(trialProblems({ ...resumed, prObservedAt: undefined }).join(" "), /Mapped PR/);
  assert.match(trialProblems({ ...resumed, prObservedAt: "2026-10-18T10:01:00Z" }).join(" "), /Mapped PR/);
});
test("manual activation cannot pass", () =>
  assert.match(trialProblems({ ...proof, origin: "manual" }).join(" "), /scheduled/));
test("pending CI and unreleased lease cannot pass", () =>
  assert.equal(trialProblems({ ...proof, ciStatus: "pending", released: false }).length, 2));
test("invalid chronology cannot pass", () =>
  assert.match(trialProblems({ ...proof, claimedAt: "2026-10-18T09:00:00Z" }).join(" "), /chronology/));
test("spoofed PR URLs cannot pass", () => {
  for (const prUrl of [
    "https://github.com/example/repo/pull/1/extra",
    "https://github.com/example/repo/pull/not-a-number",
    "https://github.com/example/repo/pull/1?redirect=evil",
    "https://github.com.evil.test/example/repo/pull/1"
  ]) {
    assert.match(trialProblems({ ...proof, prUrl }).join(" "), /PR is not mapped/);
  }
});
test("invalid or ambiguous timestamps cannot pass", () => {
  for (const claimedAt of ["2026-02-31T10:01:00Z", "2026-10-18 10:01:00", "2026-10-18T10:01:00+00:00"]) {
    assert.match(trialProblems({ ...proof, claimedAt }).join(" "), /UTC timestamps/);
  }
});
test("a self-asserted scheduled value does not independently prove origin", () => {
  // Only authenticated private Boardroom records can attest real origin.
  assert.deepEqual(trialProblems({ ...proof, origin: "scheduled" }), []);
});
