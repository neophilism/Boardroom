import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,symlink,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {CodingSandbox} from "../src/runner/sandbox.ts";
test("repository tests cannot redirect broker writes through an absolute symlink",async()=>{
  const sandbox=await CodingSandbox.create();
  const outside=await mkdtemp(path.join(tmpdir(),"boardroom-outside-"));
  try{
    await sandbox.put("src/valid.ts","first");assert.equal(await readFile(path.join(sandbox.directory,"src/valid.ts"),"utf8"),"first");
    await symlink(outside,path.join(sandbox.directory,"redirect"));
    await assert.rejects(sandbox.put("redirect/file.txt","escaped"));
    await mkdir(path.join(sandbox.directory,"other"));
    await symlink(path.join(outside,"file.txt"),path.join(sandbox.directory,"other/redirect.txt"));
    await assert.rejects(sandbox.put("other/redirect.txt","escaped"));
    await assert.rejects(readFile(path.join(outside,"file.txt")));
  }finally{await sandbox.dispose();await rm(outside,{recursive:true,force:true});}
});
