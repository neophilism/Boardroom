import test from "node:test";
import assert from "node:assert/strict";
import type {Pool} from "pg";
import {GitHubAppError,GitHubAppSetupFailure,type githubAppRequest} from "../src/server/github-app.ts";
import {recordGithubMutation,reconcileGithubOperations,githubBlobSha,githubValueDigest,GithubOperationUncertain,
  type GithubOperation,type GithubMutationIntent} from "../src/server/github-operation-ledger.ts";

const target="a".repeat(40),other="b".repeat(40);
const operation:GithubOperation={operationId:"11111111-1111-4111-8111-111111111111",runId:"22222222-2222-4222-8222-222222222222",
  repositoryId:"42",unitId:"BR-035",fullName:"ci/repo",generation:"7"};
const refIntent:GithubMutationIntent={kind:"UPDATE_REF",branch:"boardroom/BR-035",targetSha:target};
function writerFixture(options:{initial?:string;fail?:"before_intent"|"lost_intent_response"|"after_send"}={}){
  let state=options.initial??"CONFIRMED",result:Record<string,unknown>={outcome:"NOT_SENT"},failed=false;
  const writes:unknown[][]=[];
  const db={query:async(sql:string,args:unknown[])=>{
    writes.push(args);
    if(sql.includes("SET state='INTENDED'")){
      if(options.fail==="before_intent")throw new Error("database unavailable before intent");
      if(state!=="CONFIRMED")return {rowCount:0,rows:[]};
      state="INTENDED";result=JSON.parse(args[1] as string);
      if(options.fail==="lost_intent_response")throw new Error("intent acknowledgement lost");
      return {rowCount:1,rows:[]};
    }
    if(sql.includes("SET state=$2")){
      const next=JSON.parse(args[2] as string);
      if(options.fail==="after_send"&&next.outcome==="APPLIED"&&!failed){failed=true;throw new Error("result database unavailable");}
      if(!["INTENDED","UNCERTAIN"].includes(state))return {rowCount:0,rows:[]};
      state=args[1] as string;result=next;return {rowCount:1,rows:[]};
    }
    throw new Error("Unexpected ledger SQL");
  }} as unknown as Pool;
  return {db,writes,state:()=>state,result:()=>result};
}

test("outbound mutation sees durable intent and only bounded outcome metadata is retained",async()=>{
  const f=writerFixture();
  const result=await recordGithubMutation(f.db,operation,refIntent,async()=>{
    assert.equal(f.state(),"INTENDED");
    return {object:{sha:target},source:"not retained",credential:"not retained"};
  });
  assert.equal(result.object.sha,target);assert.equal(f.state(),"CONFIRMED");
  assert.equal(f.result().outcome,"APPLIED");
  assert.ok(!JSON.stringify(f.writes).includes("not retained"));
});

test("database failures before send and a lost intent acknowledgement never send a GitHub mutation",async()=>{
  for(const fail of ["before_intent","lost_intent_response"] as const){
    const f=writerFixture({fail});let sent=0;
    await assert.rejects(recordGithubMutation(f.db,operation,refIntent,async()=>{sent++;return {object:{sha:target}};}));
    assert.equal(sent,0);assert.equal(f.state(),"CONFIRMED");assert.equal(f.result().outcome,"NOT_SENT");
  }
});

test("an existing unresolved attempt cannot be relabeled NOT_SENT or resent",async()=>{
  const f=writerFixture({initial:"UNCERTAIN"});let sent=0;
  await assert.rejects(recordGithubMutation(f.db,operation,refIntent,async()=>{sent++;}),GithubOperationUncertain);
  assert.equal(sent,0);assert.equal(f.state(),"UNCERTAIN");assert.equal(f.writes.length,1);
});

test("definite GitHub refusal and preflight setup failure settle while unknown effects retain a hold",async()=>{
  for(const error of [new GitHubAppError(409),new GitHubAppError(422),new GitHubAppSetupFailure("PRIVATE_KEY_MISSING")]){
    const f=writerFixture();
    await assert.rejects(recordGithubMutation(f.db,operation,refIntent,async()=>{throw error;}));
    assert.equal(f.state(),"CONFIRMED");assert.equal(f.result().outcome,"REJECTED");
  }
  for(const error of [new GitHubAppError(503),new TypeError("network response lost")]){
    const f=writerFixture();
    await assert.rejects(recordGithubMutation(f.db,operation,refIntent,async()=>{throw error;}),GithubOperationUncertain);
    assert.equal(f.state(),"UNCERTAIN");
  }
  const f=writerFixture({fail:"after_send"});
  await assert.rejects(recordGithubMutation(f.db,operation,refIntent,async()=>({object:{sha:target}})),GithubOperationUncertain);
  assert.equal(f.state(),"UNCERTAIN");
});

test("immutable staging uncertainty cannot strand a branch and malformed mutable replies cannot certify success",async()=>{
  for(const kind of ["CREATE_TREE","CREATE_COMMIT"] as const){
    const f=writerFixture();
    await assert.rejects(recordGithubMutation(f.db,operation,{kind},async()=>{throw new GitHubAppError(503);}));
    assert.equal(f.state(),"CONFIRMED");assert.equal(f.result().outcome,"STAGING_ONLY");
  }
  const f=writerFixture();
  await assert.rejects(recordGithubMutation(f.db,operation,{kind:"READY_PR",number:10,headSha:target},
    async()=>({data:{},errors:[{message:"not retained"}]})),GithubOperationUncertain);
  assert.equal(f.state(),"UNCERTAIN");assert.ok(!JSON.stringify(f.writes).includes("not retained"));
});

function reconciliationFixture(intents:(GithubMutationIntent|null)[]){
  const rows=intents.map((intent,i)=>({operation_id:String(i),result:intent?
    {version:1,fullName:"ci/repo",generation:"7",intent,outcome:"UNCONFIRMED"}:null}));
  const settled:string[]=[];
  const db={query:async(sql:string,args:unknown[])=>{
    if(sql.startsWith("SELECT"))return {rows:rows.slice(0,4),rowCount:Math.min(4,rows.length)};
    if(sql.startsWith("UPDATE")){settled.push(args[0] as string);return {rowCount:1,rows:[]};}
    throw new Error("Unexpected reconciliation SQL");
  }} as unknown as Pool;
  return {db,settled};
}
const pull=(number=10)=>({number,head:{sha:target,ref:"boardroom/BR-035",repo:{id:42}},base:{ref:"main",repo:{id:42}}});

test("reconciliation confirms exact ref, content blob, ready PR and merged head without external writes",async()=>{
  for(const [intent,response] of [
    [refIntent,{object:{sha:target}}],
    [{kind:"UPSERT_FILE",branch:"boardroom/BR-035",filePath:"src/a.ts",blobSha:target},{type:"file",sha:target}],
    [{kind:"READY_PR",number:10,headSha:target},{...pull(),draft:false}],
    [{kind:"MERGE_PR",number:10,headSha:target},{...pull(),merged:true,merge_commit_sha:other}]
  ] as [GithubMutationIntent,unknown][]){
    const f=reconciliationFixture([intent]);let calls=0;
    const request:typeof githubAppRequest=async(method,path)=>{
      assert.equal(method,"GET");calls++;return path==="/repos/ci/repo"?{id:42}:response;
    };
    assert.deepEqual(await reconcileGithubOperations(f.db,operation.runId,"42",request),{examined:1,resolved:1,pending:0});
    assert.equal(calls,2);assert.deepEqual(f.settled,["0"]);
  }
});

test("new PR evidence requires the same repository, exact head, branch, base and hashed description",async()=>{
  const intent:GithubMutationIntent={kind:"CREATE_PR",branch:"boardroom/BR-035",base:"main",headSha:target,
    titleDigest:githubValueDigest("BR-035: source change"),bodyDigest:githubValueDigest("Original description")};
  for(const body of ["Original description","Unrelated description"]){
    const f=reconciliationFixture([intent]);
    const request:typeof githubAppRequest=async(_method,path)=>path==="/repos/ci/repo"?{id:42}:
      [{...pull(),title:"BR-035: source change",body}];
    const result=await reconcileGithubOperations(f.db,operation.runId,"42",request);
    assert.equal(result.resolved,body==="Original description"?1:0);
  }
});

test("missing, changed, cross-repository and legacy evidence stay held; staging can settle without GitHub",async()=>{
  const legacy=reconciliationFixture([null,{kind:"CREATE_COMMIT"}]);let calls=0;
  const none:typeof githubAppRequest=async()=>{calls++;throw new Error("No external request expected");};
  assert.deepEqual(await reconcileGithubOperations(legacy.db,operation.runId,"42",none),{examined:2,resolved:1,pending:1});
  assert.equal(calls,0);
  for(const reply of [{object:{sha:other}},new GitHubAppError(404)]){
    const f=reconciliationFixture([refIntent]);
    const request:typeof githubAppRequest=async(_method,path)=>{
      if(path==="/repos/ci/repo")return {id:42};if(reply instanceof Error)throw reply;return reply;
    };
    assert.equal((await reconcileGithubOperations(f.db,operation.runId,"42",request)).pending,1);
    assert.deepEqual(f.settled,[]);
  }
  const f=reconciliationFixture([refIntent]);
  assert.equal((await reconcileGithubOperations(f.db,operation.runId,"42",async()=>({id:99}))).pending,1);
});

test("reconciliation has a total read deadline and late results cannot update the released client",async()=>{
  const f=reconciliationFixture([refIntent]);let release:(value:unknown)=>void=()=>undefined;
  const request:typeof githubAppRequest=()=>new Promise(resolve=>{release=resolve;});
  const start=Date.now(),result=await reconcileGithubOperations(f.db,operation.runId,"42",request,20);
  assert.equal(result.pending,1);assert.ok(Date.now()-start<1000);
  release({id:42});await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(f.settled,[]);
});

test("git content fingerprints use the canonical blob header without retaining source",()=>{
  assert.equal(githubBlobSha(Buffer.from("hello\n").toString("base64")),"ce013625030ba8dba906f756967f9e9ca394464a");
  assert.match(githubValueDigest({source:"private source"}),/^[a-f0-9]{64}$/);
});
