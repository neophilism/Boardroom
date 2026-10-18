import type {Pool} from "pg";
import {advanceAssignedWork} from "./chain.ts";
import {yieldAndClaim} from "./continuation.ts";
import {SessionConflict} from "./sessions.ts";

/** Compatibility for installed connections whose cached tool list predates
 * yield-and-claim. The old advance signature now also hands off pending work.
 * It never treats a handoff as a merge or changes prerequisite state. */
export async function continueAssignedWork(db:Pool,runId:string,credentialId:string,generation:string){
  let merged=false;
  try{
    const next=await advanceAssignedWork(db,runId,credentialId,generation);
    if(next.status==="NEXT_UNIT")return next;
    merged=true;
  }catch(error){
    if(!(error instanceof SessionConflict)||
      !error.message.startsWith("Current unit needs observed merge evidence before chaining:"))throw error;
  }
  const next=await yieldAndClaim(db,runId,credentialId,generation,merged?"COMPLETED":"YIELDED");
  return {...next,continuationRequired:next.status==="ASSIGNED",
    nextAction:next.status==="ASSIGNED"?
      "Load boardroom_context using the returned assignment generation and continue this same activation.":
      "No unattempted eligible work was found. Make a bounded Coffee pass and finish the unassigned run."};
}
