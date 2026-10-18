import test from "node:test";
import assert from "node:assert/strict";
import {mergeBlockers,aggregateLinkedPrState,mergeDenialAuditDetails,type MergeFacts} from "../src/server/merge-policy.ts";
import {classifyChangedFiles,isSensitivePath} from "../src/server/change-review.ts";

const suite={id:2,status:"completed",conclusion:"success",app:{name:"Actions"}} as const;
const facts:MergeFacts={
  draft:false,state:"open",headSha:"a".repeat(40),expectedSha:"a".repeat(40),
  branch:"boardroom/BR-038",expectedBranch:"boardroom/BR-038",
  repositoryId:"1",expectedRepositoryId:"1",
  mergeable:"MERGEABLE",mergeStateStatus:"CLEAN",
  checks:[{id:1,name:"verify",status:"completed",conclusion:"success"}],
  checkTotal:1,suites:[suite],suiteTotal:1,statuses:[]
};
const policy={auto_merge:true,required_checks:["verify"]};

test("current-head CI and actual GitHub merge requirements determine merge eligibility",()=>{
  assert.deepEqual(mergeBlockers(policy,facts),[]);
  for(const patch of [{auto_merge:false},{required_checks:[]},{required_checks:["security"]}])
    assert.ok(mergeBlockers({...policy,...patch},facts).length);
  for(const patch of [
    {draft:true},{state:"closed"},{expectedSha:"b".repeat(40)},{repositoryId:"2"},
    {mergeable:"CONFLICTING"},{mergeable:"UNKNOWN"},{mergeStateStatus:"BLOCKED"},
    {checkTotal:2},{checks:[]},{suiteTotal:2},{suites:[{...suite,conclusion:"failure"}]}
  ])
    assert.ok(mergeBlockers(policy,{...facts,...patch}).length);
});

test("queued, failed, and truncated check suites block merges",()=>{
  const checks=[{...facts.checks[0],check_suite:{id:2},app:{id:15368,slug:"github-actions"}}];
  const healthy={...facts,checks,suites:[suite,{id:3,status:"queued",conclusion:null,latest_check_runs_count:0,
    app:{id:14658,slug:"render"}}],suiteTotal:2};
  assert.deepEqual(mergeBlockers(policy,healthy),[]);
  assert.ok(mergeBlockers({...policy,required_checks:["verify","Render"]},healthy)
    .includes("REQUIRED_CHECK_MISSING"));
  assert.ok(mergeBlockers(policy,{...healthy,suites:[{...suite,conclusion:"failure"}],suiteTotal:1})
    .includes("CHECKS_NOT_PASSING"));
  assert.ok(mergeBlockers(policy,{...healthy,suites:[{...suite,status:"in_progress",conclusion:null}],suiteTotal:1})
    .includes("CHECKS_NOT_PASSING"));
  assert.ok(mergeBlockers(policy,{...facts,suiteTotal:2}).includes("CHECKS_NOT_PASSING"));
});

test("sensitive files add no independent human-review prerequisite",()=>{
  for(const filename of [
    "src/server/merge-policy.ts","src/server/oauth.ts",".github/workflows/ci.yml",
    "db/migrations/0019_new.sql","render.yaml","src/server/risk-approval.ts",
    "src/server/owner-session.ts","src/server/agent-tools.ts","src/server/github-app.ts",
    "app/api/v1/internal/tick/route.ts","infra/main.tf"
  ]){
    assert.ok(isSensitivePath(filename),filename);
    assert.equal(classifyChangedFiles([{filename,status:"modified"}],1),"REVIEW_REQUIRED",filename);
    assert.deepEqual(mergeBlockers(policy,facts),[],filename);
  }
  assert.equal(classifyChangedFiles([{
    filename:"src/domain/work-board.ts",previous_filename:"src/server/owner-auth.ts",status:"renamed"
  }],1),"REVIEW_REQUIRED");
  // If GitHub actually requires approval, it reports a blocked merge state.
  assert.ok(mergeBlockers(policy,{...facts,mergeStateStatus:"BLOCKED"})
    .includes("GITHUB_MERGE_REQUIREMENTS_UNSATISFIED"));
});

test("file-list classification remains fail-closed as advisory evidence, not a merge gate",()=>{
  const f=[{filename:"src/domain/work-board.ts",status:"modified"}];
  assert.equal(classifyChangedFiles(f,1),"ROUTINE");
  for(const [files,count] of [[f,2],[f,null],[[],0],[null,1],
    [[{filename:"src/domain/work-board.ts",status:"renamed"}],1],
    [[{filename:"src/domain/work-board.ts",status:"invented"}],1],
    [[{filename:"../escape",status:"modified"}],1]] as const)
    assert.equal(classifyChangedFiles(files,count),"UNVERIFIED");
  assert.deepEqual(mergeBlockers(policy,facts),[]);
});

test("one merged PR cannot complete a unit with another open or missing linked PR",()=>{
  const open={number:2,title:"BR-038: follow-up",state:"open" as const,created_at:"2026-10-12T00:00:00Z",
    merged_at:null,updated_at:"2026-10-12T00:00:00Z"};
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[open],1),"OPEN_PR");
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[],1),"UNKNOWN");
  assert.equal(aggregateLinkedPrState("BR-038",[1,2],[{...open,state:"closed",merged_at:"2026-10-12T00:00:00Z"}],1),"MERGED");
});

test("denied merges retain minimal auditable blocker codes",()=>{
  assert.deepEqual(mergeDenialAuditDetails("BR-038",42,facts.headSha,
    ["HEAD_CHANGED","REQUIRED_CHECK_MISSING","HEAD_CHANGED"]),{
    unitId:"BR-038",number:42,headSha:facts.headSha,
    reasons:["HEAD_CHANGED","REQUIRED_CHECK_MISSING"]
  });
});
