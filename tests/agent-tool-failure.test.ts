import test from "node:test";
import assert from "node:assert/strict";
import {agentToolFailure} from "../src/server/agent-tool-failure.ts";
import {SessionConflict,ContinuationRequired,ReleaseReconciliationRequired} from "../src/server/sessions.ts";
import {AssignmentConflict} from "../src/server/assignment.ts";
import {GitHubAppError,GitHubAppSetupFailure} from "../src/server/github-app.ts";
import {GithubWriteValidation} from "../src/server/github-write-gateway.ts";
import {RunnerBudgetBlocked} from "../src/server/budget-errors.ts";
import {GithubOperationUncertain} from "../src/server/github-operation-ledger.ts";

test("agents receive exact merge blockers and a useful recovery action",()=>{
  const result=agentToolFailure(new SessionConflict("Merge blocked: OWNER_MERGE_POLICY_REQUIRED, CURRENT_HEAD_APPROVAL_REQUIRED"));
  assert.equal(result.isError,true);
  assert.equal(result.structuredContent.error.code,"MERGE_BLOCKED");
  assert.match(result.structuredContent.error.message,/CURRENT_HEAD_APPROVAL_REQUIRED/);
  assert.match(result.structuredContent.error.nextAction,/Owner Action/);
  assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent.error);
});
test("expired leases, owner pauses and spending limits never suggest blind retry",()=>{
  for(const [error,code] of [
    [new SessionConflict("Lease expired; recovery required"),"SESSION_CONFLICT"],
    [new AssignmentConflict("This run cannot claim an assignment"),"SESSION_CONFLICT"],
    [new SessionConflict("Owner paused execution"),"EXECUTION_PAUSED"],
    [new SessionConflict("Session time budget exhausted; checkpoint and finish"),"SESSION_LIMIT"],
    [new RunnerBudgetBlocked("BUDGET_LIMIT"),"BUDGET_LIMIT"]
  ] as const){const result=agentToolFailure(error).structuredContent.error;assert.equal(result.code,code);assert.equal(result.retryable,false);}
});
test("GitHub conflicts preserve the need to reconcile an interrupted successful write",()=>{
  const conflict=agentToolFailure(new GitHubAppError(409)).structuredContent.error;
  assert.equal(conflict.code,"GITHUB_CONFLICT");assert.match(conflict.nextAction,/observed SHA/);
  assert.equal(agentToolFailure(new GitHubAppError(403)).structuredContent.error.retryable,false);
  assert.equal(agentToolFailure(new GitHubAppError(503)).structuredContent.error.retryable,true);
  assert.match(agentToolFailure(new GitHubAppSetupFailure("PRIVATE_KEY_INVALID")).content[0].text,/PRIVATE_KEY_INVALID/);
  assert.equal(agentToolFailure(new GithubWriteValidation("Protected path requires owner authorization")).structuredContent.error.code,"INPUT_REJECTED");
});
test("unknown provider and database exceptions never disclose raw details",()=>{
  for(const error of [new Error("postgres://user:password@private-db/internal"),{message:"secret",stack:"secret"},"secret",null]){
    const result=agentToolFailure(error);
    assert.equal(result.structuredContent.error.code,"SERVICE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(result),/password|private-db|stack|secret/);
  }
});

test("mapping failures direct a unit handoff without ending the activation",async()=>{
  const {WorkMappingConflict}=await import("../src/server/work-branch.ts");
  const result=agentToolFailure(new WorkMappingConflict("PR is not linked to the assigned approved work unit in this repository")).structuredContent.error;
  assert.equal(result.code,"PR_MAPPING_CONFLICT");assert.equal(result.retryable,false);
  assert.match(result.nextAction,/boardroom_yield_and_claim/);
  assert.match(result.nextAction,/boardroom_advance/);
});

test("premature finish is a workflow continuation, not an authority failure",()=>{
  const result=agentToolFailure(new ContinuationRequired()).structuredContent.error;
  assert.equal(result.code,"CONTINUATION_REQUIRED");assert.equal(result.retryable,false);
  assert.match(result.nextAction,/assignment was not released/);
  assert.match(result.nextAction,/Continue useful implementation, testing or CI repair/);
  assert.match(result.nextAction,/boardroom_advance/);
  assert.match(result.nextAction,/activationStop/);
  assert.match(result.nextAction,/USER_STOP/);
  assert.doesNotMatch(result.nextAction,/request.*owner.*approval/i);
});

test("an ambiguous remote effect stops execution and retains a hold rather than demanding continuation",()=>{
  const operationId="26741e83-9694-4fb3-8174-783b2f9bf61c";
  const result=agentToolFailure(new ReleaseReconciliationRequired(operationId)).structuredContent.error;
  assert.equal(result.code,"RELEASE_RECONCILIATION_REQUIRED");assert.equal(result.retryable,false);
  assert.match(result.message,new RegExp(operationId));
  assert.match(result.nextAction,/Stop this activation now/);
  assert.match(result.nextAction,/Do not continue work, renew the heartbeat, repeat the mutation/);
  assert.doesNotMatch(result.nextAction,/boardroom_advance|CONTINUATION_REQUIRED/);
});

test("an uncertain mutation is distinguished from a fenced release hold",()=>{
  const result=agentToolFailure(new GithubOperationUncertain("26741e83-9694-4fb3-8174-783b2f9bf61c")).structuredContent.error;
  assert.equal(result.code,"GITHUB_OPERATION_UNCERTAIN");assert.equal(result.retryable,false);
  assert.match(result.nextAction,/mutation may have succeeded/);
  assert.match(result.nextAction,/boardroom_source or boardroom_pr_evidence/);
  assert.match(result.nextAction,/Do not repeat the mutation/);
  assert.doesNotMatch(result.nextAction,/Boardroom fenced|Stop this activation now/);
});
