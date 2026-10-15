import {isOwnerActionStatus,type OwnerActionStatus,type OwnerActionType} from "./owner-actions.ts";

export const OWNER_ACTION_TYPES=["ACCOUNT","CREDENTIAL","PURCHASE","APPROVAL","HUMAN_INPUT","OTHER"] as const;
export const OWNER_INBOX_SORTS=["ATTENTION","OLDEST","NEWEST","TYPE","STATUS"] as const;
export type OwnerInboxSort=typeof OWNER_INBOX_SORTS[number];
export type OwnerInboxFilters={status:OwnerActionStatus|null;type:OwnerActionType|null;sort:OwnerInboxSort};

function single(value:string|string[]|undefined):string|null{
  return typeof value==="string"?value:null;
}
export function parseOwnerInboxFilters(query:Record<string,string|string[]|undefined>):OwnerInboxFilters{
  const status=single(query.status);
  const type=single(query.type);
  const sort=single(query.sort);
  return {
    status:status&&isOwnerActionStatus(status)?status:null,
    type:type&&OWNER_ACTION_TYPES.includes(type as OwnerActionType)?type as OwnerActionType:null,
    sort:sort&&OWNER_INBOX_SORTS.includes(sort as OwnerInboxSort)?sort as OwnerInboxSort:"ATTENTION"
  };
}
type InboxRow={action_type:string;status:string;created_at:Date|string};
const active=new Set(["OPEN","ACKNOWLEDGED","AWAITING_VERIFICATION"]);
export function arrangeOwnerInbox<T extends InboxRow>(rows:T[],filters:OwnerInboxFilters):T[]{
  const selected=filters.type?rows.filter(row=>row.action_type===filters.type):[...rows];
  const created=(row:T)=>new Date(row.created_at).getTime();
  return selected.sort((a,b)=>{
    if(filters.sort==="OLDEST")return created(a)-created(b);
    if(filters.sort==="NEWEST")return created(b)-created(a);
    if(filters.sort==="TYPE")return a.action_type.localeCompare(b.action_type)||created(a)-created(b);
    if(filters.sort==="STATUS")return a.status.localeCompare(b.status)||created(a)-created(b);
    return Number(!active.has(a.status))-Number(!active.has(b.status))||created(a)-created(b);
  });
}
