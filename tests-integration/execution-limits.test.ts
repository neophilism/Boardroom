import test,{after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {setExecutionPolicy} from "../src/server/operations.ts";
const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Policy fixtures require the explicit boardroom_test database");
const db=new Pool({connectionString:url,max:2});after(async()=>db.end());
test("private policy updates persist caps and merge-only requests preserve them",async()=>{
  const repositoryId="960000001";
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at,enabled) VALUES($1,'ci/limits',now(),FALSE)",[repositoryId]);
  const policy={repositoryId,autoMerge:false,requiredChecks:[],maxSessionSeconds:600,maxToolCalls:25,maxTokens:20000};
  await setExecutionPolicy(db,policy);
  await setExecutionPolicy(db,{repositoryId,autoMerge:false,requiredChecks:[],minimumReviews:1});
  const row=(await db.query("SELECT max_session_seconds,max_tool_calls,max_tokens,minimum_reviews FROM repository_execution_policy WHERE repository_id=$1",[repositoryId])).rows[0];
  assert.deepEqual(row,{max_session_seconds:600,max_tool_calls:25,max_tokens:20000,minimum_reviews:1});
});
