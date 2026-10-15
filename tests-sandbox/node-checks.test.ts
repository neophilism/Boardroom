import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {CodingSandbox,loadAssignedRepositorySandbox} from "../src/runner/sandbox.ts";

if(process.env.BOARDROOM_DOCKER_TESTS!=="true")throw new Error("Sandbox acceptance must be explicitly invoked on a disposable Docker-capable CI runner");
test("real containers run checks without parent secrets, network or privileged mounts",async()=>{
  process.env.BOARDROOM_SECRET_SENTINEL="must-never-reach-repository-tests";
  const sandbox=await CodingSandbox.create();
  try{
    await sandbox.put("package.json",JSON.stringify({name:"sandbox-fixture",version:"1.0.0",scripts:{test:"node check.mjs",postinstall:"node -e \"require('fs').writeFileSync('lifecycle-ran','yes')\""}}));
    await sandbox.put("package-lock.json",JSON.stringify({name:"sandbox-fixture",version:"1.0.0",lockfileVersion:3,packages:{"":{name:"sandbox-fixture",version:"1.0.0"}}}));
    await sandbox.put("check.mjs",`import assert from 'node:assert/strict';import {existsSync,writeFileSync} from 'node:fs';
assert.equal(process.env.BOARDROOM_SECRET_SENTINEL,undefined);assert.equal(process.env.OPENAI_API_KEY,undefined);assert.equal(process.env.BOARDROOM_AGENT_TOKEN,undefined);
assert.equal(existsSync('/var/run/docker.sock'),false);assert.equal(existsSync('lifecycle-ran'),false);
assert.throws(()=>writeFileSync('/root/outside.txt','no'));await assert.rejects(fetch('https://example.com',{signal:AbortSignal.timeout(3000)}));console.log('ISOLATION_VERIFIED');`);
    const install=await sandbox.run("install",AbortSignal.timeout(60000));assert.equal(install.exitCode,0);
    const checked=await sandbox.run("test",AbortSignal.timeout(60000));assert.equal(checked.exitCode,0,checked.output);assert.match(checked.output,/ISOLATION_VERIFIED/);
  }finally{delete process.env.BOARDROOM_SECRET_SENTINEL;await sandbox.dispose();}
});
test("cancellation terminates the actual container before cleanup returns",async()=>{
  const sandbox=await CodingSandbox.create(),controller=new AbortController();
  try{
    await sandbox.put("package.json",JSON.stringify({name:"cancel-fixture",version:"1.0.0",scripts:{test:"node -e 'setInterval(()=>{},1000)'"}}));
    const timer=setTimeout(()=>controller.abort(),1500);
    try{const result=await sandbox.run("test",controller.signal);assert.notEqual(result.exitCode,0);}finally{clearTimeout(timer);}
  }finally{await sandbox.dispose();}
});

test("a live worker loads and tests only its assigned immutable repository snapshot",async()=>{
  const headSha="a".repeat(40),repository="neophilism/assigned-fixture";
  const files={
    "package.json":JSON.stringify({name:"assigned-fixture",version:"1.0.0",scripts:{test:"node verify.mjs"}}),
    "package-lock.json":JSON.stringify({name:"assigned-fixture",version:"1.0.0",lockfileVersion:3,packages:{"":{name:"assigned-fixture",version:"1.0.0"}}}),
    "verify.mjs":"console.log('ASSIGNED_REPOSITORY_TESTED')"
  };
  const entries=Object.entries(files).map(([path,text])=>{
    const bytes=Buffer.from(text);
    return {path,sha:createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),size:bytes.length};
  });
  const requested:string[]=[];
  const sandbox=await loadAssignedRepositorySandbox({repository,headSha,entries},repository,async entry=>{
    requested.push(entry.path);
    return {path:entry.path,sha:entry.sha,snapshotSha:headSha,contentBase64:Buffer.from(files[entry.path as keyof typeof files]).toString("base64")};
  },AbortSignal.timeout(60000));
  try{
    assert.deepEqual(requested,entries.map(entry=>entry.path));
    assert.equal((await sandbox.run("install",AbortSignal.timeout(60000))).exitCode,0);
    const checked=await sandbox.run("test",AbortSignal.timeout(60000));
    assert.equal(checked.exitCode,0,checked.output);
    assert.match(checked.output,/ASSIGNED_REPOSITORY_TESTED/);
  }finally{await sandbox.dispose();}
});
test("assigned snapshot identity and immutable blob metadata fail closed",async()=>{
  const entry={path:"package.json",sha:"b".repeat(40),size:2};
  const load=async()=>({path:entry.path,sha:entry.sha,snapshotSha:"c".repeat(40),contentBase64:"e30="});
  await assert.rejects(loadAssignedRepositorySandbox({
    repository:"neophilism/other",headSha:"c".repeat(40),entries:[entry]
  },"neophilism/assigned",load,AbortSignal.timeout(5000)),/snapshot mismatch/);
  await assert.rejects(loadAssignedRepositorySandbox({
    repository:"neophilism/assigned",headSha:"d".repeat(40),entries:[entry]
  },"neophilism/assigned",load,AbortSignal.timeout(5000)),/does not match/);
});
