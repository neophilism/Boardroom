import {ownerNavigationSection} from "./owner-navigation.ts";
/** Only resume a known owner view or our own OAuth consent page. */
export function safeOwnerReturnTo(value:string|null):string{
  if(!value||value.length>6000||!value.startsWith("/")||value.startsWith("//")||value.includes("\\")||/[\x00-\x20\x7f]/.test(value))return "/owner-actions";
  const url=new URL(value,"https://boardroom.invalid");
  return url.origin==="https://boardroom.invalid"&&!url.hash&&
    (ownerNavigationSection(url.pathname)!==null||(url.pathname==="/oauth/authorize"&&url.search.length>0))?url.pathname+url.search:"/owner-actions";
}
