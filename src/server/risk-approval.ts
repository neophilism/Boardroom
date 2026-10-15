import {createHash} from "node:crypto";
import type {Pool} from "pg";

export const RISK_CATEGORIES=["SPENDING","DESTRUCTIVE_ACTION","PRIVILEGE_CHANGE","LEGAL_OR_POLITICAL","PRODUCTION_RELEASE"] as const;
export type RiskCategory=typeof RISK_CATEGORIES[number];
export type RiskIntent={category:RiskCategory;target:string;summary:string;maxCostCents:number|null};
export type RiskApprovalSession={runId:string;generation:string};

export class RiskApprovalRejected extends Error{}

const secret=/(?:github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api.?key|secret|token)\s*[:=])/i;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const generation=/^[1-9][0-9]*$/;

export function parseRiskIntent(value:unknown):RiskIntent{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new RiskApprovalRejected("Structured risk intent required");
  const item=value as Record<string,unknown>;
  if(Object.keys(item).some(key=>!["category","target","summary","maxCostCents"].includes(key)))
    throw new RiskApprovalRejected("Unexpected risk intent field");
  if(typeof item.category!=="string"||!RISK_CATEGORIES.includes(item.category as RiskCategory))
    throw new RiskApprovalRejected("Supported risk category required");
  if(typeof item.target!=="string"||item.target.trim().length<3||item.target.length>240||/[\x00-\x1f\x7f]/.test(item.target)||secret.test(item.target))
    throw new RiskApprovalRejected("Safe bounded risk target required");
  if(typeof item.summary!=="string"||item.summary.trim().length<12||item.summary.length>1000||secret.test(item.summary))
    throw new RiskApprovalRejected("Specific secret-free risk summary required");
  const maxCost=item.maxCostCents??null;
  if(maxCost!==null&&(!Number.isSafeInteger(maxCost)||(maxCost as number)<0||(maxCost as number)>1e12))
    throw new RiskApprovalRejected("Invalid maximum cost");
  if(item.category==="SPENDING"&&(maxCost===null||(maxCost as number)<1))
    throw new RiskApprovalRejected("Spending approval requires a positive maximum cost");
  if(item.category!=="SPENDING"&&maxCost!==null)
    throw new RiskApprovalRejected("Only spending approvals may set a maximum cost");
  return {category:item.category as RiskCategory,target:item.target.trim(),summary:item.summary.trim(),maxCostCents:maxCost as number|null};
}

export function riskIntentDigest(intent:RiskIntent):string{
  return createHash("sha256").update(JSON.stringify([intent.category,intent.target,intent.summary,intent.maxCostCents])).digest("hex");
}

export function riskApprovalActionKey(intent:RiskIntent):string{
  return `approval:${intent.category.toLowerCase()}:${riskIntentDigest(intent)}`;
}

export function renderRiskApprovalRequest(session:RiskApprovalSession,value:unknown){
  if(!uuid.test(session.runId)||!generation.test(session.generation))throw new RiskApprovalRejected("Valid authorized session required");
  const intent=parseRiskIntent(value);
  const cost=intent.maxCostCents===null?"none":String(intent.maxCostCents);
  return {
    runId:session.runId,generation:session.generation,actionKey:riskApprovalActionKey(intent),
    title:`Approve ${intent.category.toLowerCase().replaceAll("_"," ")}: ${intent.target}`.slice(0,240),
    type:"APPROVAL",condition:"OWNER_APPROVAL",
    instructions:`Target: ${intent.target}\nRisk category: ${intent.category}\nMaximum cost cents: ${cost}\nExact action: ${intent.summary}\nApprove only this immutable intent; any change requires a new approval.`,
    requestedPermissions:[],secureEntryLocation:null,priceEstimateCents:intent.maxCostCents
  };
}

export async function verifyRiskApproval(db:Pool,actionId:string):Promise<{actionId:string;status:"VERIFIED"}>{
  if(!uuid.test(actionId))throw new RiskApprovalRejected("Valid risk approval action required");
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const result=await client.query<{action_id:string;action_key:string;action_type:string;status:string}>(
      "SELECT action_id,action_key,action_type,status FROM owner_actions WHERE action_id=$1 FOR UPDATE",
      [actionId]
    );
    const action=result.rows[0];
    const category=RISK_CATEGORIES.map(value=>value.toLowerCase()).join("|");
    if(!action||action.action_type!=="APPROVAL"||!new RegExp(`^approval:(?:${category}):[a-f0-9]{64}$`).test(action.action_key)||
       !["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"].includes(action.status))
      throw new RiskApprovalRejected("Risk approval is unavailable or already final");
    await client.query("UPDATE owner_actions SET status='VERIFIED',updated_at=now(),resolved_at=now() WHERE action_id=$1",[actionId]);
    await client.query("INSERT INTO audit_events(kind,details) VALUES('owner.risk_approval.verified',$1::jsonb)",[JSON.stringify({actionId})]);
    await client.query("COMMIT");
    return {actionId,status:"VERIFIED"};
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

export async function executeApprovedRisk<T>(
  db:Pool,runId:string,credentialId:string,generationValue:string,rawIntent:unknown,execute:()=>Promise<T>
):Promise<T>{
  if(!uuid.test(runId)||!uuid.test(credentialId)||!generation.test(generationValue))
    throw new RiskApprovalRejected("Valid authenticated session required");
  const intent=parseRiskIntent(rawIntent),digest=riskIntentDigest(intent),key=riskApprovalActionKey(intent);
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const approval=await client.query<{action_id:string;repository_id:string;unit_id:string|null}>(
      `SELECT oa.action_id,a.repository_id::text,a.unit_id
       FROM agent_runs ar
       JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
       JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id
         AND l.generation=a.lease_generation AND l.expires_at>now()
       JOIN owner_action_dependents d ON d.repository_id=a.repository_id AND (d.unit_id IS NULL OR d.unit_id=a.unit_id)
       JOIN owner_actions oa ON oa.action_id=d.action_id
       WHERE ar.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
         AND a.lease_generation=$3::bigint AND oa.action_key=$4
         AND oa.action_type='APPROVAL' AND oa.status='VERIFIED'
       FOR UPDATE OF oa`,
      [runId,credentialId,generationValue,key]
    );
    if(approval.rowCount!==1)throw new RiskApprovalRejected("Exact verified owner approval required");
    const row=approval.rows[0];
    const used=await client.query(
      "SELECT 1 FROM audit_events WHERE kind='owner.risk_approval.consumed' AND details->>'actionId'=$1 LIMIT 1",
      [row.action_id]
    );
    if(used.rowCount)throw new RiskApprovalRejected("Owner approval was already consumed");
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,'owner.risk_approval.consumed',$3::jsonb)",
      [runId,row.repository_id,JSON.stringify({actionId:row.action_id,unitId:row.unit_id,category:intent.category,intentDigest:digest})]
    );
    await client.query("COMMIT");committed=true;
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
  return execute();
}
