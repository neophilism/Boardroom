import type {ReactNode} from "react";
import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../src/server/owner-session";
import OwnerNavigation from "./owner-navigation";

/** Defense in depth, not a replacement for each page/API's own authorization.
 * Server pages can render in parallel with layouts: keep their existing guards. */
export default async function PrivateOwnerLayout({children,returnTo}:{children:ReactNode;returnTo:string}){
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login?next="+encodeURIComponent(returnTo));
  return <div className="boardroom-workspace"><OwnerNavigation/><div id="boardroom-content" className="boardroom-content" tabIndex={-1}>{children}</div></div>;
}
