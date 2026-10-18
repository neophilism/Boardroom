import {SessionConflict} from "./sessions.ts";
export class RunnerBudgetBlocked extends SessionConflict{
  readonly code:"API_DISABLED"|"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED";
  constructor(code:"API_DISABLED"|"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED"){
    super(code==="API_DISABLED"?"Paid API execution is disabled by the owner-controlled safety gate":
      code==="BUDGET_LIMIT"?"Aggregate daily spending limit reached":"Owner daily model spending cap is not configured");
    this.name="RunnerBudgetBlocked";this.code=code;
  }
}
