import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMergeEvidence, parseArgs, verifyRemotePR, safeMergePR} from '../scripts/verify-pr-merge.mjs';
const head='a'.repeat(40), mergedSha='b'.repeat(40), repository='neophilism/Project';
const pr={number:4,state:'open',draft:false,head:{sha:head},base:{repo:{full_name:repository}},mergeable:true,mergeable_state:'clean'};
const checks={total_count:1,check_runs:[{head_sha:head,name:'verify',status:'completed',conclusion:'success'}]};
const statuses={total_count:0,statuses:[]};
const requiredChecks=['verify'];
const assess=(patch={})=>assessMergeEvidence({repository,pr,checks,statuses,requiredChecks,expectedSha:head,...patch});
test('passes only a fresh, correctly scoped PR with concrete successful checks',()=>{
 assert.deepEqual(assess().blockers,[]);
 assert.equal(assess().safe,true);
 assert.deepEqual(assess({requiredChecks:[]}).blockers,['REQUIRED_CHECKS_NOT_CONFIGURED']);
 assert.ok(assess({expectedSha:mergedSha}).blockers.includes('HEAD_SHA_MISMATCH'));
 assert.ok(assess({pr:{...pr,draft:true}}).blockers.includes('PR_NOT_READY'));
 assert.ok(assess({pr:{...pr,mergeable_state:'unstable'}}).blockers.includes('GITHUB_MERGE_REQUIREMENTS_UNSATISFIED'));
 assert.ok(assess({pr:{...pr,base:{repo:{full_name:'other/repo'}}}}).blockers.includes('BASE_REPOSITORY_MISMATCH'));
});
test('real check failures are never excused by docs-only PRs, resource limits or other passing checks',()=>{
 for(const conclusion of ['failure','cancelled','timed_out','startup_failure','action_required','skipped','neutral',null]) {
   const bad={total_count:2,check_runs:[...checks.check_runs,{head_sha:head,name:'blocked-resource-job',status:'completed',conclusion}]};
   assert.ok(assess({checks:bad}).blockers.includes('CHECK_NOT_SUCCESSFUL'),conclusion);
 }
 assert.ok(assess({checks:{total_count:1,check_runs:[{...checks.check_runs[0],status:'in_progress',conclusion:null}]}}).blockers.includes('CHECK_NOT_SUCCESSFUL'));
 assert.ok(assess({checks:{total_count:0,check_runs:[]},statuses:{total_count:0,statuses:[]}}).blockers.includes('NO_EXECUTED_CHECK_EVIDENCE'));
 assert.ok(assess({checks:{total_count:2,check_runs:checks.check_runs}}).blockers.includes('CHECK_RUNS_INCOMPLETE'));
 assert.ok(assess({checks:{total_count:1,check_runs:[{...checks.check_runs[0],head_sha:mergedSha}]}}).blockers.includes('CHECK_FOR_DIFFERENT_COMMIT'));
});
test('CircleCI success cannot mask failed GitHub Actions and legacy status failures',()=>{
 const broken={total_count:1,check_runs:[{head_sha:head,name:'github verify',status:'completed',conclusion:'failure'}]};
 const circle={total_count:1,statuses:[{context:'ci/circleci: verify',state:'success'}]};
 assert.ok(assess({checks:broken,statuses:circle,requiredChecks:['ci/circleci: verify']}).blockers.includes('CHECK_NOT_SUCCESSFUL'));
 assert.ok(assess({statuses:{total_count:1,statuses:[{context:'ci/circleci: verify',state:'failure'}]}}).blockers.includes('LEGACY_STATUS_NOT_SUCCESSFUL'));
 assert.ok(assess({requiredChecks:['missing suite']}).blockers.includes('REQUIRED_CHECK_MISSING:missing suite'));
});
test('rejects skipped, pending and incomplete legacy evidence',()=>{
 for(const state of ['pending','failure','error']) assert.ok(assess({statuses:{total_count:1,statuses:[{context:'ci/circleci: test',state}]}}).blockers.includes('LEGACY_STATUS_NOT_SUCCESSFUL'));
 assert.ok(assess({statuses:{statuses:Array.from({length:100},(_,i)=>({context:"status-"+i,state:'success'}))}}).blockers.includes('COMMIT_STATUSES_INCOMPLETE'));
});
test('no merge call if any check failed; safe merge rereads checks and pins SHA',async()=>{
 let reads=0, merges=0, breakSecond=false;
 const request=async(url,init)=>{
  if(init.method==='PUT'){merges++;assert.equal(JSON.parse(init.body).sha,head);return {ok:true,json:async()=>({merged:true,sha:mergedSha})};}
  if(url.includes('/pulls/4'))return {ok:true,json:async()=>pr};
  if(url.includes('/check-runs')){reads++;const body=breakSecond&&reads===2?{total_count:1,check_runs:[{...checks.check_runs[0],conclusion:'failure'}]}:checks;return {ok:true,json:async()=>body};}
  if(url.includes('/status?'))return {ok:true,json:async()=>statuses};
  throw Error('Unexpected request');
 };
 let result=await verifyRemotePR({repository,number:4,requiredChecks,expectedSha:head,token:'fixture',request});
 assert.equal(result.result.safe,true);
 breakSecond=true;reads=0;
 result=await safeMergePR({repository,number:4,requiredChecks,token:'fixture',request});
 assert.equal(result.merged,false);assert.equal(merges,0);assert.equal(reads,2);
 breakSecond=false;reads=0;
 result=await safeMergePR({repository,number:4,requiredChecks,token:'fixture',request});
 assert.equal(result.merged,true);assert.equal(merges,1);assert.equal(reads,2);
});
test('CLI requires an actual check name and optionally an immutable SHA',()=>{
 assert.deepEqual(parseArgs(['--repo',repository,'--pr','4','--require','ci/circleci: test','--merge']),{repository,number:4,requiredChecks:['ci/circleci: test'],merge:true});
 assert.throws(()=>parseArgs(['--repo',repository,'--pr','4']),/required real check/i);
 assert.throws(()=>parseArgs(['--repo',repository,'--pr','-1','--require','verify']),/Usage:/);
});
