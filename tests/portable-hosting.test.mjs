import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("Oracle launch pins an immutable Boardroom image and preserves private external database credentials",()=>{
  const compose=src("ops/hosting/oracle/compose.yaml");
  const example=src("ops/hosting/oracle/env.example");
  assert.match(compose,/BOARDROOM_IMAGE:/);
  assert.match(compose,/env_file:[\s\S]*\.env/);
  assert.match(example,/DATABASE_URL=/);
  assert.match(compose,/condition: service_healthy/);
  assert.match(compose,/no-new-privileges:true/);
  assert.doesNotMatch(compose,/privileged: true/);
  assert.doesNotMatch(compose,/build:\s*\./);
});

test("The Oracle launcher never evaluates connection strings as shell commands",()=>{
  const script=src("ops/hosting/oracle/deploy.sh");
  assert.doesNotMatch(script,/^\. \.\/\.env$/m);
  assert.match(script,/docker compose --env-file \.env/);
});

test("Hosting smoke workflow requires a host and source revision, not just a healthy HTTP response",()=>{
  const ci=src(".github/workflows/hosting-verify.yml");
  assert.match(ci,/origin:/);
  assert.match(ci,/expected_commit:/);
  assert.match(ci,/smoke-deployment\.mjs/);
  assert.doesNotMatch(ci,/BOARDROOM_OWNER_API_TOKEN/);
});

test("Deploy configuration avoids embedded credentials in public deployment config",()=>{
  const compose=src("ops/hosting/oracle/compose.yaml");
  const netlify=src("netlify.toml");
  for (const config of [compose,netlify]) {
    assert.doesNotMatch(config,/postgresql:\/\//);
    assert.doesNotMatch(config,/BOARDROOM_SESSION_SECRET\s*=/);
  }
});
