import type {Pool} from "pg";
import {MIGRATION_MANIFEST} from "../../db/migration-manifest.ts";
export const REQUIRED_CONFIG=["DATABASE_URL","BOARDROOM_TOKEN_PEPPER","BOARDROOM_OWNER_API_TOKEN","BOARDROOM_SESSION_SECRET"] as const;
export const REQUIRED_MIGRATIONS=MIGRATION_MANIFEST.map(migration=>migration.filename);

export function environmentReady(env:NodeJS.ProcessEnv):boolean{
  return REQUIRED_CONFIG.every(name=>typeof env[name]==="string" && (env[name]?.length??0)>=32);
}

/** Infrastructure readiness only, not proof of an unattended development loop.
 * Compare every ledger fingerprint to this release's immutable migration source.
 * Missing, duplicate or mismatched evidence fails closed without exposing secrets.
 */
export async function checkReadiness(db:Pool,env:NodeJS.ProcessEnv):Promise<boolean>{
  if(!environmentReady(env))return false;
  const result=await db.query<{filename:string;sha256:string}>(
    "SELECT filename,sha256 FROM schema_migrations WHERE filename=ANY($1::text[])",
    [[...REQUIRED_MIGRATIONS]]
  );
  if(result.rows.length!==MIGRATION_MANIFEST.length)return false;
  const complete=new Map(result.rows.map(row=>[row.filename,row.sha256]));
  return MIGRATION_MANIFEST.every(({filename,sha256})=>complete.get(filename)===sha256);
}
