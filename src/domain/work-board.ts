export type WorkBoardStatus = "UNASSIGNED"|"RUNNING"|"RECOVERING"|"UNKNOWN";
export type LeaseState={
  runId:string|null;
  runState:string|null;
  leaseExpiresAt:string|null;
  lastHeartbeatAt:string|null;
};

/** A database lease alone never proves a live process; UNKNOWN is not healthy. */
export function classifyLease(lease:LeaseState,now=Date.now()):WorkBoardStatus{
  if(!lease.runId)return "UNASSIGNED";
  if(lease.runState==="RECOVERING")return "RECOVERING";
  if(lease.runState!=="RUNNING")return "UNKNOWN";
  if(!lease.leaseExpiresAt||!lease.lastHeartbeatAt)return "UNKNOWN";
  const expires=Date.parse(lease.leaseExpiresAt);
  const heartbeat=Date.parse(lease.lastHeartbeatAt);
  if(!Number.isFinite(expires)||!Number.isFinite(heartbeat))return "UNKNOWN";
  if(expires<=now)return "RECOVERING";
  // Fresh heartbeat and bounded lease indicate a registered run, not proof of
  // actual healthy work; do not infer completion from this classification.
  return "RUNNING";
}

export function formatEastern(timestamp:string|null):string{
  if(!timestamp)return "No verified update";
  const date=new Date(timestamp);
  if(!Number.isFinite(date.getTime()))return "Invalid timestamp";
  return new Intl.DateTimeFormat("en-US",{
    timeZone:"America/New_York",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"
  }).format(date);
}
