import Link from "next/link";
import type {ReactNode} from "react";
const main=[
{href:"/work-board",label:"Work board"},{href:"/owner-actions",label:"Owner actions"},
{href:"/priorities",label:"Priorities"},{href:"/agents",label:"Agents"},
{href:"/coffee",label:"Coffee Corner"},{href:"/observatory",label:"Usage"},
{href:"/system",label:"System"}
] as const;
const extra=[
{href:"/operations",label:"Operations"},{href:"/recovery",label:"Recovery"},
{href:"/reports",label:"Reports"},{href:"/logical-agents",label:"API agents"},
{href:"/launch",label:"Agent launch"}] as const;
function active(path:string,href:string){return path===href||path.startsWith(href+"/");}
export default function OwnerNavigation({section,title,activePath}:{section:string,title:ReactNode,activePath:string}){
const hasMore=extra.some(x=>active(activePath,x.href));
return <>
<div className="boardroom-toolbar">
<Link href="/work-board" className="boardroom-brand" aria-label="Boardroom work board">
<span className="boardroom-brand-mark" aria-hidden="true">B</span><span>Boardroom</span></Link>
<nav className="boardroom-primary-nav" aria-label="Main navigation">{main.map(x=>
<Link key={x.href} href={x.href} className={"boardroom-nav-link"+(active(activePath,x.href)?" is-active":"")}
aria-current={active(activePath,x.href)?"page":undefined}>{x.label}</Link>)}</nav>
<div className="boardroom-toolbar-actions">
<details className={"boardroom-more"+(hasMore?" is-active":"")}><summary>More <span aria-hidden="true">▾</span></summary>
<nav aria-label="More Boardroom pages" className="boardroom-more-menu">{extra.map(x=>
<Link key={x.href} href={x.href} className={"boardroom-nav-link"+(active(activePath,x.href)?" is-active":"")}
aria-current={active(activePath,x.href)?"page":undefined}>{x.label}</Link>)}</nav></details>
<form action="/api/v1/owner/logout" method="post"><button className="boardroom-signout" type="submit">Sign out</button></form>
</div></div>
<header className="boardroom-page-heading"><p className="eyebrow">BOARDROOM / {section}</p><h1>{title}</h1></header>
</>;
}
