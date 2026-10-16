/** Obtain a short-lived GitHub assertion without exposing it in logs or files. */
export async function maintenanceCredential(env,origin,request=fetch){
  if(env.BOARDROOM_WATCHDOG_TOKEN)return env.BOARDROOM_WATCHDOG_TOKEN;
  if(!env.ACTIONS_ID_TOKEN_REQUEST_URL||!env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    throw new Error("Maintenance authentication is not configured");
  const endpoint=new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(endpoint.protocol!=="https:"||endpoint.username||endpoint.password||
    !endpoint.hostname.endsWith(".actions.githubusercontent.com"))
    throw new Error("Invalid GitHub identity endpoint");
  endpoint.searchParams.set("audience",origin+"/api/v1/internal/tick");
  const result=await request(endpoint.toString(),{redirect:"error",signal:AbortSignal.timeout(15000),
    headers:{Authorization:"Bearer "+env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,Accept:"application/json"}});
  if(!result.ok)throw new Error("GitHub identity request failed");
  const text=await result.text();
  if(text.length>20000)throw new Error("Invalid GitHub identity response");
  let body;
  try{body=JSON.parse(text);}catch{throw new Error("Invalid GitHub identity response");}
  if(typeof body.value!=="string"||body.value.length>16000||
    !/^[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+\.[-A-Za-z0-9_]+$/.test(body.value))
    throw new Error("Invalid GitHub identity response");
  return body.value;
}
