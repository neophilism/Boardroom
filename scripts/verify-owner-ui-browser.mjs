/** Dependency-free Chrome DevTools fixture for the CI runner's installed Chrome.
 * Browser and server receive no live credentials; the DB is a read-only stub. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {startOwnerUiFixture} from './owner-ui-fixture.mjs';

const chrome=['/usr/bin/google-chrome','/opt/google/chrome/chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(path=>existsSync(path));
if(!chrome)throw new Error('Owner browser checks unavailable: an installed Chrome/Chromium binary is required. No browser result is claimed.');
const fixture=await startOwnerUiFixture(),profile=await mkdtemp(join(tmpdir(),'boardroom-chrome-'));
const child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH??'',LANG:'C.UTF-8'}});
const exited=once(child,'exit');let socket;
try{
  const endpoint=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(Error('Chrome startup timed out')),15000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Chrome exited early'));});
    child.stderr.on('data',data=>{output+=String(data);const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
  socket=new WebSocket(endpoint);await once(socket,'open');let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const item=pending.get(message.id);if(!item)return;pending.delete(message.id);clearTimeout(item.timer);if(message.error)item.reject(Error(message.error.message));else item.resolve(message.result);});
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);
    pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });}
  const target=await send('Target.createTarget',{url:'about:blank'}),attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}),session=attached.sessionId;
  const call=(method,params={})=>send(method,params,session);
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error('Browser fixture evaluation failed');return result.result.value;};
  async function until(expression){const deadline=Date.now()+10000;do{if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);throw Error('Browser condition timed out: '+expression);}
  await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
  await call('Network.setCookie',{name:fixture.cookieName,value:fixture.token,url:fixture.base,httpOnly:true,sameSite:'Strict'});
  async function navigate(path){await call('Page.navigate',{url:fixture.base+path});await until('document.readyState === "complete" && !!document.querySelector("#boardroom-navigation")');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
  async function key(key,code){const keyCode={Tab:9,Enter:13,Escape:27}[key];await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode,nativeVirtualKeyCode:keyCode});}
  const fits='document.documentElement.scrollWidth <= innerWidth + 1';
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await navigate('/audit');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".boardroom-sidebar")).display !== "none"'),true);
  assert.equal(await evaluate('document.querySelector("[aria-current=page]").getAttribute("href")'),'/audit');assert.equal(await evaluate(fits),true);
  await key('Tab','Tab');assert.equal(await evaluate('document.activeElement.textContent'),'Skip to page content');await key('Enter','Enter');
  assert.equal(await evaluate('document.activeElement.id'),'boardroom-content');
  for(const width of [390,320]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await navigate('/audit');
    assert.equal(await evaluate(fits),true);assert.equal(await evaluate('getComputedStyle(document.querySelector(".boardroom-sidebar")).display'),'none');
    await evaluate('document.querySelector(".boardroom-menu").click()');await until('document.querySelector(".boardroom-menu").getAttribute("aria-expanded") === "true"');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".boardroom-sidebar")).display !== "none"'),true);
    assert.equal(await evaluate('document.querySelectorAll("#boardroom-navigation a").length'),11);
    assert.equal(await evaluate('[...document.querySelectorAll("#boardroom-navigation a")].every(a=>a.getBoundingClientRect().height >= 44)'),true);
    await evaluate('document.querySelector("#boardroom-navigation a").focus()');await key('Escape','Escape');
    await until('document.querySelector(".boardroom-menu").getAttribute("aria-expanded") === "false"');
    assert.equal(await evaluate('document.activeElement.classList.contains("boardroom-menu")'),true);
    await evaluate('document.querySelector(".boardroom-menu").click()');await until('document.querySelector(".boardroom-menu").getAttribute("aria-expanded") === "true"');
    await evaluate('[...document.querySelectorAll("#boardroom-navigation a")].find(a=>a.pathname === "/coffee").click()');
    await until('location.pathname === "/coffee" && [...document.querySelectorAll("[aria-current=page]")].some(a=>a.pathname === "/coffee")');
    assert.equal(await evaluate('document.querySelector(".boardroom-menu").getAttribute("aria-expanded")'),'false');assert.equal(await evaluate(fits),true);
  }
  await call('Network.deleteCookies',{name:fixture.cookieName,url:fixture.base});await call('Page.navigate',{url:fixture.base+'/audit'});
  await until('location.pathname === "/login"');assert.equal(await evaluate('!!document.querySelector("#boardroom-navigation")'),false);
  console.log('Owner Chrome fixture passed: desktop 1440px, mobile 390/320px, no horizontal overflow, active links, menu open/close, 44px navigation targets, Escape/focus restoration, skip link, client-side navigation and expired access redirect.');
}finally{
  socket?.close();if(child.exitCode===null){child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),2000);await exited;clearTimeout(kill);}
  await fixture.stop();await rm(profile,{recursive:true,force:true});
}
