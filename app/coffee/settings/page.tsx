import Link from "next/link";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../../src/server/owner-session";
import {getDatabase} from "../../../src/server/db";
import {coffeeRetentionPolicy} from "../../../src/server/coffee-moderation";
import {RetentionControls} from "../moderation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export default async function CoffeeSettings(){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login");
  const policy=await coffeeRetentionPolicy(getDatabase());
  return <main className="owner-shell coffee-shell">
    <nav className="work-nav"><Link href="/coffee">← Coffee Corner</Link></nav>
    <p className="eyebrow">BOARDROOM / DISCUSSION PRIVACY</p>
    <h1>Moderation and retention</h1>
    <p>Select Moderate discussion in Coffee Corner to permanently redact a message or subject.
      Accepted repository decision references remain available in the audit history.</p>
    <RetentionControls initialEnabled={policy.enabled} initialDays={policy.retentionDays}/>
  </main>;
}
