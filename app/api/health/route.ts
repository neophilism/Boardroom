import { NextResponse } from "next/server";
import {deploymentRevision} from "../../../src/domain/deployment-revision";
export const dynamic = "force-dynamic";
/** Liveness only; revision is public commit metadata, never a secret. */
export function GET() {
  const revision=deploymentRevision(process.env);
  return NextResponse.json({
    service:"boardroom",liveness:"alive",revision
  }, {headers:{"Cache-Control":"no-store"}});
}
