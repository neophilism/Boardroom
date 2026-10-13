import type {Pool} from "pg";
import {assignedScope} from "./assignment-scope.ts";
import {SessionConflict} from "./sessions.ts";

export function usageInteger(value:unknown,max=1000000000):number{
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0||value>max)throw new SessionConflict("Invalid usage or budget amount");
  return value;
}
/** Reserve against one aggregate daily cap before a hosted model call.
 * A lost provider response leaves the maximum reservation charged to the cap.
 * This prevents uncertain calls from silently resetting the budget.
 */
export async function reserveRunnerBudget(db:Pool,runId:string,credentialId:string,generation:string,key:string,amount:number){
  usageInteger(amount);if(amount<1||!/^model-[0-9]{1,5}$/.test(key))throw new SessionConflict("Valid model operation and positive reservation required");
  const cap=Number(process.env.BOARDROOM_DAILY_COST_CAP_MICROUSD??0);
  if(!Number.isSafeInteger(cap)||cap<1)throw new SessionConflict("Owner daily model spending cap is not configured");
  const client=await db.connect();
  try{
    await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(540074)");
    await assignedScope(client,runId,credentialId,generation,true);
    const existing=await client.query<{reservation_id:string;reserved_microusd:string}>("SELECT reservation_id,reserved_microusd::text FROM runner_budget_reservations WHERE run_id=$1 AND operation_key=$2",[runId,key]);
    if(existing.rowCount){
      if(Number(existing.rows[0].reserved_microusd)!==amount)throw new SessionConflict("Budget operation conflict");
      // A reservation replay must not initiate a second paid model request.
      await client.query("COMMIT");return {reservationId:existing.rows[0].reservation_id,replay:true};
    }
    const total=await client.query<{total:string}>("SELECT COALESCE(SUM(COALESCE(charged_microusd,reserved_microusd)),0)::text AS total FROM runner_budget_reservations WHERE created_at>now()-interval '24 hours'");
    if(Number(total.rows[0].total)+amount>cap)throw new SessionConflict("Aggregate daily spending limit reached");
    const created=await client.query<{reservation_id:string}>("INSERT INTO runner_budget_reservations(run_id,operation_key,reserved_microusd) VALUES($1,$2,$3) RETURNING reservation_id",[runId,key,amount]);
    await client.query("COMMIT");return {reservationId:created.rows[0].reservation_id,replay:false};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function recordRunnerUsage(db:Pool,runId:string,credentialId:string,generation:string,input:Record<string,unknown>){
  const inputTokens=usageInteger(input.inputTokens,10000000),outputTokens=usageInteger(input.outputTokens,10000000),cost=usageInteger(input.costMicroUsd);
  const key=String(input.operationKey??"");if(!/^model-[0-9]{1,5}$/.test(key))throw new SessionConflict("Invalid usage operation");
  const client=await db.connect();
  try{
    await client.query("BEGIN");await assignedScope(client,runId,credentialId,generation,true);
    const reservation=await client.query<{reserved_microusd:string}>("SELECT reserved_microusd::text FROM runner_budget_reservations WHERE run_id=$1 AND operation_key=$2 FOR UPDATE",[runId,key]);
    if(!reservation.rowCount||Number(reservation.rows[0].reserved_microusd)<cost)throw new SessionConflict("Usage exceeds its paid-call reservation");
    const prior=await client.query<{input_tokens:number;output_tokens:number;cost_microusd:string}>("SELECT input_tokens,output_tokens,cost_microusd::text FROM usage_events WHERE run_id=$1 AND operation_key=$2",[runId,key]);
    if(prior.rowCount&&(prior.rows[0].input_tokens!==inputTokens||prior.rows[0].output_tokens!==outputTokens||Number(prior.rows[0].cost_microusd)!==cost))
      throw new SessionConflict("Recorded usage cannot be changed by a replay");
    await client.query("INSERT INTO usage_events(run_id,operation_key,input_tokens,output_tokens,cost_microusd) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,operation_key) DO NOTHING",[runId,key,inputTokens,outputTokens,cost]);
    await client.query("UPDATE runner_budget_reservations SET state='COMMITTED',charged_microusd=$3 WHERE run_id=$1 AND operation_key=$2",[runId,key,cost]);
    await client.query("COMMIT");return {recorded:true};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
