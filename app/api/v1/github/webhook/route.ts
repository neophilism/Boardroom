import {handleGitHubWebhook} from "../../../../../src/server/webhook";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  return handleGitHubWebhook(request);
}
