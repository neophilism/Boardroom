import type {Pool} from "pg";
import {resolveVerifiedOwnerAction} from "./owner-action-resolution.ts";

export const CREDENTIAL_REFERENCE_PROVIDERS=["render","github-actions","boardroom-runtime"] as const;
export type CredentialReferenceProvider=typeof CREDENTIAL_REFERENCE_PROVIDERS[number];
export type CredentialReference={provider:CredentialReferenceProvider;locator:string;secretName:string};
export type CredentialProbeResult={present:boolean;capabilities:string[];evidenceId:string|null};
export type CredentialCapabilityOutcome={
  actionId:string;present:boolean;verified:boolean;capabilities:string[];evidenceId:string|null;
};
export type CredentialCapabilityProbe=(input:{
  reference:CredentialReference;requiredCapabilities:string[];
})=>Promise<CredentialProbeResult>;

export class CredentialHandoffRejected extends Error{}

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const locator=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,240}$/;
const secretName=/^[A-Z][A-Z0-9_]{2,120}$/;
const evidenceId=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,180}$/;
const apparentCredentialValue=/(?:github_pat_|gh[pousr]_|sk-[A-Za-z0-9_-]{12,}|private.?key)/i;

export function credentialReferenceLocation(reference:CredentialReference):string{
  return `${reference.provider}://${reference.locator}/${reference.secretName}`;
}

export function parseCredentialReference(value:unknown):CredentialReference{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new CredentialHandoffRejected("Structured credential reference required");
  const item=value as Record<string,unknown>;
  if(typeof item.provider!=="string"||!CREDENTIAL_REFERENCE_PROVIDERS.includes(item.provider as CredentialReferenceProvider))
    throw new CredentialHandoffRejected("Unsupported secret-store provider");
  if(typeof item.locator!=="string"||!locator.test(item.locator)||item.locator.includes("//")||apparentCredentialValue.test(item.locator))
    throw new CredentialHandoffRejected("Invalid secret-store locator");
  if(typeof item.secretName!=="string"||!secretName.test(item.secretName))
    throw new CredentialHandoffRejected("Invalid secret reference name");
  if(Object.keys(item).some(key=>!["provider","locator","secretName"].includes(key)))
    throw new CredentialHandoffRejected("Credential values and extra fields are forbidden");
  return {provider:item.provider as CredentialReferenceProvider,locator:item.locator,secretName:item.secretName};
}

function capabilityList(value:unknown,requireOne=true):string[]{
  if(!Array.isArray(value)||(requireOne&&value.length<1)||value.length>30||value.some(item=>typeof item!=="string"||item.length<2||item.length>180))
    throw new CredentialHandoffRejected("Credential action requires explicit bounded capabilities");
  return [...new Set(value)].sort();
}

export async function verifyCredentialHandoff(
  db:Pool,actionId:string,rawReference:unknown,probe:CredentialCapabilityProbe
):Promise<CredentialCapabilityOutcome>{
  if(!uuid.test(actionId))throw new CredentialHandoffRejected("Valid owner action ID required");
  const reference=parseCredentialReference(rawReference);
  const action=await db.query<{action_type:string;status:string;requested_permissions:unknown;secure_entry_location:string|null}>(
    "SELECT action_type,status,requested_permissions,secure_entry_location FROM owner_actions WHERE action_id=$1::uuid",
    [actionId]
  );
  if(action.rowCount!==1)throw new CredentialHandoffRejected("Credential action not found");
  const record=action.rows[0];
  if(record.action_type!=="CREDENTIAL")throw new CredentialHandoffRejected("Owner action is not a credential handoff");
  if(record.status!=="AWAITING_VERIFICATION")throw new CredentialHandoffRejected("Credential action is not awaiting verification");
  if(record.secure_entry_location!==credentialReferenceLocation(reference))
    throw new CredentialHandoffRejected("Credential reference does not match the approved secure-entry destination");
  const requiredCapabilities=capabilityList(record.requested_permissions);
  const result=await probe({reference,requiredCapabilities:[...requiredCapabilities]});
  const reportedCapabilities=capabilityList(result.capabilities,false).filter(item=>requiredCapabilities.includes(item));
  const safeEvidenceId=result.evidenceId===null?null:
    typeof result.evidenceId==="string"&&evidenceId.test(result.evidenceId)&&!apparentCredentialValue.test(result.evidenceId)?result.evidenceId:
      (()=>{throw new CredentialHandoffRejected("Invalid provider evidence identifier")})();
  const present=result.present===true;
  const capabilities=present?reportedCapabilities:[];
  const verified=present&&requiredCapabilities.every(item=>capabilities.includes(item));
  const outcome={actionId,present,verified,capabilities,evidenceId:safeEvidenceId};
  await db.query(
    "INSERT INTO audit_events(kind,details) VALUES('owner_action.credential_capability_checked',$1::jsonb)",
    [JSON.stringify({provider:reference.provider,...outcome})]
  );
  if(verified)await resolveVerifiedOwnerAction(db,actionId,{
    kind:"credential_capability",
    evidenceId:safeEvidenceId??reference.provider+":capability-check",
    verified:true
  });
  return outcome;
}
