import test from "node:test";
import assert from "node:assert/strict";
import {deploymentRevision} from "../src/domain/deployment-revision.ts";
test("image revision wins over stale native service metadata; native releases remain supported",()=>{
  assert.equal(deploymentRevision({BOARDROOM_BUILD_REVISION:'a'.repeat(40),RENDER_GIT_COMMIT:'b'.repeat(40)}),'a'.repeat(40));
  assert.equal(deploymentRevision({RENDER_GIT_COMMIT:'b'.repeat(40)}),'b'.repeat(40));
  assert.equal(deploymentRevision({BOARDROOM_BUILD_REVISION:'invalid',RENDER_GIT_COMMIT:'b'.repeat(40)}),null);
  assert.equal(deploymentRevision({}),null);
});
