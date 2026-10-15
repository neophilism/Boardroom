import {spawn} from "node:child_process";
import {mkdtemp,mkdir,open,chmod,rm,lstat} from "node:fs/promises";
import {constants} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {readableSourcePath} from "../server/source.ts";

export class SandboxFailure extends Error{constructor(message:string){super(message);}}
export function checkCommand(name:unknown):string[]{
  if(typeof name!=="string"||!["install","lint","typecheck","test","build","check"].includes(name))throw new SandboxFailure("Only documented Node checks are supported");
  return name==="install"?["npm","ci","--ignore-scripts","--no-audit","--no-fund"]:["npm","run",name];
}
/** Source executes only in an unprivileged, credential-free disposable container.
 * Neither the Docker socket, parent filesystem nor parent environment is mounted.
 */
export type RepositorySnapshotEntry={path:string};
export async function materializeRepositorySnapshot(
  sandbox:CodingSandbox,
  entries:readonly RepositorySnapshotEntry[],
  readBlob:(path:string)=>Promise<string>,
  signal:AbortSignal
){
  for(const entry of entries){
    signal.throwIfAborted();
    await sandbox.put(entry.path,Buffer.from(await readBlob(entry.path),"base64"));
  }
}

export class CodingSandbox{
  readonly directory:string;readonly #containers=new Set<string>();
  private constructor(directory:string){this.directory=directory;}
  static async create(){const root=await mkdtemp(path.join(tmpdir(),"boardroom-worker-"));await chmod(root,0o777);return new CodingSandbox(root);}
  async put(file:string,text:string|Buffer){
    if(this.#containers.size)throw new SandboxFailure("Stop sandbox processes before updating source");
    const safe=readableSourcePath(file),target=path.join(this.directory,safe);
    if(!target.startsWith(this.directory+path.sep))throw new SandboxFailure("Source escaped the sandbox directory");
    let directory=this.directory;
    for(const part of safe.split("/").slice(0,-1)){
      directory=path.join(directory,part);
      await mkdir(directory,{mode:0o777}).catch(error=>{if(error.code!=="EEXIST")throw error;});
      const stat=await lstat(directory);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new SandboxFailure("Sandbox path was replaced by a symlink");
      await chmod(directory,0o777);
    }
    const handle=await open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o666);
    try{await handle.writeFile(text);await handle.chmod(0o666);}finally{await handle.close();}
  }
  async run(name:string,signal:AbortSignal){
    signal.throwIfAborted();
    if(this.#containers.size)throw new SandboxFailure("Prior sandbox termination is unverified");
    const command=checkCommand(name),container="boardroom-"+randomUUID();
    const args=["run","--rm","--name",container,"--network",name==="install"?"bridge":"none",
      "--read-only","--tmpfs","/tmp:rw,nosuid,size=256m","--cap-drop","ALL","--security-opt","no-new-privileges",
      "--pids-limit","128","--cpus","1","--memory","1g","--user","1000:1000",
      "--mount","type=bind,src="+this.directory+",dst=/workspace","--workdir","/workspace",
      "--env","npm_config_cache=/tmp/npm-cache","node:22-bookworm-slim",...command];
    this.#containers.add(container);
    let output="";
    const child=spawn("docker",args,{env:{PATH:process.env.PATH,NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});
    const stop=()=>{child.kill("SIGTERM");};signal.addEventListener("abort",stop,{once:true});
    const timer=setTimeout(stop,120000);
    for(const stream of [child.stdout,child.stderr])stream.on("data",chunk=>{if(output.length<16000)output+=String(chunk).slice(0,16000-output.length);});
    let code:number|null;
    try{code=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});}
    finally{
      clearTimeout(timer);signal.removeEventListener("abort",stop);
      // Killing docker CLI alone does not prove that the container stopped.
      await this.#remove(container);this.#containers.delete(container);
    }
    return {command:command.join(" "),exitCode:code,output,truncated:output.length>=16000,network:name==="install"?"dependency-download-only":"disabled"};
  }
  async #remove(name:string){
    const cleanup=spawn("docker",["rm","--force",name],{env:{PATH:process.env.PATH,NODE_ENV:"test"},stdio:"ignore"});
    const code=await new Promise<number|null>((resolve,reject)=>{cleanup.once("error",reject);cleanup.once("exit",resolve);});
    if(code!==0){
      const inspect=spawn("docker",["inspect","--format","{{.State.Running}}",name],{env:{PATH:process.env.PATH,NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});
      let output="",error="";inspect.stdout.on("data",c=>output+=String(c));inspect.stderr.on("data",c=>error+=String(c));
      const status=await new Promise<number|null>((resolve,reject)=>{inspect.once("error",reject);inspect.once("exit",resolve);});
      if(!(status===0&&output.trim()==="false")&&!(status===1&&/No such object|No such container/.test(error)))
        throw new SandboxFailure("Container termination could not be verified; repository must remain held");
    }
  }
  async dispose(){for(const name of this.#containers)await this.#remove(name);this.#containers.clear();await rm(this.directory,{recursive:true,force:true});}
}
