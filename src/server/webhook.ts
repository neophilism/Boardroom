import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {Pool} from "pg";
import {getDatabase} from "./db.ts";
import {boundedRequestBytes,RequestBodyTooLarge} from "./request-body.ts";
export class GitHubDeliveryError extends Error{
  readonly status:number;readonly code:string;
  constructor(status:number,code:string){super(code);this.name="GitHubDeliveryError";this.status=status;this.code=code;}
}
const events=new Set(["push","pull_request","workflow_run","check_run","check_suite","installation_repositories","repository","ping"]);
const deliveryPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const positiveId=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>0;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
export function validWebhookSignature(raw:string|Uint8Array,signature:string|null,secret:string|undefined):boolean{
  if(!secret||secret.length<32||!signature||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
  const expected=createHmac("sha256",secret).update(raw).digest(),received=Buffer.from(signature.slice(7),"hex");
  return timingSafeEqual(expected,received);
}
export function parseGitHubDelivery(delivery:string,event:string,raw:string|Uint8Array,expectedInstallation:string){
  if(!deliveryPattern.test(delivery)||!/^[a-z_]{1,50}$/.test(event))throw new GitHubDeliveryError(400,"INVALID_DELIVERY_HEADERS");
  if(!/^[1-9][0-9]{0,18}$/.test(expectedInstallation))throw new GitHubDeliveryError(503,"WEBHOOK_CONFIGURATION_REQUIRED");
  let data:unknown;
  try{data=JSON.parse(typeof raw==="string"?raw:new TextDecoder("utf-8",{fatal:true}).decode(raw));}
  catch{throw new GitHubDeliveryError(400,"INVALID_DELIVERY_JSON");}
  if(!object(data))throw new GitHubDeliveryError(400,"INVALID_DELIVERY_JSON");
  const installation=object(data.installation)?data.installation.id:undefined;
  if(!(event==="ping"&&installation===undefined)&&(!positiveId(installation)||String(installation)!==expectedInstallation))
    throw new GitHubDeliveryError(403,"INSTALLATION_SCOPE_MISMATCH");
  const digest=createHash("sha256").update(raw).digest("hex");
  const base={delivery:delivery.toLowerCase(),event,digest,installationId:expectedInstallation};
  if(!events.has(event))return {...base,ignored:true,repositoryId:null,repositoryIds:[] as number[]};
  if(event==="ping")return {...base,ignored:false,repositoryId:null,repositoryIds:[] as number[]};
  if(event==="installation_repositories"){
    const added=data.repositories_added,removed=data.repositories_removed;
    if(!Array.isArray(added)||!Array.isArray(removed)||added.length>1000||removed.length>1000||
      [...added,...removed].some(row=>!object(row)||!positiveId(row.id)))throw new GitHubDeliveryError(400,"INVALID_REPOSITORY_LIST");
    return {...base,ignored:false,repositoryId:null,repositoryIds:[...new Set([...added,...removed].map(row=>Number(row.id)))]};
  }
  const repositoryId=object(data.repository)?data.repository.id:undefined;
  if(!positiveId(repositoryId))throw new GitHubDeliveryError(400,"INVALID_REPOSITORY_ID");
  return {...base,ignored:false,repositoryId,repositoryIds:[repositoryId]};
}

/** Internal ingestion AFTER signature validation. Payloads only enqueue fresh
 * installation-scoped reads, never directly update verified project state. */
export async function acceptGitHubWebhook(db:Pool,delivery:string,event:string,raw:string|Uint8Array,
  expectedInstallation=process.env.BOARDROOM_GITHUB_INSTALLATION_ID??""){
  const item=parseGitHubDelivery(delivery,event,raw,expectedInstallation);
  if(item.ignored)return {accepted:true,ignored:true};
  const client=await db.connect();
  try{
    await client.query("BEGIN");
    const known=await client.query<{repository_id:string}>("SELECT repository_id::text FROM repositories WHERE repository_id=ANY($1::bigint[])",[item.repositoryIds]);
    if(item.repositoryId!==null&&!known.rowCount){await client.query("COMMIT");return {accepted:true,unregistered:true};}
    const inserted=await client.query(`INSERT INTO github_events(delivery_id,repository_id,event_type,payload,payload_sha256,installation_id)
      VALUES($1,$2,$3,$4::jsonb,$5,$6::bigint) ON CONFLICT DO NOTHING RETURNING delivery_id`,
      [item.delivery,item.repositoryId,item.event,JSON.stringify({repositoryId:item.repositoryId,installationId:item.installationId}),item.digest,item.installationId]);
    if(!inserted.rowCount){
      const existing=await client.query<{delivery_id:string;repository_id:string|null;event_type:string;payload_sha256:string|null;installation_id:string|null}>(
        "SELECT delivery_id,repository_id::text,event_type,payload_sha256,installation_id::text FROM github_events WHERE delivery_id=$1 OR payload_sha256=$2",[item.delivery,item.digest]);
      const prior=existing.rows[0];
      if(existing.rowCount!==1||prior.event_type!==item.event||prior.repository_id!==(item.repositoryId===null?null:String(item.repositoryId))||
        (prior.payload_sha256!==null&&prior.payload_sha256!==item.digest)||
        (prior.installation_id!==null&&prior.installation_id!==item.installationId))throw new GitHubDeliveryError(409,"DELIVERY_ID_CONFLICT");
      await client.query("COMMIT");return {accepted:true,replay:true};
    }
    for(const repository of known.rows)await client.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES($1,'sync_repository',$2::jsonb) ON CONFLICT DO NOTHING",
      ["github:"+item.delivery+":"+repository.repository_id,JSON.stringify({repositoryId:repository.repository_id})]);
    if(item.event==="installation_repositories")await client.query("INSERT INTO operation_outbox(idempotency_key,operation_type,payload) VALUES($1,'sync_inventory','{}'::jsonb) ON CONFLICT DO NOTHING",["github-inventory:"+item.delivery]);
    await client.query("COMMIT");return {accepted:true,replay:false,ping:item.event==="ping"};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

/** Bounded bytes are authenticated before UTF-8/JSON decoding or DB access. */
export async function handleGitHubWebhook(request:Request,options={
  secret:process.env.BOARDROOM_GITHUB_WEBHOOK_SECRET,
  installationId:process.env.BOARDROOM_GITHUB_INSTALLATION_ID,database:getDatabase
}){
  const headers={"Cache-Control":"no-store"};
  try{
    if(!options.secret||options.secret.length<32||!options.installationId||!/^[1-9][0-9]{0,18}$/.test(options.installationId))
      throw new GitHubDeliveryError(503,"WEBHOOK_CONFIGURATION_REQUIRED");
    if(!(request.headers.get("content-type")??"").toLowerCase().match(/^application\/json(?:\s*;|$)/)||
      ![null,"identity"].includes(request.headers.get("content-encoding")))throw new GitHubDeliveryError(415,"UNSUPPORTED_DELIVERY_ENCODING");
    const raw=await boundedRequestBytes(request,1000000);
    if(!validWebhookSignature(raw,request.headers.get("x-hub-signature-256"),options.secret))throw new GitHubDeliveryError(401,"INVALID_DELIVERY_SIGNATURE");
    const delivery=request.headers.get("x-github-delivery")??"",event=request.headers.get("x-github-event")??"";
    const parsed=parseGitHubDelivery(delivery,event,raw,options.installationId);
    if(parsed.ignored)return Response.json({accepted:true,ignored:true},{headers});
    return Response.json(await acceptGitHubWebhook(options.database(),delivery,event,raw,options.installationId),{headers});
  }catch(error){
    if(error instanceof RequestBodyTooLarge)return Response.json({error:"DELIVERY_TOO_LARGE"},{status:413,headers});
    if(error instanceof GitHubDeliveryError)return Response.json({error:error.code},{status:error.status,headers});
    return Response.json({error:"WEBHOOK_PROCESSING_UNAVAILABLE"},{status:503,headers});
  }
}
