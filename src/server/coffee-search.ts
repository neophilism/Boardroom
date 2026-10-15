import type {Pool} from "pg";
import {parseCoffeeSearch,parseCoffeeStatus,isSafeGitHubReference} from "../domain/coffee-view.ts";

export type CoffeeSearchThread={thread_id:string;repository_id:string|null;repository_name:string|null;unit_id:string|null;
  subject:string;status:string;blocker_classification:string;deadline_at:Date|null;created_at:Date;updated_at:Date;author_name:string|null;provider:string|null;replies:string;
  messages:{messageId:string;kind:string;content:string;evidence:unknown;createdAt:string}[];adr:string|null};
/** Owner UI, HTTP SDK and MCP share literal text search over subjects, source
 * repositories and actual question/answer contents, including resolved work. */
export async function searchCoffeeThreads(db:Pool,queryInput:string|null,statusInput:string|null){
  const query=parseCoffeeSearch(queryInput),status=parseCoffeeStatus(statusInput);
  if(statusInput&&status===null)throw new Error("Invalid Coffee status");
  const result=await db.query<CoffeeSearchThread>(
    `SELECT t.thread_id::text,t.repository_id::text,r.full_name AS repository_name,t.unit_id,t.subject,t.status,t.created_at,t.updated_at,
      t.blocker_classification,t.deadline_at,c.label AS author_name,a.provider,
      (SELECT COUNT(*)::text FROM coffee_messages m WHERE m.thread_id=t.thread_id) AS replies,
      COALESCE(messages.items,'[]'::json) AS messages,resolution.adr
     FROM coffee_threads t LEFT JOIN repositories r ON r.repository_id=t.repository_id
     LEFT JOIN agent_runs a ON a.run_id=t.opened_by_run_id
     LEFT JOIN agent_credentials c ON c.credential_id=a.credential_id
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object('messageId',m.message_id,'kind',m.message_kind,'content',m.content,'evidence',m.evidence,'createdAt',m.created_at)
         ORDER BY m.created_at,m.message_id) AS items
       FROM (SELECT * FROM coffee_messages x WHERE x.thread_id=t.thread_id
         ORDER BY CASE WHEN $2<>'' AND strpos(lower(x.content),lower($2))>0 THEN 0 ELSE 1 END,x.created_at DESC,x.message_id LIMIT 10) m
     ) messages ON TRUE
     LEFT JOIN LATERAL (SELECT e.details->>'adr' AS adr FROM audit_events e
       WHERE e.kind='coffee.answer.accepted_in_adr' AND e.details->>'threadId'=t.thread_id::text
       ORDER BY e.occurred_at DESC,e.event_id DESC LIMIT 1) resolution ON TRUE
     WHERE ($1::text IS NULL OR t.status=$1) AND ($2::text='' OR strpos(lower(t.subject),lower($2))>0
       OR strpos(lower(r.full_name),lower($2))>0 OR EXISTS(SELECT 1 FROM coffee_messages x
         WHERE x.thread_id=t.thread_id AND strpos(lower(x.content),lower($2))>0))
     ORDER BY CASE WHEN t.status='RESOLVED' AND $2<>'' THEN 0 WHEN t.status='OPEN' THEN 1 ELSE 2 END,
       t.updated_at DESC,t.thread_id LIMIT 20`,[status,query]);
  return result.rows.map(t=>({...t,adr:isSafeGitHubReference(t.adr)?t.adr:null,
    messages:t.messages.map(m=>({...m,evidence:Array.isArray(m.evidence)?m.evidence.filter(isSafeGitHubReference):[]}))}));
}
