import type {Pool,PoolClient} from "pg";
import {isValidRunId,isValidGeneration,SessionConflict} from "./sessions.ts";

const secretPattern=/(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api.?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{20,})/i;
const sensitivePattern=/(?:\b\d{3}-\d{2}-\d{4}\b|\b(?:\d[ -]*?){13,19}\b)/;
const workPattern=/\b(repo|repository|code|bug|pull request|PR\b|test|architecture|API|integration|migration|deployment|schema|dependency|build|CI|typescript|github|render|neon|database|service|implementation|config|security|contract)\b/i;
export class CoffeeError extends Error {constructor(message:string){super(message);this.name="CoffeeError";}}

export function validateCoffeeText(value:unknown,maxLength=3500):string{
  if(typeof value!=="string"||value.trim().length<15||value.length>maxLength)
    throw new CoffeeError("Provide a concise substantive engineering question or answer");
  if(secretPattern.test(value)||sensitivePattern.test(value))
    throw new CoffeeError("Potential credential or sensitive number detected");
  if(!workPattern.test(value))throw new CoffeeError("Coffee Corner is restricted to engineering work");
  return value.trim();
}
export function validateEvidence(value:unknown):string[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>12)throw new CoffeeError("Invalid evidence references");
  for(const item of value)if(typeof item!=="string"||item.length>450||
    !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s]*)?$/.test(item))
    throw new CoffeeError("Only verified-format GitHub reference URLs are accepted");
  for(const item of value){const url=new URL(item);if(url.search||url.username||url.password)throw new CoffeeError("Evidence URLs cannot contain credentials or query parameters");}
  return value;
}
async function ensureAgent(client:PoolClient,runId:string,credentialId:string):Promise<void>{
  if(!isValidRunId(runId))throw new CoffeeError("Invalid run ID");
  const q=await client.query(
    "SELECT 1 FROM agent_runs WHERE run_id=$1 AND credential_id=$2 AND state IN ('ADMITTED','RUNNING')",
    [runId,credentialId]
  );
  if(q.rowCount!==1)throw new CoffeeError("No authorized active agent session");
}
type ThreadInput={runId:string;generation?:string;repositoryId?:number;unitId?:string;subject:unknown;question:unknown;evidence?:unknown};
export async function openCoffeeThread(db:Pool,credentialId:string,input:ThreadInput){
  const subject=validateCoffeeText(input.subject,180);
  const question=validateCoffeeText(input.question);
  const evidence=validateEvidence(input.evidence);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await ensureAgent(client,input.runId,credentialId);
    let repoId:number|null=null,unitId:string|null=null;
    if(input.repositoryId!==undefined||input.generation!==undefined){
      if((input.repositoryId!==undefined&&(!Number.isSafeInteger(input.repositoryId)||input.repositoryId<=0))||
         !isValidGeneration(input.generation))throw new CoffeeError("Valid claimed repository and generation required");
      const owned=await client.query<{repository_id:string;unit_id:string}>(
        "SELECT a.repository_id::text,a.unit_id FROM work_assignments a JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id AND l.generation=a.lease_generation WHERE ($1::bigint IS NULL OR a.repository_id=$1) AND a.run_id=$2 AND a.lease_generation=$3::bigint AND a.released_at IS NULL AND l.expires_at>now()",
        [input.repositoryId??null,input.runId,input.generation]
      );
      if(owned.rowCount!==1)throw new CoffeeError("Repository is not currently assigned to this session");
      repoId=Number(owned.rows[0].repository_id);
      unitId=owned.rows[0].unit_id;
      await client.query("UPDATE roadmap_units SET state='BLOCKED' WHERE repository_id=$1 AND unit_id=$2 AND state IN ('PENDING','ACTIVE')",[repoId,unitId]);
    }
    const row=await client.query<{thread_id:string}>(
      "INSERT INTO coffee_threads(repository_id,unit_id,subject,opened_by_run_id) VALUES($1,$2,$3,$4) RETURNING thread_id",
      [repoId,unitId,subject,input.runId]
    );
    await client.query(
      "INSERT INTO coffee_messages(thread_id,author_run_id,content,evidence,message_kind) VALUES($1,$2,$3,$4::jsonb,'QUESTION')",
      [row.rows[0].thread_id,input.runId,question,JSON.stringify(evidence)]
    );
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'coffee.question.created',$3::jsonb)",
      [input.runId,repoId,JSON.stringify({threadId:row.rows[0].thread_id})]);
    await client.query("COMMIT");
    return {threadId:row.rows[0].thread_id,status:"OPEN"};
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
export async function answerCoffeeThread(
  db:Pool,credentialId:string,runId:string,threadId:string,text:unknown,evidenceInput:unknown
){
  if(!/^[0-9a-f-]{36}$/i.test(threadId))throw new CoffeeError("Invalid thread ID");
  const answer=validateCoffeeText(text);
  const evidence=validateEvidence(evidenceInput);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await ensureAgent(client,runId,credentialId);
    const thread=await client.query<{status:string;repository_id:number|null}>(
      "SELECT status,repository_id FROM coffee_threads WHERE thread_id=$1 FOR UPDATE",[threadId]
    );
    if(!thread.rowCount||["RESOLVED","CLOSED"].includes(thread.rows[0].status))
      throw new CoffeeError("Question is not open for answers");
    const msg=await client.query<{message_id:string}>(
      "INSERT INTO coffee_messages(thread_id,author_run_id,content,evidence,message_kind) VALUES($1,$2,$3,$4::jsonb,'ANSWER') RETURNING message_id",
      [threadId,runId,answer,JSON.stringify(evidence)]
    );
    await client.query(
      "UPDATE coffee_threads SET status='ANSWERED',updated_at=now() WHERE thread_id=$1 AND status IN ('OPEN','ANSWERED')",[threadId]
    );
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'coffee.answer.posted',$3::jsonb)",
      [runId,thread.rows[0].repository_id,JSON.stringify({threadId,messageId:msg.rows[0].message_id})]
    );
    await client.query("COMMIT");
    return {messageId:msg.rows[0].message_id,threadId,status:"ANSWERED_UNVERIFIED"};
  }catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}
}
