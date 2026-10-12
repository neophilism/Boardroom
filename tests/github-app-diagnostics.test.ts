import test from "node:test";
import assert from "node:assert/strict";
import {GitHubAppSetupFailure,GitHubAppError} from "../src/server/github-app.ts";
import {classifyGitHubConnectionIssue} from "../src/server/system-status.ts";
import {GITHUB_APP_DIAGNOSTICS,githubDiagnosticHint} from "../src/domain/github-setup-hints.ts";

test("server classifies signing and installation failures without showing raw errors",()=>{
  for(const code of ["APP_ID_MISSING","APP_ID_INVALID","INSTALLATION_ID_MISSING",
    "INSTALLATION_ID_INVALID","PRIVATE_KEY_MISSING","PRIVATE_KEY_INVALID",
    "APP_AUTH_REJECTED","INSTALLATION_NOT_FOUND","INSTALLATION_FORBIDDEN",
    "GITHUB_TEMPORARILY_UNAVAILABLE","GITHUB_NETWORK_ERROR",
    "INSTALLATION_RESPONSE_INVALID"] as const){
    const e=new GitHubAppSetupFailure(code);
    assert.equal(classifyGitHubConnectionIssue(e),code);
    assert.ok(githubDiagnosticHint(code)?.length);
  }
});

test("GitHub API failure statuses map to actionable bounded diagnostics",()=>{
  assert.equal(classifyGitHubConnectionIssue(new GitHubAppError(401)),"APP_AUTH_REJECTED");
  assert.equal(classifyGitHubConnectionIssue(new GitHubAppError(403)),"REPOSITORY_API_REJECTED");
  assert.equal(classifyGitHubConnectionIssue(new GitHubAppError(404)),"REPOSITORY_API_REJECTED");
  assert.equal(classifyGitHubConnectionIssue(new GitHubAppError(502)),"GITHUB_TEMPORARILY_UNAVAILABLE");
  assert.equal(classifyGitHubConnectionIssue(new Error("Token secret should never be shown")),"UNKNOWN");
});

test("owner guidance does not echo secret-bearing provider error messages",()=>{
  const marker="FAKE_PRIVATE_KEY_DO_NOT_SHOW";
  const diagnostic=classifyGitHubConnectionIssue(new Error(marker));
  assert.equal(diagnostic,"UNKNOWN");
  assert.ok(!githubDiagnosticHint(diagnostic)?.includes(marker));
  for(const hint of Object.values(GITHUB_APP_DIAGNOSTICS)){
    assert.ok(!hint.includes("Bearer "));
    assert.ok(!hint.includes("-----BEGIN PRIVATE KEY-----"));
  }
});
