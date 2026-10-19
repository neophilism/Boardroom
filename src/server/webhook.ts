import {createHmac,timingSafeEqual} from "node:crypto";
import type {Pool} from "pg";
import {queueRepositoryRefresh} from "./outbox.ts";
export function validWebhookSignature(raw:string,signature:string|null,secret:string|undefined):boolean{
  if(!secret||secret.length<32||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac("sha256",secret).update(raw).digest(),received=Buffer.from(signature.slice(7),"hex");
  return timingSafeEqual(expected,received);
}
export async function acceptGitHubWebhook(db:Pool,delivery:string,event:string,raw:string){
  if(!/^[a-f0-9-]{36}$/i.test(delivery)||!["push","pull_request","workflow_run","check_run","installation_repositories","repository","ping"].includes(event))
    throw new Error("Unsupported GitHub delivery");
  if(event==="ping")return {accepted:true,ping:true};
  const data=JSON.parse(raw) as {repository?:{id?:unknown};action?:unknown};
  const repoId=data.repository?.id;
  if(!Number.isSafeInteger(repoId)||(repoId as number)<1)return {accepted:true,reconciliationRequired:true};
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const repository=await client.query("SELECT repository_id FROM repositories WHERE repository_id=$1",[repoId]);
    if(!repository.rowCount){await client.query("COMMIT");return {accepted:true,unregistered:true};}
    // Keep only control-plane identifiers. The signed payload does not determine
    // PR status; replay and out-of-order delivery trigger a real GitHub reread.
    const inserted=await client.query("INSERT INTO github_events(delivery_id,repository_id,event_type,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING delivery_id",
      [delivery,repoId,event,JSON.stringify({repositoryId:repoId,action:typeof data.action==="string"?data.action.slice(0,50):null})]);
    if(inserted.rowCount)await queueRepositoryRefresh(client,String(repoId),delivery);
    await client.query("COMMIT");return {accepted:true,replay:!inserted.rowCount};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
