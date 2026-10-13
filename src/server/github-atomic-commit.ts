import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {SessionConflict} from "./sessions.ts";
import type {GithubWrite} from "./github-write-gateway.ts";

type CommitFiles=Extract<GithubWrite,{kind:"commit_files"}>;
type Commit={tree:{sha:string};parents:{sha:string}[];message:string};
type Entry={path:string;type:string;mode:string;sha:string};
const validSha=(s:unknown):s is string=>typeof s==="string"&&/^[a-f0-9]{40}$/i.test(s);

/** Internal only: invoke with validated input while holding the assignment's
 * repository lease lock. Git objects are staged first; only the final non-force
 * ref update makes the entire change visible to the branch and CI. */
export async function commitAssignedFiles(api:string,branch:string,op:CommitFiles,transport=githubAppRequest){
  const refPath=api+"/git/refs/heads/"+branch;
  const readHead=async()=>{
    const ref=await transport("GET",api+"/git/ref/heads/"+branch) as {object?:{sha?:string}};
    if(!validSha(ref.object?.sha))throw new GitHubAppError(503);
    return ref.object.sha;
  };
  const head=await readHead();
  const current=await transport("GET",api+"/git/commits/"+head) as Commit;
  const replay=head!==op.expectedHeadSha;
  if(replay&&(!Array.isArray(current.parents)||current.parents.length!==1||
    current.parents[0].sha!==op.expectedHeadSha||current.message!==op.message))throw new GitHubAppError(409);
  const base=replay?await transport("GET",api+"/git/commits/"+op.expectedHeadSha) as Commit:current;
  if(!validSha(base.tree?.sha)||!validSha(current.tree?.sha))throw new GitHubAppError(503);
  const snapshot=await transport("GET",api+"/git/trees/"+base.tree.sha+"?recursive=1") as {truncated:boolean;tree:Entry[]};
  if(snapshot.truncated||!Array.isArray(snapshot.tree)||snapshot.tree.length>20000)
    throw new SessionConflict("Source tree exceeds bounded snapshot; use a dedicated approved runtime");
  const entries=new Map(snapshot.tree.map(e=>[e.path,e]));
  const tree=op.files.map(file=>{
    const existing=entries.get(file.path),parts=file.path.split("/");
    for(let i=1;i<parts.length;i++){
      const parent=entries.get(parts.slice(0,i).join("/"));
      if(parent&&(parent.type!=="tree"||parent.mode!=="040000"))
        throw new SessionConflict("Source parent is not an ordinary directory");
    }
    if(existing&&(existing.type!=="blob"||!["100644","100755"].includes(existing.mode)))
      throw new SessionConflict("Only ordinary source files may be edited or deleted");
    if(file.contentBase64===null&&!existing)throw new GitHubAppError(409);
    const entry={path:file.path,mode:existing?.mode??"100644",type:"blob"};
    return file.contentBase64===null?{...entry,sha:null}:{...entry,content:Buffer.from(file.contentBase64,"base64").toString("utf8")};
  });
  const staged=await transport("POST",api+"/git/trees",{base_tree:base.tree.sha,tree}) as {sha?:string};
  if(!validSha(staged.sha))throw new GitHubAppError(503);
  if(replay){
    if(current.tree.sha!==staged.sha||await readHead()!==head)throw new GitHubAppError(409);
    return {kind:"commit_files" as const,branch,commitSha:head,treeSha:staged.sha,replay:true,changed:true};
  }
  if(staged.sha===base.tree.sha){
    if(await readHead()!==head)throw new GitHubAppError(409);
    return {kind:"commit_files" as const,branch,commitSha:head,treeSha:staged.sha,replay:false,changed:false};
  }
  const commit=await transport("POST",api+"/git/commits",{message:op.message,tree:staged.sha,parents:[head]}) as {sha?:string};
  if(!validSha(commit.sha))throw new GitHubAppError(503);
  if(await readHead()!==head)throw new GitHubAppError(409);
  const updated=await transport("PATCH",refPath,{sha:commit.sha,force:false}) as {object?:{sha?:string}};
  if(updated.object?.sha!==commit.sha)throw new GitHubAppError(503);
  return {kind:"commit_files" as const,branch,commitSha:commit.sha,treeSha:staged.sha,replay:false,changed:true};
}
