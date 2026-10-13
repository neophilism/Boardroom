import {randomBytes} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {isApprovedAgentName} from "../domain/agent-names.ts";
import {InvalidAgentCredential,type AuthenticatedAgent} from "./agent-auth.ts";
import {OAuthFailure,oauthDigest,oauthResource,OAUTH_SCOPE,OPENAI_CLIENT_ID,validPkce,parseOAuthAuthorization,type OAuthAuthorization} from "./oauth-contract.ts";

const randomToken=()=>randomBytes(48).toString("base64url");
/** Called only after owner authentication, CSRF verification and explicit UI
 * consent for an existing enabled named credential. No raw credential is used. */
export async function createOAuthCode(db:Pool,credentialId:string,a:OAuthAuthorization,pepper:string,env:NodeJS.ProcessEnv=process.env){
  if(!/^[a-f0-9-]{36}$/i.test(credentialId))throw new OAuthFailure("invalid_request");
  parseOAuthAuthorization(new URLSearchParams({client_id:a.clientId,redirect_uri:a.redirectUri,resource:a.resource,scope:a.scope,state:a.state,
    code_challenge:a.challenge,code_challenge_method:"S256",response_type:"code"}),env);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const credential=await client.query<{label:string}>("SELECT label FROM agent_credentials WHERE credential_id=$1 AND provider='chatgpt' AND enabled AND revoked_at IS NULL FOR SHARE",[credentialId]);
    if(!credential.rowCount||!isApprovedAgentName(credential.rows[0].label))throw new OAuthFailure("invalid_request");
    const code=randomToken();
    await client.query(`INSERT INTO oauth_authorization_codes(code_digest,credential_id,client_id,redirect_uri,resource,scope,code_challenge,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '2 minutes')`,[oauthDigest("code",code,pepper),credentialId,a.clientId,a.redirectUri,a.resource,a.scope,a.challenge]);
    await client.query("INSERT INTO audit_events(kind,details) VALUES('owner.oauth.named_agent_authorized',$1::jsonb)",[JSON.stringify({credentialId,clientId:a.clientId,scope:a.scope})]);
    await client.query("COMMIT");return code;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

async function tokenPair(client:PoolClient,grantId:string,pepper:string){
  const access=randomToken(),refresh=randomToken();
  await client.query(`INSERT INTO oauth_tokens(token_digest,grant_id,token_kind,expires_at)
    VALUES($1,$3,'ACCESS',now()+interval '15 minutes'),($2,$3,'REFRESH',now()+interval '30 days')`,[oauthDigest("token",access,pepper),oauthDigest("token",refresh,pepper),grantId]);
  return {access_token:access,token_type:"Bearer",expires_in:900,refresh_token:refresh,scope:OAUTH_SCOPE};
}

export async function exchangeOAuthToken(db:Pool,form:URLSearchParams,pepper:string,env:NodeJS.ProcessEnv=process.env){
  for(const key of form.keys())if(form.getAll(key).length!==1)throw new OAuthFailure("invalid_request");
  if(form.get("client_id")!==OPENAI_CLIENT_ID||form.has("client_secret")||form.has("client_assertion"))throw new OAuthFailure("invalid_client");
  if(form.has("scope")&&form.get("scope")!==OAUTH_SCOPE)throw new OAuthFailure("invalid_scope");
  const resource=oauthResource(env),kind=form.get("grant_type");
  if(form.has("resource")&&form.get("resource")!==resource)throw new OAuthFailure("invalid_target");
  if(kind!=="authorization_code"&&kind!=="refresh_token")throw new OAuthFailure("invalid_request");
  if(kind==="authorization_code"&&form.get("resource")!==resource)throw new OAuthFailure("invalid_target");
  const client=await db.connect();let committed=false;
  try{
    await client.query("BEGIN");
    let grantId:string;
    if(kind==="authorization_code"){
      const digest=oauthDigest("code",form.get("code")??"",pepper);
      const found=await client.query<{credential_id:string;client_id:string;redirect_uri:string;resource:string;scope:string;code_challenge:string}>(
        `SELECT a.* FROM oauth_authorization_codes a JOIN agent_credentials c ON c.credential_id=a.credential_id
         WHERE code_digest=$1 AND used_at IS NULL AND expires_at>now() AND c.enabled AND c.revoked_at IS NULL FOR UPDATE OF a`,[digest]);
      const row=found.rows[0];
      if(!row||row.client_id!==OPENAI_CLIENT_ID||row.resource!==resource||row.scope!==OAUTH_SCOPE||row.redirect_uri!==form.get("redirect_uri")||!validPkce(form.get("code_verifier"),row.code_challenge))throw new OAuthFailure("invalid_grant");
      await client.query("UPDATE oauth_authorization_codes SET used_at=now() WHERE code_digest=$1",[digest]);
      const created=await client.query<{grant_id:string}>("INSERT INTO oauth_grants(credential_id,client_id,resource,scope) VALUES($1,$2,$3,$4) RETURNING grant_id",[row.credential_id,row.client_id,row.resource,row.scope]);
      grantId=created.rows[0].grant_id;
    }else{
      const digest=oauthDigest("token",form.get("refresh_token")??"",pepper);
      const found=await client.query<{grant_id:string;consumed_at:Date|null;client_id:string;resource:string;scope:string;revoked_at:Date|null;expires_at:Date}>(
        `SELECT t.grant_id,t.consumed_at,t.expires_at,g.client_id,g.resource,g.scope,g.revoked_at
         FROM oauth_tokens t JOIN oauth_grants g ON g.grant_id=t.grant_id JOIN agent_credentials c ON c.credential_id=g.credential_id
         WHERE t.token_digest=$1 AND t.token_kind='REFRESH' AND c.enabled AND c.revoked_at IS NULL FOR UPDATE OF t,g`,[digest]);
      const row=found.rows[0];
      if(!row||row.client_id!==OPENAI_CLIENT_ID||row.resource!==resource||row.scope!==OAUTH_SCOPE||row.revoked_at||row.expires_at.getTime()<=Date.now())throw new OAuthFailure("invalid_grant");
      if(row.consumed_at){
        await client.query("UPDATE oauth_grants SET revoked_at=now() WHERE grant_id=$1",[row.grant_id]);
        await client.query("INSERT INTO audit_events(kind,details) VALUES('oauth.refresh.reuse_rejected',$1::jsonb)",[JSON.stringify({grantId:row.grant_id})]);
        await client.query("COMMIT");committed=true;throw new OAuthFailure("invalid_grant");
      }
      await client.query("UPDATE oauth_tokens SET consumed_at=now() WHERE token_digest=$1",[digest]);grantId=row.grant_id;
    }
    const pair=await tokenPair(client,grantId,pepper);
    await client.query("COMMIT");committed=true;return pair;
  }catch(error){if(!committed)await client.query("ROLLBACK");throw error;}finally{client.release();}
}

export async function authenticateOAuthAgent(headers:Headers,db:Pool,pepper:string,env:NodeJS.ProcessEnv=process.env):Promise<AuthenticatedAgent>{
  const match=headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/);
  if(!match)throw new InvalidAgentCredential();
  const digest=oauthDigest("token",match[1],pepper);
  const found=await db.query<{credential_id:string;label:string;provider:string}>(
    `SELECT c.credential_id,c.label,c.provider FROM oauth_tokens t JOIN oauth_grants g ON g.grant_id=t.grant_id
     JOIN agent_credentials c ON c.credential_id=g.credential_id WHERE t.token_digest=$1 AND t.token_kind='ACCESS'
     AND t.expires_at>now() AND g.revoked_at IS NULL AND g.resource=$2 AND g.scope=$3
     AND c.enabled AND c.revoked_at IS NULL`,[digest,oauthResource(env),OAUTH_SCOPE]);
  const row=found.rows[0];
  if(!row||!isApprovedAgentName(row.label))throw new InvalidAgentCredential();
  return {credentialId:row.credential_id,label:row.label,provider:row.provider};
}
