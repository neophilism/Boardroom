import type {GitHubPull} from "./github-app.ts";

export type PlanUnit={
  id:string;title:string;dependsOn:string[];pullRequests:number[];
  status:"PENDING"|"OPEN_PR"|"MERGED"|"UNKNOWN";acceptanceCriteria:string|null;
};
export type CanonicalPlan={version:number;units:PlanUnit[];verified:boolean};

function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Expected roadmap object");
  return value as Record<string,unknown>;
}
function refToNumber(value:unknown,repo:string):number{
  if(typeof value==="number"&&Number.isSafeInteger(value)&&value>0)return value;
  if(typeof value==="string"){
    const match=value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/i);
    if(match&&match[1].toLowerCase()===repo.toLowerCase())return Number(match[2]);
  }
  throw new Error("Invalid or cross-repository PR reference");
}
/** A PR may explicitly advance more than one stable unit, e.g. BR-044/047. */
export function titleWorkUnitIds(title:string):string[]{
  const match=title.match(/^([A-Z][A-Z0-9]*-\d+)((?:\/(?:[A-Z][A-Z0-9]*-)?\d+)*)(?::|\s|$)/i);
  if(!match)return [];
  const ids=[match[1]];
  const prefix=match[1].slice(0,match[1].indexOf("-")+1);
  for(const value of match[2].split("/").filter(Boolean)){
    ids.push(value.includes("-")?value:prefix+value);
  }
  return ids;
}
function codeMatch(id:string,title:string):boolean{
  return titleWorkUnitIds(title).includes(id);
}
export function normalizeRoadmap(raw:unknown,fullName:string,pulls:readonly GitHubPull[]):CanonicalPlan{
  if(raw===null)return {version:0,units:[],verified:false};
  const p=record(raw);
  if(p.repository!==fullName || p.planVerified===false)return {version:0,units:[],verified:false};
  const version=p.version;
  if(!Number.isInteger(version)||(version as number)<1)throw new Error("Invalid roadmap version");
  if(!Array.isArray(p.milestones)||p.plannedPrCount!==p.milestones.length)
    throw new Error("Roadmap planned count does not match milestone array length");
  const ids=new Set<string>();
  const mapped=p.milestones.map(rawMilestone=>{
    const m=record(rawMilestone);
    if(typeof m.id!=="string"||m.id.length<2||m.id.length>128||ids.has(m.id))
      throw new Error("Missing or duplicate stable work-unit ID");
    ids.add(m.id);
    if(typeof m.title!=="string"||!m.title.trim())throw new Error("Missing unit title");
    const dependsOn=m.dependsOn??[];
    if(!Array.isArray(dependsOn)||dependsOn.some(x=>typeof x!=="string"))
      throw new Error("Invalid work-unit dependencies");
    const refs=m.pullRequests??[];
    if(!Array.isArray(refs))throw new Error("Invalid linked PR references");
    const explicit=refs.map(x=>refToNumber(x,fullName));
    const inferred=pulls.filter(p=>codeMatch(m.id as string,p.title)).map(p=>p.number);
    // One approved unit can be implemented across several follow-up PRs.
    // Explicit references and exact title mappings both contribute evidence.
    const linked=[...new Set([...explicit,...inferred])].sort((a,b)=>a-b);
    let status:PlanUnit["status"]="PENDING";
    if(linked.length){
      const records=linked.map(n=>pulls.find(p=>p.number===n));
      if(records.some(p=>!p))status="UNKNOWN";
      else if(records.some(p=>p?.state==="open"))status="OPEN_PR";
      else if(records.every(p=>!!p?.merged_at))status="MERGED";
      else status="UNKNOWN"; // Closed-but-unmerged needs actual review.
    }
    return {
      id:m.id,title:m.title.trim(),dependsOn:dependsOn as string[],
      pullRequests:linked,status,
      acceptanceCriteria:typeof m.acceptanceCriteria==="string"?m.acceptanceCriteria:null
    };
  });
  return {version:version as number,units:mapped,verified:true};
}
