import {maintenanceCredential} from "./maintenance-auth.mjs";
try{
const origin=process.env.BOARDROOM_BASE_URL;
if(process.env.BOARDROOM_MAINTENANCE_ENABLED!=="true")console.log("Boardroom maintenance scheduler disabled.");
else{
  if(!origin)throw new Error("Protected maintenance configuration missing");
  const parsed=new URL(origin);if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.pathname!=="/")throw new Error("Invalid maintenance origin");
  const token=await maintenanceCredential(process.env,parsed.origin);
  const response=await fetch(parsed.origin+"/api/v1/internal/tick",{method:"POST",redirect:"error",headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(180000)});
  if(!response.ok){console.error("Boardroom maintenance unavailable (HTTP "+response.status+")");process.exitCode=1;}
  else console.log("Boardroom maintenance request completed.");
}
}catch{
  console.error("Boardroom maintenance failed; verify authentication and service readiness.");
  process.exitCode=1;
}
