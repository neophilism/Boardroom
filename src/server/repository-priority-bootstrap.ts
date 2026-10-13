import type {PoolClient} from "pg";

/** Preserve an existing owner order. Name the immediate primary key explicitly:
 * PostgreSQL cannot use the deferrable position constraint as an ON CONFLICT
 * arbiter, even when no duplicate position exists.
 */
export async function ensureDefaultRepositoryPriority(db:Pick<PoolClient,"query">,fullName:string){
  await db.query(
    `INSERT INTO repository_priority(repository_id,position)
     SELECT repository_id,1 FROM repositories
     WHERE full_name=$1 AND NOT EXISTS (SELECT 1 FROM repository_priority)
     ON CONFLICT(repository_id) DO NOTHING`,
    [fullName]
  );
}
