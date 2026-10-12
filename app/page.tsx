import {redirect} from "next/navigation";
import {environmentReady} from "../src/server/readiness";
export const dynamic="force-dynamic";
export default function HomePage(){
  if(!environmentReady(process.env))redirect("/setup");
  redirect("/owner-actions");
}
