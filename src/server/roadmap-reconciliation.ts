import type {Pool,PoolClient} from "pg";
import type {CanonicalPlan} from "./roadmap-import.ts";
import type {GitHubRepository} from "./github-app.ts";
import {currentRepositoryObservation} from "./repository-observation.ts";

/** GitHub owns PR state. Local holds and in-progress work survive a refresh
 * which contains no newer PR evidence. An open follow-up can reopen an accepted *work unit*; it never revokes acceptance of a previously merged PR. */
export const UPSERT_ROADMAP_UNIT_SQL=`INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state,depends_on,planned_prs,acceptance_criteria,external_dependencies,external_prerequisites,source_metadata,source_observed_at)
  VALUES($1,$2,$3,$4,TRUE,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb,$10::jsonb,$11::jsonb,now())
  ON CONFLICT(repository_id,unit_id) DO UPDATE SET title=excluded.title,version=excluded.version,approved=TRUE,
    state=CASE
      WHEN roadmap_units.state='BLOCKED' AND excluded.state IN ('PENDING','OPEN_PR') THEN 'BLOCKED'
      WHEN roadmap_units.state='ACTIVE' AND excluded.state='PENDING' THEN 'ACTIVE'
      WHEN roadmap_units.state='ACCEPTED' AND excluded.state IN ('PENDING','MERGED')
        AND roadmap_units.acceptance_criteria IS NOT DISTINCT FROM excluded.acceptance_criteria
        AND roadmap_units.depends_on=excluded.depends_on
        AND roadmap_units.external_dependencies=excluded.external_dependencies
        AND roadmap_units.external_prerequisites=excluded.external_prerequisites THEN 'ACCEPTED'
      ELSE excluded.state END,
    depends_on=excluded.depends_on,planned_prs=excluded.planned_prs,
    acceptance_criteria=excluded.acceptance_criteria,external_dependencies=excluded.external_dependencies,
    external_prerequisites=excluded.external_prerequisites,source_metadata=excluded.source_metadata,source_observed_at=now()`;

export async function reconcileRoadmapUnits(client:Pick<PoolClient,"query">,repositoryId:number,plan:CanonicalPlan){
  for(const unit of plan.units)await client.query(UPSERT_ROADMAP_UNIT_SQL,
    [repositoryId,unit.id,unit.title,plan.version,unit.status,JSON.stringify(unit.dependsOn),JSON.stringify(unit.pullRequests),unit.acceptanceCriteria,JSON.stringify(unit.externalDependencies??[]),
      JSON.stringify(unit.externalPrerequisites??[]),JSON.stringify(unit.sourceMetadata??{})]);
  await client.query("UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1 AND ($2::boolean=FALSE OR NOT(unit_id=ANY($3::text[])))",
    [repositoryId,plan.verified,plan.units.map(unit=>unit.id)]);
}

/** Preserve inventory and an actionable safe diagnosis when a GitHub/plan
 * fetch fails. Previously approved work becomes ineligible until reverified. */
export async function recordReconciliationFailure(db:Pool,repository:GitHubRepository,generation?:string){
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    if(generation!==undefined&&!await currentRepositoryObservation(client,repository.id,generation)){
      await client.query("COMMIT");return false;
    }
    await client.query(`INSERT INTO repositories(repository_id,full_name,description,archived,created_at,last_development_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(repository_id) DO UPDATE SET
      updated_at=now()`,
      [repository.id,repository.full_name,repository.description,repository.archived,repository.created_at,repository.pushed_at]);
    await client.query("INSERT INTO repository_leases(repository_id) VALUES($1) ON CONFLICT DO NOTHING",[repository.id]);
    await client.query("UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1",[repository.id]);
    await client.query(`INSERT INTO repository_sync_status(repository_id,plan_status,last_error,last_attempt_at)
      VALUES($1,'ERROR','GITHUB_OR_ROADMAP_VERIFICATION_FAILED',now()) ON CONFLICT(repository_id) DO UPDATE SET
      plan_status='ERROR',last_error=excluded.last_error,last_attempt_at=now()`,[repository.id]);
    await client.query("COMMIT");
    return true;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
