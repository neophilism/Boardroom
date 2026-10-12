import {spawn} from "node:child_process";
// Apply immutable additive migrations before exposing routes needing new tables.
// No runtime key, database URI, or provider response is printed.
const migration=spawn(process.execPath,["--experimental-strip-types","db/migrate.ts"],{stdio:"inherit"});
const result=await new Promise(resolve=>{migration.once("exit",resolve);migration.once("error",()=>resolve(1));});
if(result!==0)process.exit(1);
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start",...process.argv.slice(2)],{stdio:"inherit"});
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.kill(signal));
server.once("exit",code=>{process.exitCode=code??1;});
