import test from "node:test";
import assert from "node:assert/strict";
import type {Pool,PoolClient} from "pg";
import {runnerConfiguration} from "../src/runner/run.ts";
import {reserveRunnerBudget} from "../src/server/usage.ts";
import {RunnerBudgetBlocked} from "../src/server/budget-errors.ts";
import {emergencyStopPaidApi} from "../src/server/operations.ts";

const args=["26741e83-9694-4fb3-8174-783b2f9bf61c","26741e83-9694-4fb3-8174-783b2f9bf61c","1","model-0",2000] as const;
test("hosted model runner cannot activate without two explicit independent switches",()=>{
  const env={BOARDROOM_RUN_ENABLED:"true",BOARDROOM_MODEL_PROVIDER:"openai",OPENAI_API_KEY:"secret"};
  assert.equal(runnerConfiguration(env),null);
  assert.equal(runnerConfiguration({...env,BOARDROOM_API_SPENDING_ENABLED:"false"}),null);
  assert.equal(runnerConfiguration({...env,BOARDROOM_API_SPENDING_ENABLED:"TRUE"}),null);
});
test("server denies a paid reservation before even opening DB when disabled by default",async()=>{
  const db={connect:async()=>{throw Error("must not touch database");}} as unknown as Pool;
  const prior=process.env.BOARDROOM_API_SPENDING_ENABLED;
  try{
    delete process.env.BOARDROOM_API_SPENDING_ENABLED;
    await assert.rejects(reserveRunnerBudget(db,...args),e=>e instanceof RunnerBudgetBlocked&&e.code==="API_DISABLED");
    process.env.BOARDROOM_API_SPENDING_ENABLED="false";
    await assert.rejects(reserveRunnerBudget(db,...args),e=>e instanceof RunnerBudgetBlocked&&e.code==="API_DISABLED");
  }finally{if(prior===undefined)delete process.env.BOARDROOM_API_SPENDING_ENABLED;
    else process.env.BOARDROOM_API_SPENDING_ENABLED=prior;}
});
test("database spending flag independently rejects calls even with configured environment and cap",async()=>{
  const statements:string[]=[];
  const client={query:async(sql:string)=>{statements.push(sql);
    if(sql.includes("SELECT api_spending_enabled"))return {rows:[{api_spending_enabled:false}],rowCount:1};
    return {rows:[],rowCount:0};
  },release:()=>{}} as unknown as PoolClient;
  const db={connect:async()=>client} as unknown as Pool;
  const cap=process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD,enabled=process.env.BOARDROOM_API_SPENDING_ENABLED;
  try{
    process.env.BOARDROOM_API_SPENDING_ENABLED="true";
    process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD="1000000";
    await assert.rejects(reserveRunnerBudget(db,...args),e=>e instanceof RunnerBudgetBlocked&&e.code==="API_DISABLED");
    assert.ok(statements.some(sql=>sql.includes("FOR SHARE")));
    assert.ok(statements.includes("ROLLBACK"));
    assert.ok(!statements.some(sql=>sql.includes("INSERT INTO runner_budget_reservations")));
  }finally{
    if(cap===undefined)delete process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD;else process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD=cap;
    if(enabled===undefined)delete process.env.BOARDROOM_API_SPENDING_ENABLED;else process.env.BOARDROOM_API_SPENDING_ENABLED=enabled;
  }
});
test("emergency stop is owner-audited and never enables spending",async()=>{
  const commands:string[]=[];
  const client={query:async(sql:string)=>{commands.push(sql);
    if(sql.includes("UPDATE execution_controls"))return {rowCount:1,rows:[{api_spending_enabled:false}]};
    return {rowCount:0,rows:[]};
  },release:()=>{}} as unknown as PoolClient;
  const db={connect:async()=>client} as unknown as Pool;
  assert.deepEqual(await emergencyStopPaidApi(db),{apiSpendingEnabled:false});
  assert.ok(commands.includes("BEGIN"));
  assert.ok(commands.includes("COMMIT"));
  assert.ok(commands.some(x=>x.includes("api_spending_enabled=FALSE")));
  assert.ok(commands.some(x=>x.includes("owner.paid_api.emergency_stop")));
  assert.ok(commands.every(x=>!x.includes("api_spending_enabled=TRUE")));
});
