import {runnerConfiguration,runHostedAgent} from "../src/runner/run.ts";
const config=runnerConfiguration(process.env);
if(!config){console.log("Hosted Boardroom worker is disabled; no model request was sent.");}
else{
  const controller=new AbortController();
  for(const signal of ["SIGTERM","SIGINT"])process.once(signal,()=>controller.abort());
  const activation=process.env.GITHUB_RUN_ID?"hosted-"+process.env.GITHUB_RUN_ID+"-"+(process.env.GITHUB_RUN_ATTEMPT??"1"):"hosted-"+crypto.randomUUID();
  try{
    const result=await runHostedAgent(config,activation,controller.signal);
    // Operational identity, code, prompts and repository names stay private.
    console.log("Hosted Boardroom worker ended: "+result.status);
    if(result.status==="RECOVERY_REQUIRED"||result.status==="FAILED")process.exitCode=1;
  }catch{console.error("Hosted Boardroom worker unavailable. Inspect its private Owner Action and system status; no credentials or provider payload were logged.");process.exitCode=1;}
}
