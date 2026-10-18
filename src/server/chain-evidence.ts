import type {CanonicalPlan,PlanUnit} from "./roadmap-import.ts";

/**
 * Only an independently fetched, verified registry plus live GitHub PR list may
 * change a chaining decision. Checkpoint prose, session success and PR comments
 * are not evidence. The caller checks the credential-bound lease twice.
 */
export type CurrentChainUnit={
  state:string;version:number;title:string;acceptance_criteria:string|null;
  depends_on:unknown;external_dependencies:unknown;external_prerequisites:unknown;
};
export type ChainMergeObservation={
  observedStatus:PlanUnit["status"];nextState:string;pullRequests:number[];
  canAdvance:boolean;reason:string;
};
function canonical(value:unknown):string{
  return JSON.stringify(value,(_key,item)=>{
    if(item!==null&&typeof item==="object"&&!Array.isArray(item))
      return Object.fromEntries(Object.entries(item as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)));
    return item;
  });
}

export function evaluateChainMergeEvidence(plan:CanonicalPlan,unitId:string,current:CurrentChainUnit):ChainMergeObservation{
  if(!plan.verified)throw new Error("Approved canonical work plan is not verified");
  const unit=plan.units.find(u=>u.id===unitId);
  if(!unit)throw new Error("Assigned work unit is no longer present in the verified plan");
  if(current.version!==plan.version||current.title!==unit.title||
      current.acceptance_criteria!==unit.acceptanceCriteria||
      canonical(current.depends_on)!==canonical(unit.dependsOn)||
      canonical(current.external_dependencies)!==canonical(unit.externalDependencies??[])||
      canonical(current.external_prerequisites)!==canonical(unit.externalPrerequisites??[]))
    throw new Error("Assigned work plan changed; resynchronize repository before chaining");
  let nextState:string=unit.status;
  if(current.state==="ACCEPTED"&&["PENDING","MERGED"].includes(unit.status))nextState="ACCEPTED";
  else if(current.state==="ACTIVE"&&unit.status==="PENDING")nextState="ACTIVE";
  else if(current.state==="BLOCKED"&&["PENDING","OPEN_PR"].includes(unit.status))nextState="BLOCKED";
  const canAdvance=nextState==="MERGED"||nextState==="ACCEPTED";
  const reason=canAdvance?"GITHUB_MERGE_OBSERVED":
    unit.status==="PENDING"?"NO_LINKED_PR":
    unit.status==="OPEN_PR"?"OPEN_PR_REMAINS":
    unit.status==="UNKNOWN"?"AMBIGUOUS_OR_UNMERGED_PR":"WORK_NOT_COMPLETE";
  return {observedStatus:unit.status,nextState,pullRequests:unit.pullRequests,canAdvance,reason};
}
