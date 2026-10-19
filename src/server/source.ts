import type {Pool} from "pg";
import {assignedScope,repositoryApiPath} from "./assignment-scope.ts";
import {githubAppRequest,GitHubAppError} from "./github-app.ts";
import {resolveAssignedWorkBranch} from "./work-branch.ts";
import {SessionConflict} from "./sessions.ts";

export function readableSourcePath(value:unknown):string{
  if(typeof value!=="string"||value.length<1||value.length>240||value.includes("\\")||/[\x00-\x1f\x7f]/.test(value))
    throw new SessionConflict("Invalid source path");
  const parts=value.split("/");
  if(parts.some(p=>!p||p==="."||p===".."||[".git",".ssh",".aws","secrets",".npmrc",".pypirc"].includes(p.toLowerCase()))||
    parts.some(p=>p.toLowerCase().startsWith(".env")&&p.toLowerCase()!==".env.example")||/\.(?:pem|p12|pfx|key)$/i.test(value))
    throw new SessionConflict("Protected source path");
  return value;
}
export async function readAssignedSource(db:Pool,runId:string,credentialId:string,generation:string,
  input:{kind:"tree"|"file"|"blob";path?:string;sha?:string}){
  const scope=await assignedScope(db,runId,credentialId,generation);
  const api=repositoryApiPath(scope.full_name);
  if(input.kind==="tree"){
    let sha:string;
    const branch=await resolveAssignedWorkBranch(db,scope);
    try{
      const ref=await githubAppRequest("GET",api+"/git/ref/heads/"+encodeURIComponent(branch)) as {object:{sha:string}};
      sha=ref.object.sha;
    }catch(error){
      if(!(error instanceof GitHubAppError)||error.httpStatus!==404)throw error;
      const info=await githubAppRequest("GET",api) as {default_branch:string};
      if(typeof info.default_branch!=="string")throw new GitHubAppError(503);
      const ref=await githubAppRequest("GET",api+"/git/ref/heads/"+encodeURIComponent(info.default_branch)) as {object:{sha:string}};
      sha=ref.object.sha;
    }
    if(!/^[a-f0-9]{40}$/i.test(sha))throw new GitHubAppError(503);
    const tree=await githubAppRequest("GET",api+"/git/trees/"+sha+"?recursive=1") as {
      truncated:boolean;tree:Array<{path:string;sha:string;type:string;mode:string;size?:number}>
    };
    if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length>20000)throw new SessionConflict("Source tree exceeds bounded snapshot; use a dedicated approved runtime");
    const entries=tree.tree.filter(e=>e.type==="blob"&&e.mode!=="120000").filter(e=>{
      try{readableSourcePath(e.path);return true;}catch{return false;}
    });
    await assignedScope(db,runId,credentialId,generation);
    return {repository:scope.full_name,branch,headSha:sha,entries,excludedSymlinksAndSecretPaths:true};
  }
  const path=readableSourcePath(input.path);
  if(!input.sha||!/^[a-f0-9]{40}$/i.test(input.sha))throw new SessionConflict("A snapshot commit SHA is required");
  const file=await githubAppRequest("GET",api+"/contents/"+path.split("/").map(encodeURIComponent).join("/")+"?ref="+input.sha) as {
    type:string;encoding:string;content:string;size:number;sha:string;
  };
  if(file.type!=="file"||file.encoding!=="base64"||typeof file.content!=="string"||file.size>1000000||file.content.length>1400000)
    throw new SessionConflict("Only bounded UTF-8 source files are readable");
  if(Buffer.from(file.content.replace(/\s/g,""),"base64").length!==file.size)throw new SessionConflict("Source size mismatch");
  if(input.kind==="blob"){
    await assignedScope(db,runId,credentialId,generation);
    return {path,sha:file.sha,contentBase64:file.content.replace(/\s/g,""),snapshotSha:input.sha};
  }
  let text:string;
  try{text=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.from(file.content.replace(/\s/g,""),"base64"));}
  catch{throw new SessionConflict("Source is not UTF-8 text");}
  if(text.includes("\0"))throw new SessionConflict("Binary source is unavailable through the text gateway");
  await assignedScope(db,runId,credentialId,generation);
  return {path,sha:file.sha,text,snapshotSha:input.sha};
}
