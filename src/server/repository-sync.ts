import {getDatabase} from "./db.ts";
import {listAppRepositories,fetchPullRequests,fetchCanonicalRoadmap,type GitHubRepository,type GitHubPull} from "./github-app.ts";
import {normalizeRoadmap} from "./roadmap-import.ts";

function activityDate(repo:GitHubRepository,pulls:readonly GitHubPull[]):string|null{
  const values=[repo.pushed_at,...pulls.map(p=>p.updated_at)].filter((v):v is string=>!!v&&Number.isFinite(Date.parse(v)));
  return values.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
}
export type SyncReport={total:number;verified:number;missing:number;failed:number;errors:{repository:string;reason:string}[]};

async function syncOne(repository:GitHubRepository):Promise<"VERIFIED"|"MISSING">{
  const pulls=await fetchPullRequests(repository.full_name);
  const source=await fetchCanonicalRoadmap(repository.full_name);
  const plan=normalizeRoadmap(source,repository.full_name,pulls);
  const db=getDatabase();
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO repositories(repository_id,full_name,description,archived,created_at,last_development_at,source_observed_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(repository_id) DO UPDATE SET full_name=excluded.full_name,description=excluded.description,archived=excluded.archived,last_development_at=excluded.last_development_at,source_observed_at=now(),updated_at=now()",
      [repository.id,repository.full_name,repository.description,repository.archived,repository.created_at,activityDate(repository,pulls)]
    );
    await client.query(
      "INSERT INTO repository_leases(repository_id,generation) VALUES($1,0) ON CONFLICT(repository_id) DO NOTHING",
      [repository.id]
    );
    const knownIds:string[]=[];
    for(const unit of plan.units){
      knownIds.push(unit.id);
      await client.query(
        `INSERT INTO roadmap_units(repository_id,unit_id,title,version,approved,state,depends_on,planned_prs,acceptance_criteria,source_observed_at)
        VALUES($1,$2,$3,$4,TRUE,$5,$6::jsonb,$7::jsonb,$8,now())
        ON CONFLICT(repository_id,unit_id) DO UPDATE SET title=excluded.title,version=excluded.version,
          approved=TRUE,
          state=CASE WHEN roadmap_units.state='ACCEPTED' THEN 'ACCEPTED' ELSE excluded.state END,
          depends_on=excluded.depends_on,planned_prs=excluded.planned_prs,
          acceptance_criteria=excluded.acceptance_criteria,source_observed_at=now()`,
        [repository.id,unit.id,unit.title,plan.version,unit.status,
          JSON.stringify(unit.dependsOn),JSON.stringify(unit.pullRequests),unit.acceptanceCriteria]
      );
    }
    if(plan.verified){
      await client.query(
        "UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1 AND NOT(unit_id=ANY($2::text[]))",
        [repository.id,knownIds]
      );
    }else{
      await client.query("UPDATE roadmap_units SET approved=FALSE WHERE repository_id=$1",[repository.id]);
    }
    await client.query(
      `INSERT INTO repository_sync_status(repository_id,last_attempt_at,last_success_at,plan_status,last_plan_version)
      VALUES($1,now(),now(),$2,$3)
      ON CONFLICT(repository_id) DO UPDATE SET last_attempt_at=now(),last_success_at=now(),
      plan_status=excluded.plan_status,last_error=NULL,last_plan_version=excluded.last_plan_version`,
      [repository.id,plan.verified?"VERIFIED":"MISSING",plan.verified?plan.version:null]
    );
    await client.query("COMMIT");
    return plan.verified?"VERIFIED":"MISSING";
  }catch(error){await client.query("ROLLBACK");throw error}
  finally{client.release()}
}

export async function synchronizeInstalledRepositories():Promise<SyncReport>{
  const installed=await listAppRepositories();
  const owner=process.env.BOARDROOM_GITHUB_OWNER ?? "neophilism";
  const filtered=installed.filter(r=>r.full_name.split("/")[0].toLowerCase()===owner.toLowerCase());
  const report:SyncReport={total:filtered.length,verified:0,missing:0,failed:0,errors:[]};
  for(const repository of filtered){
    try{
      const status=await syncOne(repository);
      if(status==="VERIFIED")report.verified++;else report.missing++;
    }catch(error){
      report.failed++;
      const reason=error instanceof Error?error.message:"Unknown sync failure";
      report.errors.push({repository:repository.full_name,reason:reason.slice(0,240)});
      console.error("GitHub repo reconciliation failed:",repository.full_name);
    }
  }
  const db=getDatabase();
  await db.query(
    `INSERT INTO repository_priority(repository_id,position)
     SELECT repository_id,1 FROM repositories
     WHERE full_name=$1 AND NOT EXISTS (SELECT 1 FROM repository_priority)
     ON CONFLICT DO NOTHING`,
    [owner+"/Boardroom"]
  );
  return report;
}
