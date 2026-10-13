export type DeploymentEvidence={
  revision:string|null;
  readiness:"ready"|"not_ready";
  exactReleaseVerified:boolean;
};

/** Validate only public release metadata. Never echo an untrusted response. */
export function expectedReleaseRevision(value:string|undefined):string|undefined{
  if(value===undefined)return undefined;
  if(!/^[a-f0-9]{40}$/i.test(value))throw new Error("Expected release revision must be a full Git commit SHA");
  return value.toLowerCase();
}
function record(value:unknown):value is Record<string,unknown>{
  return value!==null&&typeof value==="object"&&!Array.isArray(value);
}
export function checkDeploymentEvidence(input:{
  healthStatus:number;health:unknown;
  readinessStatus:number;readiness:unknown;
  expectedRevision?:string;
}):DeploymentEvidence{
  const expected=expectedReleaseRevision(input.expectedRevision);
  if(input.healthStatus!==200||!record(input.health)||input.health.service!=="boardroom"||input.health.liveness!=="alive")
    throw new Error("Boardroom liveness is not verified");
  const value=input.health.revision;
  if(value!==null&&(typeof value!=="string"||!/^[a-f0-9]{40}$/i.test(value)))
    throw new Error("Observed release revision is invalid");
  const revision=value===null?null:(value as string).toLowerCase();
  if(![200,503].includes(input.readinessStatus)||!record(input.readiness)||input.readiness.service!=="boardroom")
    throw new Error("Boardroom readiness response is invalid");
  const readiness=input.readinessStatus===200?"ready":"not_ready";
  if(input.readiness.readiness!==readiness)throw new Error("Boardroom readiness status and response disagree");
  if(expected!==undefined){
    if(revision!==expected)throw new Error("Expected release is not yet deployed");
    if(readiness!=="ready")throw new Error("Expected release is not yet ready");
  }
  return {revision,readiness,exactReleaseVerified:expected!==undefined};
}
