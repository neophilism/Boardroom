import assert from 'node:assert/strict';
import {startOwnerUiFixture,fixtureKey,fixtureOrigin} from './owner-ui-fixture.mjs';
import {issueOwnerCookie,OWNER_COOKIE,OWNER_SESSION_SECONDS} from '../src/server/owner-session.ts';
import {OWNER_NAVIGATION} from '../src/domain/owner-navigation.ts';
const fixture=await startOwnerUiFixture();
try{
  const privatePaths=[...OWNER_NAVIGATION.map(item=>item.href),'/owner-actions/26741e83-9694-4fb3-8174-783b2f9bf61c','/coffee/26741e83-9694-4fb3-8174-783b2f9bf61c'];
  const expired=OWNER_COOKIE+'='+issueOwnerCookie(fixtureKey,Date.now()-1000*(OWNER_SESSION_SECONDS+60));
  for(const path of privatePaths){
    for(const headers of [{},{authorization:'Bearer fixture-agent-not-owner'}, {cookie:OWNER_COOKIE+'=tampered'}, {cookie:expired}]){
      const response=await fetch(fixture.base+path,{headers,redirect:'manual'}),body=await response.text();
      assert.ok([307,308].includes(response.status),path+' must redirect before private rendering');
      assert.ok(response.headers.get('location')?.startsWith('/login'));
      assert.ok(!body.includes('fixture/owner-workspace'));
    }
  }
  const rsc=await fetch(fixture.base+'/audit',{headers:{RSC:'1','Next-Router-Prefetch':'1',authorization:'Bearer fixture-agent-not-owner'},redirect:'manual'});
  const rscBody=await rsc.text();assert.ok(!rscBody.includes('fixture/owner-workspace'));assert.ok([307,308].includes(rsc.status));
  assert.equal(fixture.readCount(),0,'Unauthenticated pages must not query the private DB');
  for(const path of OWNER_NAVIGATION.map(item=>item.href)){
    const response=await fetch(fixture.base+path,{headers:{cookie:fixture.cookie}}),body=await response.text();
    assert.equal(response.status,200,path+' owner access');assert.match(response.headers.get('cache-control')??'',/no-store/);
    assert.ok(body.includes('Boardroom primary navigation'));assert.ok(body.includes('Skip to page content'));
    assert.ok(!body.includes('fixture-private-detail-never-display'));
    for(const item of OWNER_NAVIGATION)assert.ok(body.includes('href="'+item.href+'"'));
  }
  const older=await fetch(fixture.base+'/audit?before=51',{headers:{cookie:fixture.cookie}});assert.equal(older.status,200);assert.ok((await older.text()).includes('Newest events'));
  const foreign=await fetch(fixture.base+'/api/v1/owner/logout',{method:'POST',headers:{cookie:fixture.cookie,origin:'https://foreign.example','sec-fetch-site':'cross-site'}});
  assert.equal(foreign.status,403);assert.equal(foreign.headers.has('set-cookie'),false);
  const signedOut=await fetch(fixture.base+'/api/v1/owner/logout',{method:'POST',headers:{cookie:fixture.cookie,origin:fixtureOrigin,'sec-fetch-site':'same-origin'}});
  assert.equal(signedOut.status,200);assert.match(signedOut.headers.get('set-cookie')??'',/Max-Age=0/i);assert.match(signedOut.headers.get('set-cookie')??'',/HttpOnly/i);
  console.log('Owner UI HTTP fixture passed: 13 private routes reject anonymous/agent/tampered/expired sessions before DB access; RSC prefetch denied; all 11 owner sections, audit paging, no-store and trusted-proxy logout verified.');
  console.log('Read-only fake DB/session evidence only; no live deployment, private data or database mutation used.');
}finally{await fixture.stop();}
