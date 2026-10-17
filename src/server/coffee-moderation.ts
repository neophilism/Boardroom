import type {Pool} from "pg";
import {isValidRunId} from "./sessions.ts";

export class CoffeeModerationError extends Error {
  constructor(message:string){super(message);this.name="CoffeeModerationError";}
}
export const MODERATION_REASONS=["PRIVACY","ABUSE","OFF_TOPIC","OTHER"] as const;
type Reason=typeof MODERATION_REASONS[number];
export const REDACTED_MESSAGE="[Message permanently redacted]";
export const REDACTED_SUBJECT="[Discussion subject redacted]";
export type ModerationRequest=
  |{kind:"retention-policy";enabled:boolean;retentionDays:number;confirm:boolean}
  |{kind:"purge";confirm:true}
  |{kind:"redact-message"|"redact-subject";threadId:string;messageId?:string;reason:Reason;confirm:true};
export function parseCoffeeModeration(input:unknown):ModerationRequest{
  if(!input||typeof input!=="object"||Array.isArray(input))throw new CoffeeModerationError("JSON object required");
  const v=input as Record<string,unknown>;
  if(v.kind==="retention-policy"){
    if(typeof v.enabled!=="boolean"||!Number.isSafeInteger(v.retentionDays)||
       (v.retentionDays as number)<30||(v.retentionDays as number)>3650)
      throw new CoffeeModerationError("Retention must be 30 to 3650 whole days");
    if(v.enabled&&v.confirm!==true)throw new CoffeeModerationError("Confirm permanent retention redaction before enabling");
    return {kind:v.kind,enabled:v.enabled,retentionDays:v.retentionDays as number,confirm:v.confirm===true};
  }
  if(v.confirm!==true)throw new CoffeeModerationError("Explicit confirmation required");
  if(v.kind==="purge")return {kind:"purge",confirm:true};
  if(v.kind!=="redact-message"&&v.kind!=="redact-subject")throw new CoffeeModerationError("Unsupported moderation operation");
  if(!isValidRunId(v.threadId)||(v.kind==="redact-message"&&!isValidRunId(v.messageId)))
    throw new CoffeeModerationError("Valid thread and message identifiers required");
  if(!MODERATION_REASONS.includes(v.reason as Reason))throw new CoffeeModerationError("Valid moderation reason required");
  return {kind:v.kind,threadId:v.threadId,messageId:v.kind==="redact-message"?v.messageId as string:undefined,
    reason:v.reason as Reason,confirm:true};
}
export async function coffeeRetentionPolicy(db:Pool){
  const row=await db.query<{enabled:boolean;retentionDays:number;updatedAt:Date}>(
    'SELECT enabled,retention_days AS "retentionDays",updated_at AS "updatedAt" FROM coffee_retention_policy WHERE singleton=TRUE');
  if(!row.rows[0])throw new Error("Coffee retention policy unavailable");
  return row.rows[0];
}
/** Trusted owner route only; never expose this operation as an agent tool. */
export async function saveCoffeeRetentionPolicy(db:Pool,input:unknown){
  const value=parseCoffeeModeration(input);
  if(value.kind!=="retention-policy")throw new CoffeeModerationError("Retention policy required");
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query<{enabled:boolean;retention_days:number}>(
      "SELECT enabled,retention_days FROM coffee_retention_policy WHERE singleton=TRUE FOR UPDATE");
    if(!current.rows[0])throw new Error("Coffee retention policy unavailable");
    const changed=current.rows[0].enabled!==value.enabled||current.rows[0].retention_days!==value.retentionDays;
    if(changed){
      await client.query("UPDATE coffee_retention_policy SET enabled=$1,retention_days=$2,updated_at=now() WHERE singleton=TRUE",
        [value.enabled,value.retentionDays]);
      await client.query("INSERT INTO audit_events(kind,details) VALUES('owner.coffee.retention_policy',$1::jsonb)",
        [JSON.stringify({enabled:value.enabled,retentionDays:value.retentionDays})]);
    }
    await client.query("COMMIT");return {enabled:value.enabled,retentionDays:value.retentionDays,replay:!changed};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function moderateCoffee(db:Pool,input:unknown){
  const value=parseCoffeeModeration(input);
  if(value.kind!=="redact-message"&&value.kind!=="redact-subject")throw new CoffeeModerationError("Redaction request required");
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const thread=await client.query<{repository_id:string|null;subject_redacted_at:Date|null}>(
      "SELECT repository_id::text,subject_redacted_at FROM coffee_threads WHERE thread_id=$1 FOR UPDATE",[value.threadId]);
    if(!thread.rows[0])throw new CoffeeModerationError("Discussion unavailable");
    let replay=false;
    if(value.kind==="redact-subject"){
      replay=thread.rows[0].subject_redacted_at!==null;
      if(!replay)await client.query("UPDATE coffee_threads SET subject=$2,subject_redacted_at=now(),updated_at=now() WHERE thread_id=$1",
        [value.threadId,REDACTED_SUBJECT]);
    }else{
      const message=await client.query<{redacted_at:Date|null}>(
        "SELECT redacted_at FROM coffee_messages WHERE thread_id=$1 AND message_id=$2 FOR UPDATE",[value.threadId,value.messageId]);
      if(!message.rows[0])throw new CoffeeModerationError("Message unavailable in this discussion");
      replay=message.rows[0].redacted_at!==null;
      if(!replay){
        await client.query("UPDATE coffee_messages SET content=$3,evidence='[]'::jsonb,author_run_id=NULL,redacted_at=now(),redaction_reason=$4 WHERE thread_id=$1 AND message_id=$2",
          [value.threadId,value.messageId,REDACTED_MESSAGE,value.reason]);
        // Withdrawing an answer must never silently authorize blocked work.
        await client.query("UPDATE coffee_threads SET status=CASE WHEN status='ANSWERED' THEN 'OPEN' ELSE status END,updated_at=now() WHERE thread_id=$1",[value.threadId]);
        await client.query("UPDATE roadmap_units w SET state='BLOCKED' FROM coffee_threads t "+
          "WHERE t.thread_id=$1 AND t.status='OPEN' AND w.repository_id=t.repository_id AND w.unit_id=t.unit_id "+
          "AND w.state IN ('PENDING','ACTIVE','OPEN_PR')",[value.threadId]);
      }
    }
    if(!replay)await client.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'owner.coffee.redacted',$2::jsonb)",
      [thread.rows[0].repository_id,JSON.stringify({kind:value.kind,threadId:value.threadId,messageId:value.messageId,reason:value.reason})]);
    await client.query("COMMIT");return {redacted:true,replay};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
/** At most 25 inactive threads and 200 message bodies per transaction.
 * Preserve thread/message IDs, state and immutable decision/audit references.
 * Shared policy-row lock serializes workers and configuration changes. */
export async function purgeExpiredCoffee(db:Pool){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const policy=await client.query<{enabled:boolean;retention_days:number}>(
      "SELECT enabled,retention_days FROM coffee_retention_policy WHERE singleton=TRUE FOR UPDATE");
    const p=policy.rows[0];if(!p)throw new Error("Coffee retention policy unavailable");
    if(!p.enabled){await client.query("COMMIT");return {enabled:false,redactedThreads:0,redactedMessages:0};}
    const threads=await client.query<{thread_id:string}>(
      "SELECT thread_id::text FROM coffee_threads WHERE status IN ('RESOLVED','CLOSED') "+
      "AND retention_redacted_at IS NULL AND updated_at<now()-make_interval(days=>$1) "+
      "ORDER BY updated_at,thread_id LIMIT 25 FOR UPDATE SKIP LOCKED",[p.retention_days]);
    const ids=threads.rows.map(t=>t.thread_id);
    if(!ids.length){await client.query("COMMIT");return {enabled:true,redactedThreads:0,redactedMessages:0};}
    const messages=await client.query(
      "WITH batch AS (SELECT message_id FROM coffee_messages WHERE thread_id=ANY($1::uuid[]) AND redacted_at IS NULL "+
      "ORDER BY created_at,message_id LIMIT 200 FOR UPDATE SKIP LOCKED) "+
      "UPDATE coffee_messages m SET content=$2,evidence='[]'::jsonb,author_run_id=NULL,redacted_at=now(),redaction_reason='RETENTION' "+
      "FROM batch WHERE m.message_id=batch.message_id",[ids,REDACTED_MESSAGE]);
    // Do not move updated_at: a partial batch must remain eligible next tick.
    await client.query("UPDATE coffee_threads SET subject=$2,subject_redacted_at=COALESCE(subject_redacted_at,now()),opened_by_run_id=NULL WHERE thread_id=ANY($1::uuid[])",[ids,REDACTED_SUBJECT]);
    const completed=await client.query("UPDATE coffee_threads t SET retention_redacted_at=now() WHERE thread_id=ANY($1::uuid[]) "+
      "AND NOT EXISTS(SELECT 1 FROM coffee_messages m WHERE m.thread_id=t.thread_id AND m.redacted_at IS NULL)",[ids]);
    const result={enabled:true,redactedThreads:completed.rowCount??0,redactedMessages:messages.rowCount??0};
    if(result.redactedThreads||result.redactedMessages)await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('coffee.retention.redacted',$1::jsonb)",
      [JSON.stringify({...result,retentionDays:p.retention_days})]);
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
