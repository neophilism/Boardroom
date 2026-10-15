import type { Pool } from "pg";
import { isValidRunId, isValidGeneration, SessionConflict } from "./sessions.ts";

export type OwnerActionType = "ACCOUNT"|"CREDENTIAL"|"PURCHASE"|"APPROVAL"|"HUMAN_INPUT"|"OTHER";
export const ESCALATION_CONDITIONS = [
  "OWNER_ACCOUNT_CREATION",
  "OWNER_CREDENTIAL_PROVISION",
  "OWNER_PURCHASE",
  "OWNER_APPROVAL",
  "OWNER_LEGAL_OR_PERSONAL_INPUT",
  "OWNER_PRODUCTION_ACCESS",
  "TECHNICAL_QUESTION",
  "AUTONOMOUS_CODE_CHANGE",
  "AUTONOMOUS_TEST_FAILURE",
  "RETRYABLE_EXTERNAL_FAILURE"
] as const;
export type EscalationCondition = typeof ESCALATION_CONDITIONS[number];
export const OWNER_ACTION_STATUSES=["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION","VERIFIED","DECLINED","CANCELLED"] as const;
export type OwnerActionStatus=typeof OWNER_ACTION_STATUSES[number];
export function isOwnerActionStatus(value:string):value is OwnerActionStatus{return OWNER_ACTION_STATUSES.includes(value as OwnerActionStatus)}
export type OwnerActionInput = {
  runId:string; generation:string; actionKey:string; title:string; type:OwnerActionType;
  condition:EscalationCondition; instructions:string; requestedPermissions:string[]; secureEntryLocation:string|null;
  priceEstimateCents:number|null;
};
const validTypes = new Set(["ACCOUNT","CREDENTIAL","PURCHASE","APPROVAL","HUMAN_INPUT","OTHER"]);
const apparentSecret = /(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api.?key|secret|token)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{20,})/i;
const ownerConditions:Record<string,readonly OwnerActionType[]>={
  OWNER_ACCOUNT_CREATION:["ACCOUNT"],
  OWNER_CREDENTIAL_PROVISION:["CREDENTIAL"],
  OWNER_PURCHASE:["PURCHASE"],
  OWNER_APPROVAL:["APPROVAL"],
  OWNER_LEGAL_OR_PERSONAL_INPUT:["HUMAN_INPUT"],
  OWNER_PRODUCTION_ACCESS:["CREDENTIAL","APPROVAL"]
};

export type EscalationDestination="OWNER_ACTION"|"COFFEE_CORNER"|"AUTONOMOUS";
export function classifyEscalation(value:unknown):EscalationDestination{
  if(typeof value!=="string"||!ESCALATION_CONDITIONS.includes(value as EscalationCondition))
    throw new SessionConflict("Explicit unmet-condition classification required");
  if(value in ownerConditions)return "OWNER_ACTION";
  return value==="TECHNICAL_QUESTION"?"COFFEE_CORNER":"AUTONOMOUS";
}

export function parseOwnerAction(payload: unknown): OwnerActionInput {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new SessionConflict("Owner action object required");
  const obj = payload as Record<string,unknown>;
  if (!isValidRunId(obj.runId) || !isValidGeneration(obj.generation)) throw new SessionConflict("Valid authorized run and lease generation required");
  if (typeof obj.actionKey !== "string" || !/^[a-z0-9][a-z0-9:._/-]{8,120}$/i.test(obj.actionKey)) throw new SessionConflict("Stable actionKey required");
  if (typeof obj.title !== "string" || obj.title.trim().length < 5 || obj.title.length > 240) throw new SessionConflict("Action title must be 5-240 characters");
  if (typeof obj.type !== "string" || !validTypes.has(obj.type)) throw new SessionConflict("Unsupported action type");
  const destination=classifyEscalation(obj.condition);
  if(destination==="COFFEE_CORNER")throw new SessionConflict("Technical questions belong in Coffee Corner after search-before-asking");
  if(destination==="AUTONOMOUS")throw new SessionConflict("This condition is authorized agent work; troubleshoot, retry, or checkpoint it instead of escalating to the owner");
  if(!ownerConditions[String(obj.condition)].includes(obj.type as OwnerActionType))
    throw new SessionConflict("Owner action type does not match the classified unmet condition");
  if (typeof obj.instructions !== "string" || obj.instructions.trim().length < 15 || obj.instructions.length > 4000) throw new SessionConflict("Actionable owner instructions required");
  const permissions = obj.requestedPermissions ?? [];
  if (!Array.isArray(permissions) || permissions.length > 30 ||
      permissions.some(p=>typeof p!=="string" || p.length > 180)) throw new SessionConflict("Invalid requested permissions");
  const target = obj.secureEntryLocation ?? null;
  if (target !== null && (typeof target !== "string" || target.length > 400)) throw new SessionConflict("Invalid secure entry location");
  const cost = obj.priceEstimateCents ?? null;
  if (cost !== null && (!Number.isSafeInteger(cost) || (cost as number) < 0 || (cost as number)>1e12)) throw new SessionConflict("Invalid price estimate");
  const values = [obj.title,obj.instructions,target,...permissions].filter(Boolean).join("\n");
  if (apparentSecret.test(values)) throw new SessionConflict("Possible credential value detected; give only its name and secure entry location");
  return {
    runId:obj.runId,generation:obj.generation,actionKey:obj.actionKey.trim().toLowerCase(),
    title:obj.title.trim(),type:obj.type as OwnerActionType,condition:obj.condition as EscalationCondition,
    instructions:obj.instructions.trim(),requestedPermissions:permissions,
    secureEntryLocation:target as string|null,priceEstimateCents:cost as number|null
  };
}

export async function listOwnerActions(db:Pool,status:OwnerActionStatus|null){
  const records=await db.query(
    `SELECT a.action_id,a.title,a.action_type,a.instructions,a.requested_permissions,a.secure_entry_location,
      a.price_estimate_cents,a.status,a.created_at,a.updated_at,
      COALESCE(json_agg(json_build_object(
        'repositoryId',d.repository_id::text,'fullName',r.full_name,'unitId',d.unit_id
      ) ORDER BY r.full_name,d.repository_id,d.unit_id) FILTER (WHERE d.repository_id IS NOT NULL),'[]'::json) AS affected
    FROM owner_actions a
    LEFT JOIN owner_action_dependents d ON d.action_id=a.action_id
    LEFT JOIN repositories r ON r.repository_id=d.repository_id
    WHERE ($1::text IS NULL OR a.status=$1)
    GROUP BY a.action_id
    ORDER BY CASE WHEN a.status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION') THEN 0 ELSE 1 END,a.created_at ASC
    LIMIT 100`,
    [status]
  );
  return records.rows;
}

export async function createOwnerAction(db:Pool,credentialId:string,input:OwnerActionInput):Promise<{actionId:string;status:string}>{
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const assignment=await client.query<{repository_id:string;unit_id:string|null}>(
      "SELECT a.repository_id,a.unit_id FROM work_assignments a JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id AND l.generation=a.lease_generation JOIN agent_runs r ON r.run_id=a.run_id WHERE a.run_id=$1 AND r.credential_id=$2 AND r.state='RUNNING' AND l.generation=$3::bigint AND l.expires_at>now() AND a.released_at IS NULL",
      [input.runId,credentialId,input.generation]
    );
    if (assignment.rowCount !== 1) throw new SessionConflict("No current exclusive authorized assignment");
    const {repository_id:repositoryId,unit_id:unitId}=assignment.rows[0];
    const result=await client.query<{action_id:string;status:string}>(
      `INSERT INTO owner_actions(action_key,title,action_type,instructions,requested_permissions,secure_entry_location,price_estimate_cents,source_run_id)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
       ON CONFLICT (action_key) WHERE status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION')
       DO UPDATE SET updated_at=now()
       RETURNING action_id,status`,
      [input.actionKey,input.title,input.type,input.instructions,JSON.stringify(input.requestedPermissions),input.secureEntryLocation,input.priceEstimateCents,input.runId]
    );
    const action=result.rows[0];
    await client.query(
      `INSERT INTO owner_action_dependents(action_id,repository_id,unit_id) VALUES($1,$2,$3)
       ON CONFLICT (action_id,repository_id) DO UPDATE
       SET unit_id=CASE WHEN owner_action_dependents.unit_id = excluded.unit_id
         THEN excluded.unit_id ELSE NULL END`,
      [action.action_id,repositoryId,unitId]
    );
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'owner_action.requested',$3::jsonb)",
      [input.runId,repositoryId,JSON.stringify({actionId:action.action_id,type:input.type,condition:input.condition})]
    );
    await client.query("COMMIT");
    return {actionId:action.action_id,status:action.status};
  }catch(error){await client.query("ROLLBACK");throw error}
  finally{client.release()}
}
