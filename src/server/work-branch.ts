import type {Pool,PoolClient} from "pg";
import {githubAppRequest} from "./github-app.ts";
import {repositoryApiPath} from "./assignment-scope.ts";
import {SessionConflict} from "./sessions.ts";

type WorkScope={repository_id:string;full_name:string;unit_id:string};
export type WorkPull={number:number;state?:string;merged?:boolean;merged_at?:string|null;
  head?:{ref?:string;sha?:string;repo?:{id?:number}};
  base?:{ref?:string;repo?:{id?:number}}};
export class WorkMappingConflict extends SessionConflict{}

export function validWorkBranch(branch:unknown):branch is string{
  return typeof branch==="string"&&branch.length<=180&&/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(branch)&&
    !branch.includes("..")&&!branch.includes("//")&&!branch.endsWith("/")&&
    branch.split("/").every(part=>!part.startsWith(".")&&!part.endsWith(".")&&!part.endsWith(".lock"));
}
export async function assignedPrNumbers(db:Pick<Pool|PoolClient,"query">,scope:WorkScope):Promise<number[]>{
  const result=await db.query<{planned_prs:unknown}>(
    "SELECT planned_prs FROM roadmap_units WHERE repository_id=$1 AND unit_id=$2 AND approved=TRUE",
    [scope.repository_id,scope.unit_id]);
  const numbers=result.rows[0]?.planned_prs;
  if(!Array.isArray(numbers)||numbers.length>100||numbers.some(n=>!Number.isSafeInteger(n)||n<1))
    throw new WorkMappingConflict("Approved work-unit PR mapping unavailable");
  return [...new Set(numbers)];
}
/** A branch convention is a default, not the identity of an imported PR.
 * Only server-imported approved links can authorize an alternate branch. */
export function assertAssignedPull(scope:WorkScope,number:number,links:readonly number[],pr:WorkPull):string{
  const branch=pr.head?.ref;
  if(pr.number!==number||String(pr.head?.repo?.id)!==scope.repository_id||
    String(pr.base?.repo?.id)!==scope.repository_id||!validWorkBranch(branch)||
    !/^[a-f0-9]{40}$/i.test(pr.head?.sha??"")||
    (branch!=="boardroom/"+scope.unit_id&&!links.includes(number)))
    throw new WorkMappingConflict("PR is not linked to the assigned approved work unit in this repository");
  return branch;
}

/** Source, writes, readiness and merge all use the same verified association.
 * Multiple open branches require explicit reconciliation, never a guessed write. */
export async function resolveAssignedWorkBranch(db:Pick<Pool|PoolClient,"query">,scope:WorkScope,
  writable=false,request:typeof githubAppRequest=githubAppRequest):Promise<string>{
  const numbers=await assignedPrNumbers(db,scope),api=repositoryApiPath(scope.full_name);
  const branches=new Set<string>();
  for(const number of numbers){
    const pr=await request("GET",api+"/pulls/"+number) as WorkPull;
    if(pr.state!=="open"||pr.merged||pr.merged_at)continue;
    branches.add(assertAssignedPull(scope,number,numbers,pr));
  }
  if(branches.size>1)throw new WorkMappingConflict("Multiple open branches are linked to this work unit; reconcile before writing");
  const branch=branches.values().next().value??"boardroom/"+scope.unit_id;
  if(!validWorkBranch(branch))throw new WorkMappingConflict("Invalid approved work branch");
  if(branches.size){
    const info=await request("GET",api) as {default_branch?:string};
    if(!validWorkBranch(info.default_branch)||branch===info.default_branch)
      throw new WorkMappingConflict("A work branch must differ from the repository default branch");
    if(writable){
      const current=await request("GET",api+"/branches/"+encodeURIComponent(branch)) as {name?:string;protected?:boolean};
      if(current.name!==branch||current.protected!==false)
        throw new WorkMappingConflict("Mapped work branch is protected or cannot be verified writable");
    }
  }
  return branch;
}
