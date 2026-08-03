import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const ready = config.marketDataConfigured && config.apiSecretConfigured && config.lineConfigured;
  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v9.7 OPPORTUNITY SIGNAL",
    version: config.version,
    provider: config.provider,
    marketDataConfigured: config.marketDataConfigured,
    scanSecretConfigured: config.apiSecretConfigured,
    lineConfigured: config.lineConfigured,
    lineWebhookSecretConfigured: config.lineSecretConfigured,
    lineTargetConfigured: config.lineTargetConfigured,
    lineMode: config.lineMode,
    automaticLineAlerts: config.alertsEnabled,
    signalProfile: config.signalProfile,
    targetAlertsPerDay: config.targetAlertsPerDay,
    alertRules: {
      minimumProbability: config.alertMinProbability,
      minimumScore: config.alertMinScore,
      opportunityMinimumProbability: config.opportunityMinProbability,
      opportunityMinimumScore: config.opportunityMinScore,
      minimumDirectionalEdge: config.minimumDirectionalEdge,
      cooldownMinutes: config.alertCooldownMinutes,
      minimumConfirmations: 2,
      riskHighBlocked: true,
      targetIsEstimateNotGuarantee: true
    },
    scheduler: "GitHub Actions · every 5 minutes · 08:00–24:00 Asia/Bangkok",
    smartFree: {
      timezone: "Asia/Bangkok",
      activeHours: "08:00–24:00",
      scanIntervalMinutes: 5,
      plannedScansPerDay: 192,
      estimatedServerCreditsPerDay: 384,
      estimatedDashboardCreditsPerDay: 192,
      estimatedCombinedCreditsPerDay: 576,
      freeDailyCreditLimit: 800,
      estimatedReserveCredits: 224
    },
    serverlessStatePersistent: false,
    checkedAt: new Date().toISOString()
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
