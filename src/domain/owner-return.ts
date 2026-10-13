/** Only resume our own OAuth consent page. Never accept an open redirect. */
export function safeOwnerReturnTo(value:string|null):string{
  if(!value||value.length>6000||!value.startsWith("/oauth/authorize?")||value.includes("\\"))return "/owner-actions";
  const url=new URL(value,"https://boardroom.invalid");
  return url.origin==="https://boardroom.invalid"&&url.pathname==="/oauth/authorize"&&!url.hash?url.pathname+url.search:"/owner-actions";
}
