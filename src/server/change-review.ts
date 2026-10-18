/** A server-verified, fail-closed classification of PR filenames.
 * GitHub source files are untrusted: the agent cannot set its own risk category.
 * This protects sensitive controls, not every ordinary Boardroom self-update.
 */
export type ChangedFile={filename:string;status:string;previous_filename?:string};
export type ChangedFileRisk="ROUTINE"|"REVIEW_REQUIRED"|"UNVERIFIED";
const allowedStatuses=new Set(["added","modified","removed","renamed","copied","changed","unchanged"]);
export function isSensitivePath(raw:string):boolean{
  const path=raw.toLowerCase();
  if(/^(?:\.github\/|\.circleci\/|db\/migrations\/|infra\/|terraform\/|deploy\/|deployment\/|\.env(?:\.|$)|agents\.md$|codeowners$|dockerfile$|render\.yaml$)/.test(path))return true;
  if(/(?:^|\/)(?:oauth|auth|authentication|authorization|security|secrets?|credentials?|privileges?|permissions?|access[-_]?control|risk[-_]?approval|merge[-_]?policy|github[-_]?write[-_]?gateway|owner[-_]?session|owner[-_]?auth|production|release[-_]?policy|deploy(?:ment)?|billing|payments?)(?:[\/._-]|$)/.test(path))return true;
  // Direct privileged execution, token issuance, recovery, and internal maintenance
  // entry points also require review, even if the filename has a neutral label.
  if(/^src\/server\/(?:github-app|agent-auth|agent-tools|owner-actions?|owner-action-[^/]+|pr-action-reconciliation|sessions|assignment(?:-[^/]+)?|maintenance-auth|watchdog|readiness|work-prerequisites|operations|credential-handoff)(?:\.|\/|-)/.test(path))return true;
  if(/^app\/api\/(?:mcp\/|oauth\/|v1\/(?:owner\/|owner-actions\/|github\/|internal\/|runs\/|assignments\/))/.test(path))return true;
  if(/\.(?:tf|tfvars)$/.test(path))return true;
  return false;
}
export function classifyChangedFiles(files:unknown,reportedTotal:unknown):ChangedFileRisk{
  if(!Array.isArray(files)||!Number.isSafeInteger(reportedTotal)||typeof reportedTotal!=="number"||
    reportedTotal<1||reportedTotal>100||files.length!==reportedTotal)return "UNVERIFIED";
  let sensitive=false;
  for(const item of files){
    if(!item||typeof item!=="object")return "UNVERIFIED";
    const f=item as Partial<ChangedFile>;
    if(typeof f.filename!=="string"||!f.filename.length||!allowedStatuses.has(String(f.status))||
       (f.status==="renamed"&&typeof f.previous_filename!=="string"))return "UNVERIFIED";
    const names=[f.filename,...(f.previous_filename?[f.previous_filename]:[])];
    if(names.some(p=>p.length>400||p.startsWith("/")||p.includes("\\")||p.split("/").some(part=>!part||part==="."||part==="..")))
      return "UNVERIFIED";
    if(names.some(isSensitivePath))sensitive=true;
  }
  return sensitive?"REVIEW_REQUIRED":"ROUTINE";
}
