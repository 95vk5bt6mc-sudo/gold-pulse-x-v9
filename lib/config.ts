import { getAdaptiveStateConnection } from "./core/adaptive-state";

export type LineDeliveryMode = "push" | "broadcast" | "disabled";

function integerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.toLowerCase());
}

export function getRuntimeConfig() {
  const lineEnabled = booleanEnv("LINE_ALERTS_ENABLED", true);
  const hasLineToken = Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN);
  const adaptiveMode = booleanEnv("ADAPTIVE_SIGNAL_MODE", true);
  const lineMode: LineDeliveryMode = !lineEnabled || !hasLineToken
    ? "disabled"
    : process.env.LINE_TARGET_ID
      ? "push"
      : "broadcast";

  const customProbability = integerEnv("ALERT_MIN_PROBABILITY", 62, 45, 99);
  const customScore = integerEnv("ALERT_MIN_SCORE", 58, 40, 100);
  const stateConnection = getAdaptiveStateConnection();

  return {
    version: "10.2.1",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode,
    alertsEnabled: lineEnabled,
    activeSignalMode: adaptiveMode,
    adaptiveMode,
    signalProfile: adaptiveMode ? "ADAPTIVE_QUALITY_30_LITE" : "CUSTOM",

    // Base decision gates. Adaptive quality is applied after these gates pass.
    alertMinProbability: adaptiveMode ? 62 : customProbability,
    alertMinScore: adaptiveMode ? 58 : customScore,
    opportunityMinProbability: adaptiveMode ? 54 : Math.max(45, customProbability - 8),
    opportunityMinScore: adaptiveMode ? 61 : Math.max(45, customScore),
    scoutMinProbability: adaptiveMode ? 56 : Math.max(45, customProbability - 6),
    scoutMinScore: adaptiveMode ? 62 : Math.max(45, customScore + 2),
    pulseMinProbability: adaptiveMode ? 58 : Math.max(45, customProbability - 5),
    pulseMinScore: adaptiveMode ? 61 : Math.max(45, customScore),
    minimumDirectionalEdge: adaptiveMode ? 10 : 8,

    // Adaptive cadence. This targets about one high-quality opportunity near
    // each 30-minute period but never forces a signal and never hard-locks 30m.
    targetSignalIntervalMinutes: integerEnv("TARGET_SIGNAL_INTERVAL_MINUTES", 30, 15, 90),
    technicalMinimumGapMinutes: integerEnv("TECHNICAL_MINIMUM_GAP_MINUTES", 2, 1, 10),
    adaptiveColdStartQuality: integerEnv("ADAPTIVE_COLD_START_QUALITY", 78, 65, 99),
    adaptiveEliteQuality: integerEnv("ADAPTIVE_ELITE_QUALITY", 92, 75, 99),
    adaptiveEarlyQuality: integerEnv("ADAPTIVE_EARLY_QUALITY", 86, 70, 99),
    adaptiveTargetQuality: integerEnv("ADAPTIVE_TARGET_QUALITY", 80, 65, 99),
    adaptiveLateQuality: integerEnv("ADAPTIVE_LATE_QUALITY", 76, 60, 99),
    adaptiveQualityFloor: integerEnv("ADAPTIVE_QUALITY_FLOOR", 72, 55, 95),
    adaptiveReversalPenalty: integerEnv("ADAPTIVE_REVERSAL_PENALTY", 4, 0, 15),
    adaptiveSameDirectionImprovement: integerEnv("ADAPTIVE_SAME_DIRECTION_IMPROVEMENT", 3, 0, 15),
    candidateExpiryMinutes: integerEnv("ADAPTIVE_CANDIDATE_EXPIRY_MINUTES", 20, 5, 60),
    dailyAlertCap: integerEnv("DAILY_ALERT_SAFETY_CAP", 32, 5, 64),

    adaptiveStateConfigured: stateConnection.configured,
    adaptiveStateRequired: stateConnection.required,
    adaptiveStateMode: stateConnection.mode
  } as const;
}
