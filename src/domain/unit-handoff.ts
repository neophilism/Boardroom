export const EXTERNAL_UNIT_BLOCKERS=["PR_MAPPING_CONFLICT","GITHUB_ACCESS_UNAVAILABLE","GITHUB_UNAVAILABLE",
  "SERVICE_UNAVAILABLE","MERGE_BLOCKED","REPOSITORY_CREDENTIAL_UNAVAILABLE","HARDWARE_UNAVAILABLE","DEPENDENCY_UNAVAILABLE"] as const;
export type UnitHandoff={reason:"IMPLEMENTATION_COMPLETE_WAITING_CI";implementationComplete:true;
  remainingImplementation:[];acceptanceEvidence:string[];prNumber:number}|{
  reason:"EXTERNAL_BLOCKER";code:typeof EXTERNAL_UNIT_BLOCKERS[number];operation:string;observedError:string;
  unblockedImplementationRemaining:[]};
/** A draft or unfinished acceptance criteria alone never authorize handoff.
 * External observations remain agent reports; current PR/CI is checked separately.
 */
export function unitHandoffReport(value:unknown):UnitHandoff|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const row=value as Record<string,unknown>;
  if(row.reason==="IMPLEMENTATION_COMPLETE_WAITING_CI"&&row.implementationComplete===true&&
    Array.isArray(row.remainingImplementation)&&row.remainingImplementation.length===0&&
    Number.isSafeInteger(row.prNumber)&&Number(row.prNumber)>0&&
    Array.isArray(row.acceptanceEvidence)&&row.acceptanceEvidence.length>0&&row.acceptanceEvidence.length<=30&&
    row.acceptanceEvidence.every(x=>typeof x==="string"&&x.length<=1000&&
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/blob\/[a-f0-9]{40}\//i.test(x)))return row as UnitHandoff;
  if(row.reason==="EXTERNAL_BLOCKER"&&EXTERNAL_UNIT_BLOCKERS.includes(row.code as typeof EXTERNAL_UNIT_BLOCKERS[number])&&
    typeof row.operation==="string"&&row.operation.trim().length>0&&row.operation.length<=160&&
    typeof row.observedError==="string"&&row.observedError.trim().length>=20&&row.observedError.length<=1000&&
    Array.isArray(row.unblockedImplementationRemaining)&&row.unblockedImplementationRemaining.length===0)return row as UnitHandoff;
  return null;
}
