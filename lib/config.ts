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
    ? "disabled" : process.env.LINE_TARGET_ID ? "push" : "broadcast";
  return {
    version: "10.3.0",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode, alertsEnabled: lineEnabled, activeSignalMode: classicMode,
    classicMode, adaptiveMode: false,
    signalProfile: classicMode ? "CLASSIC_98_PRO" : "CUSTOM",
    alertMinProbability: integerEnv("ALERT_MIN_PROBABILITY", 61, 50, 90),
    alertMinScore: integerEnv("ALERT_MIN_SCORE", 58, 50, 95),
    confirmedMinProbability: integerEnv("CONFIRMED_MIN_PROBABILITY", 64, 55, 95),
    confirmedMinScore: integerEnv("CONFIRMED_MIN_SCORE", 62, 55, 98),
    opportunityMinProbability: integerEnv("OPPORTUNITY_MIN_PROBABILITY", 57, 50, 90),
    opportunityMinScore: integerEnv("OPPORTUNITY_MIN_SCORE", 62, 55, 98),
    scoutMinProbability: integerEnv("SCOUT_MIN_PROBABILITY", 59, 50, 90),
    scoutMinScore: integerEnv("SCOUT_MIN_SCORE", 66, 55, 98),
    pulseMinProbability: 99, pulseMinScore: 99,
    minimumDirectionalEdge: integerEnv("MINIMUM_DIRECTIONAL_EDGE", 10, 6, 30),
    minimumConfirmations: integerEnv("MINIMUM_CONFIRMATIONS", 2, 2, 4),
    scoutMinimumConfirmations: integerEnv("SCOUT_MINIMUM_CONFIRMATIONS", 3, 2, 4),
    deliverySlotMinutes: integerEnv("DELIVERY_SLOT_MINUTES", 30, 15, 60),
    dailyAlertCap: integerEnv("DAILY_ALERT_SAFETY_CAP", 24, 5, 48),
    riskHighBlocked: true, targetIsEstimateNotGuarantee: true,
    targetSignalIntervalMinutes: 30, technicalMinimumGapMinutes: 2,
    adaptiveStateConfigured: false, adaptiveStateRequired: false,
    adaptiveStateMode: "disabled-classic"
  } as const;
}
