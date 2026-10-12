import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
/** Process-liveness only: this does not claim dependencies, workers or GitHub are healthy. */
export function GET() {
  return NextResponse.json({ service: "boardroom", liveness: "alive" }, { headers: { "Cache-Control": "no-store" } });
}
