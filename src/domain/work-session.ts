export const TARGET_WORK_SECONDS=50*60;
export const DEFAULT_MAX_SESSION_SECONDS=55*60;
/** Every project uses the original arrival clock; a handoff never restarts it. */
export function workSession(startedAt:Date,maxSessionSeconds=DEFAULT_MAX_SESSION_SECONDS,now=Date.now()){
  const start=startedAt.getTime();
  if(!Number.isFinite(start)||!Number.isSafeInteger(maxSessionSeconds)||maxSessionSeconds<60)
    throw new Error("Invalid work-session clock");
  const deadline=start+maxSessionSeconds*1000;
  const targetSeconds=maxSessionSeconds<240?TARGET_WORK_SECONDS:Math.min(TARGET_WORK_SECONDS,maxSessionSeconds-180);
  const target=start+targetSeconds*1000;
  return {startedAt:startedAt.toISOString(),targetWorkSeconds:targetSeconds,
    workUntilAt:new Date(target).toISOString(),deadlineAt:new Date(deadline).toISOString(),
    elapsedSeconds:Math.max(0,Math.floor((now-start)/1000)),
    remainingWorkSeconds:Math.max(0,Math.ceil((target-now)/1000)),
    shouldContinue:now<Math.min(target,deadline-60000),
    targetFitsRuntime:target<=deadline-60000};
}
