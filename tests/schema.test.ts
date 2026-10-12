import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../db/migrations/0001_core.sql", import.meta.url), "utf8");
test("schema includes durable exclusive sessions and fencing generation", () => {
  for (const table of ["repositories","repository_priority","agent_runs","repository_leases","work_assignments","roadmap_units","checkpoints","owner_actions","coffee_threads","coffee_messages","audit_events","operation_outbox"]) {
    assert.match(sql, new RegExp("CREATE TABLE " + table + "\\b"));
  }
  assert.match(sql, /generation BIGINT NOT NULL DEFAULT 0/);
  assert.match(sql, /CREATE UNIQUE INDEX idx_one_open_repo_assignment/);
  assert.match(sql, /CREATE UNIQUE INDEX idx_one_open_run_assignment/);
  assert.match(sql, /CREATE UNIQUE INDEX idx_unique_pending_owner_action/);
});
