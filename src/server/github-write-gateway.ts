import type {Pool} from "pg";
import {SessionConflict,isValidGeneration,isValidRunId} from "./sessions.ts";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {commitAssignedFiles} from "./github-atomic-commit.ts";
import {assertWorkPrerequisites} from "./work-prerequisites.ts";

type RepoScope={repository_id:string;full_name:string;unit_id:string;title:string};
export type GithubWrite=
  |{kind:"ensure_branch"}
  |{kind:"commit_files";expectedHeadSha:string;message:string;files:{path:string;contentBase64:string|null}[]}
  |{kind:"upsert_file";path:string;contentBase64:string;expectedSha:string|null;message:string}
  |{kind:"open_draft_pr";description:string}
  |{kind:"ready_pr";number:number};

export class GithubWriteValidation extends Error{
  constructor(message:string){super(message);this.name="GithubWriteValidation";}
}
const validSha=(s:unknown):s is string=>typeof s==="string"&&/^[a-f0-9]{40}$/i.test(s);
const danger=/\b(?:github_pat_[a-z0-9_]{12,}|gh[pousr]_[a-z0-9]{20,}|sk-[a-z0-9_-]{20,})\b|-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY/i;

export function safeRepositoryPath(input:unknown):string{
  if(typeof input!=="string"||input.length<1||input.length>240||
    input.includes("\\")||/[\x00-\x1f\x7f]/.test(input)||
    !/^[a-zA-Z0-9_.@()+,\-/]+$/.test(input))
    throw new GithubWriteValidation("Invalid repository file path");
  const parts=input.split("/");
  if(parts.some(p=>p===""||p==="."||p===".."))
    throw new GithubWriteValidation("Path traversal or empty path component forbidden");
  const key=input.toLowerCase();
  if(key.startsWith(".github/")||key.startsWith(".circleci/")||key.startsWith("registry/")||
    key==="agents.md"||key==="render.yaml"||
    parts.some(p=>p.toLowerCase().startsWith(".env")||[".git",".npmrc",".pypirc",".ssh",".aws","secrets"].includes(p.toLowerCase()))||
    /\.(?:pem|p12|pfx|key)$/i.test(input))
    throw new GithubWriteValidation("Protected path requires owner authorization");
  return input;
}
export function safeWorkBranch(unitId:string):string{
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{1,100}$/.test(unitId)||
     unitId.includes("..")||unitId.endsWith(".lock"))
    throw new GithubWriteValidation("Work-unit ID cannot safely form a branch");
  return "boardroom/"+unitId;
}
function decodeSourceBase64(data:unknown):string{
  if(typeof data!=="string"||data.length>280000||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
    throw new GithubWriteValidation("Invalid bounded base64 text");
  const bytes=Buffer.from(data,"base64");
  if(bytes.length>200000)throw new GithubWriteValidation("File exceeds 200 KB");
  let text:string;
  try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);}
  catch{throw new GithubWriteValidation("Source file must contain UTF-8 text");}
  if(text.includes("\0")||danger.test(text))
    throw new GithubWriteValidation("Possible raw credential or binary content forbidden");
  return text;
}
export function parseGithubWrite(value:unknown):GithubWrite{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new GithubWriteValidation("JSON operation object required");
  const v=value as Record<string,unknown>;
  if(v.kind==="ensure_branch")return {kind:"ensure_branch"};
  if(v.kind==="commit_files"){
    if(!validSha(v.expectedHeadSha)||!Array.isArray(v.files)||v.files.length<1||v.files.length>50)
      throw new GithubWriteValidation("A snapshot head SHA and 1-50 source files are required");
    // Reuse the single-file policy for every addition, edit and deletion.
    const files=v.files.map(file=>{
      if(!file||typeof file!=="object"||Array.isArray(file)||Object.keys(file).some(k=>!["path","contentBase64"].includes(k)))
        throw new GithubWriteValidation("Invalid source file change");
      const f=file as Record<string,unknown>;
      const validated=parseGithubWrite({kind:"upsert_file",path:f.path,contentBase64:f.contentBase64===null?"":f.contentBase64,message:v.message});
      if(validated.kind!=="upsert_file")throw new GithubWriteValidation("Invalid source file change");
      return {path:validated.path,contentBase64:f.contentBase64 as string|null};
    });
    const paths=files.map(f=>f.path);
    if(new Set(paths).size!==paths.length||paths.some(p=>paths.some(other=>other!==p&&other.startsWith(p+"/"))))
      throw new GithubWriteValidation("Duplicate or overlapping source paths are forbidden");
    if(files.reduce((bytes,f)=>bytes+(f.contentBase64===null?0:Buffer.from(f.contentBase64,"base64").length),0)>200000)
      throw new GithubWriteValidation("Combined source changes exceed 200 KB");
    return {kind:"commit_files",expectedHeadSha:v.expectedHeadSha,message:(v.message as string).trim(),files};
  }
  if(v.kind==="upsert_file"){
    const path=safeRepositoryPath(v.path);
    decodeSourceBase64(v.contentBase64);
    const expectedSha=v.expectedSha??null;
    if(expectedSha!==null&&!validSha(expectedSha))
      throw new GithubWriteValidation("Expected existing-file blob SHA must be valid");
    if(typeof v.message!=="string"||v.message.trim().length<8||
       v.message.length>200||/[\r\n]/.test(v.message)||danger.test(v.message))
      throw new GithubWriteValidation("Invalid commit message");
    return {kind:"upsert_file",path,contentBase64:v.contentBase64 as string,
      expectedSha,message:v.message.trim()};
  }
  if(v.kind==="open_draft_pr"){
    const description=v.description??"";
    if(typeof description!=="string"||description.length>8000||danger.test(description))
      throw new GithubWriteValidation("Invalid PR description");
    return {kind:"open_draft_pr",description};
  }
  if(v.kind==="ready_pr"&&Number.isSafeInteger(v.number)&&(v.number as number)>0)
    return {kind:"ready_pr",number:v.number as number};
  throw new GithubWriteValidation("Unsupported write operation");
}
export function parseGithubWriteRequest(value:unknown){
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new GithubWriteValidation("JSON request required");
  const body=value as Record<string,unknown>;
  if(!isValidRunId(body.runId)||!isValidGeneration(body.generation))
    throw new GithubWriteValidation("Valid runId and generation required");
  if(["repository","repositoryId","fullName","owner","repo"].some(key=>Object.hasOwn(body,key)))
    throw new GithubWriteValidation("Repository scope is derived from the current assignment");
  const {runId,generation,...operation}=body;
  return {runId,generation,op:parseGithubWrite(operation)};
}
function repoParts(repo:string):{owner:string;name:string}{
  const parts=repo.split("/");
  if(parts.length!==2||parts.some(p=>!/^[a-zA-Z0-9_.-]{1,100}$/.test(p)))
    throw new GithubWriteValidation("Invalid repository identity");
  return {owner:parts[0],name:parts[1]};
}
async function defaultBranch(path:string):Promise<{base:string;sha:string}>{
  const info=await githubAppRequest("GET",path) as {default_branch?:string};
  const base=info.default_branch;
  if(!base||!/^[a-zA-Z0-9._/-]{1,100}$/.test(base))throw new GitHubAppError(503);
  const ref=await githubAppRequest("GET",path+"/git/ref/heads/"+base) as {object?:{sha?:string}};
  if(!validSha(ref.object?.sha))throw new GitHubAppError(503);
  return {base,sha:ref.object.sha};
}
async function doWrite(scope:RepoScope,op:GithubWrite){
  const {owner,name}=repoParts(scope.full_name);
  const repoPath="/repos/"+encodeURIComponent(owner)+"/"+encodeURIComponent(name);
  const branch=safeWorkBranch(scope.unit_id);
  if(op.kind==="commit_files")return commitAssignedFiles(repoPath,branch,op);
  if(op.kind==="ready_pr"){
    const pr=await githubAppRequest("GET",repoPath+"/pulls/"+op.number) as {node_id:string;draft:boolean;head:{ref:string;repo:{id:number}}};
    if(pr.head.ref!==branch||String(pr.head.repo.id)!==scope.repository_id)
      throw new SessionConflict("PR is outside the assigned work branch");
    if(!pr.draft)return {kind:"ready_pr",number:op.number,replay:true};
    const result=await githubAppRequest("POST","/graphql",{
      query:"mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number isDraft}}}",
      variables:{id:pr.node_id}}) as {errors?:unknown[]};
    if(result.errors?.length)throw new GitHubAppError(409);
    return {kind:"ready_pr",number:op.number,replay:false};
  }
  if(op.kind==="ensure_branch"){
    const {sha}=await defaultBranch(repoPath);
    try{
      const existing=await githubAppRequest("GET",repoPath+"/git/ref/heads/"+branch) as {object?:{sha?:string}};
      return {kind:"ensure_branch",branch,headSha:existing.object?.sha??null,created:false};
    }catch(error){
      if(!(error instanceof GitHubAppError)||error.httpStatus!==404)throw error;
    }
    try{
      const created=await githubAppRequest("POST",repoPath+"/git/refs",
        {ref:"refs/heads/"+branch,sha}) as {object?:{sha?:string}};
      return {kind:"ensure_branch",branch,headSha:created.object?.sha??sha,created:true};
    }catch(error){
      if(!(error instanceof GitHubAppError)||error.httpStatus!==422)throw error;
      const existing=await githubAppRequest("GET",repoPath+"/git/ref/heads/"+branch) as {object?:{sha?:string}};
      return {kind:"ensure_branch",branch,headSha:existing.object?.sha??null,created:false};
    }
  }
  if(op.kind==="upsert_file"){
    // An interrupted success is reconciled from GitHub before attempting PUT.
    // Content equality prevents duplicate commits on a retried file write.
    try{
      const existing=await githubAppRequest("GET",repoPath+"/contents/"+
        op.path.split("/").map(encodeURIComponent).join("/")+"?ref="+encodeURIComponent(branch)) as
        {content?:string;sha?:string;encoding?:string};
      if(existing.encoding==="base64"&&existing.content?.replace(/\s/g,"")===op.contentBase64){
        const ref=await githubAppRequest("GET",repoPath+"/git/ref/heads/"+branch) as {object:{sha:string}};
        return {kind:"upsert_file",branch,path:op.path,blobSha:existing.sha,commitSha:ref.object.sha,replay:true};
      }
      if(existing.sha!==op.expectedSha)throw new GitHubAppError(409);
    }catch(error){
      if(!(error instanceof GitHubAppError)||error.httpStatus!==404)throw error;
      if(op.expectedSha!==null)throw new GitHubAppError(409);
    }
    const body:Record<string,unknown>={
      message:op.message,branch,content:op.contentBase64,
    };
    if(op.expectedSha)body.sha=op.expectedSha;
    const result=await githubAppRequest("PUT",repoPath+"/contents/"+
      op.path.split("/").map(encodeURIComponent).join("/"),body) as
      {content?:{sha?:string};commit?:{sha?:string}};
    return {kind:"upsert_file",branch,path:op.path,
      blobSha:result.content?.sha??null,commitSha:result.commit?.sha??null};
  }
  const {base}=await defaultBranch(repoPath);
  const open=await githubAppRequest("GET",
    repoPath+"/pulls?state=open&head="+encodeURIComponent(owner+":"+branch)+"&per_page=5") as
    Array<{number:number;html_url:string;draft:boolean}>;
  if(open.length){
    return {kind:"open_draft_pr",number:open[0].number,url:open[0].html_url,replay:true};
  }
  const created=await githubAppRequest("POST",repoPath+"/pulls",{
    head:branch,base,
    title:(scope.unit_id+": "+scope.title).slice(0,220),
    body:op.description||"Boardroom work unit "+scope.unit_id+". Requires verified checks and review before merging.",
    draft:true
  }) as {number:number;html_url:string};
  return {kind:"open_draft_pr",number:created.number,url:created.html_url,replay:false};
}

/** Hold the repository lease-row lock through the external GitHub write.
 * Recovery, finish and other writers must serialize on that row. Do not
 * implement a lease-timeout-only takeover or issue raw installation tokens to agents.
 */
export async function performFencedGithubWrite(db:Pool,runId:string,credentialId:string,
  generation:string,op:GithubWrite){
  if(!isValidRunId(runId)||!isValidGeneration(generation))
    throw new GithubWriteValidation("Invalid run identity");
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='25s'");
    const grant=await client.query<RepoScope>(
      `SELECT r.repository_id::text AS repository_id,r.full_name,a.unit_id,w.title
       FROM agent_runs ar
       JOIN agent_credentials c ON c.credential_id=ar.credential_id
       JOIN work_assignments a ON a.run_id=ar.run_id AND a.released_at IS NULL
       JOIN repository_leases l ON l.repository_id=a.repository_id AND l.run_id=a.run_id
         AND l.generation=a.lease_generation
       JOIN repositories r ON r.repository_id=a.repository_id
       JOIN roadmap_units w ON w.repository_id=a.repository_id AND w.unit_id=a.unit_id
       LEFT JOIN repository_execution_policy policy ON policy.repository_id=r.repository_id
       WHERE ar.run_id=$1 AND ar.credential_id=$2 AND ar.state='RUNNING'
         AND c.enabled=TRUE AND c.revoked_at IS NULL
         AND a.lease_generation=$3::bigint AND l.expires_at>now()+interval '25 seconds'
         AND r.enabled=TRUE AND r.archived=FALSE AND w.approved=TRUE
         AND ar.started_at>now()-make_interval(secs=>COALESCE(policy.max_session_seconds,1800))
       FOR UPDATE OF l`,
      [runId,credentialId,generation]
    );
    if(grant.rowCount!==1)throw new SessionConflict("Writable repo lease unavailable or needs heartbeat");
    const pause=await client.query<{paused:boolean}>("SELECT paused FROM execution_controls WHERE singleton=TRUE");
    if(pause.rows[0]?.paused)throw new SessionConflict("Owner paused execution");
    const scope=grant.rows[0];
    await assertWorkPrerequisites(client,scope.repository_id,scope.unit_id);
    const result=await doWrite(scope,op);
    await client.query(
      "INSERT INTO audit_events(run_id,repository_id,kind,details) VALUES($1,$2,$3,$4::jsonb)",
      [runId,scope.repository_id,"github.write."+op.kind,
        JSON.stringify({unitId:scope.unit_id,generation,kind:op.kind,
          path:op.kind==="upsert_file"?op.path:undefined,
          paths:op.kind==="commit_files"?op.files.map(f=>f.path):undefined,
          result})]
    );
    await client.query("COMMIT");committed=true;
    return {repository:scope.full_name,unitId:scope.unit_id,operation:result};
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
