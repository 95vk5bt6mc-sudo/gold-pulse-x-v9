import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const ready = config.marketDataConfigured &&
    config.apiSecretConfigured &&
    config.lineConfigured;

  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS",
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
    alertRules: {
      baseMinimumProbability: config.alertMinProbability,
      baseMinimumScore: config.alertMinScore,
      confirmedMinimumProbability: config.confirmedMinProbability,
      confirmedMinimumScore: config.confirmedMinScore,
      opportunityMinimumProbability: config.opportunityMinProbability,
      opportunityMinimumScore: config.opportunityMinScore,
      scoutMinimumProbability: config.scoutMinProbability,
      scoutMinimumScore: config.scoutMinScore,
      pulseDisabled: true,
      minimumDirectionalEdge: config.minimumDirectionalEdge,
      minimumConfirmations: config.minimumConfirmations,
      scoutMinimumConfirmations: config.scoutMinimumConfirmations,
      riskHighBlocked: true
    },
    classicQualityFilters: {
      adaptiveCadenceEnabled: false,
      pulseFallbackEnabled: false,
      rangeMinimumEdge: config.rangeMinimumEdge,
      mixedMinimumEdge: config.mixedMinimumEdge,
      counterTrendMinimumEdge: config.counterTrendMinimumEdge,
      deliveryGuardSlotMinutes: config.deliverySlotMinutes,
      persistentStateRequired: false,
      note: "Quality-first filtering. No signal is forced by time or target count."
    },
    scheduler: "cron-job.org | every 5 minutes | endpoint active 08:00-24:00 Asia/Bangkok",
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
    checkedAt: new Date().toISOString()
  }, {
    status: ready ? 200 : 503,
    headers: { "Cache-Control": "no-store" }
  });
}
