import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("recovery view never mutates a repository lease",()=>{
  const source=readFileSync(new URL("../src/server/recovery-overview.ts",import.meta.url),"utf8");
  assert.match(source,/FROM repository_leases/);
  assert.match(source,/RECOVERING/);
  assert.match(source,/owner_actions/);
  assert.doesNotMatch(source,/UPDATE\s+repository_leases|DELETE\s+FROM\s+repository_leases|INSERT\s+INTO\s+repository_leases/i);
});
test("recovery UI discloses no takeover or release button",()=>{
  const source=readFileSync(new URL("../app/recovery/page.tsx",import.meta.url),"utf8");
  assert.match(source,/former worker is proven terminated/);
  assert.doesNotMatch(source,/onClick|releaseLease|forceTakeover/);
});
