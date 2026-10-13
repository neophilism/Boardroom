import test from "node:test";
import assert from "node:assert/strict";
import {runnerConfiguration} from "../src/runner/run.ts";
const env={BOARDROOM_RUN_ENABLED:"true",BOARDROOM_BASE_URL:"https://boardroom.example",BOARDROOM_AGENT_NAME:"Smith",BOARDROOM_AGENT_TOKEN:"x".repeat(64),
  BOARDROOM_MODEL_PROVIDER:"openai",BOARDROOM_MODEL:"explicit-model",OPENAI_API_KEY:"fixture-key",BOARDROOM_MAX_COST_MICROUSD:"100000",
  BOARDROOM_INPUT_USD_PER_MILLION:"1",BOARDROOM_OUTPUT_USD_PER_MILLION:"2"};
test("hosted scheduling is inert until explicitly enabled and funded with protected credentials",()=>{
  assert.equal(runnerConfiguration({}),null);
  assert.equal(runnerConfiguration({...env,BOARDROOM_RUN_ENABLED:"false"}),null);
  assert.equal(runnerConfiguration(env)?.maxCostMicroUsd,100000);
  for(const patch of [{OPENAI_API_KEY:""},{BOARDROOM_MAX_COST_MICROUSD:"0"},{BOARDROOM_MAX_TOKENS:"-1"},{BOARDROOM_INPUT_USD_PER_MILLION:"NaN"}])
    assert.throws(()=>runnerConfiguration({...env,...patch}));
});
