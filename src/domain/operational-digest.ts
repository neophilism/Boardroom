export type RecordedGitHubActivity={kind:"COMMIT"|"PR_OPENED"|"PR_READY"|"PR_MERGED";repository:string;unitId:string|null;observedAt:string;url:string;checksUrl:string|null};
const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Emit only allowlisted receipts from the GitHub gateway, never arbitrary
 * checkpoint assertions, provider text, error bodies or stored URLs. */
export function recordedGitHubActivity(row:{kind:string;repository:string|null;details:unknown;occurredAt:Date}):RecordedGitHubActivity|null{
  if(!row.repository||!/^[-A-Za-z0-9_.]+\/[-A-Za-z0-9_.]+$/.test(row.repository)||!Number.isFinite(row.occurredAt.getTime()))return null;
  const d=object(row.details);if(!d)return null;
  const result=object(d.result);
  const base="https://github.com/"+row.repository;
  const common={repository:row.repository,unitId:typeof d.unitId==="string"?d.unitId:null,observedAt:row.occurredAt.toISOString()};
  if(row.kind==="github.write.upsert_file"&&typeof result?.commitSha==="string"&&/^[a-f0-9]{40}$/i.test(result.commitSha))
    return {...common,kind:"COMMIT",url:base+"/commit/"+result.commitSha,checksUrl:null};
  const number=row.kind==="github.pr.merged"?d.number:result?.number;
  if(!Number.isSafeInteger(number)||(number as number)<1)return null;
  const kind=row.kind==="github.write.open_draft_pr"?"PR_OPENED":row.kind==="github.write.ready_pr"?"PR_READY":row.kind==="github.pr.merged"?"PR_MERGED":null;
  return kind?{...common,kind,url:base+"/pull/"+number,checksUrl:base+"/pull/"+number+"/checks"}:null;
}

export function actionAge(createdAt:Date,observedAt:Date):{days:number;attention:"NEW"|"PENDING"|"OVERDUE"}{
  const days=Math.max(0,Math.floor((observedAt.getTime()-createdAt.getTime())/86400000));
  return {days,attention:days>=7?"OVERDUE":days>=1?"PENDING":"NEW"};
}

export function safeRevision(value:unknown):string|null{
  return typeof value==="string"&&/^[a-f0-9]{40}$/i.test(value)?value:null;
}
