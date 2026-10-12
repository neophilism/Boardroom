import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const plan = JSON.parse(readFileSync(new URL("../registry/roadmap.json", import.meta.url), "utf8")) as {
  repository: string; plannedPrCount: number; milestones: {id: string; dependsOn?: string[]}[];
};
test("Boardroom roadmap has stable unique IDs and valid dependencies", () => {
  assert.equal(plan.repository, "neophilism/Boardroom");
  assert.equal(plan.plannedPrCount, plan.milestones.length);
  const ids = plan.milestones.map(unit => unit.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const unit of plan.milestones) for (const parent of unit.dependsOn ?? []) assert.ok(ids.includes(parent), parent);
});
