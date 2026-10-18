import {WorkMappingConflict} from "./work-branch.ts";
import {SessionConflict} from "./sessions.ts";
import {AssignmentConflict,AssignmentRefreshPending} from "./assignment.ts";
import {GithubWriteValidation} from "./github-write-gateway.ts";
import {GitHubAppError,GitHubAppSetupFailure} from "./github-app.ts";
import {CoffeeError,CoffeeRateLimit} from "./coffee.ts";
import {RunnerBudgetBlocked} from "./budget-errors.ts";

type Failure={code:string;message:string;nextAction:string;retryable:boolean};
/** Only application-controlled errors are returned to an authenticated agent.
 * Never serialize raw exceptions, provider responses, SQL, or credentials. */
export function agentToolFailure(error:unknown){
  let failure:Failure={code:"SERVICE_UNAVAILABLE",message:"Boardroom could not complete the operation.",
    nextAction:"Reconcile the current assignment, source or PR before a bounded retry. If the service remains unavailable, report the blocker; do not assume the write failed or release succeeded.",retryable:true};
  if(error instanceof AssignmentRefreshPending)failure={code:"ASSIGNMENT_REFRESH_PENDING",message:error.message,
    nextAction:"No repository lease was granted. Keep the same admitted runId and retry boardroom_claim with bounded backoff (at most three retries). Do not call arrive again or classify this as IDLE. If synchronization remains unavailable, report the exact error and use an evidenced capability stop; preserve the recurring schedule.",retryable:true};
  else if(error instanceof RunnerBudgetBlocked)failure={code:error.code,message:error.message,
    nextAction:"Stop paid work, checkpoint remote progress and finish. Request an owner spending decision privately if required.",retryable:false};
  else if(error instanceof WorkMappingConflict)failure={code:"PR_MAPPING_CONFLICT",message:error.message,
    nextAction:"Re-read the approved PR links and current assignment once. Do not rename branches or bypass scope. Save a checkpoint and call boardroom_yield_and_claim (or boardroom_advance for an older connection) to continue another eligible unit or project; record the mapping defect for repair.",retryable:false};
  else if(error instanceof CoffeeRateLimit)failure={code:"COFFEE_RATE_LIMIT",message:error.message,
    nextAction:"Wait at least ten minutes before posting again, or checkpoint and continue eligible work. Do not create a new activation to bypass the credential-level limit.",retryable:true};
  else if(error instanceof GitHubAppSetupFailure)failure={code:"GITHUB_SETUP_REQUIRED",message:"GitHub App setup or connectivity is unavailable ("+error.issue+").",
    nextAction:"Create a private Owner Action with this diagnostic and ask the owner to verify /system. Never request a secret value in chat.",retryable:false};
  else if(error instanceof GitHubAppError){
    const conflict=[404,409,422].includes(error.httpStatus),access=[401,403].includes(error.httpStatus);
    failure={code:conflict?"GITHUB_CONFLICT":access?"GITHUB_ACCESS_UNAVAILABLE":"GITHUB_UNAVAILABLE",message:"GitHub returned HTTP "+error.httpStatus+".",
      nextAction:conflict?"Read the current source snapshot or PR evidence and reconcile the existing result before retrying with the observed SHA.":
        access?"Check GitHub access and rate limits through a private Owner Action. Do not loop or bypass the scoped gateway.":
        "Use bounded backoff, renew a still-live lease and reconcile GitHub state before retrying. Checkpoint and yield if the outage persists.",retryable:!access};
  }else if(error instanceof GithubWriteValidation||error instanceof CoffeeError)failure={
    code:"INPUT_REJECTED",message:error.message,nextAction:"Correct the request using the tool contract. If an owner authorization is required, request it privately; do not bypass the restriction.",retryable:false};
  else if(error instanceof SessionConflict||error instanceof AssignmentConflict){
    const message=error.message;
    if(message.startsWith("Merge blocked: "))failure={code:"MERGE_BLOCKED",message,
      nextAction:"Read current PR evidence. Fix actionable failures. For pending CI or an unresolved unit-specific gate, checkpoint and call boardroom_yield_and_claim or boardroom_advance to continue other eligible work in the same run. Use a private Owner Action only for genuinely owner-only decisions.",retryable:false};
    else if(message==="Owner paused execution")failure={code:"EXECUTION_PAUSED",message,
      nextAction:"Stop writes, checkpoint remote progress and finish. Only the owner can resume execution.",retryable:false};
    else if(message==="Session time budget exhausted; checkpoint and finish")failure={code:"SESSION_LIMIT",message,
      nextAction:"Checkpoint remote progress and finish. Do not start another unit or extend the session limit.",retryable:false};
    else if(message==="Technical question prerequisite unresolved or retry evidence consumed")failure={code:"PREREQUISITE_BLOCKED",message,
      nextAction:"Search Coffee Corner and obtain fresh source-backed answers for every unresolved question. Verify and persist accepted answers through immutable repository ADRs before merging. Checkpoint and yield if the technical blocker remains. Do not replay consumed evidence or bypass the write gate.",retryable:false};
    else if(["Approved work-unit prerequisite unresolved","Cross-repository compatibility prerequisite unresolved","Owner action prerequisite unresolved"].includes(message))failure={code:"PREREQUISITE_BLOCKED",message,
      nextAction:"Checkpoint and use boardroom_yield_and_claim or boardroom_advance to continue another eligible unit or repository in the same activation. A prerequisite must be independently verified or the private Owner Action resolved before writes can resume. Do not override the dependency or approval.",retryable:false};
    else failure={code:"SESSION_CONFLICT",message,
      nextAction:"Reconcile the request and current assignment. Heartbeat only a still-live lease; if renewal is rejected, stop writes and report recovery needed. Never reclaim or assume release of another run's assignment.",retryable:false};
  }
  return {isError:true,content:[{type:"text" as const,text:JSON.stringify(failure)}],structuredContent:{error:failure}};
}
