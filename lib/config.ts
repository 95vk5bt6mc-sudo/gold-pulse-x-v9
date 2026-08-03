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
  const activeSignalMode = booleanEnv("ACTIVE_SIGNAL_MODE", true);
  const lineMode: LineDeliveryMode = !lineEnabled || !hasLineToken
    ? "disabled"
    : process.env.LINE_TARGET_ID
      ? "push"
      : "broadcast";

  // ACTIVE mode deliberately overrides legacy v9.5 gates so existing Vercel values
  // such as 80/70/30 cannot silently keep the system too restrictive after upgrade.
  const customProbability = integerEnv("ALERT_MIN_PROBABILITY", 60, 50, 99);
  const customScore = integerEnv("ALERT_MIN_SCORE", 54, 40, 100);
  const customCooldown = integerEnv("ALERT_COOLDOWN_MINUTES", 20, 5, 240);

  return {
    version: "9.7.0",
    provider: process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data",
    marketDataConfigured: Boolean(process.env.TWELVE_DATA_API_KEY),
    apiSecretConfigured: Boolean(process.env.GOLD_PULSE_API_SECRET),
    lineConfigured: hasLineToken,
    lineSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
    lineTargetConfigured: Boolean(process.env.LINE_TARGET_ID),
    lineMode,
    alertsEnabled: lineEnabled,
    activeSignalMode,
    signalProfile: activeSignalMode ? "ACTIVE_20_OPPORTUNITY" : "CUSTOM",
    targetAlertsPerDay: integerEnv("TARGET_ALERTS_PER_DAY", 20, 5, 40),
    alertMinProbability: activeSignalMode ? 60 : customProbability,
    alertMinScore: activeSignalMode ? 54 : customScore,
    opportunityMinProbability: activeSignalMode ? 50 : Math.max(45, customProbability - 10),
    opportunityMinScore: activeSignalMode ? 58 : Math.max(45, customScore),
    minimumDirectionalEdge: 8,
    alertCooldownMinutes: activeSignalMode ? 20 : customCooldown
  } as const;
}
