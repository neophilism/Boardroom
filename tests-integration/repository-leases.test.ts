import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {claimAssignment,type ClaimedAssignment} from "../src/server/assignment.ts";
import {heartbeatRun,saveCheckpoint,finishRun,SessionConflict} from "../src/server/sessions.ts";
import {finishIdleSession} from "../src/server/idle-session.ts";
import {admitAgentRun} from "../src/server/admission.ts";
import {reserveRunnerBudget,recordRunnerUsage} from "../src/server/usage.ts";
import {RunnerBudgetBlocked} from "../src/server/budget-errors.ts";
import {performFencedGithubWrite} from "../src/server/github-write-gateway.ts";
import {advanceAssignedWork} from "../src/server/chain.ts";

const url=process.env.DATABASE_URL;
if(!url||!url.includes("boardroom_test"))
  throw new Error("Refusing to run integration fixtures outside an explicitly named boardroom_test database");

const db=new Pool({connectionString:url,max:8});
const credentials:string[]=[];
const runs:string[]=[];
const repoIds=["920000001","920000002"];
let assigned:ClaimedAssignment[]=[];

before(async()=>{
  await db.query(
    "INSERT INTO repositories(repository_id,full_name,enabled,archived,created_at,last_development_at) "+
    "VALUES($1,'ci/oldest',TRUE,FALSE,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),"+
    "($2,'ci/priority',TRUE,FALSE,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z')",
    repoIds
  );
  await db.query(
    "INSERT INTO repository_leases(repository_id,generation) VALUES ($1,0),($2,0)",repoIds
  );
  await db.query(
    "INSERT INTO repository_priority(repository_id,position) VALUES($1,1)",[repoIds[1]]
  );
  await db.query(
    "INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) "+
    "VALUES($1,'CI-001','Oldest fixture',1,TRUE,'PENDING'),"+
    "($2,'CI-002','Priority fixture',1,TRUE,'PENDING')",
    repoIds
  );
  await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) VALUES($1,now(),'VERIFIED'),($2,now(),'VERIFIED')",repoIds);
  for(const [i,name] of ["Smith","Eve","Gort","C-3PO"].entries()){
    const key=String(i+1).repeat(64);
    const result=await db.query<{credential_id:string}>(
      "INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",
      [name,key]
    );
    credentials.push(result.rows[0].credential_id);
  }
  for(let i=0;i<3;i++){
    const result=await db.query<{run_id:string}>(
      "INSERT INTO agent_runs(provider,activation_source,credential_id) VALUES('test',$1,$2) RETURNING run_id",
      [["Smith","Eve","Gort"][i],credentials[i]]
    );
    runs.push(result.rows[0].run_id);
  }
});
after(async()=>{await db.end();});

test("identical workflow activations from distinct credentials receive independent runs",async()=>{
  const created=await Promise.all([
    db.query<{credential_id:string}>(
      "INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Admission A','test',$1) RETURNING credential_id",
      ["a".repeat(64)]
    ),
    db.query<{credential_id:string}>(
      "INSERT INTO agent_credentials(label,provider,token_digest) VALUES('Admission B','test',$1) RETURNING credential_id",
      ["b".repeat(64)]
    )
  ]);
  const principals=created.map((result,index)=>({
    credentialId:result.rows[0].credential_id,
    label:index===0?"Admission A":"Admission B",
    provider:"test"
  }));
  const admitted=await Promise.all(principals.map(principal=>admitAgentRun(db,principal,null)));
  assert.ok(admitted.every(result=>result.kind==="CREATED"));
  const runIds=admitted.map(result=>{
    if(result.kind!=="CREATED")throw new Error("Expected independent admission");
    return result.runId;
  });
  assert.equal(new Set(runIds).size,2);
  const rows=await db.query<{run_id:string;credential_id:string}>(
    "SELECT run_id::text,credential_id::text FROM agent_runs WHERE run_id=ANY($1::uuid[])",
    [runIds]
  );
  assert.deepEqual(new Set(rows.rows.map(row=>row.credential_id)),new Set(principals.map(p=>p.credentialId)));
  await db.query(
    "UPDATE agent_runs SET state='CANCELLED',ended_at=now() WHERE run_id=ANY($1::uuid[])",
    [runIds]
  );
});

test("two concurrent sessions claim distinct repositories with top priority included",async()=>{
  const results=await Promise.all([
    claimAssignment(db,runs[0],credentials[0]),
    claimAssignment(db,runs[1],credentials[1])
  ]);
  assert.ok(results[0]);
  assert.ok(results[1]);
  assigned=results as ClaimedAssignment[];
  assert.deepEqual(new Set(assigned.map(a=>a.repositoryId)),new Set(repoIds));
  assert.equal(assigned.filter(a=>a.repositoryId===repoIds[1]).length,1);
  assert.equal(assigned.filter(a=>a.repositoryId===repoIds[0]).length,1);
  assert.ok(assigned.every(a=>!a.replay));
});

test("current owner may heartbeat/checkpoint, but stale lease generations fail closed",async()=>{
  const grant=assigned[0];
  const renewal=await heartbeatRun(db,runs[0],credentials[0],grant.generation);
  // Native clients can spend several minutes in a single model/tool turn.
  // The lease must provide headroom without changing the 55-minute run cap.
  assert.ok(Date.parse(renewal)-Date.now()>11*60*1000);
  assert.ok(Date.parse(renewal)-Date.now()<=12*60*1000);
  const stored=await saveCheckpoint(db,runs[0],credentials[0],grant.generation,{
    branch:"boardroom/CI-001",headSha:null,state:{checkpoint:"recorded",evidence:["real postgres"]}
  });
  assert.match(stored,/^[0-9a-f-]{36}$/i);
  const stale=(BigInt(grant.generation)+1n).toString();
  await assert.rejects(heartbeatRun(db,runs[0],credentials[0],stale),SessionConflict);
  const results=await db.query<{number:string}>(
    "SELECT COUNT(*)::text AS number FROM checkpoints WHERE run_id=$1",[runs[0]]
  );
  assert.equal(results.rows[0].number,"1");
});

test("privileged writes reject wrong credentials and stale generations before GitHub access",async()=>{
  const grant=assigned[0];
  await assert.rejects(
    performFencedGithubWrite(db,runs[0],credentials[1],grant.generation,{kind:"ensure_branch"}),
    SessionConflict
  );
  await assert.rejects(
    performFencedGithubWrite(db,runs[0],credentials[0],(BigInt(grant.generation)+1n).toString(),{kind:"ensure_branch"}),
    SessionConflict
  );
  const audits=await db.query<{n:string}>(
    "SELECT COUNT(*)::text AS n FROM audit_events WHERE run_id=$1 AND kind LIKE 'github.write.%'",[runs[0]]
  );
  assert.equal(audits.rows[0].n,"0");
});

test("expired but still assigned repo stays unavailable to other scheduled agents",async()=>{
  const grant=assigned[1];
  await db.query(
    "UPDATE repository_leases SET expires_at=now()-interval '2 seconds' WHERE repository_id=$1",
    [grant.repositoryId]
  );
  const result=await claimAssignment(db,runs[2],credentials[2]);
  assert.equal(result,null);
  const count=await db.query<{n:string}>(
    "SELECT COUNT(*)::text AS n FROM work_assignments WHERE repository_id=ANY($1::bigint[]) AND released_at IS NULL",
    [repoIds]
  );
  assert.equal(count.rows[0].n,"2");
  const idle=await finishIdleSession(db,runs[2],credentials[2]);
  assert.equal(idle.state,"YIELDED");
});

test("fenced owner completes and releases, then a distinct activation becomes eligible",async()=>{
  for(let i=0;i<2;i++){
    await db.query("UPDATE agent_runs SET started_at=now()-interval '50 minutes' WHERE run_id=$1",[runs[i]]);
    const result=await finishRun(db,runs[i],credentials[i],assigned[i].generation,"COMPLETED");
    assert.equal(result.state,"COMPLETED");
    assert.equal(result.replay,false);
  }
  const outstanding=await db.query<{n:string}>(
    "SELECT COUNT(*)::text AS n FROM repository_leases WHERE repository_id=ANY($1::bigint[]) AND run_id IS NOT NULL",
    [repoIds]
  );
  assert.equal(outstanding.rows[0].n,"0");
  const result=await admitAgentRun(db,
    {credentialId:credentials[3],label:"C-3PO",provider:"test"},null);
  assert.equal(result.kind,"CREATED");
  if(result.kind!=="CREATED")throw new Error("Expected new session");
  const claim=await claimAssignment(db,result.runId,credentials[3]);
  assert.equal(claim?.repositoryId,repoIds[1],"Highest-priority repo wins after release");
});

test("500 named activations contend for 50 repos without duplicate ownership",async()=>{
  const {readFile}=await import("node:fs/promises");
  const {createHash}=await import("node:crypto");
  const roster=JSON.parse(await readFile(new URL("../registry/agent-names.json",import.meta.url),"utf8")) as {names:string[]};
  const names=roster.names.filter(n=>!["Smith","Eve","Gort","C-3PO"].includes(n)).slice(0,500);
  await db.query("UPDATE repositories SET enabled=FALSE WHERE repository_id=ANY($1::bigint[])",[repoIds]);
  const stressIds=Array.from({length:50},(_,i)=>String(920001000+i));
  for(const [i,id] of stressIds.entries()){
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,$2,now())",[id,"ci/stress-"+i]);
    await db.query("INSERT INTO repository_leases(repository_id) VALUES($1)",[id]);
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved) VALUES($1,'STRESS-001','Concurrency fixture',1,TRUE)",[id]);
    await db.query("INSERT INTO repository_sync_status(repository_id,last_success_at,plan_status) VALUES($1,now(),'VERIFIED')",[id]);
  }
  const identities:{id:string;run:string}[]=[];
  for(const [i,name] of names.entries()){
    const credential=await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES($1,'test',$2) RETURNING credential_id",
      [name,createHash("sha256").update("fixture-stress-"+i).digest("hex")]);
    const id=credential.rows[0].credential_id;
    const admitted=await admitAgentRun(db,{credentialId:id,label:name,provider:"test"},null);
    if(admitted.kind!=="CREATED")throw new Error("Expected new fixture activation");
    identities.push({id,run:admitted.runId});
  }
  const claimed=await Promise.all(identities.map(x=>claimAssignment(db,x.run,x.id)));
  const active=claimed.filter((x):x is ClaimedAssignment=>x!==null);
  assert.equal(identities.length,500);assert.equal(active.length,50);
  assert.equal(new Set(active.map(x=>x.repositoryId)).size,50);
  const current=await db.query<{count:string}>("SELECT COUNT(*)::text AS count FROM repository_leases WHERE repository_id=ANY($1::bigint[]) AND run_id IS NOT NULL",[stressIds]);
  assert.equal(current.rows[0].count,"50");
  const picked=claimed.findIndex(x=>x!==null),grant=claimed[picked]!;
  const {recoverRun}=await import("../src/server/operations.ts");
  const {assignedScope}=await import("../src/server/assignment-scope.ts");
  await recoverRun(db,identities[picked].run,true);
  await assert.rejects(assignedScope(db,identities[picked].run,identities[picked].id,grant.generation),SessionConflict);
  const revoked=await db.query<{enabled:boolean}>("SELECT enabled FROM agent_credentials WHERE credential_id=$1",[identities[picked].id]);
  assert.equal(revoked.rows[0].enabled,false);
  const newLease=await db.query<{generation:string;run_id:string|null}>("SELECT generation::text,run_id FROM repository_leases WHERE repository_id=$1",[grant.repositoryId]);
  assert.ok(BigInt(newLease.rows[0].generation)>BigInt(grant.generation));assert.equal(newLease.rows[0].run_id,null);
});
test("real budget reservations retain uncertain charges and serialize competing calls",async()=>{
  const prior=process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD;
  process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD="1000";
  try{
    const repositoryId="950000001";
    await db.query("INSERT INTO repositories(repository_id,full_name,created_at) VALUES($1,'ci/budget',now())",[repositoryId]);
    await db.query("INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state) VALUES($1,'BUDGET-001','Budget fixture',1,TRUE,'MERGED')",[repositoryId]);
    const credential=await db.query<{credential_id:string}>("INSERT INTO agent_credentials(label,provider,token_digest) VALUES('PAL','test',$1) RETURNING credential_id",["f".repeat(64)]);
    const credentialId=credential.rows[0].credential_id;
    const run=await db.query<{run_id:string}>("INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",[credentialId]);
    const runId=run.rows[0].run_id;
    await db.query("INSERT INTO repository_leases(repository_id,run_id,generation,expires_at,last_heartbeat_at,assigned_at) VALUES($1,$2,1,now()+interval '180 seconds',now(),now())",[repositoryId,runId]);
    await db.query("INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) VALUES($1,$2,1,'BUDGET-001')",[repositoryId,runId]);
    assert.equal((await reserveRunnerBudget(db,runId,credentialId,"1","model-0",900)).replay,false);
    assert.equal((await reserveRunnerBudget(db,runId,credentialId,"1","model-0",900)).replay,true);
    await assert.rejects(reserveRunnerBudget(db,runId,credentialId,"1","model-1",200),e=>e instanceof RunnerBudgetBlocked&&e.code==="BUDGET_LIMIT");
    await recordRunnerUsage(db,runId,credentialId,"1",{operationKey:"model-0",inputTokens:10,outputTokens:10,costMicroUsd:450});
    await reserveRunnerBudget(db,runId,credentialId,"1","model-1",300);
    const competing=await Promise.allSettled([reserveRunnerBudget(db,runId,credentialId,"1","model-2",200),reserveRunnerBudget(db,runId,credentialId,"1","model-3",200)]);
    assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await db.query("SELECT SUM(COALESCE(charged_microusd,reserved_microusd))::text AS total FROM runner_budget_reservations WHERE run_id=$1",[runId])).rows[0].total,"950");
    await assert.rejects(recordRunnerUsage(db,runId,credentialId,"1",{operationKey:"model-0",inputTokens:0,outputTokens:0,costMicroUsd:0}),SessionConflict);
    await saveCheckpoint(db,runId,credentialId,"1",{state:{activationStop:{reason:"USER_STOP",detail:"The isolated budget fixture explicitly requested this activation stop after verification."}}});
    await finishRun(db,runId,credentialId,"1","YIELDED");
  }finally{
    if(prior===undefined)delete process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD;else process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD=prior;
  }
});

test("verified completion advances only within the held repository lease",async()=>{
  const repositoryId="946000001",otherRepositoryId="946000002";
  await db.query(
    "INSERT INTO repositories(repository_id,full_name,created_at,enabled) "+
    "VALUES($1,'ci/chain-primary',now(),FALSE),($2,'ci/chain-other',now(),FALSE)",
    [repositoryId,otherRepositoryId]
  );
  await db.query("INSERT INTO repository_leases(repository_id) VALUES($1),($2)",
    [repositoryId,otherRepositoryId]);
  await db.query(
    "INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state,depends_on) VALUES "+
    "($1,'CHAIN-001','Merged chain fixture',1,TRUE,'MERGED','[]'::jsonb),"+
    "($1,'CHAIN-002','Next chain fixture',1,TRUE,'PENDING','[\"CHAIN-001\"]'::jsonb),"+
    "($2,'OTHER-001','Other repository fixture',1,TRUE,'PENDING','[]'::jsonb)",
    [repositoryId,otherRepositoryId]
  );
  const credential=await db.query<{credential_id:string}>(
    "INSERT INTO agent_credentials(label,provider,token_digest) "+
    "VALUES('Chain Acceptance','test',$1) RETURNING credential_id",["9".repeat(64)]
  );
  const credentialId=credential.rows[0].credential_id;
  const run=await db.query<{run_id:string}>(
    "INSERT INTO agent_runs(provider,credential_id,state) VALUES('test',$1,'RUNNING') RETURNING run_id",
    [credentialId]
  );
  const runId=run.rows[0].run_id;
  await db.query(
    "UPDATE repository_leases SET run_id=$2,generation=1,expires_at=now()+interval '180 seconds',"+
    "last_heartbeat_at=now(),assigned_at=now() WHERE repository_id=$1",[repositoryId,runId]
  );
  const assignment=await db.query<{assignment_id:string}>(
    "INSERT INTO work_assignments(repository_id,run_id,lease_generation,unit_id) "+
    "VALUES($1,$2,1,'CHAIN-001') RETURNING assignment_id",[repositoryId,runId]
  );
  await db.query("UPDATE repositories SET enabled=TRUE WHERE repository_id=$1",[repositoryId]);

  assert.deepEqual(await advanceAssignedWork(db,runId,credentialId,"1"),{
    status:"NEXT_UNIT",repository:"ci/chain-primary",unitId:"CHAIN-002",generation:"1"
  });
  const current=await db.query<{
    assignment_id:string;repository_id:string;lease_generation:string;unit_id:string;released_at:Date|null;
  }>("SELECT assignment_id::text,repository_id::text,lease_generation::text,unit_id,released_at "+
    "FROM work_assignments WHERE run_id=$1",[runId]);
  assert.deepEqual(current.rows[0],{
    assignment_id:assignment.rows[0].assignment_id,repository_id:repositoryId,
    lease_generation:"1",unit_id:"CHAIN-002",released_at:null
  });
  assert.deepEqual((await db.query<{run_id:string;generation:string}>(
    "SELECT run_id::text,generation::text FROM repository_leases WHERE repository_id=$1",
    [repositoryId])).rows[0],{run_id:runId,generation:"1"});
  assert.equal((await db.query("SELECT state FROM roadmap_units WHERE repository_id=$1 AND unit_id='OTHER-001'",
    [otherRepositoryId])).rows[0].state,"PENDING");
  assert.equal((await db.query("SELECT details FROM audit_events WHERE run_id=$1 AND kind='agent.work.advanced'",
    [runId])).rows[0].details.to,"CHAIN-002");

  await assert.rejects(advanceAssignedWork(db,runId,credentialId,"1"),SessionConflict);
  await db.query("UPDATE roadmap_units SET state='MERGED' WHERE repository_id=$1 AND unit_id='CHAIN-002'",
    [repositoryId]);
  assert.deepEqual(await advanceAssignedWork(db,runId,credentialId,"1"),
    {status:"EXHAUSTED",repository:"ci/chain-primary"});
  await db.query("UPDATE agent_runs SET started_at=now()-interval '50 minutes' WHERE run_id=$1",[runId]);
  await finishRun(db,runId,credentialId,"1","COMPLETED");
});
