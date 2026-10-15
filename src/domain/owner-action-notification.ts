export const OWNER_ACTION_NOTIFICATION_MINIMUM_AGE_MS=24*60*60*1000;
export const OWNER_ACTION_NOTIFICATION_REPEAT_MS=24*60*60*1000;
export const OWNER_ACTION_NOTIFICATION_RESERVATION_MS=30*60*1000;

export type OwnerActionNotificationCandidate={
  actionId:string;
  type:string;
  status:string;
  createdAt:Date;
  lastDeliveredAt:Date|null;
  lastReservedAt:Date|null;
};

export type OwnerActionNotificationBatch={
  actionIds:string[];
  subject:string;
  text:string;
};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTypes=new Set(["ACCOUNT","CREDENTIAL","PURCHASE","APPROVAL","HUMAN_INPUT","OTHER"]);
const allowedStatuses=new Set(["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"]);

function privateOrigin(value:string):string{
  const url=new URL(value);
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)
    throw new Error("A credential-free HTTPS Boardroom origin is required");
  return url.origin;
}

function validDate(value:Date|null):value is Date{return value instanceof Date&&Number.isFinite(value.getTime())}

export function buildOwnerActionNotificationBatch(
  candidates:readonly OwnerActionNotificationCandidate[],
  publicUrl:string,
  observedAt=new Date()
):OwnerActionNotificationBatch|null{
  if(!validDate(observedAt))throw new Error("Valid notification observation time required");
  const origin=privateOrigin(publicUrl),now=observedAt.getTime();
  const unique=new Map<string,OwnerActionNotificationCandidate>();
  for(const candidate of candidates){
    if(!uuid.test(candidate.actionId)||!allowedTypes.has(candidate.type)||!allowedStatuses.has(candidate.status)||
        !validDate(candidate.createdAt)||candidate.createdAt.getTime()>now)continue;
    if(now-candidate.createdAt.getTime()<OWNER_ACTION_NOTIFICATION_MINIMUM_AGE_MS)continue;
    if(validDate(candidate.lastDeliveredAt)&&now-candidate.lastDeliveredAt.getTime()<OWNER_ACTION_NOTIFICATION_REPEAT_MS)continue;
    if(validDate(candidate.lastReservedAt)&&now-candidate.lastReservedAt.getTime()<OWNER_ACTION_NOTIFICATION_RESERVATION_MS)continue;
    const prior=unique.get(candidate.actionId);
    if(!prior||candidate.createdAt<prior.createdAt)unique.set(candidate.actionId,candidate);
  }
  const selected=[...unique.values()].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()||a.actionId.localeCompare(b.actionId)).slice(0,100);
  if(!selected.length)return null;
  const counts=new Map<string,number>();
  for(const action of selected)counts.set(action.type,(counts.get(action.type)??0)+1);
  const lines=[
    `${selected.length} Boardroom owner action${selected.length===1?"":"s"} need attention.`,
    "",
    ...[...counts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([type,count])=>`${type.replaceAll("_"," ")}: ${count}`),
    "",
    "Open each private action:",
    ...selected.map(action=>{
      const days=Math.floor((now-action.createdAt.getTime())/86400000);
      return `- ${action.status.replaceAll("_"," ")} / ${action.type.replaceAll("_"," ")} / ${days} day${days===1?"":"s"}: ${origin}/owner-actions/${action.actionId}`;
    }),
    "",
    "Sensitive request details are available only after signing in to Boardroom."
  ];
  return {
    actionIds:selected.map(action=>action.actionId),
    subject:`Boardroom: ${selected.length} owner action${selected.length===1?"":"s"} need attention`,
    text:lines.join("\n")
  };
}
