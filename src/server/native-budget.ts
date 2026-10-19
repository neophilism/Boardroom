export const NATIVE_MAX_ACTIVE_RUNS=1;
export const NATIVE_MAX_STARTS_ROLLING_24H=4;
export const NATIVE_MIN_START_GAP_SECONDS=4*60*60;
export const NATIVE_MAX_SESSION_SECONDS=15*60;
export const NATIVE_TARGET_WORK_SECONDS=12*60;
export const FLEET_ADMISSION_ADVISORY_LOCK=8523340;
export type NativeBudgetObservation={active_native:string|number;starts_24h:string|number;last_started_at:Date|null;fourth_newest_started_at:Date|null;checked_at:Date};
export type NativeBudgetDenial={reason:"FLEET_BUSY"|"DAILY_ADMISSION_CAP"|"START_COOLDOWN";retryAfterAt:string|null};
export type NativeBudgetDecision={allowed:true}|({allowed:false}&NativeBudgetDenial);
function count(value:string|number):number{
  const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid native admission count");return n;
}
function millis(value:Date|null):number|null{
  if(value===null)return null;
  const n=value.getTime();if(!Number.isFinite(n))throw new Error("Invalid native admission timestamp");return n;
}
/** Evaluate under one global PostgreSQL transaction-level advisory lock. */
export function evaluateNativeBudget(value:NativeBudgetObservation):NativeBudgetDecision{
  const now=millis(value.checked_at);if(now===null)throw new Error("Missing observation timestamp");
  const active=count(value.active_native),total=count(value.starts_24h);
  if(active>=NATIVE_MAX_ACTIVE_RUNS)return {allowed:false,reason:"FLEET_BUSY",retryAfterAt:null};
  const last=millis(value.last_started_at),fourth=millis(value.fourth_newest_started_at);
  if(total>=NATIVE_MAX_STARTS_ROLLING_24H){
    if(fourth===null)throw new Error("Missing fourth recent start");
    return {allowed:false,reason:"DAILY_ADMISSION_CAP",retryAfterAt:new Date(
      Math.max(fourth+86400000,last===null?0:last+NATIVE_MIN_START_GAP_SECONDS*1000)).toISOString()};
  }
  if(last!==null&&now<last+NATIVE_MIN_START_GAP_SECONDS*1000)
    return {allowed:false,reason:"START_COOLDOWN",
      retryAfterAt:new Date(last+NATIVE_MIN_START_GAP_SECONDS*1000).toISOString()};
  return {allowed:true};
}
/** Internal, trusted SQL column expressions only. */
export function effectiveSessionSecondsSql(provider:string,policy:string):string{
  return "(CASE WHEN "+provider+"='chatgpt' THEN LEAST(COALESCE("+policy+",3300),900) ELSE COALESCE("+policy+",3300) END)";
}
