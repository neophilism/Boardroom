import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(new URL("../registry/agent-names.json", import.meta.url),"utf8"));
const document = readFileSync(new URL("../docs/AGENT_NAMES.md", import.meta.url),"utf8");

test("Boardroom agent name roster is a complete, unique, stable allowlist", () => {
  assert.equal(registry.schemaVersion,1);
  assert.ok(registry.names.length > 400);
  assert.equal(new Set(registry.names).size,registry.names.length);
  for(const name of registry.names) {
    assert.equal(name,name.trim());
    assert.ok(name.length >= 1 && name.length <= 100);
    assert.ok(document.includes(name));
  }
  assert.ok(registry.names.includes("Smith"));
  assert.ok(registry.names.includes("The Mechanical Dummy"));
  assert.ok(registry.names.includes("J.A.R.V.I.S."));
  assert.ok(registry.names.includes("'80s Robot"));
  assert.ok(registry.names.includes("EVE"));
  assert.ok(registry.names.includes("Eve"));
});

test("Every approved name appears once in the numbered document", () => {
  const entries = document.split("\n").filter(line=>/^\d+\. /.test(line)).map(line=>line.replace(/^\d+\. /,""));
  assert.deepEqual(entries,registry.names);
});
