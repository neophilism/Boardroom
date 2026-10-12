import test from "node:test";
import assert from "node:assert/strict";
import { InvalidAgentCredential, digestActivation, digestCredential } from "../src/server/agent-auth.ts";

const pepper = "BoardroomSecuritySecretPepperWithMoreThan32Chars";
const token = "AURO_0123456789012345678901234567890123456789";
test("credential digest is deterministic, scoped and never equals raw token", () => {
  const a = digestCredential(token,pepper);
  assert.equal(a,digestCredential(token,pepper));
  assert.notEqual(a,token);
  assert.match(a,/^[0-9a-f]{64}$/);
  assert.notEqual(a,digestCredential(token,pepper+"x"));
});
test("short and malformed token values fail closed",()=>{
  assert.throws(()=>digestCredential("short",pepper),InvalidAgentCredential);
  assert.throws(()=>digestCredential("a ".repeat(20),pepper),InvalidAgentCredential);
});
test("idempotency keys are scoped to credential ID",()=>{
  const key="provider-event-abc123";
  const a=digestActivation("cred-A",key,pepper);
  assert.equal(a,digestActivation("cred-A",key,pepper));
  assert.notEqual(a,digestActivation("cred-B",key,pepper));
  assert.throws(()=>digestActivation("cred-A","x",pepper));
});
