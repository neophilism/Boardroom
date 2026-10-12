import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Liveness only; revision is public commit metadata, never a secret. */
export function GET() {
  const raw=process.env.RENDER_GIT_COMMIT;
  const revision=raw&&/^[0-9a-f]{40}$/i.test(raw)?raw:null;
  return NextResponse.json({
    service:"boardroom",liveness:"alive",revision
  }, {headers:{"Cache-Control":"no-store"}});
}
