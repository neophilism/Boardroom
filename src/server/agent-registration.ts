import {randomBytes} from "node:crypto";
import type {Pool} from "pg";
import {digestCredential} from "./agent-auth.ts";
import {requireApprovedAgentName} from "../domain/agent-names.ts";

export const PROVIDERS=["chatgpt","claude","grok","other"] as const;
export type AgentProvider=typeof PROVIDERS[number];
export class AgentRegistrationError extends Error{
  constructor(message:string){super(message);this.name="AgentRegistrationError";}
}
export class AgentAlreadyRegistered extends AgentRegistrationError{
  constructor(){super("This name already has an active credential. Revoke it before issuing a replacement.");}
}
/** Provider account metadata is owner-supplied and does not establish identity or authorization. */
export function normalizeAccountEmail(value:unknown):string{
  if(typeof value!=="string")throw new AgentRegistrationError("Account email is required");
  const email=value.trim().toLowerCase();
  if(email.length<3||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new AgentRegistrationError("Enter a valid account email address");
  return email;
}
export function parseAgentRegistration(value:unknown):{name:string;provider:AgentProvider;authentication:"bearer"|"oauth";accountEmail:string}{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new AgentRegistrationError("Registration object required");
  const body=value as Record<string,unknown>;
  let name:string;
  try{name=requireApprovedAgentName(body.name);}
  catch{throw new AgentRegistrationError("Name must exactly match one of the 601 approved labels");}
  if(typeof body.provider!=="string"||!PROVIDERS.includes(body.provider as AgentProvider))
    throw new AgentRegistrationError("Choose chatgpt, claude, grok, or other");
  const authentication=body.authentication??"bearer";
  if(authentication!=="bearer"&&authentication!=="oauth")
    throw new AgentRegistrationError("Choose bearer or oauth authentication");
  if(authentication==="oauth"&&body.provider!=="chatgpt")
    throw new AgentRegistrationError("Native OAuth registration currently supports ChatGPT only");
  return {name,provider:body.provider as AgentProvider,authentication,accountEmail:normalizeAccountEmail(body.accountEmail)};
}
export type RegisteredAgent={
  credentialId:string;name:string;provider:string;createdAt:string;accountEmail:string|null;
};
export async function listRegisteredAgents(db:Pool):Promise<RegisteredAgent[]>{
  const result=await db.query<{credential_id:string;label:string;provider:string;created_at:Date;account_email:string|null}>(
    "SELECT credential_id,label,provider,created_at,account_email FROM agent_credentials "+
    "WHERE enabled=TRUE AND revoked_at IS NULL ORDER BY label ASC,credential_id ASC"
  );
  return result.rows.map(row=>({
    credentialId:row.credential_id,name:row.label,provider:row.provider,
    createdAt:row.created_at.toISOString(),accountEmail:row.account_email
  }));
}
/** Only return a raw token to the authenticated owner once. Never persist plaintext. */
export async function registerNamedAgent(db:Pool,value:unknown,pepper:string){
  const {name,provider,authentication,accountEmail}=parseAgentRegistration(value);
  const token=randomBytes(48).toString("base64url");
  const digest=digestCredential(token,pepper);
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const created=await client.query<{credential_id:string}>(
      "INSERT INTO agent_credentials(label,provider,token_digest,account_email) VALUES($1,$2,$3,$4) RETURNING credential_id",
      [name,provider,digest,accountEmail]
    );
    await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('owner.agent_credential.issued',$1::jsonb)",
      [JSON.stringify({credentialId:created.rows[0].credential_id,name,provider,authentication})]
    );
    await client.query("COMMIT");committed=true;
    // OAuth registration discards the generated bearer secret. Consent and
    // PKCE token exchange remain mandatory; registration grants no connection.
    return {credentialId:created.rows[0].credential_id,name,provider,authentication,accountEmail,
      ...(authentication==="bearer"?{token}:{})};
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    if((error as {code?:string}).code==="23505")throw new AgentAlreadyRegistered();
    throw error;
  }finally{client.release();}
}
export function validCredentialId(id:unknown):id is string{
  return typeof id==="string"&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id);
}
export async function revokeNamedAgent(db:Pool,credentialId:string){
  if(!validCredentialId(credentialId))
    throw new AgentRegistrationError("Valid credential ID required");
  const client=await db.connect();
  let committed=false;
  try{
    await client.query("BEGIN");
    const result=await client.query<{label:string;provider:string}>(
      "UPDATE agent_credentials SET enabled=FALSE,revoked_at=now() "+
      "WHERE credential_id=$1 AND enabled=TRUE AND revoked_at IS NULL RETURNING label,provider",
      [credentialId]
    );
    if(!result.rowCount)throw new AgentRegistrationError("Credential is not active");
    const {label,provider}=result.rows[0];
    await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('owner.agent_credential.revoked',$1::jsonb)",
      [JSON.stringify({credentialId,name:label,provider})]
    );
    await client.query("COMMIT");committed=true;
    return {credentialId,revoked:true};
  }catch(error){
    if(!committed)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

/** Edit private routing metadata without revoking or replacing an existing credential. */
export async function updateNamedAgentAccountEmail(db:Pool,credentialId:string,value:unknown){
  if(!validCredentialId(credentialId))throw new AgentRegistrationError("Valid credential ID required");
  const accountEmail=normalizeAccountEmail(value);
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const changed=await client.query<{label:string}>(
      "UPDATE agent_credentials SET account_email=$2 WHERE credential_id=$1 AND enabled=TRUE AND revoked_at IS NULL RETURNING label",
      [credentialId,accountEmail]
    );
    if(!changed.rowCount)throw new AgentRegistrationError("Active agent credential not found");
    await client.query(
      "INSERT INTO audit_events(kind,details) VALUES('owner.agent_account.updated',$1::jsonb)",
      [JSON.stringify({credentialId,name:changed.rows[0].label})]
    );
    await client.query("COMMIT");
    return {credentialId,accountEmail};
  }catch(error){await client.query("ROLLBACK");throw error;}
  finally{client.release();}
}
