import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const ready = config.marketDataConfigured && config.apiSecretConfigured && config.lineConfigured;
  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v10 PULSE ENGINE",
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
      scoutMinimumProbability: config.scoutMinProbability,
      scoutMinimumScore: config.scoutMinScore,
      pulseMinimumProbability: config.pulseMinProbability,
      pulseMinimumScore: config.pulseMinScore,
      minimumDirectionalEdge: config.minimumDirectionalEdge,
      activeCooldownMinutes: config.alertCooldownMinutes,
      opportunityCooldownMinutes: config.opportunityCooldownMinutes,
      scoutCooldownMinutes: config.scoutCooldownMinutes,
      pulseCooldownMinutes: config.pulseCooldownMinutes,
      pulseDesignCapacityPerDay: config.pulseDesignCapacityPerDay,
      minimumConfirmations: 2,
      riskHighBlocked: true,
      targetIsEstimateNotGuarantee: true
    },
    scheduler: "GitHub Actions | every 5 minutes | 08:00-24:00 Asia/Bangkok",
    smartFree: {
      timezone: "Asia/Bangkok",
      activeHours: "08:00-24:00",
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
