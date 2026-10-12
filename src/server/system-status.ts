import type {Pool} from "pg";
import {checkReadiness} from "./readiness.ts";
import {githubAppRequest,getInstalledGitHubPermissions} from "./github-app.ts";

export type SystemStatus={
  database:{connected:boolean;migrationsReady:boolean;repositories:number;registeredAgents:number;openOwnerActions:number};
  github:{configured:boolean;verifiedConnected:boolean;visibleRepositories:number|null;missingPermissions:string[]};
  integration:{scheduledWorkTested:false;liveCodeWriteTested:false;safeAutonomousOperations:false};
};

export function hasGitHubAppEnvironment(env:NodeJS.ProcessEnv):boolean{
  return [
    "BOARDROOM_GITHUB_APP_ID","BOARDROOM_GITHUB_INSTALLATION_ID",
    "BOARDROOM_GITHUB_APP_PRIVATE_KEY","BOARDROOM_GITHUB_OWNER"
  ].every(k=>typeof env[k]==="string"&&!!env[k]);
}

/** An installation with no authorized repositories is not yet usable for
 * Boardroom's claim/import flow, even if its GitHub credential is valid.
 */
/** Minimum scopes needed for repository inventory, source writes, PR creation
 * and independent CI evidence. Metadata read is intrinsic to all GitHub Apps.
 */
export function missingGitHubPermissions(value:unknown):string[]{
  const levels=(value&&typeof value==="object"&&!Array.isArray(value))
    ?value as Record<string,unknown>:{} as Record<string,unknown>;
  return ([
    ["contents","write"],
    ["pull_requests","write"],
    ["checks","read"],
    ["actions","read"]
  ] as const).filter(([permission,required])=>{
    const actual=levels[permission];
    return !(actual==="write"||(required==="read"&&actual==="read"));
  }).map(([name,required])=>name+":"+required);
}

export function verifiedInstallationInventory(evidence:unknown):boolean{
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))return false;
  const v=evidence as {total_count?:unknown;repositories?:unknown};
  return typeof v.total_count==="number"&&Number.isSafeInteger(v.total_count)&&
    v.total_count>0&&Array.isArray(v.repositories)&&v.repositories.length>0;
}

export async function getSystemStatus(db:Pool,env:NodeJS.ProcessEnv):Promise<SystemStatus>{
  let database:SystemStatus["database"]={
    connected:false,migrationsReady:false,repositories:0,registeredAgents:0,openOwnerActions:0
  };
  try{
    const readiness=await checkReadiness(db,env);
    const stats=await db.query<{
      repositories:string;registered_agents:string;open_owner_actions:string
    }>(
      "SELECT (SELECT COUNT(*) FROM repositories)::text AS repositories,"+
      "(SELECT COUNT(*) FROM agent_credentials WHERE enabled=TRUE AND revoked_at IS NULL)::text AS registered_agents,"+
      "(SELECT COUNT(*) FROM owner_actions WHERE status IN ('OPEN','ACKNOWLEDGED','AWAITING_VERIFICATION'))::text AS open_owner_actions"
    );
    database={connected:true,migrationsReady:readiness,
      repositories:Number(stats.rows[0].repositories),
      registeredAgents:Number(stats.rows[0].registered_agents),
      openOwnerActions:Number(stats.rows[0].open_owner_actions)};
  }catch{
    // Private owner sees a clear failure rather than speculative green status.
  }
  let github:SystemStatus["github"]={
    configured:hasGitHubAppEnvironment(env),verifiedConnected:false,visibleRepositories:null,missingPermissions:[]
  };
  if(github.configured){
    try{
      const evidence=await githubAppRequest("GET","/installation/repositories?per_page=1") as
        {total_count?:number;repositories?:unknown[]};
      const scopes=await getInstalledGitHubPermissions();
      const missingPermissions=missingGitHubPermissions(scopes);
      if(verifiedInstallationInventory(evidence)){
        github={configured:true,verifiedConnected:missingPermissions.length===0,
          visibleRepositories:evidence.total_count as number,missingPermissions};
      }else if(Number.isSafeInteger(evidence.total_count)&&Array.isArray(evidence.repositories)){
        github={configured:true,verifiedConnected:false,
          visibleRepositories:evidence.total_count as number,missingPermissions};
      }
    }catch{
      // Invalid installation or denied scope is not proof of connected access.
    }
  }
  return {database,github,integration:{
    scheduledWorkTested:false,liveCodeWriteTested:false,safeAutonomousOperations:false
  }};
}
