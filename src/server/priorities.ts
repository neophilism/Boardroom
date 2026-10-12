import type { Pool } from "pg";

export class PriorityValidationError extends Error {
  constructor(message: string) { super(message); this.name = "PriorityValidationError"; }
}

/** IDs are GitHub numeric IDs serialized as decimal strings to avoid JS precision loss. */
export function parsePriorityOrder(payload: unknown): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new PriorityValidationError("Object with repositoryIds array required");
  const raw = (payload as Record<string,unknown>).repositoryIds;
  if (!Array.isArray(raw) || raw.length > 2000)
    throw new PriorityValidationError("repositoryIds must be an array of at most 2000 repository IDs");
  const ids: string[]=[];
  const seen=new Set<string>();
  for(const id of raw){
    if(typeof id !== "string" || !/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id)>9223372036854775807n)
      throw new PriorityValidationError("Each repository ID must be a positive 64-bit decimal string");
    const normalized=BigInt(id).toString();
    if(seen.has(normalized))throw new PriorityValidationError("Duplicate repository ID in priority order");
    seen.add(normalized); ids.push(normalized);
  }
  return ids;
}

export async function getRepositoryPriority(db: Pool) {
  const result=await db.query<{
    repositoryId: string; fullName: string; position:number; lastDevelopmentAt:Date|null
  }>(
    `SELECT r.repository_id::text AS "repositoryId",r.full_name AS "fullName",
      p.position AS "position",r.last_development_at AS "lastDevelopmentAt"
     FROM repository_priority p JOIN repositories r ON r.repository_id=p.repository_id
     ORDER BY p.position ASC, r.repository_id ASC`
  );
  return result.rows;
}

/** The complete list is replaced transactionally; no worker can see a partial order. */
export async function replaceRepositoryPriority(db:Pool, repositoryIds:string[]) {
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    // Use one global lock for priority edits, including the empty-list case.
    await client.query("SELECT pg_advisory_xact_lock(508012)");
    const available=repositoryIds.length===0?{rowCount:0,rows:[]}:
      await client.query<{repository_id:string}>(
        `SELECT repository_id::text AS repository_id FROM repositories
         WHERE repository_id=ANY($1::bigint[]) AND enabled=TRUE AND archived=FALSE
         FOR UPDATE`,[repositoryIds]
      );
    if(available.rowCount!==repositoryIds.length) {
      throw new PriorityValidationError("All priority repositories must exist, be enabled, and not archived");
    }
    await client.query("DELETE FROM repository_priority");
    if(repositoryIds.length){
      await client.query(
        `INSERT INTO repository_priority(repository_id,position)
         SELECT ordered.id, ordered.position::integer
         FROM unnest($1::bigint[]) WITH ORDINALITY AS ordered(id, position)`,
        [repositoryIds]
      );
    }
    await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('owner.repository_priorities.replaced',$1::jsonb)",
      [JSON.stringify({repositoryIds, count:repositoryIds.length})]
    );
    await client.query("COMMIT"); committed=true;
    return {repositoryIds,count:repositoryIds.length};
  }catch(error){ if(!committed)await client.query("ROLLBACK"); throw error; }
  finally{client.release()}
}
