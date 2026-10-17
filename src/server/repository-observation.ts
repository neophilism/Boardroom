import type {Pool,PoolClient} from "pg";

/** Reserve BEFORE reading GitHub, not when publishing the resulting snapshot. */
export async function reserveRepositoryObservation(db:Pool|PoolClient,repositoryId:number){
  if(!Number.isSafeInteger(repositoryId)||repositoryId<1)throw new Error("Invalid repository observation identity");
  const row=await db.query<{generation:string}>(`INSERT INTO repository_observation_fences(repository_id,generation)
    VALUES($1,1) ON CONFLICT(repository_id) DO UPDATE SET generation=repository_observation_fences.generation+1
    RETURNING generation::text`,[repositoryId]);
  return row.rows[0].generation;
}
/** Called in the publication/failure transaction. A later attempt supersedes
 * earlier results, including errors; no database lock spans a GitHub request. */
export async function currentRepositoryObservation(db:PoolClient,repositoryId:number,generation:string){
  const row=await db.query<{generation:string}>("SELECT generation::text FROM repository_observation_fences WHERE repository_id=$1 FOR UPDATE",[repositoryId]);
  return row.rows[0]?.generation===generation;
}
