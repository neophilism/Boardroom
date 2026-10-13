import {safeWorkBranch} from "../server/github-write-gateway.ts";

export type ResumeProgress={summary?:string;nextAction?:string;prNumber:number|null};
/** Checkpoints are hints, never proof of checks, authority, or PR scope. */
export function checkpointProgress(checkpoint:unknown,unitId:string):ResumeProgress{
  const empty:ResumeProgress={prNumber:null};
  if(!checkpoint||typeof checkpoint!=="object"||Array.isArray(checkpoint))return empty;
  const c=checkpoint as Record<string,unknown>;
  if(c.branch!==safeWorkBranch(unitId)||!c.state||typeof c.state!=="object"||Array.isArray(c.state))return empty;
  const s=c.state as Record<string,unknown>;
  return {
    ...(typeof s.summary==="string"?{summary:s.summary}:{}),
    ...(typeof s.nextAction==="string"?{nextAction:s.nextAction}:{}),
    prNumber:Number.isSafeInteger(s.prNumber)&&(s.prNumber as number)>0?s.prNumber as number:null
  };
}

export function resumablePrNumber(evidence:unknown,snapshotSha:string):number|null{
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))return null;
  const pr=(evidence as Record<string,unknown>).pullRequest;
  if(!pr||typeof pr!=="object"||Array.isArray(pr))return null;
  const p=pr as Record<string,unknown>;
  if(!Number.isSafeInteger(p.number)||(p.number as number)<1||p.headSha!==snapshotSha||
    (p.state!=="open"&&!(p.state==="closed"&&typeof p.mergedAt==="string")))return null;
  return p.number as number;
}
