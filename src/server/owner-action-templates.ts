import {parseOwnerAction,type OwnerActionInput,type OwnerActionType,type EscalationCondition} from "./owner-actions.ts";
import {SessionConflict} from "./sessions.ts";

export const OWNER_ACTION_TEMPLATES=["ACCOUNT","CREDENTIAL","PURCHASE","APPROVAL"] as const;
export type OwnerActionTemplate=typeof OWNER_ACTION_TEMPLATES[number];
type TemplatePolicy={type:OwnerActionType;condition:EscalationCondition;title:string};
const policies:Record<OwnerActionTemplate,TemplatePolicy>={
  ACCOUNT:{type:"ACCOUNT",condition:"OWNER_ACCOUNT_CREATION",title:"Create external account"},
  CREDENTIAL:{type:"CREDENTIAL",condition:"OWNER_CREDENTIAL_PROVISION",title:"Provision scoped credential"},
  PURCHASE:{type:"PURCHASE",condition:"OWNER_PURCHASE",title:"Approve required purchase"},
  APPROVAL:{type:"APPROVAL",condition:"OWNER_APPROVAL",title:"Record owner approval"}
};
export type OwnerActionTemplateInput={
  runId:unknown;generation:unknown;actionKey:unknown;template:unknown;targetSystem:unknown;
  requestedAction:unknown;requestedPermissions?:unknown;prerequisites:unknown;
  secureEntryLocation?:unknown;priceEstimateCents?:unknown;verificationMethod:unknown;
};
function line(value:unknown,label:string,min=3,max=300):string{
  if(typeof value!=="string")throw new SessionConflict(label+" required");
  const normalized=value.trim().replace(/\s+/g," ");
  if(normalized.length<min||normalized.length>max)throw new SessionConflict("Invalid "+label.toLowerCase());
  return normalized;
}
function list(value:unknown,label:string,min:number,max:number):string[]{
  if(!Array.isArray(value)||value.length<min||value.length>max)
    throw new SessionConflict(label+" must contain "+min+"-"+max+" concise entries");
  return value.map(item=>line(item,label.slice(0,-1),2,180));
}
export function renderOwnerActionTemplate(input:OwnerActionTemplateInput):OwnerActionInput{
  if(typeof input.template!=="string"||!OWNER_ACTION_TEMPLATES.includes(input.template as OwnerActionTemplate))
    throw new SessionConflict("Supported owner action template required");
  const template=input.template as OwnerActionTemplate;
  const policy=policies[template];
  const targetSystem=line(input.targetSystem,"Target system",3,180);
  const requestedAction=line(input.requestedAction,"Requested action",10,600);
  const prerequisites=list(input.prerequisites,"Prerequisites",1,12);
  const requestedPermissions=list(input.requestedPermissions??[],"Requested permissions",template==="CREDENTIAL"?1:0,30);
  const verificationMethod=line(input.verificationMethod,"Verification method",10,600);
  const secureEntryLocation=input.secureEntryLocation??null;
  const priceEstimateCents=input.priceEstimateCents??null;
  if(template==="CREDENTIAL"&&(typeof secureEntryLocation!=="string"||secureEntryLocation.trim().length<5))
    throw new SessionConflict("Credential template requires a secure entry location");
  if(template==="PURCHASE"&&priceEstimateCents===null)
    throw new SessionConflict("Purchase template requires an expected expense");
  const instructions=[
    `Target system: ${targetSystem}`,
    `Requested action: ${requestedAction}`,
    "Prerequisites:",
    ...prerequisites.map(item=>`- ${item}`),
    `Verification: ${verificationMethod}`
  ].join("\n");
  return parseOwnerAction({
    runId:input.runId,generation:input.generation,actionKey:input.actionKey,
    title:`${policy.title}: ${targetSystem}`,type:policy.type,condition:policy.condition,
    instructions,requestedPermissions,secureEntryLocation,priceEstimateCents
  });
}
