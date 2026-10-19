import type {Pool} from "pg";
import {advanceAssignedWork,ChainHandoffRequired,type ChainHandoffReason} from "./chain.ts";
import {yieldAndClaim} from "./continuation.ts";

type ContinuationOperations={advance:typeof advanceAssignedWork;handoff:typeof yieldAndClaim};

/** Compatibility for installed connections whose cached tool list predates
 * yield-and-claim. The old advance signature now also hands off pending work.
 * It never treats a handoff as a merge or changes prerequisite state. */
export function createWorkContinuation(operations:ContinuationOperations={advance:advanceAssignedWork,handoff:yieldAndClaim}){
  return async function continueAssignedWork(db:Pool,runId:string,credentialId:string,generation:string){
    let merged=false,handoffReason:ChainHandoffReason|"REPOSITORY_EXHAUSTED"="REPOSITORY_EXHAUSTED";
    try{
      const next=await operations.advance(db,runId,credentialId,generation);
      if(next.status==="NEXT_UNIT")return next;
      merged=true;
    }catch(error){
      if(!(error instanceof ChainHandoffRequired))throw error;
      handoffReason=error.reason;
    }
    // This independently rechecks the live lease, saved checkpoint and pending
    // GitHub operation ledger. An observation error is never merge authority.
    const next=await operations.handoff(db,runId,credentialId,generation,merged?"COMPLETED":"YIELDED");
    return {...next,handoffReason,continuationRequired:next.status==="ASSIGNED",
      nextAction:next.status==="ASSIGNED"?
        "Load boardroom_context using the returned assignment generation and continue this same activation.":
        "No unattempted eligible work was found. Make a bounded Coffee pass and finish the unassigned run."};
  };
}

export const continueAssignedWork=createWorkContinuation();
