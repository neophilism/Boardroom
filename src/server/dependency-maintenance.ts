import type {Pool} from "pg";
import {githubAppRequest} from "./github-app.ts";

/**
 * Bounded, credential-free-from-agents maintenance for routine GitHub PR hygiene.
 * Only the trusted maintenance tick calls this module. PR titles, bodies, labels
 * and file contents are untrusted data, never operational instructions.
 *
 * The owner authorizes automatic PATCH-only dependency merges after exact-head
 * CI and strict manifest-diff checks, not major/minor or arbitrary bot changes.
 * No routine owner review request is necessary. An active repository lease,
 * a paused coordinator, missing CI, or ambiguous GitHub state fails closed.
 */
const DEPENDABOT_ID=49699333;
const COORDINATOR_LOGIN="boardroom-coordinator[bot]";
const MAX_PRS_PER_REPOSITORY=20;
const CHECK_INTERVAL_HOURS=12;

type GithubPr={
  number:number;state:string;draft:boolean;mergeable?:boolean|null;mergeable_state?:string;
  changed_files?:number;user?:{login?:string;id?:number};
  requested_reviewers?:Array<{login?:string}>;
  head?:{ref?:string;sha?:string;repo?:{id?:number}};
  base?:{ref?:string;sha?:string;repo?:{id?:number}};
};
type GithubFile={filename:string;status:string};
type CheckRun={name:string;status:string;conclusion:string|null};
type CheckSuite={status:string;conclusion:string|null};
type GithubApi=(method:"GET"|"POST"|"PUT"|"PATCH"|"DELETE",path:string,body?:unknown)=>Promise<unknown>;
export type DependencyScanReport={
  repository:string|null;inspected:number;ownerRequestsRemoved:number;
  merged:number;needsAgent:number;deferred:number;errors:number;noWork:boolean;
};

export function isAutomatedReviewNoise(pr:GithubPr,owner:string):boolean{
  if(pr.state!=="open"||pr.user?.login!==COORDINATOR_LOGIN&&
    !(pr.user?.login==="dependabot[bot]"&&pr.user?.id===DEPENDABOT_ID))return false;
  return Array.isArray(pr.requested_reviewers)&&
    pr.requested_reviewers.some(r=>r.login?.toLowerCase()===owner.toLowerCase());
}
export function isVerifiedDependabot(pr:GithubPr,repositoryId:string,branch:string):boolean{
  return pr.state==="open"&&pr.draft===false&&pr.user?.login==="dependabot[bot]"&&
    pr.user?.id===DEPENDABOT_ID&&Number.isSafeInteger(pr.number)&&pr.number>0&&
    pr.base?.ref===branch&&String(pr.base?.repo?.id)===repositoryId&&
    String(pr.head?.repo?.id)===repositoryId&&
    typeof pr.head?.ref==="string"&&pr.head.ref.startsWith("dependabot/")&&
    typeof pr.head?.sha==="string"&&/^[0-9a-f]{40}$/i.test(pr.head.sha)&&
    typeof pr.base?.sha==="string"&&/^[0-9a-f]{40}$/i.test(pr.base.sha);
}
export function exactHeadChecksPass(runs:unknown,suites:unknown,statuses:unknown):boolean{
  if(!runs||typeof runs!=="object"||!suites||typeof suites!=="object"||
    !statuses||typeof statuses!=="object")return false;
  const r=runs as {total_count?:number;check_runs?:CheckRun[]};
  const s=suites as {total_count?:number;check_suites?:CheckSuite[]};
  const l=statuses as {statuses?:Array<{state:string}>};
  if(!Number.isSafeInteger(r.total_count)||!r.total_count||r.total_count>100||
     !Array.isArray(r.check_runs)||r.check_runs.length!==r.total_count||
     !Number.isSafeInteger(s.total_count)||s.total_count!<0||s.total_count!>100||
     !Array.isArray(s.check_suites)||s.check_suites.length!==s.total_count||
     !Array.isArray(l.statuses))return false;
  if(!r.check_runs.some(c=>/verify|test|build|ci/i.test(c.name)))return false;
  return r.check_runs.every(c=>c.status==="completed"&&c.conclusion==="success")&&
    s.check_suites.every(c=>c.status==="completed"&&c.conclusion==="success")&&
    l.statuses.every(c=>c.state==="success");
}
function parsedVersion(v:unknown):number[]|null{
  if(typeof v!=="string"||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(v))return null;
  const parts=v.split(".").map(Number);
  return parts.every(Number.isSafeInteger)?parts:null;
}
export function safePackagePatch(before:unknown,after:unknown):boolean{
  if(!before||typeof before!=="object"||Array.isArray(before)||
     !after||typeof after!=="object"||Array.isArray(after))return false;
  const original=before as Record<string,unknown>,next=after as Record<string,unknown>;
  const restored=JSON.parse(JSON.stringify(next)) as Record<string,unknown>;
  let changed=0;
  for(const section of ["dependencies","devDependencies"]){
    const old=original[section],now=next[section];
    if(old===undefined&&now===undefined)continue;
    if(!old||typeof old!=="object"||Array.isArray(old)||
       !now||typeof now!=="object"||Array.isArray(now))return false;
    const a=old as Record<string,unknown>,b=now as Record<string,unknown>;
    if(Object.keys(a).sort().join("\0")!==Object.keys(b).sort().join("\0"))return false;
    for(const name of Object.keys(a)){
      if(a[name]===b[name])continue;
      // Node's type declarations must match the actual supported runtime;
      // typecheck alone cannot verify runtime APIs.
      if(name==="@types/node")return false;
      const oldV=parsedVersion(a[name]),newV=parsedVersion(b[name]);
      if(!oldV||!newV||oldV[0]!==newV[0]||oldV[1]!==newV[1]||newV[2]<=oldV[2])return false;
      (restored[section] as Record<string,unknown>)[name]=a[name];
      changed++;
    }
  }
  return changed>0&&changed<=3&&JSON.stringify(restored)===JSON.stringify(original);
}
export function safeDependencyPaths(files:unknown,expected:number|undefined):string[]|null{
  if(!Array.isArray(files)||files.length<2||files.length>12||
    !Number.isSafeInteger(expected)||expected!==files.length)return null;
  const manifests:string[]=[],locks:string[]=[];
  for(const item of files){
    const row=item as GithubFile;
    if(!row||row.status!=="modified"||typeof row.filename!=="string")return null;
    const p=row.filename;
    if(p==="pnpm-lock.yaml"||p==="package-lock.json"||p==="yarn.lock"||p==="npm-shrinkwrap.json")locks.push(p);
    else if(/^(?:[A-Za-z0-9_.-]+\/)*package\.json$/.test(p)&&!p.includes("..")&&
      !p.startsWith(".github/")&&!p.startsWith(".circleci/"))manifests.push(p);
    else return null;
  }
  return manifests.length>=1&&locks.length===1?manifests:null;
}
function githubSource(value:unknown):unknown{
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("INVALID_FILE");
  const v=value as {encoding?:string;content?:string;size?:number;type?:string};
  if(v.type!=="file"||v.encoding!=="base64"||typeof v.content!=="string"||
     typeof v.size!=="number"||v.size>100000||v.size<0)throw Error("INVALID_FILE");
  const buffer=Buffer.from(v.content.replace(/\s/g,""),"base64");
  if(buffer.length!==v.size)throw Error("INVALID_FILE");
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(buffer)) as unknown;
}
async function eligiblePatch(pr:GithubPr,api:string,request:GithubApi):Promise<boolean>{
  const sha=pr.head!.sha!,baseSha=pr.base!.sha!;
  const files=await request("GET",api+"/pulls/"+pr.number+"/files?per_page=100");
  const paths=safeDependencyPaths(files,pr.changed_files);
  if(!paths)return false;
  for(const p of paths){
    const path=p.split("/").map(encodeURIComponent).join("/");
    const [a,b]=await Promise.all([
      request("GET",api+"/contents/"+path+"?ref="+baseSha),
      request("GET",api+"/contents/"+path+"?ref="+sha)
    ]);
    if(!safePackagePatch(githubSource(a),githubSource(b)))return false;
  }
  return true;
}
async function passingCurrentChecks(sha:string,api:string,request:GithubApi):Promise<boolean>{
  const [runs,suites,statuses]=await Promise.all([
    request("GET",api+"/commits/"+sha+"/check-runs?per_page=100"),
    request("GET",api+"/commits/"+sha+"/check-suites?per_page=100"),
    request("GET",api+"/commits/"+sha+"/status?per_page=100")
  ]);
  return exactHeadChecksPass(runs,suites,statuses);
}
async function claimOneRepository(db:Pool,owner:string){
  const client=await db.connect();
  let open=false;
  try{
    await client.query("BEGIN");open=true;
    await client.query("SELECT pg_advisory_xact_lock(21413,0)");
    const result=await client.query<{repository_id:string;full_name:string}>(
      "SELECT r.repository_id::text,r.full_name FROM repositories r "+
      "LEFT JOIN repository_leases l ON l.repository_id=r.repository_id "+
      "WHERE r.enabled=TRUE AND r.archived=FALSE AND split_part(r.full_name,'/',1)=$1 "+
      "AND l.run_id IS NULL AND NOT EXISTS (SELECT 1 FROM audit_events e "+
      "WHERE e.repository_id=r.repository_id AND e.kind='maintenance.dependabot.started' "+
      "AND e.occurred_at>now()-interval '"+CHECK_INTERVAL_HOURS+" hours') "+
      "ORDER BY r.created_at,r.repository_id LIMIT 1",[owner]);
    const item=result.rows[0];
    if(item)await client.query(
      "INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.dependabot.started','{}'::jsonb)",
      [item.repository_id]);
    await client.query("COMMIT");open=false;
    return item??null;
  }catch(error){if(open)await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
/** One unleased registered repository per tick. A failure never triggers an
 * owner approval request or a bypass of required CI. Logs are bounded facts. */
export async function scanDependabotMaintenance(db:Pool,request:GithubApi=githubAppRequest,
  owner=process.env.BOARDROOM_GITHUB_OWNER??"neophilism"):Promise<DependencyScanReport>{
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(owner))throw Error("Invalid repository owner");
  const report:DependencyScanReport={repository:null,inspected:0,ownerRequestsRemoved:0,
    merged:0,needsAgent:0,deferred:0,errors:0,noWork:false};
  const paused=await db.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
  if(paused.rows[0]?.paused){report.noWork=true;return report;}
  const selected=await claimOneRepository(db,owner);
  if(!selected){report.noWork=true;return report;}
  report.repository=selected.full_name;
  const repoApi="/repos/"+selected.full_name.split("/").map(encodeURIComponent).join("/");
  try{
    const repository=await request("GET",repoApi) as {id?:number;default_branch?:string};
    if(String(repository.id)!==selected.repository_id||typeof repository.default_branch!=="string")throw Error("REPO_CHANGED");
    const pulls=await request("GET",repoApi+"/pulls?state=open&sort=created&direction=asc&per_page="+MAX_PRS_PER_REPOSITORY);
    if(!Array.isArray(pulls))throw Error("INVALID_PULLS");
    for(const candidate of pulls as GithubPr[]){
      if(report.inspected>=MAX_PRS_PER_REPOSITORY)break;
      report.inspected++;
      if(!Number.isSafeInteger(candidate.number)||candidate.number<1)continue;
      try{
        if(isAutomatedReviewNoise(candidate,owner)){
          await request("DELETE",repoApi+"/pulls/"+candidate.number+"/requested_reviewers",{reviewers:[owner]});
          report.ownerRequestsRemoved++;
        }
        if(!isVerifiedDependabot(candidate,selected.repository_id,repository.default_branch))continue;
        // Only one automatic dependency merge per repository per scan to limit
        // independent changes and allow its main-branch CI to settle.
        if(report.merged){report.deferred++;continue;}
        const current=await request("GET",repoApi+"/pulls/"+candidate.number) as GithubPr;
        if(!isVerifiedDependabot(current,selected.repository_id,repository.default_branch)||
          current.head?.sha!==candidate.head?.sha||
          current.mergeable!==true||current.mergeable_state!=="clean"){report.deferred++;continue;}
        const compatible=await eligiblePatch(current,repoApi,request);
        if(!compatible){
          report.needsAgent++;
          await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.dependabot.needs_agent',$2::jsonb)",
            [selected.repository_id,JSON.stringify({prNumber:candidate.number,reason:"NOT_STRICT_PATCH_UPDATE"})]);
          continue;
        }
        if(!await passingCurrentChecks(current.head!.sha!,repoApi,request)){report.deferred++;continue;}
        // The merge endpoint's SHA condition rejects races with Dependabot
        // rebases; a new scan independently rechecks source and CI.
        await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.dependabot.merge_intent',$2::jsonb)",
          [selected.repository_id,JSON.stringify({prNumber:candidate.number,headSha:current.head!.sha})]);
        const result=await request("PUT",repoApi+"/pulls/"+candidate.number+"/merge",
          {sha:current.head!.sha,merge_method:"squash"}) as {merged?:boolean;sha?:string};
        if(!result?.merged||typeof result.sha!=="string")throw Error("MERGE_UNCONFIRMED");
        report.merged++;
        await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.dependabot.merged',$2::jsonb)",
          [selected.repository_id,JSON.stringify({prNumber:candidate.number,headSha:current.head!.sha,mergeSha:result.sha})]);
      }catch{
        report.errors++;
        // The outcome of a timed-out GitHub write might be uncertain. Do not
        // immediately replay it; the next tick checks authoritative PR state.
      }
    }
  }catch{report.errors++;}
  await db.query("INSERT INTO audit_events(repository_id,kind,details) VALUES($1,'maintenance.dependabot.completed',$2::jsonb)",
    [selected.repository_id,JSON.stringify({...report,repository:undefined})]);
  return report;
}
