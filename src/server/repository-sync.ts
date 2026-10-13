import {getDatabase} from "./db.ts";
import {listAppRepositories,fetchPullRequests,fetchCanonicalRoadmap,githubAppRequest,type GitHubRepository,type GitHubPull} from "./github-app.ts";
import {normalizeRoadmap} from "./roadmap-import.ts";
import {reconcileRoadmapUnits,recordReconciliationFailure} from "./roadmap-reconciliation.ts";

function activityDate(repo:GitHubRepository,pulls:readonly GitHubPull[]):string|null{
  const values=[repo.pushed_at,...pulls.map(p=>p.updated_at)].filter((v):v is string=>!!v&&Number.isFinite(Date.parse(v)));
  return values.sort((a,b)=>Date.parse(b)-Date.parse(a))[0]??null;
}
export type SyncReport={total:number;processed:number;nextAfterId:string|null;verified:number;missing:number;failed:number;errors:{repository:string;reason:string}[]};
export type RepositorySyncOptions={limit?:number;afterId?:string|null};

/** Stable numeric GitHub IDs form a cursor. Owner browser requests have a small
 * batch budget so a free-plan web request cannot silently run hundreds of repos.
 */
export function selectRepositorySyncBatch(installed:readonly GitHubRepository[],owner:string,
  options:RepositorySyncOptions={}){
  const {limit,afterId}=options;
  if(limit!==undefined&&(!Number.isSafeInteger(limit)||limit<1||limit>10))
    throw new Error("Batch limit must be 1 to 10");
  if(afterId!==undefined&&afterId!==null&&!/^[1-9][0-9]{0,18}$/.test(afterId))
    throw new Error("Invalid GitHub repository cursor");
  const filtered=installed.filter(r=>r.full_name.split("/")[0].toLowerCase()===owner.toLowerCase())
    .sort((a,b)=>a.id-b.id);
  const remaining=afterId
    ?filtered.filter(r=>BigInt(r.id)>BigInt(afterId))
    :filtered;
  const selected=limit===undefined?remaining:remaining.slice(0,limit);
  const nextAfterId=selected.length<remaining.length
    ?String(selected[selected.length-1].id)
    :null;
  return {total:filtered.length,selected,nextAfterId};
}

async function syncOne(repository:GitHubRepository):Promise<"VERIFIED"|"MISSING">{
  const db=getDatabase();
  let pulls:GitHubPull[],plan:ReturnType<typeof normalizeRoadmap>;
  try{
    pulls=await fetchPullRequests(repository.full_name);
    const source=await fetchCanonicalRoadmap(repository.full_name);
    plan=normalizeRoadmap(source,repository.full_name,pulls);
  }catch{
    await recordReconciliationFailure(db,repository);
    throw new Error("GitHub or approved roadmap verification failed; inspect the repository plan and installed App access");
  }
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
    await reconcileRoadmapUnits(client,repository.id,plan);
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

export async function synchronizeRepositoryById(repositoryId:string){
  if(!/^[1-9][0-9]{0,18}$/.test(repositoryId))throw new Error("Invalid repository identity");
  const db=getDatabase();
  const known=await db.query<{full_name:string}>("SELECT full_name FROM repositories WHERE repository_id=$1",[repositoryId]);
  if(!known.rowCount)throw new Error("Repository not registered");
  const fullName=known.rows[0].full_name;
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName))throw new Error("Invalid registered repository");
  const repository=await githubAppRequest("GET","/repos/"+fullName) as GitHubRepository;
  if(String(repository.id)!==repositoryId)throw new Error("Immutable repository identity changed");
  return syncOne(repository);
}

export async function synchronizeInstalledRepositories(options:RepositorySyncOptions={}):Promise<SyncReport>{
  const installed=await listAppRepositories();
  const owner=process.env.BOARDROOM_GITHUB_OWNER ?? "neophilism";
  const {total,selected,nextAfterId}=selectRepositorySyncBatch(installed,owner,options);
  const report:SyncReport={total,processed:selected.length,nextAfterId,verified:0,missing:0,failed:0,errors:[]};
  for(const repository of selected){
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
