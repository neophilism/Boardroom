/** Isolated production-server fixture: fake read-only DB and fake session key.
 * No inherited credentials, live provider fetches or database writes permitted. */
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {issueOwnerCookie,OWNER_COOKIE} from '../src/server/owner-session.ts';
export const fixtureOrigin='https://boardroom.example';
export const fixtureKey='fixture-only-owner-workspace-session-key-more-than-thirty-two-bytes';
export async function startOwnerUiFixture(){
  const directory=await mkdtemp(join(tmpdir(),'boardroom-owner-ui-')),bootstrap=join(directory,'read-only-fixture.mjs');
  const pgUrl=new URL('../node_modules/pg/lib/index.js',import.meta.url).href;
  await writeFile(bootstrap,`
import pg from ${JSON.stringify(pgUrl)};
globalThis.fetch=async()=>{throw new Error('Fixture forbids external provider access');};
pg.Pool.prototype.connect=async()=>{throw new Error('Fixture forbids transactions and database writes');};
pg.Pool.prototype.query=async function(input,values=[]){
  const sql=typeof input==='string'?input:input.text;
  if(!/^\\s*SELECT\\b/i.test(sql))throw new Error('Fixture allows SELECT only');
  process.stdout.write('OWNER_FIXTURE_READ\\n');
  if(sql.includes('e.event_id::text AS "eventId"')){
    const before=values[0]===null?null:BigInt(values[0]);
    const rows=Array.from({length:52},(_,i)=>({eventId:String(100-i),kind:'agent.assignment.claimed',occurredAt:new Date('2026-01-01T12:00:00Z'),repository:'fixture/owner-workspace',details:{secret:'fixture-private-detail-never-display'}}))
      .filter(row=>before===null||BigInt(row.eventId)<before).slice(0,51);
    return {rows,rowCount:rows.length};
  }
  if(sql.includes('AS plans')&&sql.includes('AS merges'))return {rows:[{paused:true,plans:0,merges:0,maintenanceAt:null}],rowCount:1};
  return {rows:[],rowCount:0};
};
`);
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;
  await new Promise((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const child=spawn(process.execPath,['--import',bootstrap,'node_modules/next/dist/bin/next','start','-p',String(port),'-H','127.0.0.1'],{
    cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe'],
    env:{PATH:process.env.PATH??'',NODE_ENV:'production',BOARDROOM_SESSION_SECRET:fixtureKey,BOARDROOM_PUBLIC_ORIGIN:fixtureOrigin,
      DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:1/boardroom_test'}
  });
  const exited=once(child,'exit');let reads=0;
  child.stdout.on('data',data=>{reads+=(String(data).match(/OWNER_FIXTURE_READ/g)||[]).length;});child.stderr.resume();
  async function stop(){
    if(child.exitCode===null){child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);await exited;clearTimeout(kill);}
    await rm(directory,{recursive:true,force:true});
  }
  try{
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Owner fixture startup timed out')),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Owner fixture exited early'));});
      child.stdout.on('data',data=>{if(String(data).includes('Ready in')){clearTimeout(timer);resolve();}});
    });
  }catch(error){await stop();throw error;}
  const token=issueOwnerCookie(fixtureKey);
  return {base:'http://127.0.0.1:'+port,token,cookie:OWNER_COOKIE+'='+token,cookieName:OWNER_COOKIE,readCount:()=>reads,stop};
}
