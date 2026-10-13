import test from "node:test";
import assert from "node:assert/strict";
import {checkDeploymentEvidence,expectedReleaseRevision} from "../src/domain/deployment-evidence.ts";
const sha="a".repeat(40);
const current={healthStatus:200,health:{service:"boardroom",liveness:"alive",revision:sha},readinessStatus:200,readiness:{service:"boardroom",readiness:"ready"},expectedRevision:sha};
test("exact release evidence requires the intended revision and readiness",()=>{
  assert.deepEqual(checkDeploymentEvidence(current),{revision:sha,readiness:"ready",exactReleaseVerified:true});
});
test("an older healthy release cannot satisfy a new deployment gate",()=>{
  assert.throws(()=>checkDeploymentEvidence({...current,health:{...current.health,revision:"b".repeat(40)}}),/not yet deployed/);
});
test("unknown or malformed revisions never establish release evidence",()=>{
  assert.throws(()=>checkDeploymentEvidence({...current,health:{...current.health,revision:null}}),/not yet deployed/);
  for(const revision of [undefined,"short",7,{secret:"not-public"}]){
    assert.throws(()=>checkDeploymentEvidence({...current,health:{...current.health,revision}}),/Observed release revision is invalid/);
  }
});
test("HTTP 503 is observable in monitor mode but cannot pass a release gate",()=>{
  const notReady={...current,readinessStatus:503,readiness:{service:"boardroom",readiness:"not_ready"}};
  assert.throws(()=>checkDeploymentEvidence(notReady),/not yet ready/);
  assert.deepEqual(checkDeploymentEvidence({...notReady,expectedRevision:undefined}),{revision:sha,readiness:"not_ready",exactReleaseVerified:false});
});
test("service identity, liveness and readiness response must agree",()=>{
  for(const health of [null,[],{...current.health,service:"other"},{...current.health,liveness:"down"}]){
    assert.throws(()=>checkDeploymentEvidence({...current,health}),/liveness is not verified/);
  }
  for(const readiness of [null,[],{service:"other",readiness:"ready"}]){
    assert.throws(()=>checkDeploymentEvidence({...current,readiness}),/readiness response is invalid/);
  }
  assert.throws(()=>checkDeploymentEvidence({...current,healthStatus:500}),/liveness is not verified/);
  assert.throws(()=>checkDeploymentEvidence({...current,readinessStatus:502}),/readiness response is invalid/);
  assert.throws(()=>checkDeploymentEvidence({...current,readiness:{service:"boardroom",readiness:"not_ready"}}),/disagree/);
});
test("missing expected revision never upgrades monitoring to verified release",()=>{
  assert.equal(checkDeploymentEvidence({...current,expectedRevision:undefined}).exactReleaseVerified,false);
  assert.equal(checkDeploymentEvidence({...current,health:{...current.health,revision:null},expectedRevision:undefined}).revision,null);
});
test("invalid expected revisions are rejected without echoing their contents",()=>{
  assert.equal(expectedReleaseRevision(undefined),undefined);
  assert.equal(expectedReleaseRevision(sha.toUpperCase()),sha);
  for(const value of ["","main","private-value",`${sha}\n`]){
    assert.throws(()=>expectedReleaseRevision(value),{message:"Expected release revision must be a full Git commit SHA"});
  }
});
