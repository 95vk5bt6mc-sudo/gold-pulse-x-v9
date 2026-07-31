import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const ready = config.marketDataConfigured && config.apiSecretConfigured && config.lineConfigured;
  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v9.0 FREE MODE",
    version: config.version,
    provider: config.provider,
    marketDataConfigured: config.marketDataConfigured,
    scanSecretConfigured: config.apiSecretConfigured,
    lineConfigured: config.lineConfigured,
    lineWebhookSecretConfigured: config.lineSecretConfigured,
    lineTargetConfigured: config.lineTargetConfigured,
    lineMode: config.lineMode,
    automaticLineAlerts: config.alertsEnabled,
    alertRules: {
      minimumProbability: config.alertMinProbability,
      minimumScore: config.alertMinScore,
      cooldownMinutes: config.alertCooldownMinutes
    },
    scheduler: "GitHub Actions",
    serverlessStatePersistent: false,
    checkedAt: new Date().toISOString()
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
