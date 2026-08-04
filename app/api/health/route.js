import { NextResponse } from "next/server";
import { getRuntimeConfig } from "../../../lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getRuntimeConfig();
  const adaptiveStateReady = !config.adaptiveStateRequired || config.adaptiveStateConfigured;
  const ready = config.marketDataConfigured &&
    config.apiSecretConfigured &&
    config.lineConfigured &&
    adaptiveStateReady;

  return NextResponse.json({
    ok: ready,
    app: "GOLD PULSE X v10.2.1 ADAPTIVE LITE",
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
      opportunityMinimumProbability: config.opportunityMinProbability,
      opportunityMinimumScore: config.opportunityMinScore,
      scoutMinimumProbability: config.scoutMinProbability,
      scoutMinimumScore: config.scoutMinScore,
      pulseMinimumProbability: config.pulseMinProbability,
      pulseMinimumScore: config.pulseMinScore,
      minimumDirectionalEdge: config.minimumDirectionalEdge,
      minimumConfirmations: 2,
      scoutMinimumConfirmations: 3,
      pulseMinimumConfirmations: 3,
      riskHighBlocked: true
    },
    adaptiveCadence: {
      enabled: config.adaptiveMode,
      targetSignalIntervalMinutes: config.targetSignalIntervalMinutes,
      hardThirtyMinuteLimit: false,
      technicalMinimumGapMinutes: config.technicalMinimumGapMinutes,
      coldStartQuality: config.adaptiveColdStartQuality,
      eliteQualityBefore10Minutes: config.adaptiveEliteQuality,
      earlyQuality10To20Minutes: config.adaptiveEarlyQuality,
      targetQuality20To30Minutes: config.adaptiveTargetQuality,
      lateQuality30To45Minutes: config.adaptiveLateQuality,
      absoluteQualityFloor: config.adaptiveQualityFloor,
      reversalPenalty: config.adaptiveReversalPenalty,
      sameDirectionImprovement: config.adaptiveSameDirectionImprovement,
      candidateExpiryMinutes: config.candidateExpiryMinutes,
      dailySafetyCap: config.dailyAlertCap,
      targetIsEstimateNotGuarantee: true,
      modelEstimateIsNotVerifiedWinRate: true
    },
    adaptiveState: {
      required: config.adaptiveStateRequired,
      configured: config.adaptiveStateConfigured,
      mode: config.adaptiveStateMode,
      ready: adaptiveStateReady,
      requiredEnvironmentVariables: [],
      warning: config.adaptiveStateMode === "memory-fallback"
        ? "No Redis: adaptive state is best-effort only. LINE idempotency limits delivery to one alert per 30-minute slot."
        : null
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
