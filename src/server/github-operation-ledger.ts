import {createHash,randomUUID} from "node:crypto";
import {Pool,type PoolClient} from "pg";
import {githubAppRequest,GitHubAppError,GitHubAppSetupFailure} from "./github-app.ts";
import {SessionConflict} from "./sessions.ts";
import {repositoryApiPath} from "./assignment-scope.ts";
import {validWorkBranch} from "./work-branch.ts";

type Queryable=Pick<Pool|PoolClient,"query">;
export type GithubOperation={operationId:string;runId:string;repositoryId:string;unitId:string;fullName:string;generation:string};
export type GithubMutationIntent=
  |{kind:"CREATE_TREE"|"CREATE_COMMIT"}
  |{kind:"CREATE_REF"|"UPDATE_REF";branch:string;targetSha:string}
  |{kind:"UPSERT_FILE";branch:string;filePath:string;blobSha:string}
  |{kind:"CREATE_PR";branch:string;base:string;headSha:string;titleDigest:string;bodyDigest:string}
  |{kind:"UPDATE_PR";number:number;headSha:string;titleDigest?:string;bodyDigest?:string;base?:string}
  |{kind:"READY_PR"|"MERGE_PR";number:number;headSha:string};
export type GithubMutationRecorder=<T>(intent:GithubMutationIntent,send:()=>Promise<T>)=>Promise<T>;
type StoredIntent={version:1;fullName:string;generation:string;intent:GithubMutationIntent;outcome:string;observation?:unknown};
const sha=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value);
const digest=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/i.test(value);
const positive=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const githubValueDigest=(value:unknown):string=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function githubBlobSha(contentBase64:string):string{
  const bytes=Buffer.from(contentBase64,"base64");
  return createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
}

/** Allocate before BEGIN/lease locking. FK insertion must not wait on a run
 * lock held by a finisher which is itself waiting on the writer's lease lock.
 * Prepared rows are settled NOT_SENT: failed validation cannot create a hold. */
export async function prepareGithubOperation(client:Queryable,runId:string,credentialId:string,generation:string,payload:unknown):Promise<GithubOperation>{
  const operationId=randomUUID();
  const result=await client.query<{repository_id:string;unit_id:string;full_name:string}>(
    `WITH scope AS (
      SELECT r.repository_id,r.full_name,a.unit_id FROM agent_runs ar
      JOIN agent_credentials c ON c.credential_id=ar.credential_id
      JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
      JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=ar.run_id AND l.generation=a.lease_generation
      JOIN repositories r ON r.repository_id=a.repository_id
      JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
      LEFT JOIN repository_execution_policy policy ON policy.repository_id=r.repository_id
      WHERE ar.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
        AND c.enabled=TRUE AND c.revoked_at IS NULL AND a.lease_generation=$3::bigint
        AND l.expires_at>now() AND r.enabled=TRUE AND r.archived=FALSE AND w.approved=TRUE
        AND ar.started_at>now()-make_interval(secs=>COALESCE(policy.max_session_seconds,3300))
    ), inserted AS (
      INSERT INTO github_operations(operation_id,repository_id,unit_id,run_id,idempotency_key,request_digest,state,result,confirmed_at)
      SELECT $4::uuid,repository_id,unit_id,$1,$4::uuid::text,$5,'CONFIRMED',$6::jsonb,now() FROM scope
      RETURNING repository_id,unit_id
    ) SELECT i.repository_id::text,i.unit_id,s.full_name FROM inserted i JOIN scope s USING(repository_id,unit_id)`,
    [runId,credentialId,generation,operationId,githubValueDigest(payload),
      JSON.stringify({version:1,generation,outcome:"NOT_SENT"})]);
  if(result.rowCount!==1)throw new SessionConflict("Current authorized repository lease unavailable");
  const row=result.rows[0];
  return {operationId,runId,repositoryId:row.repository_id,unitId:row.unit_id,fullName:row.full_name,generation};
}

const durablePools=new WeakMap<Pool,Pool>();
/** A separate bounded pool prevents eight locked write transactions from
 * exhausting the eight-connection application pool while saving their intent.
 * Only existing ledger rows are updated here; their FK columns never change. */
export function githubOperationWriter(db:Pool):Queryable{
  let writer=durablePools.get(db);
  if(!writer){
    writer=new Pool({...db.options,max:2,connectionTimeoutMillis:5000,statement_timeout:5000,
      idleTimeoutMillis:1000,allowExitOnIdle:true});
    writer.on("error",()=>{/* Active calls report failures; no credential-bearing idle errors are logged. */});
    durablePools.set(db,writer);
  }
  return writer;
}
export async function closeGithubOperationWriter(db:Pool):Promise<void>{
  const writer=durablePools.get(db);durablePools.delete(db);if(writer)await writer.end();
}
export class GithubOperationUncertain extends SessionConflict{
  readonly operationId:string;
  constructor(operationId:string){super("GitHub operation "+operationId+" requires source-bound outcome reconciliation");this.operationId=operationId;}
}

function validateIntent(value:unknown):value is GithubMutationIntent{
  const v=record(value);
  if(v.kind==="CREATE_TREE"||v.kind==="CREATE_COMMIT")return true;
  if(v.kind==="CREATE_REF"||v.kind==="UPDATE_REF")return validWorkBranch(v.branch)&&sha(v.targetSha);
  if(v.kind==="UPSERT_FILE")return validWorkBranch(v.branch)&&sha(v.blobSha)&&typeof v.filePath==="string"&&
    v.filePath.length<=240&&/^[a-zA-Z0-9_.@()+,\-/]+$/.test(v.filePath)&&
    v.filePath.split("/").every(p=>p&&p!=="."&&p!=="..");
  if(v.kind==="CREATE_PR")return validWorkBranch(v.branch)&&validWorkBranch(v.base)&&sha(v.headSha)&&digest(v.titleDigest)&&digest(v.bodyDigest);
  if(v.kind==="UPDATE_PR")return positive(v.number)&&sha(v.headSha)&&
    (v.titleDigest===undefined||digest(v.titleDigest))&&(v.bodyDigest===undefined||digest(v.bodyDigest))&&
    (v.base===undefined||validWorkBranch(v.base));
  return (v.kind==="READY_PR"||v.kind==="MERGE_PR")&&positive(v.number)&&sha(v.headSha);
}
function mutationObservation(intent:GithubMutationIntent,value:unknown):Record<string,unknown>|null{
  const v=record(value);
  switch(intent.kind){
    case "CREATE_TREE":case "CREATE_COMMIT":return sha(v.sha)?{sha:v.sha}:null;
    case "CREATE_REF":case "UPDATE_REF":return record(v.object).sha===intent.targetSha?{sha:intent.targetSha}:null;
    case "UPSERT_FILE":return record(v.content).sha===intent.blobSha&&sha(record(v.commit).sha)?
      {blobSha:intent.blobSha,commitSha:record(v.commit).sha}:null;
    case "CREATE_PR":return positive(v.number)?{number:v.number}:null;
    case "UPDATE_PR":return v.number===intent.number?{number:intent.number}:null;
    case "READY_PR":{
      const pr=record(record(record(v.data).markPullRequestReadyForReview).pullRequest);
      return (v.errors===undefined||Array.isArray(v.errors)&&v.errors.length===0)&&
        pr.number===intent.number&&pr.isDraft===false?{number:intent.number,draft:false}:null;
    }
    case "MERGE_PR":
      if(v.merged===false)throw new GitHubAppError(409);
      return v.merged===true&&sha(v.sha)?{number:intent.number,mergeSha:v.sha}:null;
  }
}
function definiteRejection(error:unknown):boolean{
  return error instanceof GitHubAppSetupFailure||
    error instanceof GitHubAppError&&[400,401,403,404,405,409,410,422,429].includes(error.httpStatus);
}
function failureCode(error:unknown):string{
  return error instanceof GitHubAppSetupFailure?error.issue:error instanceof GitHubAppError?"HTTP_"+error.httpStatus:
    "OUTCOME_UNCONFIRMED";
}

/** The caller keeps its scoped lease lock. These autocommitted updates survive
 * caller rollback, process failure and a lost GitHub response. No request body,
 * source content, title, PR description or credential enters the ledger. */
export async function recordGithubMutation<T>(writer:Queryable,operation:GithubOperation,intent:GithubMutationIntent,send:()=>Promise<T>):Promise<T>{
  if(!validateIntent(intent))throw new SessionConflict("Invalid GitHub operation reconciliation metadata");
  const stored:StoredIntent={version:1,fullName:operation.fullName,generation:operation.generation,intent,outcome:"PENDING"};
  let sent=false,canSettle=true;
  async function settle(state:"CONFIRMED"|"UNCERTAIN",outcome:string,observation?:unknown){
    await writer.query(
      "UPDATE github_operations SET state=$2,result=$3::jsonb,confirmed_at=CASE WHEN $2='CONFIRMED' THEN now() ELSE NULL END "+
      "WHERE operation_id=$1 AND state IN ('INTENDED','UNCERTAIN')",
      [operation.operationId,state,JSON.stringify({...stored,outcome,observation})]);
  }
  try{
    const saved=await writer.query(
      "UPDATE github_operations SET state='INTENDED',result=$2::jsonb,confirmed_at=NULL WHERE operation_id=$1 AND state='CONFIRMED'",
      [operation.operationId,JSON.stringify(stored)]);
    if(saved.rowCount!==1){canSettle=false;throw new GithubOperationUncertain(operation.operationId);}
    sent=true;
    const value=await send();
    const observation=mutationObservation(intent,value);
    if(!observation)throw new GithubOperationUncertain(operation.operationId);
    await settle("CONFIRMED","APPLIED",observation);
    return value;
  }catch(error){
    if(!canSettle)throw error;
    const staging=intent.kind==="CREATE_TREE"||intent.kind==="CREATE_COMMIT";
    const settled=!sent||definiteRejection(error)||staging;
    // A response lost while saving intent still precedes send(). Settle that
    // known NOT_SENT state; if the database remains unavailable, recovery holds.
    await settle(settled?"CONFIRMED":"UNCERTAIN",!sent?"NOT_SENT":staging?"STAGING_ONLY":
      definiteRejection(error)?"REJECTED":"UNCONFIRMED",{code:failureCode(error)}).catch(()=>undefined);
    if(settled)throw error;
    throw new GithubOperationUncertain(operation.operationId);
  }
}

/** Read-only external reconciliation, called with the repository lease locked.
 * A bounded positive observation may settle an ambiguous write. Absence or a
 * different head never proves a timed-out request was not applied. */
export async function reconcileGithubOperations(client:Queryable,runId:string,repositoryId:string,
  request:typeof githubAppRequest=githubAppRequest,timeoutMs=6000):Promise<{examined:number;resolved:number;pending:number}>{
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>6000)throw new Error("Invalid reconciliation deadline");
  const deadline=Date.now()+timeoutMs;
  const rows=await client.query<{operation_id:string;result:unknown}>(
    "SELECT operation_id::text,result FROM github_operations WHERE run_id=$1 AND repository_id=$2 "+
    "AND state IN ('INTENDED','UNCERTAIN') ORDER BY created_at LIMIT 4 FOR UPDATE SKIP LOCKED",[runId,repositoryId]);
  const report={examined:rows.rows.length,resolved:0,pending:0};let reads=0;
  const identities=new Map<string,boolean>();
  const read=async(path:string)=>{
    const remaining=deadline-Date.now();
    if(reads++>=4||remaining<=0)throw new Error("RECONCILIATION_READ_LIMIT");
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([request("GET",path),new Promise<never>((_resolve,reject)=>{
      timer=setTimeout(()=>reject(new Error("RECONCILIATION_DEADLINE")),remaining);
    })]);}finally{if(timer)clearTimeout(timer);}
  };
  for(const row of rows.rows){
    const stored=record(row.result),intent=stored.intent;
    let observation:Record<string,unknown>|null=null;
    try{
      if(stored.version!==1||typeof stored.fullName!=="string"||!validateIntent(intent))throw new Error("MISSING_INTENT_METADATA");
      if(intent.kind==="CREATE_TREE"||intent.kind==="CREATE_COMMIT")observation={outcome:"STAGING_ONLY"};
      else{
        const api=repositoryApiPath(stored.fullName);
        if(!identities.has(api))identities.set(api,String(record(await read(api)).id)===repositoryId);
        if(!identities.get(api))throw new Error("REPOSITORY_IDENTITY_MISMATCH");
        if(intent.kind==="CREATE_REF"||intent.kind==="UPDATE_REF"){
          const current=record(await read(api+"/git/ref/heads/"+encodeURIComponent(intent.branch)));
          if(record(current.object).sha===intent.targetSha)observation={sha:intent.targetSha};
        }else if(intent.kind==="UPSERT_FILE"){
          const current=record(await read(api+"/contents/"+intent.filePath.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(intent.branch)));
          if(current.type==="file"&&current.sha===intent.blobSha)observation={blobSha:intent.blobSha};
        }else if(intent.kind==="CREATE_PR"){
          const current=await read(api+"/pulls?state=open&head="+encodeURIComponent(stored.fullName.split("/")[0]+":"+intent.branch)+"&per_page=100");
          if(Array.isArray(current)&&current.length<100){
            const matches=current.map(record).filter(pr=>positive(pr.number)&&matchingPull(pr,repositoryId,intent.headSha)&&
              record(pr.head).ref===intent.branch&&record(pr.base).ref===intent.base&&
              githubValueDigest(pr.title)===intent.titleDigest&&githubValueDigest(pr.body??"")===intent.bodyDigest);
            if(matches.length===1)observation={number:matches[0].number};
          }
        }else if("number" in intent){
          const pr=record(await read(api+"/pulls/"+intent.number));
          if(pr.number===intent.number&&matchingPull(pr,repositoryId,intent.headSha)){
            if(intent.kind==="MERGE_PR"&&pr.merged===true&&sha(pr.merge_commit_sha))observation={number:intent.number,mergeSha:pr.merge_commit_sha};
            if(intent.kind==="READY_PR"&&pr.draft===false)observation={number:intent.number,draft:false};
            if(intent.kind==="UPDATE_PR"&&(intent.titleDigest===undefined||githubValueDigest(pr.title)===intent.titleDigest)&&
              (intent.bodyDigest===undefined||githubValueDigest(pr.body??"")===intent.bodyDigest)&&
              (intent.base===undefined||record(pr.base).ref===intent.base))observation={number:intent.number};
          }
        }
      }
    }catch{/* Preserve unknown effects and let a later bounded pass retry reads. */}
    if(observation){
      await client.query("UPDATE github_operations SET state='CONFIRMED',confirmed_at=now(),result=$2::jsonb "+
        "WHERE operation_id=$1 AND state IN ('INTENDED','UNCERTAIN')",
        [row.operation_id,JSON.stringify({...stored,outcome:"RECONCILED",observation})]);report.resolved++;
    }else report.pending++;
  }
  return report;
}
function matchingPull(pr:Record<string,unknown>,repositoryId:string,headSha:string):boolean{
  return record(pr.head).sha===headSha&&String(record(record(pr.head).repo).id)===repositoryId&&
    String(record(record(pr.base).repo).id)===repositoryId;
}

/** The caller must commit any reconciliation progress before reporting a hold;
 * rolling it back could repeatedly revisit the same bounded first page. */
export async function unresolvedGithubOperation(client:Queryable,runId:string,repositoryId:string,
  request:typeof githubAppRequest=githubAppRequest):Promise<string|null>{
  const pending=()=>client.query<{operation_id:string}>(
    "SELECT operation_id::text FROM github_operations WHERE run_id=$1 AND repository_id=$2 "+
    "AND state IN ('INTENDED','UNCERTAIN') ORDER BY created_at LIMIT 1",[runId,repositoryId]);
  if(!(await pending()).rowCount)return null;
  await reconcileGithubOperations(client,runId,repositoryId,request);
  return (await pending()).rows[0]?.operation_id??null;
}
