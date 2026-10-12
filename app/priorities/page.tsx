import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import Link from "next/link";
import {OWNER_COOKIE,validOwnerSession} from "../../src/server/owner-session";
import {getDatabase} from "../../src/server/db";
import PriorityControls from "./controls";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Row={
  repositoryId:string;fullName:string;description:string|null;
  position:number|null;lastDevelopmentAt:Date|null;createdAt:Date;
};

export default async function RepositoryPrioritiesPage(){
  const jar=await cookies();
  if(!validOwnerSession(jar.get(OWNER_COOKIE)?.value))redirect("/login");
  const result=await getDatabase().query<Row>(
    `SELECT r.repository_id::text AS "repositoryId",r.full_name AS "fullName",r.description AS "description",
      p.position AS "position",r.last_development_at AS "lastDevelopmentAt",r.created_at AS "createdAt"
     FROM repositories r LEFT JOIN repository_priority p ON p.repository_id=r.repository_id
     WHERE r.enabled=TRUE AND r.archived=FALSE
     ORDER BY p.position ASC NULLS LAST, COALESCE(r.last_development_at,r.created_at) ASC,r.repository_id ASC`
  );
  const repositories=result.rows.map(r=>({
    ...r,lastDevelopmentAt:r.lastDevelopmentAt?.toISOString()??null,
    createdAt:r.createdAt.toISOString()
  }));
  return <main className="owner-shell priority-shell">
    <header className="owner-header">
      <div><p className="eyebrow">BOARDROOM / OWNER CONTROL</p><h1>Repository priorities</h1></div>
      <Link className="priority-nav" href="/owner-actions">Owner Action Board</Link>
    </header>
    <p>Scheduled agents claim the first available priority repository. When every priority repository is occupied or ineligible, Boardroom assigns the eligible repository with the oldest verified GitHub development activity.</p>
    <PriorityControls repositories={repositories}/>
  </main>;
}
