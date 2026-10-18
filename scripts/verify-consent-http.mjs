/** Production HTTP transport regression with fixture-only owner credentials.
 * No database, grant, live OAuth state, or external provider request is used. */
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {issueOwnerCookie,OWNER_COOKIE} from '../src/server/owner-session.ts';
import {submitOAuthConsent} from '../src/sdk/oauth-consent-client.ts';

const issuer='https://boardroom.example';
const key='fixture-only-consent-session-key-more-than-thirty-two-bytes';
const webhookSecret='fixture-only-webhook-http-key-more-than-thirty-two-bytes';
const clientId='https://chatgpt.com/oauth/client.json';
const callback='https://chatgpt.com/connector_platform_oauth_redirect';
const directory=await mkdtemp(join(tmpdir(),'boardroom-consent-http-'));
const bootstrap=join(directory,'client-fixture.mjs');
await writeFile(bootstrap,`
const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url===${JSON.stringify(clientId)})return Response.json({client_id:${JSON.stringify(clientId)},redirect_uris:[${JSON.stringify(callback)}],token_endpoint_auth_methods_supported:['none']});
  return original(input,options);
};
`);
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;
await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
const child=spawn(process.execPath,['--import',bootstrap,'node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{
  cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe'],
  env:{PATH:process.env.PATH??'',NODE_ENV:'production',BOARDROOM_OAUTH_ENABLED:'true',
    BOARDROOM_SESSION_SECRET:key,BOARDROOM_PUBLIC_ORIGIN:issuer,
    BOARDROOM_GITHUB_WEBHOOK_SECRET:webhookSecret,BOARDROOM_GITHUB_INSTALLATION_ID:'7'}
});
const exited=once(child,'exit');
try{
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Fixture server startup timed out')),20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',()=>{clearTimeout(timer);reject(Error('Fixture server exited before readiness'));});
    child.stdout.on('data',data=>{if(String(data).includes('Ready in')){clearTimeout(timer);resolve();}});
    child.stderr.resume();
  });
  const base='http://127.0.0.1:'+port;
  const form=new URLSearchParams({client_id:clientId,redirect_uri:callback,resource:issuer+'/api/mcp',
    scope:'boardroom:agent',state:'fixture-state',code_challenge:'A'.repeat(43),code_challenge_method:'S256',response_type:'code',decision:'deny'});
  const cookie=OWNER_COOKIE+'='+issueOwnerCookie(key);
  const transport=async(path,options)=>{
    assert.equal(options.mode,'cors');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
    const headers=new Headers(options.headers);headers.set('origin',issuer);headers.set('sec-fetch-site','same-origin');headers.set('cookie',cookie);
    return fetch(base+path,{...options,headers,signal:AbortSignal.timeout(10000)});
  };
  const target=new URL(await submitOAuthConsent(form,issuer,transport));
  assert.equal(target.origin+target.pathname,callback);assert.equal(target.searchParams.get('iss'),issuer);
  assert.equal(target.searchParams.get('state'),'fixture-state');assert.equal(target.searchParams.get('error'),'access_denied');
  assert.equal(target.searchParams.has('code'),false);
  for(const [origin,site,expected] of [['null','same-origin','NULL_ORIGIN'],
    ['https://attacker.example','same-origin','ORIGIN_MISMATCH'],[issuer,'cross-site','FETCH_SITE_REJECTED']]){
    const response=await fetch(base+'/api/v1/owner/oauth/authorize',{method:'POST',redirect:'error',
      headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded',origin,'sec-fetch-site':site,cookie},body:form});
    const error=await response.json();assert.equal(response.status,403);assert.equal(error.diagnostic,expected);
    assert.equal(error.code,'CONSENT_ORIGIN_REJECTED');assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const anonymous=await fetch(base+'/api/v1/owner/oauth/authorize',{method:'POST',headers:{Accept:'application/json'},body:form});
  assert.equal(anonymous.status,401);assert.equal((await anonymous.json()).code,'OWNER_SESSION_REQUIRED');
  const webhook='/api/v1/github/webhook';
  for(const [raw,extra,status] of [
    ['{"installation":{"id":7},"repository":{"id":12}}',{'x-hub-signature-256':'sha256='+'0'.repeat(64)},401],
    ['null',{},400],['{}',{},403],
    ['{"installation":{"id":8},"repository":{"id":12}}',{},403],
    ['{"installation":{"id":7},"repository":{"id":12}}',{'content-length':'1000001'},413]
  ]){
    // A declared-size test cannot lie to fetch's content-length enforcement;
    // send an actually oversized body to exercise the production byte limit.
    const body=status===413?'x'.repeat(1000001):raw;
    const headers={'content-type':'application/json','x-github-delivery':randomUUID(),'x-github-event':'push',
      'x-hub-signature-256':'sha256='+createHmac('sha256',webhookSecret).update(body).digest('hex'),...extra};
    const response=await fetch(base+webhook,{method:'POST',headers,body});
    assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');
  }
  const ignored=JSON.stringify({installation:{id:7},repository:{id:12}});
  const accepted=await fetch(base+webhook,{method:'POST',headers:{'content-type':'application/json','x-github-delivery':randomUUID(),'x-github-event':'issues',
    'x-hub-signature-256':'sha256='+createHmac('sha256',webhookSecret).update(ignored).digest('hex')},body:ignored});
  assert.equal(accepted.status,200);assert.equal((await accepted.json()).ignored,true);
  console.log('Production webhook HTTP fixture passed: signature, JSON, installation and byte-limit denials; unsupported signed events acknowledged without database access.');
  console.log('Production consent HTTP fixture passed: authenticated JSON callback; null/foreign/cross-site origins and anonymous requests denied.');
  console.log('No live OAuth grant or scheduled-agent acceptance is established by this fixture.');
}finally{
  child.kill('SIGTERM');
  const kill=setTimeout(()=>child.kill('SIGKILL'),2000);await exited;clearTimeout(kill);
  await rm(directory,{recursive:true,force:true});
}
