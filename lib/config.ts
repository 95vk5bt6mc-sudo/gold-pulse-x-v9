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
  const classicMode = booleanEnv("CLASSIC_98_PRO_MODE", true);
  const lineMode: LineDeliveryMode = !lineEnabled || !hasLineToken
    ? "disabled"
    : process.env.LINE_TARGET_ID
      ? "push"
      : "broadcast";

  return {
    version: "11.0.0",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode,
    alertsEnabled: lineEnabled,
    activeSignalMode: classicMode,
    classicMode,
    adaptiveMode: false,
    signalProfile: classicMode ? "PATTERN_INTELLIGENCE_5M" : "CUSTOM",

    // ใช้ชื่อ Environment Variable ชุดใหม่ เพื่อไม่ให้ค่าเก่า 80/70 จาก v10.2 มาทับระบบ Classic
    alertMinProbability: integerEnv("CLASSIC_BASE_MIN_PROBABILITY", 61, 55, 85),
    alertMinScore: integerEnv("CLASSIC_BASE_MIN_SCORE", 58, 52, 90),
    confirmedMinProbability: integerEnv("CLASSIC_CONFIRMED_MIN_PROBABILITY", 66, 60, 90),
    confirmedMinScore: integerEnv("CLASSIC_CONFIRMED_MIN_SCORE", 64, 58, 95),
    opportunityMinProbability: integerEnv("CLASSIC_OPPORTUNITY_MIN_PROBABILITY", 57, 52, 85),
    opportunityMinScore: integerEnv("CLASSIC_OPPORTUNITY_MIN_SCORE", 62, 56, 95),
    scoutMinProbability: integerEnv("CLASSIC_SCOUT_MIN_PROBABILITY", 59, 54, 88),
    scoutMinScore: integerEnv("CLASSIC_SCOUT_MIN_SCORE", 66, 60, 96),
    pulseMinProbability: 99,
    pulseMinScore: 99,
    minimumDirectionalEdge: integerEnv("CLASSIC_MINIMUM_DIRECTIONAL_EDGE", 10, 8, 25),
    minimumConfirmations: integerEnv("CLASSIC_MINIMUM_CONFIRMATIONS", 2, 2, 4),
    scoutMinimumConfirmations: integerEnv("CLASSIC_SCOUT_MINIMUM_CONFIRMATIONS", 3, 3, 4),

    rangeMinimumEdge: integerEnv("CLASSIC_RANGE_MINIMUM_EDGE", 14, 10, 30),
    mixedMinimumEdge: integerEnv("CLASSIC_MIXED_MINIMUM_EDGE", 12, 10, 30),
    counterTrendMinimumEdge: integerEnv("CLASSIC_COUNTER_TREND_MINIMUM_EDGE", 16, 12, 35),
    deliverySlotMinutes: integerEnv("CLASSIC_DELIVERY_SLOT_MINUTES", 30, 15, 60),

    riskHighBlocked: true,
    targetIsEstimateNotGuarantee: true,
    adaptiveStateConfigured: false,
    adaptiveStateRequired: false,
    adaptiveStateMode: "disabled-classic"
  } as const;
}
