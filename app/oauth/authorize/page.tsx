import Link from "next/link";
import {cookies} from "next/headers";
import {redirect,notFound} from "next/navigation";
import {OWNER_COOKIE,validOwnerSession} from "../../../src/server/owner-session";
import {oauthEnabled,parseOAuthAuthorization,verifyOpenAIClient} from "../../../src/server/oauth-contract";
import {listRegisteredAgents} from "../../../src/server/agent-registration";
import {getDatabase} from "../../../src/server/db";
export const dynamic="force-dynamic";
export default async function OAuthConsent({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  if(!oauthEnabled())notFound();
  const supplied=await searchParams,parameters=new URLSearchParams();
  for(const [key,value] of Object.entries(supplied))if(Array.isArray(value))for(const item of value)parameters.append(key,item);else if(value!==undefined)parameters.set(key,value);
  let authorization:ReturnType<typeof parseOAuthAuthorization>;
  try{authorization=parseOAuthAuthorization(parameters);await verifyOpenAIClient();}
  catch{return <main className="owner-shell"><h1>Connection request unavailable</h1><p>This request does not match the supported ChatGPT client, callback, resource, scope or PKCE contract, or client verification is temporarily unavailable.</p><Link href="/system">System status</Link></main>;}
  if(!validOwnerSession((await cookies()).get(OWNER_COOKIE)?.value))redirect("/login?next="+encodeURIComponent("/oauth/authorize?"+parameters.toString()));
  const agents=(await listRegisteredAgents(getDatabase())).filter(a=>a.provider==="chatgpt");
  const fields={client_id:authorization.clientId,redirect_uri:authorization.redirectUri,resource:authorization.resource,scope:authorization.scope,
    state:authorization.state,code_challenge:authorization.challenge,code_challenge_method:"S256",response_type:"code"};
  return <main className="owner-shell"><section className="login-panel"><p className="eyebrow">BOARDROOM / CONNECTION CONSENT</p><h1>Connect a named agent to ChatGPT</h1>
    <p>Choose the existing named agent for this connection. ChatGPT can check in as that agent, receive one exclusive repository, read approved context, create fenced source changes and PRs, use Coffee Corner, and create private owner-action requests.</p>
    <p>This connection does not grant owner administration. Automatic merges remain subject to your repository policy, current checks and reviews.</p>
    {agents.length===0?<p><Link href="/agents">Register a named agent first</Link>, then restart this connection.</p>:
      <form action="/api/v1/owner/oauth/authorize" method="post">
        {Object.entries(fields).map(([name,value])=><input type="hidden" name={name} value={value} key={name}/>)}
        <label htmlFor="oauth-agent">Named agent</label><select id="oauth-agent" name="credential_id" required>{agents.map(a=><option key={a.credentialId} value={a.credentialId}>{a.name} · {a.provider}</option>)}</select>
        <button type="submit" name="decision" value="allow">Authorize this named agent</button><button type="submit" name="decision" value="deny" className="outline">Deny connection</button>
      </form>}
  </section></main>;
}
