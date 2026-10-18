import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import type {Pool} from "pg";
import {parseGitHubDelivery,handleGitHubWebhook,validWebhookSignature,GitHubDeliveryError} from "../src/server/webhook.ts";
const secret="fixture-only-webhook-secret-more-than-32-bytes";
const payload=()=>JSON.stringify({installation:{id:7},repository:{id:12},sender:{login:"private-fixture-name"}});
const signature=(raw:string|Uint8Array)=>"sha256="+createHmac("sha256",secret).update(raw).digest("hex");
const req=(raw:string|Uint8Array,headers:Record<string,string>={})=>new Request("https://boardroom.example/api/v1/github/webhook",{method:"POST",body:raw as BodyInit,
  headers:{"content-type":"application/json","x-github-delivery":randomUUID(),"x-github-event":"push","x-hub-signature-256":signature(raw),...headers}});

test("HMAC binds exact bytes including Unicode, BOM and malformed UTF-8, before decoding",()=>{
  const raw=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from('{"title":"é🤖"}')]);
  assert.equal(validWebhookSignature(raw,signature(raw),secret),true);
  assert.equal(validWebhookSignature(raw,signature(new TextDecoder().decode(raw)),secret),false);
  assert.equal(validWebhookSignature(Buffer.from([0xff,0xfe]),signature(Buffer.from([0xff,0xfe])),secret),true);
  assert.equal(validWebhookSignature(raw,"sha256="+"z".repeat(64),secret),false);
  assert.equal(validWebhookSignature(raw,signature(raw),"short"),false);
});
test("only exact GUIDs, safe repository IDs and the configured installation are accepted",()=>{
  for(const event of ["push","pull_request","workflow_run","repository","check_run","check_suite"]){
    const result=parseGitHubDelivery(randomUUID(),event,payload(),"7");
    assert.equal(result.repositoryId,12);assert.equal(result.installationId,"7");assert.match(result.digest,/^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(result).includes("private-fixture-name"));
  }
  for(const body of ["null","[]","not json",JSON.stringify({repository:{id:12}}),JSON.stringify({installation:{id:8},repository:{id:12}}),
    JSON.stringify({installation:{id:7},repository:{id:0}}),JSON.stringify({installation:{id:7},repository:{id:Number.MAX_SAFE_INTEGER+1}})])
    assert.throws(()=>parseGitHubDelivery(randomUUID(),"push",body,"7"),GitHubDeliveryError);
  assert.throws(()=>parseGitHubDelivery("-".repeat(36),"push",payload(),"7"),GitHubDeliveryError);
  assert.throws(()=>parseGitHubDelivery(randomUUID(),"push\n",payload(),"7"),GitHubDeliveryError);
});
test("installation changes reduce bounded added/removed objects to unique identifiers",()=>{
  const raw=JSON.stringify({installation:{id:7},repositories_added:[{id:1,name:"ignored"},{id:2}],repositories_removed:[{id:2},{id:3}]});
  assert.deepEqual(parseGitHubDelivery(randomUUID(),"installation_repositories",raw,"7").repositoryIds,[1,2,3]);
  for(const repositories_added of [null,Array(1001).fill({id:1}),[{id:"12"}],[{id:-1}]])
    assert.throws(()=>parseGitHubDelivery(randomUUID(),"installation_repositories",JSON.stringify({installation:{id:7},repositories_added,repositories_removed:[]}),"7"),GitHubDeliveryError);
  assert.equal(parseGitHubDelivery(randomUUID(),"ping","{}","7").repositoryId,null);
});
test("transport denies bad signatures, invalid JSON and foreign installations before DB access",async()=>{
  let dbCalls=0;
  const options={secret,installationId:"7",database:()=>{dbCalls++;throw new Error("No DB expected");}};
  const cases:[Request,number][]=[
    [req(payload(),{"x-hub-signature-256":"sha256="+"0".repeat(64)}),401],
    [req("null"),400],[req(Buffer.from([0xff])),400],[req("{}"),403],
    [req(payload(),{"x-github-delivery":"bad"}),400],
    [req(payload(),{"content-type":"text/plain"}),415],
    [req(payload(),{"content-encoding":"gzip"}),415],
    [req(payload(),{"content-length":"1000001"}),413]
  ];
  for(const [request,status] of cases){const response=await handleGitHubWebhook(request,options);assert.equal(response.status,status);assert.equal(response.headers.get("cache-control"),"no-store");}
  assert.equal(dbCalls,0);
  const unsupported=await handleGitHubWebhook(req(payload(),{"x-github-event":"issues"}),options);
  assert.equal(unsupported.status,200);assert.equal((await unsupported.json()).ignored,true);assert.equal(dbCalls,0);
  assert.equal((await handleGitHubWebhook(req(payload()),{...options,installationId:undefined})).status,503);
});
test("streamed oversized deliveries cancel at the byte boundary without parsing or DB access",async()=>{
  let cancelled=false,dbCalls=0;
  const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(200001));},cancel(){cancelled=true;}});
  const request=new Request("https://boardroom.example/api/v1/github/webhook",{method:"POST",body:stream,duplex:"half",headers:{"content-type":"application/json"}} as RequestInit);
  const response=await handleGitHubWebhook(request,{secret,installationId:"7",database:()=>{dbCalls++;throw new Error("No DB expected");}});
  assert.equal(response.status,413);assert.equal(cancelled,true);assert.equal(dbCalls,0);
});
test("authenticated transport enqueues only identifiers and hides raw database failures",async()=>{
  const parameters:unknown[]=[];
  const client={query:async(sql:string,args?:unknown[])=>{
    parameters.push(args);
    if(sql.startsWith("SELECT repository_id"))return {rowCount:1,rows:[{repository_id:"12"}]};
    if(sql.includes("INSERT INTO github_events"))return {rowCount:1,rows:[{delivery_id:"fixture"}]};
    return {rowCount:0,rows:[]};
  },release(){}};
  const response=await handleGitHubWebhook(req(payload()),{secret,installationId:"7",database:()=>({connect:async()=>client} as unknown as Pool)});
  assert.equal(response.status,200);assert.equal((await response.json()).replay,false);
  assert.ok(!JSON.stringify(parameters).includes("private-fixture-name"));
  const failure=await handleGitHubWebhook(req(payload()),{secret,installationId:"7",database:()=>{throw new Error("private fixture error must never echo");}});
  assert.equal(failure.status,503);assert.equal((await failure.json()).error,"WEBHOOK_PROCESSING_UNAVAILABLE");
});
