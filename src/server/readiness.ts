import type {Pool} from "pg";
export const REQUIRED_CONFIG=["DATABASE_URL","BOARDROOM_TOKEN_PEPPER","BOARDROOM_OWNER_API_TOKEN","BOARDROOM_SESSION_SECRET"] as const;
export const REQUIRED_MIGRATIONS=["0001_core.sql","0002_agent_credentials.sql","0003_repository_sync.sql","0004_unique_named_principals.sql","0005_single_active_run_per_named_agent.sql"] as const;

export function environmentReady(env:NodeJS.ProcessEnv):boolean{
  return REQUIRED_CONFIG.every(name=>typeof env[name]==="string" && (env[name]?.length??0)>=32);
}

/** Does not equate liveness with readiness, and never exposes values of secrets. */
export async function checkReadiness(db:Pool,env:NodeJS.ProcessEnv):Promise<boolean>{
  if(!environmentReady(env))return false;
  const result=await db.query<{filename:string;sha256:string}>(
    "SELECT filename,sha256 FROM schema_migrations WHERE filename=ANY($1::text[])",
    [[...REQUIRED_MIGRATIONS]]
  );
  const complete=new Map(result.rows.map(row=>[row.filename,row.sha256]));
  return REQUIRED_MIGRATIONS.every(name=>/^[a-f0-9]{64}$/.test(complete.get(name)??""));
}
