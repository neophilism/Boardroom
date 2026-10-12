import {synchronizeInstalledRepositories} from "../src/server/repository-sync.ts";
const report=await synchronizeInstalledRepositories();
console.log(JSON.stringify(report,null,2));
if(report.failed>0)process.exitCode=1;
