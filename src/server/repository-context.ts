import {githubAppRequest} from "./github-app.ts";

export type RepositoryBranch={name:string;headSha:string;protected:boolean};

export function decodeRepositoryBranches(value:unknown):RepositoryBranch[]{
  if(!Array.isArray(value)||value.length>100)throw new Error("Invalid GitHub branch response");
  return value.map((entry)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))
      throw new Error("Invalid GitHub branch response");
    const branch=entry as Record<string,unknown>;
    const commit=branch.commit;
    if(typeof branch.name!=="string"||branch.name.length<1||branch.name.length>255||
      typeof branch.protected!=="boolean"||!commit||typeof commit!=="object"||Array.isArray(commit)||
      typeof (commit as Record<string,unknown>).sha!=="string"||
      !/^[0-9a-f]{40}$/i.test((commit as Record<string,unknown>).sha as string))
      throw new Error("Invalid GitHub branch response");
    return {name:branch.name,headSha:(commit as Record<string,unknown>).sha as string,protected:branch.protected};
  });
}

export async function fetchRepositoryBranches(fullName:string){
  const parts=fullName.split("/");
  if(parts.length!==2||parts.some((part)=>!/^[a-zA-Z0-9_.-]{1,100}$/.test(part)))
    throw new Error("Invalid repository identity");
  const value=await githubAppRequest("GET","/repos/"+parts.map(encodeURIComponent).join("/")+"/branches?per_page=100");
  const branches=decodeRepositoryBranches(value);
  return {branches,limited:branches.length===100};
}
