import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {netlifyBuildRevision} from "../scripts/prepare-netlify-build.mjs";

test("Netlify release identity requires an immutable Git commit",()=>{
  const sha="A".repeat(40);
  assert.equal(netlifyBuildRevision({COMMIT_REF:sha}),sha.toLowerCase());
  for(const value of [undefined,"main","", "0".repeat(39),"x".repeat(40),"a".repeat(40)+"\n"]){
    assert.throws(()=>netlifyBuildRevision({COMMIT_REF:value}),/COMMIT_REF/);
  }
});
test("Serverless recovery retains an actual Next.js build, not an unauthenticated static snapshot",()=>{
  const config=readFileSync(new URL("../netlify.toml",import.meta.url),"utf8");
  assert.match(config,/publish = "\.next"/);
  assert.match(config,/prepare-netlify-build\.mjs && npm run build/);
  assert.doesNotMatch(config,/DATABASE_URL\s*=/);
  assert.doesNotMatch(config,/BOARDROOM_OWNER_API_TOKEN\s*=/);
});
