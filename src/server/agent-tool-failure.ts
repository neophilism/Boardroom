import {SessionConflict} from "./sessions.ts";
import {AssignmentConflict} from "./assignment.ts";
import {GithubWriteValidation} from "./github-write-gateway.ts";
import {GitHubAppError,GitHubAppSetupFailure} from "./github-app.ts";
import {CoffeeError} from "./coffee.ts";
import {RunnerBudgetBlocked} from "./budget-errors.ts";

type Failure={code:string;message:string;nextAction:string;retryable:boolean};
/** Only application-controlled errors are returned to an authenticated agent.
 * Never serialize raw exceptions, provider responses, SQL, or credentials. */
export function agentToolFailure(error:unknown){
  let failure:Failure={code:"SERVICE_UNAVAILABLE",message:"Boardroom could not complete the operation.",
    nextAction:"Reconcile the current assignment, source or PR before a bounded retry. If the service remains unavailable, report the blocker; do not assume the write failed or release succeeded.",retryable:true};
  if(error instanceof RunnerBudgetBlocked)failure={code:error.code,message:error.message,
    nextAction:"Stop paid work, checkpoint remote progress and finish. Request an owner spending decision privately if required.",retryable:false};
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
      nextAction:"Read current PR evidence. Resolve failed checks; wait for pending checks; create a private Owner Action for required policy or review. Checkpoint and yield if it cannot be resolved in this run.",retryable:false};
    else if(message==="Owner paused execution")failure={code:"EXECUTION_PAUSED",message,
      nextAction:"Stop writes, checkpoint remote progress and finish. Only the owner can resume execution.",retryable:false};
    else if(message==="Session time budget exhausted; checkpoint and finish")failure={code:"SESSION_LIMIT",message,
      nextAction:"Checkpoint remote progress and finish. Do not start another unit or extend the session limit.",retryable:false};
    else failure={code:"SESSION_CONFLICT",message,
      nextAction:"Reconcile the request and current assignment. Heartbeat only a still-live lease; if renewal is rejected, stop writes and report recovery needed. Never reclaim or assume release of another run's assignment.",retryable:false};
  }
  return {isError:true,content:[{type:"text" as const,text:JSON.stringify(failure)}],structuredContent:{error:failure}};
}
