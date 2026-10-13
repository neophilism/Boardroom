import {SessionConflict} from "./sessions.ts";
export class RunnerBudgetBlocked extends SessionConflict{
  readonly code:"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED";
  constructor(code:"BUDGET_LIMIT"|"BUDGET_NOT_CONFIGURED"){
    super(code==="BUDGET_LIMIT"?"Aggregate daily spending limit reached":"Owner daily model spending cap is not configured");
    this.name="RunnerBudgetBlocked";this.code=code;
  }
}
