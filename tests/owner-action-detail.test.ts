import test from "node:test";
import assert from "node:assert/strict";
import {describeOwnerActionUrgency,ownerActionLinks} from "../src/server/owner-action-detail.ts";

test("owner action urgency follows lifecycle state without inventing severity",()=>{
  assert.equal(describeOwnerActionUrgency("OPEN"),"Blocks affected work");
  assert.equal(describeOwnerActionUrgency("ACKNOWLEDGED"),"Blocks affected work");
  assert.equal(describeOwnerActionUrgency("AWAITING_VERIFICATION"),"Verify now");
  assert.equal(describeOwnerActionUrgency("VERIFIED"),"No longer active");
  assert.equal(describeOwnerActionUrgency("DECLINED"),"No longer active");
});

test("detail links include unique explicit HTTPS destinations only",()=>{
  assert.deepEqual(ownerActionLinks(
    "Open https://example.com/settings and not http://unsafe.example",
    "Use https://example.com/settings or https://docs.example/scope"
  ),["https://example.com/settings","https://docs.example/scope"]);
  assert.deepEqual(ownerActionLinks("No destination was supplied",null),[]);
});
