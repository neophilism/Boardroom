/** Only bounded, pre-existing server records appear in owner activity profiles. */
export function activityCursor(value:unknown):string|null{
  if(typeof value!=="string"||!/^[1-9][0-9]{0,17}$/.test(value))return null;
  return value;
}
export function eventDescription(kind:string):string{
  const descriptions:Record<string,string>={
    "agent.run.admitted":"Session admitted","agent.run.finished":"Session finished",
    "agent.run.idle_completed":"Session finished without assignment",
    "agent.run.recovery_hold":"Session held for recovery",
    "agent.run.oauth_fenced_and_released":"Prior session fenced and released",
    "agent.assignment.claimed":"Work unit assigned","agent.assignment.yielded":"Work unit released",
    "agent.assignment.refresh_deferred":"Repository refresh deferred",
    "agent.work.advanced":"Work advanced","agent.unit.handoff_basis":"Work handoff recorded",
    "github.write.ensure_branch":"GitHub branch prepared","github.write.commit_files":"Files committed",
    "github.write.upsert_file":"GitHub file updated","github.write.open_draft_pr":"Draft pull request opened",
    "github.write.ready_pr":"Pull request marked ready","github.pr.merged":"Pull request merged",
    "github.pr.merge_denied":"Pull request merge denied",
    "coffee.question.created":"Coffee Corner discussion opened",
    "coffee.answer.posted":"Coffee Corner answer posted",
    "coffee.answer.accepted_in_adr":"Answer accepted in repository ADR",
    "owner_action.requested":"Owner decision requested"
  };
  return descriptions[kind]??kind.replaceAll("."," · ").replaceAll("_"," ");
}
export function githubEvidenceUrl(repo:string|null,kind:"commit"|"pull",value:string|null):string|null{
  if(!repo||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||!value)return null;
  if(kind==="commit"&&!/^[0-9a-f]{40}$/i.test(value))return null;
  if(kind==="pull"&&!/^[1-9][0-9]{0,8}$/.test(value))return null;
  return "https://github.com/"+repo+"/"+kind+"/"+value;
}
export function safeEventPaths(value:unknown):string[]{
  if(!Array.isArray(value))return [];
  return value.filter((x):x is string=>typeof x==="string"&&x.length>0&&x.length<=240&&
    !/[\u0000-\u001f]/.test(x)).slice(0,20);
}
export function safeUuidLink(value:unknown):string|null{
  return typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value:null;
}
