import test from "node:test";
import assert from "node:assert/strict";
import { REPOSITORY_CLAIM_QUERY,REPOSITORY_CONTINUATION_CLAIM_QUERY } from "../src/server/assignment.ts";

test("claim query prioritizes the owner's explicit list ahead of recency",()=>{
  assert.match(REPOSITORY_CLAIM_QUERY,/CASE WHEN p.position IS NULL THEN 1 ELSE 0 END/);
  assert.match(REPOSITORY_CLAIM_QUERY,/p.position ASC NULLS LAST/);
  assert.match(REPOSITORY_CLAIM_QUERY,/COALESCE\(r.last_development_at, r.created_at\) ASC/);
});
test("claim query uses atomic row locking and does not reclaim abandoned leases",()=>{
  assert.match(REPOSITORY_CLAIM_QUERY,/FOR UPDATE OF l SKIP LOCKED/);
  assert.match(REPOSITORY_CLAIM_QUERY,/l.run_id IS NULL/);
  assert.doesNotMatch(REPOSITORY_CLAIM_QUERY,/l.expires_at\s*</);
});
test("claim query requires approved eligible work and honors active owner blockers",()=>{
  assert.match(REPOSITORY_CLAIM_QUERY,/w.approved = TRUE/);
  assert.match(REPOSITORY_CLAIM_QUERY,/prerequisite.state NOT IN/);
  assert.match(REPOSITORY_CLAIM_QUERY,/owner_action_dependents/);
});

test("continuation excludes previously attempted work only in the current run",()=>{
  assert.doesNotMatch(REPOSITORY_CLAIM_QUERY,/prior\.run_id=\$1::uuid/);
  assert.match(REPOSITORY_CONTINUATION_CLAIM_QUERY,/prior\.run_id=\$1::uuid/);
  assert.match(REPOSITORY_CONTINUATION_CLAIM_QUERY,/prior\.unit_id=w\.unit_id/);
  assert.match(REPOSITORY_CONTINUATION_CLAIM_QUERY,/prior\.released_at IS NOT NULL/);
  assert.match(REPOSITORY_CONTINUATION_CLAIM_QUERY,/FOR UPDATE OF l SKIP LOCKED/);
});
