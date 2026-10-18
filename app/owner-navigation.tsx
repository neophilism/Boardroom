"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
import {useRef,useState} from "react";
import {OWNER_NAVIGATION,ownerNavigationSection} from "../src/domain/owner-navigation";

export default function OwnerNavigation(){
  const pathname=usePathname(),active=ownerNavigationSection(pathname);
  const [expandedFor,setExpandedFor]=useState<string|null>(null),[signingOut,setSigningOut]=useState(false),[error,setError]=useState("");
  const button=useRef<HTMLButtonElement>(null),open=expandedFor===pathname;
  function close(){setExpandedFor(null);button.current?.focus();}
  async function signOut(){
    setSigningOut(true);setError("");
    try{
      const response=await fetch("/api/v1/owner/logout",{method:"POST",credentials:"same-origin",cache:"no-store"});
      if(!response.ok&&response.status!==401)throw new Error("Sign-out rejected");
      // A full navigation discards the private client router cache.
      window.location.assign("/login");
    }catch{setError("Could not sign out. Check your connection and try again.");setSigningOut(false);}
  }
  return <>
    <a className="boardroom-skip" href="#boardroom-content">Skip to page content</a>
    <header className="boardroom-topbar">
      <Link href="/work-board" className="boardroom-brand" aria-label="Boardroom work board"><span className="boardroom-mark" aria-hidden="true">B</span><span>Boardroom<small>Owner workspace</small></span></Link>
      <div className="boardroom-top-actions"><span className="boardroom-private"><span aria-hidden="true">●</span> Private workspace</span>
        <button className="outline boardroom-signout" onClick={signOut} disabled={signingOut}>{signingOut?"Signing out…":"Sign out"}</button>
        <button ref={button} className="outline boardroom-menu" aria-expanded={open} aria-controls="boardroom-navigation" onClick={()=>setExpandedFor(open?null:pathname)}>{open?"Close menu":"Menu"}</button>
      </div>
      {error&&<p className="boardroom-signout-error error" role="alert">{error}</p>}
    </header>
    <aside className="boardroom-sidebar" data-open={open} onKeyDown={event=>{if(event.key==="Escape"&&open){event.preventDefault();close();}}}>
      <nav id="boardroom-navigation" aria-label="Boardroom primary navigation">
        {["Workspace","Manage","Oversight"].map(group=><section className="boardroom-nav-group" key={group} aria-label={group}>
          <p className="boardroom-nav-label">{group}</p><ul>{OWNER_NAVIGATION.filter(item=>item.group===group).map(item=><li key={item.href}>
            <Link href={item.href} prefetch={false} aria-current={active?.href===item.href?"page":undefined} onClick={()=>setExpandedFor(null)}>
              <span className="boardroom-nav-symbol" aria-hidden="true">{item.href==="/work-board"?"▦":item.href==="/coffee"?"◌":item.href==="/audit"?"≡":"◇"}</span>{item.label}
            </Link>
          </li>)}</ul>
        </section>)}
        <p className="boardroom-nav-note">Session activity and verified development progress are tracked separately.</p>
      </nav>
    </aside>
  </>;
}
