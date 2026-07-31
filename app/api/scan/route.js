import { NextResponse } from "next/server";
import { markScan } from "../../../lib/core/signal-state";
import { sendSignalAlert } from "../../../lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request) {
  const expected = process.env.GOLD_PULSE_API_SECRET;
  const supplied = request.headers.get("x-gold-pulse-secret");
  return Boolean(expected) && supplied === expected;
}

async function run(request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  const origin = request.nextUrl.origin;
  const response = await fetch(`${origin}/api/gold?source=server-scan`, {
    cache: "no-store",
    headers: { "user-agent": "GOLD-PULSE-v9-FREE-SCAN" }
  });
  const payload = await response.json().catch(() => ({ ok: false, message: `Market API HTTP ${response.status}` }));

  let lineAlert = { sent: false, duplicate: false, reason: "market-data-failed" };
  if (response.ok && payload?.ok !== false) {
    try {
      lineAlert = await sendSignalAlert(payload);
    } catch (error) {
      lineAlert = {
        sent: false,
        duplicate: false,
        reason: error instanceof Error ? error.message : "line-alert-exception"
      };
    }
  }

  const result = {
    ok: response.ok && payload?.ok !== false,
    version: "9.0.0",
    scannedAt: new Date().toISOString(),
    market: payload.market || null,
    source: payload.source || null,
    dataMode: payload.dataMode || null,
    decision: payload.tradeDecision || null,
    lineAlert,
    message: payload.message || null
  };
  markScan(result);

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" }
  });
}

export async function GET(request) { return run(request); }
export async function POST(request) { return run(request); }
