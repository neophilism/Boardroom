import test from "node:test";
import assert from "node:assert/strict";
import {OWNER_NAVIGATION,ownerNavigationSection} from "../src/domain/owner-navigation.ts";
import {safeOwnerReturnTo} from "../src/domain/owner-return.ts";
import {auditBefore,auditKind} from "../src/domain/owner-audit.ts";
test("navigation covers every private view with unique local destinations",()=>{
  assert.equal(new Set(OWNER_NAVIGATION.map(item=>item.href)).size,OWNER_NAVIGATION.length);
  for(const item of OWNER_NAVIGATION){
    assert.match(item.href,/^\/[a-z-]+$/);assert.ok(item.label.length>0);
    assert.equal(ownerNavigationSection(item.href)?.href,item.href);
    assert.equal(ownerNavigationSection(item.href+"/detail")?.href,item.href);
    assert.equal(ownerNavigationSection(item.href+"-not-the-same-view"),null);
  }
  assert.equal(ownerNavigationSection("/login"),null);assert.equal(ownerNavigationSection("/api/v1/owner"),null);
});
test("sign-in return destinations stay within known private views or OAuth consent",()=>{
  for(const item of OWNER_NAVIGATION)assert.equal(safeOwnerReturnTo(item.href),item.href);
  assert.equal(safeOwnerReturnTo("/audit?before=42"),"/audit?before=42");
  assert.equal(safeOwnerReturnTo("/owner-actions/26741e83-9694-4fb3-8174-783b2f9bf61c"),"/owner-actions/26741e83-9694-4fb3-8174-783b2f9bf61c");
  for(const value of ["//evil.example","https://evil.example","/audit#secret","/login","/api/v1/owner/operations","/owner-actions/../../login","/audit\\evil.example","/audit\n"])
    assert.equal(safeOwnerReturnTo(value),"/owner-actions");
});
test("audit keyset cursors are bounded integer values, never SQL or offsets",()=>{
  assert.equal(auditBefore("42"),"42");assert.equal(auditBefore("9223372036854775807"),"9223372036854775807");
  for(const value of [undefined,null,["1"],"0","-1","01","1;DROP TABLE audit_events","9223372036854775808","1e3"])assert.equal(auditBefore(value),null);
  assert.equal(auditKind("github.write.commit_files"),"github.write.commit_files");
  for(const value of [null,"private event with spaces","<script>","x".repeat(97)])assert.equal(auditKind(value),"unrecognized.event");
});
