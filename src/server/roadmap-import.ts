import type {GitHubPull} from "./github-app.ts";
import {parsePrRegistry,attachObservedWorkIds,type ExternalDependency,type PrUnit} from "../../registry/pr-contract.mjs";
export {titleWorkUnitIds} from "../../registry/pr-contract.mjs";
export type PlanUnit={
  id:string;title:string;dependsOn:string[];pullRequests:number[];
  status:"PENDING"|"OPEN_PR"|"MERGED"|"UNKNOWN";acceptanceCriteria:string|null;
  externalDependencies?:ExternalDependency[];externalPrerequisites?:string[];sourceMetadata?:PrUnit;
};
export type CanonicalPlan={version:number;units:PlanUnit[];verified:boolean};
/** Only the shared repository-owned PR format is accepted. Live GitHub owns status. */
export function normalizeRoadmap(raw:unknown,fullName:string,pulls:readonly GitHubPull[]):CanonicalPlan{
  if(raw===null)return {version:0,units:[],verified:false};
  const {document,items}=parsePrRegistry(JSON.stringify(raw),fullName);
  const observed=attachObservedWorkIds(items,pulls);
  const byNumber=new Map(pulls.map(p=>[p.number,p]));
  const units:PlanUnit[]=observed.map((item,index)=>{
    let status:PlanUnit["status"]=item.ambiguous?"UNKNOWN":"PENDING";
    if(item.numbers.length){
      const records=item.numbers.map(n=>byNumber.get(n));
      if(records.some(p=>!p))status="UNKNOWN";
      else if(records.some(p=>p?.state==="open"))status="OPEN_PR";
      else if(records.every(p=>!!p?.merged_at))status="MERGED";
      else status="UNKNOWN";
    }
    const source=document.units[index];
    return {id:item.sourceItemId,title:item.title,dependsOn:item.dependsOn,
      pullRequests:item.numbers,status,acceptanceCriteria:typeof source.acceptanceCriteria==="string"?source.acceptanceCriteria:null,
      externalDependencies:item.externalDependencies,externalPrerequisites:item.externalPrerequisites,sourceMetadata:source};
  });
  return {version:document.roadmapVersion,units,verified:document.planVerified};
}
