import type {Pool} from "pg";
import {assignedScope,repositoryApiPath} from "./assignment-scope.ts";
import {githubAppRequest} from "./github-app.ts";
import {SessionConflict,isValidRunId} from "./sessions.ts";

export const COFFEE_RESOLUTION_COMPATIBILITY_QUERY=String.raw`
  SELECT registry_prerequisites_satisfied($1,$2) AND
    NOT EXISTS(
      SELECT 1 FROM roadmap_units w CROSS JOIN LATERAL jsonb_array_elements_text(w.depends_on) dependency(id)
      LEFT JOIN roadmap_units prerequisite ON prerequisite.repository_id=w.repository_id AND prerequisite.unit_id=dependency.id
      WHERE w.repository_id=$1 AND w.unit_id=$2
        AND (prerequisite.unit_id IS NULL OR prerequisite.approved IS NOT TRUE OR prerequisite.state NOT IN ('MERGED','ACCEPTED'))
    ) AND
    NOT EXISTS(
      SELECT 1 FROM owner_action_dependents dependent JOIN owner_actions action ON action.action_id=dependent.action_id
      WHERE dependent.repository_id=$1 AND (dependent.unit_id IS NULL OR dependent.unit_id=$2)
        AND action.status NOT IN ('VERIFIED','CANCELLED')
    ) AND
    NOT EXISTS(
      SELECT 1 FROM compatibility_dependencies dependency
      LEFT JOIN roadmap_units prerequisite ON prerequisite.repository_id=dependency.prerequisite_repository_id
        AND prerequisite.unit_id=dependency.prerequisite_unit_id
      WHERE dependency.repository_id=$1 AND dependency.unit_id=$2
        AND (prerequisite.unit_id IS NULL OR prerequisite.approved IS NOT TRUE OR prerequisite.state NOT IN ('MERGED','ACCEPTED'))
    ) AS satisfied
`;
export function parseAdrEvidence(input:unknown,repository:string){
  if(typeof input!=="string")throw new SessionConflict("A durable repository ADR reference is required");
  const url=new URL(input);
  const parts=url.pathname.split('/').filter(Boolean);
  const file=parts.slice(4).map(decodeURIComponent).join('/');
  if(url.origin!=="https://github.com"||url.username||url.password||url.search||url.hash||parts.slice(0,2).join('/').toLowerCase()!==repository.toLowerCase()||
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
    const answer=await client.query("SELECT message_id FROM coffee_messages WHERE message_id=$1 AND thread_id=$2 AND message_kind='ANSWER' AND jsonb_array_length(evidence)>0",[messageId,threadId]);
    if(!answer.rowCount)throw new SessionConflict("Answer needs documented source evidence");
    const compatibility=await client.query<{satisfied:boolean}>(COFFEE_RESOLUTION_COMPATIBILITY_QUERY,[scope.repository_id,scope.unit_id]);
    if(compatibility.rows[0]?.satisfied!==true)throw new SessionConflict("Work-unit compatibility prerequisites changed while the question was open");
    const file=await githubAppRequest('GET',repositoryApiPath(scope.full_name)+'/contents/'+proof.path.split('/').map(encodeURIComponent).join('/')+'?ref='+proof.sha) as {type:string;size:number};
    if(file.type!=='file'||file.size<15||file.size>100000)throw new SessionConflict("ADR could not be verified in GitHub");
    await client.query("UPDATE coffee_threads SET status='RESOLVED',updated_at=now() WHERE thread_id=$1",[threadId]);
    await client.query("UPDATE roadmap_units SET state='ACTIVE' WHERE repository_id=$1 AND unit_id=$2 AND state='BLOCKED'",[scope.repository_id,scope.unit_id]);
    await client.query("INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'coffee.answer.accepted_in_adr',$3::jsonb)",[runId,scope.repository_id,JSON.stringify({threadId,messageId,unitId:scope.unit_id,adr})]);
    await client.query('COMMIT');return {status:'RESOLVED',adr};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
