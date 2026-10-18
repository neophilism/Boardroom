import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../db/migration-manifest.ts";
import {prepareGithubOperation,recordGithubMutation,githubOperationWriter,closeGithubOperationWriter,
  reconcileGithubOperations,GithubOperationUncertain} from "../src/server/github-operation-ledger.ts";
import {performFencedGithubWrite} from "../src/server/github-write-gateway.ts";
import {mergeAssignedPullRequest} from "../src/server/merge-policy.ts";
import {GitHubAppError,type githubAppRequest} from "../src/server/github-app.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))throw new Error("Ledger fixtures require an isolated boardroom_test database");
const schema="github_ledger_"+randomUUID().replaceAll("-","");
const admin=new Pool({connectionString:url,max:1});let db:Pool;let sequence=0;
const target="a".repeat(40),oldHead="b".repeat(40);
before(async()=>{
  await admin.query('CREATE SCHEMA "'+schema+'"');
  // One application connection proves durable writes do not wait behind the
  // application's own lease transaction for another main-pool connection.
  db=new Pool({connectionString:url,max:1,options:'-c search_path='+schema+',public'});
  for(const migration of MIGRATION_MANIFEST)await db.query(await readFile(new URL("../db/migrations/"+migration.filename,import.meta.url),"utf8"));
  await db.query("CREATE TABLE ledger_fault(mode TEXT)");
  await db.query("INSERT INTO ledger_fault VALUES(NULL)");
  await db.query(`CREATE FUNCTION reject_ledger_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE fault TEXT; BEGIN SELECT mode INTO fault FROM ledger_fault;
      IF (fault='INTENDED' AND NEW.state='INTENDED') OR (fault='APPLIED' AND NEW.result->>'outcome'='APPLIED')
      THEN RAISE EXCEPTION 'injected ledger database failure'; END IF; RETURN NEW; END $$`);
  await db.query("CREATE TRIGGER ledger_fault BEFORE UPDATE ON github_operations FOR EACH ROW EXECUTE FUNCTION reject_ledger_transition()");
  await db.query(`CREATE FUNCTION reject_write_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF EXISTS(SELECT 1 FROM ledger_fault WHERE mode='AUDIT') AND NEW.kind LIKE 'github.%'
      THEN RAISE EXCEPTION 'injected outer audit failure'; END IF; RETURN NEW; END $$`);
  await db.query("CREATE TRIGGER write_audit_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_write_audit()");
});
after(async()=>{
  if(db){await closeGithubOperationWriter(db);await db.end();}
  await admin.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await admin.end();
});

async function fixture(){
  const n=++sequence,repositoryId=String(975000000+n),fullName="ci/ledger-"+n;
  await db.query("UPDATE ledger_fault SET mode=NULL");
  await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,$2,now())",[repositoryId,fullName]);
  await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,source_metadata) VALUES($1,'BR-035','Ledger fixture',1,TRUE,$2::jsonb)",
    [repositoryId,JSON.stringify({id:"BR-035",prs:[]})]);
  const credentialId=(await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'chatgpt',$2) RETURNING credential_id",
    ["Ledger fixture "+n,createHash("sha256").update(schema+n).digest("hex")])).rows[0].credential_id;
  const runId=(await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state) VALUES('chatgpt',$1,'RUNNING') RETURNING run_id",[credentialId])).rows[0].run_id;
  await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,assigned_at,last_heartbeat_at,expires_at) VALUES($1,$2,7,now(),now(),now()+interval '3 minutes')",[repositoryId,runId]);
  await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,7,'BR-035')",[repositoryId,runId]);
  return {runId,credentialId,repositoryId,fullName};
}
function githubFixture(f:Awaited<ReturnType<typeof fixture>>,options:{lostResponse?:boolean;refusal?:boolean;onSend?:()=>Promise<void>}={}){
  let created=false,writes=0;
  const request:typeof githubAppRequest=async(method,path)=>{
    const api="/repos/"+f.fullName;
    if(method==="GET"&&path===api)return {id:Number(f.repositoryId),default_branch:"main"};
    if(method==="GET"&&path===api+"/git/ref/heads/main")return {object:{sha:target}};
    if(method==="GET"&&path===api+"/git/ref/heads/boardroom/BR-035"){
      if(!created)throw new GitHubAppError(404);return {object:{sha:target}};
    }
    if(method==="POST"&&path===api+"/git/refs"){
      writes++;await options.onSend?.();
      if(options.refusal)throw new GitHubAppError(422);
      created=true;if(options.lostResponse)throw new TypeError("lost GitHub response");
      return {object:{sha:target}};
    }
    if(method==="GET"&&path===api+"/git/ref/heads/boardroom%2FBR-035")return {object:{sha:created?target:oldHead}};
    throw new Error("Unexpected isolated GitHub fixture request");
  };
  return {request,writes:()=>writes,created:()=>created};
}
const ledgerFor=async(runId:string)=>(await db.query<{state:string;result:{outcome:string;intent?:unknown};request_digest:string}>(
  "SELECT state,result,request_digest FROM github_operations WHERE run_id=$1 ORDER BY created_at",[runId])).rows;

test("ledger intent and confirmed outcome survive caller rollback while run and lease locks are held",async()=>{
  const f=await fixture(),client=await db.connect();
  try{
    const operation=await prepareGithubOperation(client,f.runId,f.credentialId,"7",{content:"private source is hashed only"});
    await client.query("BEGIN");
    await client.query("SELECT run_id FROM agent_runs WHERE run_id=$1 FOR UPDATE",[f.runId]);
    await client.query("SELECT repository_id FROM repository_leases WHERE repository_id=$1 FOR UPDATE",[f.repositoryId]);
    await recordGithubMutation(githubOperationWriter(db),operation,{kind:"UPDATE_REF",branch:"boardroom/BR-035",targetSha:target},async()=>{
      const row=(await client.query("SELECT state FROM github_operations WHERE operation_id=$1",[operation.operationId])).rows[0];
      assert.equal(row.state,"INTENDED");return {object:{sha:target}};
    });
    await client.query("ROLLBACK");
  }finally{client.release();}
  const [row]=await ledgerFor(f.runId);assert.equal(row.state,"CONFIRMED");assert.equal(row.result.outcome,"APPLIED");
  assert.ok(!JSON.stringify(row).includes("private source"));assert.match(row.request_digest,/^[a-f0-9]{64}$/);
});

test("a real database failure saving intent prevents the outbound mutation and leaves no recovery hold",async()=>{
  const f=await fixture(),remote=githubFixture(f);await db.query("UPDATE ledger_fault SET mode='INTENDED'");
  await assert.rejects(performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request),/injected ledger database failure/);
  await db.query("UPDATE ledger_fault SET mode=NULL");
  assert.equal(remote.writes(),0);
  const [row]=await ledgerFor(f.runId);assert.equal(row.state,"CONFIRMED");assert.equal(row.result.outcome,"NOT_SENT");
});

test("a real database failure after GitHub success leaves durable uncertainty and exact-head reconciliation resolves it",async()=>{
  const f=await fixture(),remote=githubFixture(f);await db.query("UPDATE ledger_fault SET mode='APPLIED'");
  await assert.rejects(performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request),GithubOperationUncertain);
  await db.query("UPDATE ledger_fault SET mode=NULL");
  assert.equal(remote.created(),true);assert.equal((await ledgerFor(f.runId))[0].state,"UNCERTAIN");
  const client=await db.connect();
  try{
    await client.query("BEGIN");await client.query("SELECT repository_id FROM repository_leases WHERE repository_id=$1 FOR UPDATE",[f.repositoryId]);
    assert.deepEqual(await reconcileGithubOperations(client,f.runId,f.repositoryId,remote.request),{examined:1,resolved:1,pending:0});
    await client.query("COMMIT");
  }finally{client.release();}
  assert.equal((await ledgerFor(f.runId))[0].state,"CONFIRMED");assert.equal(remote.writes(),1);
});

test("outer audit rollback cannot erase a successfully applied external operation",async()=>{
  const f=await fixture(),remote=githubFixture(f);await db.query("UPDATE ledger_fault SET mode='AUDIT'");
  await assert.rejects(performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request),/injected outer audit failure/);
  await db.query("UPDATE ledger_fault SET mode=NULL");
  assert.equal(remote.created(),true);assert.equal((await ledgerFor(f.runId))[0].state,"CONFIRMED");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM audit_events WHERE run_id=$1",[f.runId])).rows[0].n,0);
});

test("a lost response cannot be hidden by retrying a different new write in the same live run",async()=>{
  const f=await fixture(),remote=githubFixture(f,{lostResponse:true});
  await assert.rejects(performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request),GithubOperationUncertain);
  const unverifiable:typeof githubAppRequest=async(method,path,body)=>path.includes("boardroom%2FBR-035")?
    {object:{sha:oldHead}}:remote.request(method,path,body);
  await assert.rejects(performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},unverifiable),GithubOperationUncertain);
  assert.equal(remote.writes(),1);assert.equal((await ledgerFor(f.runId)).filter(row=>row.state==="UNCERTAIN").length,1);
  await performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request);
  assert.equal(remote.writes(),1);assert.ok((await ledgerFor(f.runId)).every(row=>row.state==="CONFIRMED"));
});

test("write and finisher lock ordering cannot deadlock the post-write audit foreign key",async()=>{
  const f=await fixture();let enter:()=>void=()=>undefined,release:()=>void=()=>undefined;
  const entered=new Promise<void>(resolve=>{enter=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
  const remote=githubFixture(f,{onSend:async()=>{enter();await resume;}});
  const finishDb=new Pool({...db.options,max:1,application_name:"ledger_test_finisher"});
  const write=performFencedGithubWrite(db,f.runId,f.credentialId,"7",{kind:"ensure_branch"},remote.request);
  await entered;
  const finish=(async()=>{
    const client=await finishDb.connect();
    try{
      await client.query("BEGIN");await client.query("SET LOCAL statement_timeout='2s'");
      await client.query("SELECT run_id FROM agent_runs WHERE run_id=$1 FOR UPDATE",[f.runId]);
      await client.query("SELECT repository_id FROM repository_leases WHERE repository_id=$1 FOR UPDATE",[f.repositoryId]);
      await client.query("COMMIT");
    }finally{client.release();}
  })();
  await new Promise(resolve=>setTimeout(resolve,30));release();
  try{await Promise.all([write,finish]);}finally{await finishDb.end();}
  assert.equal(remote.writes(),1);assert.equal((await ledgerFor(f.runId))[0].state,"CONFIRMED");
});

test("merge transport is recorded only after current-head checks and survives post-merge SQL rollback",async()=>{
  const f=await fixture();let merged=false;
  await db.query("INSERT INTO repository_execution_policy(repository_id,auto_merge,required_checks) VALUES($1,TRUE,'[\"verify\"]')",[f.repositoryId]);
  const request:typeof githubAppRequest=async(method,path)=>{
    if(method==="GET"&&path.endsWith("/pulls/10"))return {number:10,state:"open",draft:false,merged:false,
      head:{sha:target,ref:"boardroom/BR-035",repo:{id:Number(f.repositoryId)}},base:{repo:{id:Number(f.repositoryId)}},html_url:"https://github.com/"+f.fullName+"/pull/10"};
    if(method==="POST"&&path==="/graphql")return {data:{repository:{pullRequest:{mergeable:"MERGEABLE",mergeStateStatus:"CLEAN",headRefOid:target}}}};
    if(path.includes("check-runs"))return {total_count:1,check_runs:[{id:1,name:"verify",status:"completed",conclusion:"success"}]};
    if(path.includes("check-suites"))return {total_count:0,check_suites:[]};
    if(path.includes("/status"))return {total_count:0,statuses:[]};
    if(method==="PUT"&&path.endsWith("/merge")){merged=true;return {merged:true,sha:oldHead};}
    throw new Error("Unexpected isolated merge request");
  };
  await db.query("UPDATE ledger_fault SET mode='AUDIT'");
  await assert.rejects(mergeAssignedPullRequest(db,f.runId,f.credentialId,"7",10,target,request,async()=>[]),/injected outer audit failure/);
  await db.query("UPDATE ledger_fault SET mode=NULL");
  assert.equal(merged,true);const [row]=await ledgerFor(f.runId);assert.equal(row.state,"CONFIRMED");
  assert.equal((row.result.intent as {kind:string}).kind,"MERGE_PR");
});
