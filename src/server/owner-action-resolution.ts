import type {Pool} from "pg";

export class OwnerActionResolutionRejected extends Error {}

export type OwnerActionVerification = {
  kind:string;
  evidenceId:string;
  verified:boolean;
};

export type OwnerActionResponse = {
  status:"OPEN"|"ACKNOWLEDGED"|"AWAITING_VERIFICATION"|"DECLINED";
  note:string|null;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const evidenceId=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,180}$/;
const apparentSecret=/(?:github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:password|api.?key|secret|token)\s*[:=])/i;

function parseActionId(value:string){
  if(!uuid.test(value))throw new OwnerActionResolutionRejected("Valid owner action ID required");
}

function boundedNote(value:unknown,required:boolean):string|null{
  if(value===undefined||value===null||value===""){
    if(required)throw new OwnerActionResolutionRejected("A secret-free clarification or rejection note is required");
    return null;
  }
  if(typeof value!=="string"||value.trim().length<12||value.length>1000||apparentSecret.test(value))
    throw new OwnerActionResolutionRejected("A bounded secret-free owner note is required");
  return value.trim();
}

export function parseOwnerActionResponse(value:unknown):OwnerActionResponse{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new OwnerActionResolutionRejected("Structured owner response required");
  const item=value as Record<string,unknown>;
  if(Object.keys(item).some(key=>!["status","note"].includes(key)))
    throw new OwnerActionResolutionRejected("Unexpected owner response field");
  const status=String(item.status??"");
  if(!["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION","DECLINED"].includes(status))
    throw new OwnerActionResolutionRejected("Unsupported owner transition");
  return {status:status as OwnerActionResponse["status"],note:boundedNote(item.note,status==="OPEN"||status==="DECLINED")};
}

export async function respondToOwnerAction(db:Pool,actionId:string,rawResponse:unknown){
  parseActionId(actionId);
  const response=parseOwnerActionResponse(rawResponse);
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const current=await client.query<{status:string}>(
      "SELECT status FROM owner_actions WHERE action_id=$1 FOR UPDATE",[actionId]
    );
    if(current.rowCount!==1)throw new OwnerActionResolutionRejected("Owner action not found");
    const prior=current.rows[0].status;
    const allowed:Record<string,readonly string[]>={
      OPEN:["ACKNOWLEDGED","AWAITING_VERIFICATION","DECLINED"],
      ACKNOWLEDGED:["OPEN","AWAITING_VERIFICATION","DECLINED"],
      AWAITING_VERIFICATION:["OPEN","DECLINED"]
    };
    if(!allowed[prior]?.includes(response.status))
      throw new OwnerActionResolutionRejected("Owner action transition is unavailable");
    await client.query(
      "UPDATE owner_actions SET status=$2,updated_at=now(),resolved_at=CASE WHEN $2='DECLINED' THEN now() ELSE NULL END WHERE action_id=$1",
      [actionId,response.status]
    );
    const kind=response.status==="OPEN"?"owner_action.clarification_requested":
      response.status==="DECLINED"?"owner_action.declined":"owner_action.owner_responded";
    await client.query("INSERT INTO audit_events(kind,details) VALUES($1,$2::jsonb)",[
      kind,JSON.stringify({actionId,status:response.status,priorStatus:prior,...(response.note?{note:response.note}:{})})
    ]);
    await client.query("COMMIT");committed=true;
    return {actionId,status:response.status};
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}

export async function resolveVerifiedOwnerAction(
  db:Pool,actionId:string,verification:OwnerActionVerification
):Promise<{actionId:string;status:"VERIFIED";requeued:{repositoryId:string;unitId:string|null}[]}>{
  parseActionId(actionId);
  if(!verification||verification.verified!==true||typeof verification.kind!=="string"||
      !/^[a-z][a-z0-9._-]{2,80}$/.test(verification.kind)||
      typeof verification.evidenceId!=="string"||!evidenceId.test(verification.evidenceId)||
      apparentSecret.test(verification.evidenceId))
    throw new OwnerActionResolutionRejected("Verified bounded fulfillment evidence required");
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const current=await client.query<{action_type:string;status:string}>(
      "SELECT action_type,status FROM owner_actions WHERE action_id=$1 FOR UPDATE",[actionId]
    );
    if(current.rowCount!==1)throw new OwnerActionResolutionRejected("Owner action not found");
    const action=current.rows[0];
    if(action.action_type==="APPROVAL")
      throw new OwnerActionResolutionRejected("Risk approvals use the exact approval verifier");
    if(action.status!=="AWAITING_VERIFICATION")
      throw new OwnerActionResolutionRejected("Owner action is not awaiting verification");
    const dependents=await client.query<{repository_id:string;unit_id:string|null}>(`
      SELECT d.repository_id::text,d.unit_id FROM owner_action_dependents d
      WHERE d.action_id=$1 AND NOT EXISTS(
        SELECT 1 FROM owner_action_dependents other
        JOIN owner_actions a ON a.action_id=other.action_id
        WHERE other.action_id<>$1 AND other.repository_id=d.repository_id
          AND (other.unit_id IS NULL OR d.unit_id IS NULL OR other.unit_id=d.unit_id)
          AND a.status NOT IN ('VERIFIED','CANCELLED')
      )
      ORDER BY d.repository_id,d.unit_id NULLS FIRST`,[actionId]);
    await client.query(
      "UPDATE owner_actions SET status='VERIFIED',updated_at=now(),resolved_at=now() WHERE action_id=$1",[actionId]
    );
    const requeued=dependents.rows.map(row=>({repositoryId:row.repository_id,unitId:row.unit_id}));
    await client.query("INSERT INTO audit_events(kind,details) VALUES('owner_action.fulfillment_verified',$1::jsonb)",[
      JSON.stringify({actionId,verificationKind:verification.kind,evidenceId:verification.evidenceId,requeued})
    ]);
    await client.query("COMMIT");committed=true;
    return {actionId,status:"VERIFIED",requeued};
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
