import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("production-secret GitHub workflows cannot run dispatched feature branch code",()=>{
  for(const name of ["hosted-agents.yml","maintenance.yml"]){
    const yaml=read(".github/workflows/"+name);
    assert.doesNotMatch(yaml,/workflow_dispatch:/);
    assert.match(yaml,/if: github\.ref == 'refs\/heads\/main'/);
    assert.match(yaml,/ref: \$\{\{ github\.sha \}\}/);
    assert.match(yaml,/persist-credentials: false/);
  }
});
test("hosted runner exposes only the configured provider credential",()=>{
  const yaml=read(".github/workflows/hosted-agents.yml");
  for(const [provider,key] of [["openai","OPENAI"],["anthropic","ANTHROPIC"],["xai","XAI"]]){
    assert.ok(yaml.includes("vars.BOARDROOM_MODEL_PROVIDER == '"+provider+"' && secrets."+key+"_API_KEY"));
    assert.ok(!yaml.includes(key+"_API_KEY: \u0024{{ secrets."+key+"_API_KEY }}"));
  }
});
test("maintenance never injects a reusable watchdog token",()=>{
  assert.doesNotMatch(read(".github/workflows/maintenance.yml"),/BOARDROOM_WATCHDOG_TOKEN/);
  assert.doesNotMatch(read("scripts/maintenance-auth.mjs"),/BOARDROOM_WATCHDOG_TOKEN/);
  assert.doesNotMatch(read("src/server/maintenance-auth.ts"),/BOARDROOM_WATCHDOG_TOKEN/);
});
