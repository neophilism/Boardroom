import type {Pool} from "pg";
import {assignedScope,repositoryApiPath} from "./assignment-scope.ts";
import {githubAppRequest} from "./github-app.ts";
import {SessionConflict,isValidRunId} from "./sessions.ts";
export function parseAdrEvidence(input:unknown,repository:string){
  if(typeof input!=="string")throw new SessionConflict("A durable repository ADR reference is required");
  const url=new URL(input);
  const parts=url.pathname.split('/').filter(Boolean);
  const file=parts.slice(4).map(decodeURIComponent).join('/');
  if(url.origin!=="https://github.com"||url.search||url.hash||parts.slice(0,2).join('/').toLowerCase()!==repository.toLowerCase()||
    parts[2]!=="blob"||!/^[a-f0-9]{40}$/i.test(parts[3]??"")||
    !/^docs\/(?:decisions|adr)\/[A-Za-z0-9._/-]+\.md$/.test(file)||file.split('/').some(p=>!p||p==='.'||p==='..'))
    throw new SessionConflict("ADR must be an immutable commit reference in the assigned repository");
  return {sha:parts[3],path:file};
}
export async function resolveCoffeeAnswer(db:Pool,runId:string,credentialId:string,generation:string,threadId:string,messageId:string,adr:string){
  if(!isValidRunId(threadId)||!isValidRunId(messageId))throw new SessionConflict("Valid thread and answer IDs required");
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const scope=await assignedScope(client,runId,credentialId,generation,true),proof=parseAdrEvidence(adr,scope.full_name);
    const thread=await client.query<{unit_id:string;repository_id:string}>("SELECT repository_id::text,unit_id FROM coffee_threads WHERE thread_id=$1 AND status='ANSWERED' FOR UPDATE",[threadId]);
    if(thread.rows[0]?.repository_id!==scope.repository_id||thread.rows[0]?.unit_id!==scope.unit_id)throw new SessionConflict("Question is outside assigned work");
    const answer=await client.query("SELECT message_id FROM coffee_messages WHERE message_id=$1 AND thread_id=$2 AND jsonb_array_length(evidence)>0",[messageId,threadId]);
    if(!answer.rowCount)throw new SessionConflict("Answer needs documented source evidence");
    const file=await githubAppRequest('GET',repositoryApiPath(scope.full_name)+'/contents/'+proof.path.split('/').map(encodeURIComponent).join('/')+'?ref='+proof.sha) as {type:string;size:number};
    if(file.type!=='file'||file.size<15||file.size>100000)throw new SessionConflict("ADR could not be verified in GitHub");
    await client.query("UPDATE coffee_threads SET status='RESOLVED',updated_at=now() WHERE thread_id=$1",[threadId]);
    await client.query("UPDATE roadmap_units SET state='ACTIVE' WHERE repository_id=$1 AND unit_id=$2 AND state='BLOCKED'",[scope.repository_id,scope.unit_id]);
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'coffee.answer.accepted_in_adr',$3::jsonb)",[runId,scope.repository_id,JSON.stringify({threadId,messageId,unitId:scope.unit_id,adr})]);
    await client.query('COMMIT');return {status:'RESOLVED',adr};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
