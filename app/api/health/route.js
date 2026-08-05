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
    app: "GOLD PULSE X v11.0 PATTERN INTELLIGENCE 5M",
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
    patternIntelligence: {
      enabled: true,
      timeframe: "5min",
      mode: "live-overlay",
      features: [
        "5M Candle DNA Weighted KNN",
        "RSI/MACD regular and hidden divergence",
        "Liquidity sweep and fake breakout",
        "BOS/CHOCH market structure",
        "Next 5/10/15-minute probability distribution"
      ],
      currentLiveMemory: "Up to the provider window loaded per scan",
      millionPatternArchiveReady: false,
      note: "Million-pattern training requires an external historical dataset and offline training pipeline."
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
