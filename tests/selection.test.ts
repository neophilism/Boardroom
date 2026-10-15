import test from "node:test";
import assert from "node:assert/strict";
import { selectRepository, type RepositoryCandidate } from "../src/domain/selection.ts";

const r = (id: number, updated: string, options: Partial<RepositoryCandidate> = {}): RepositoryCandidate => ({
  id, fullName: "owner/repo-" + id, createdAt: "2026-01-01T00:00:00Z",
  lastDevelopmentAt: updated, eligible: true, leaseHeld: false, ...options,
});

test("strict owner priority beats recency", () => {
  assert.equal(selectRepository([r(1, "2026-10-01T00:00:00Z"), r(2, "2026-02-01T00:00:00Z")], [1])?.id, 1);
});
test("falls back to least recently developed eligible nonpriority repository", () => {
  assert.equal(selectRepository([r(1, "2026-10-01T00:00:00Z", {leaseHeld: true}), r(2, "2026-08-01T00:00:00Z"), r(3, "2026-03-01T00:00:00Z")], [1])?.id, 3);
});
test("skips ineligible repos and returns null if all are locked", () => {
  assert.equal(selectRepository([r(1, "2026-01-01T00:00:00Z",{eligible:false}),r(2,"2026-01-01T00:00:00Z",{leaseHeld:true})],[1]), null);
});
test("creation date is deterministic fallback and repository id breaks ties", () => {
  assert.equal(selectRepository([r(9, "2026-09-01T00:00:00Z"),r(3, "2026-09-01T00:00:00Z",{lastDevelopmentAt:null})], [])?.id,3);
  assert.equal(selectRepository([r(9, "2026-09-01T00:00:00Z"),r(3, "2026-09-01T00:00:00Z")],[])?.id,3);
});
test("does not treat a currently leased priority repo as available ordinary work", () => {
  assert.equal(selectRepository([r(1,"2026-03-01T00:00:00Z",{leaseHeld:true}), r(2,"2026-04-01T00:00:00Z")],[1])?.id,2);
});

test("selection is invariant to candidate enumeration order", () => {
  const candidates = [
    r(30, "2026-06-01T00:00:00Z"),
    r(20, "2026-02-01T00:00:00Z"),
    r(10, "2026-02-01T00:00:00Z")
  ];
  const permutations = [
    candidates,
    [candidates[0], candidates[2], candidates[1]],
    [candidates[1], candidates[0], candidates[2]],
    [candidates[1], candidates[2], candidates[0]],
    [candidates[2], candidates[0], candidates[1]],
    [candidates[2], candidates[1], candidates[0]]
  ];
  for (const ordering of permutations) {
    assert.equal(selectRepository(ordering, [30, 20])?.id, 30, "explicit priority order wins");
    assert.equal(selectRepository(ordering, [])?.id, 10, "oldest timestamp uses the id tie-break");
    assert.equal(selectRepository(ordering.map(repo => ({...repo, leaseHeld: true})), []), null);
  }
});
