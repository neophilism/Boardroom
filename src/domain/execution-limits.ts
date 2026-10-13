export const DEFAULT_EXECUTION_LIMITS={maxSessionSeconds:1800,maxToolCalls:100,maxTokens:100000} as const;
export type ExecutionLimits={maxSessionSeconds:number;maxToolCalls:number;maxTokens:number};
export function boundedWorkerLimits(config:ExecutionLimits,evidence:unknown):ExecutionLimits{
  if(evidence===undefined||evidence===null)evidence=DEFAULT_EXECUTION_LIMITS;
  if(!evidence||typeof evidence!=="object"||Array.isArray(evidence))throw new Error("Invalid repository execution limits");
  const e=evidence as Record<string,unknown>;
  const ranges={maxSessionSeconds:[60,14400],maxToolCalls:[1,1000],maxTokens:[1,10000000]} as const;
  const result={...config};
  for(const key of Object.keys(ranges) as (keyof ExecutionLimits)[]){
    const value=e[key],range=ranges[key];
    if(!Number.isSafeInteger(value)||(value as number)<range[0]||(value as number)>range[1])throw new Error("Invalid repository execution limits");
    result[key]=Math.min(config[key],value as number);
  }
  return result;
}
