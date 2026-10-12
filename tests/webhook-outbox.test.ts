import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {validWebhookSignature} from "../src/server/webhook.ts";
import {retryDelaySeconds} from "../src/server/outbox.ts";
test("webhooks require a SHA256 signature over the exact raw bytes",()=>{
  const key="x".repeat(40),raw='{"event":"push"}';
  const signature="sha256="+createHmac("sha256",key).update(raw).digest("hex");
  assert.equal(validWebhookSignature(raw,signature,key),true);
  assert.equal(validWebhookSignature(raw+" ",signature,key),false);
  assert.equal(validWebhookSignature(raw,null,key),false);
  assert.equal(validWebhookSignature(raw,signature,"short"),false);
});
test("transient reconciliation retries have bounded exponential backoff",()=>{
  assert.equal(retryDelaySeconds(1),15);assert.equal(retryDelaySeconds(2),30);assert.equal(retryDelaySeconds(100),900);
});
