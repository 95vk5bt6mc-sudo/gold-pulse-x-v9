import { NextResponse } from "next/server";
import { snapshot } from "../../../lib/core/signal-state";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = snapshot();
  const config = getRuntimeConfig();
  return NextResponse.json({
    ok: true,
    version: config.version,
    architecture: "real-repository + typed-server-core",
    provider: config.provider,
    freeMode: true,
    scheduler: "GitHub Actions",
    lineMode: config.lineMode,
    serverScan: { lastScanAt: state.lastScanAt, lastResult: state.lastResult },
    note: "Last scan state is best-effort serverless memory and can reset after a cold start. LINE duplicate protection uses X-Line-Retry-Key."
  }, { headers: { "Cache-Control": "no-store" } });
}
