import {NextResponse} from "next/server";
import {getDatabase} from "../../../../../src/server/db";
import {authenticateAgent,InvalidAgentCredential} from "../../../../../src/server/agent-auth";
import {parseGithubWriteRequest,performFencedGithubWrite,GithubWriteValidation}
  from "../../../../../src/server/github-write-gateway";
import {GitHubAppError} from "../../../../../src/server/github-app";
import {SessionConflict} from "../../../../../src/server/sessions";
import {GithubOperationUncertain} from "../../../../../src/server/github-operation-ledger";
import {boundedRequestText,RequestBodyTooLarge} from "../../../../../src/server/request-body";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};

export async function POST(request:Request){
  try{
    const db=getDatabase();
    const agent=await authenticateAgent(request.headers,db);
    const input:unknown=JSON.parse(await boundedRequestText(request,300000));
    const {runId,generation,op}=parseGithubWriteRequest(input);
    const result=await performFencedGithubWrite(db,runId,agent.credentialId,generation,op);
    return NextResponse.json(result,{headers});
  }catch(error){
    if(error instanceof RequestBodyTooLarge)return NextResponse.json({error:"Request too large"},{status:413,headers});
    if(error instanceof SyntaxError)return NextResponse.json({error:"Invalid JSON request"},{status:400,headers});
    if(error instanceof InvalidAgentCredential)
      return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    if(error instanceof GithubWriteValidation)
      return NextResponse.json({error:error.message},{status:400,headers});
    if(error instanceof GithubOperationUncertain)
      return NextResponse.json({error:error.message,code:"GITHUB_OPERATION_UNCERTAIN"},{status:409,headers});
    if(error instanceof SessionConflict)
      return NextResponse.json({error:error.message},{status:409,headers});
    if(error instanceof GitHubAppError){
      // GitHub conflicts require the agent to refresh its source SHA or PR state.
      const conflict=[404,409,422].includes(error.httpStatus);
      return NextResponse.json({error:conflict?"GitHub ref or file conflict":"GitHub write unavailable",
        githubStatus:error.httpStatus},{status:conflict?409:503,headers});
    }
    console.error("Fenced GitHub gateway operation failed");
    return NextResponse.json({error:"GitHub write unavailable"},{status:503,headers});
  }
}
