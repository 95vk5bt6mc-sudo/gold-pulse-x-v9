import { getRuntimeConfig } from "./config";
import { sendLineText } from "./line";

type AnyRecord = Record<string, any>;

const numberText = (value: unknown, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";

export function evaluateAlert(payload: AnyRecord) {
  const config = getRuntimeConfig();
  const decision = payload?.tradeDecision;
  const probability = Number(decision?.targetProbability || 0);
  const score = Number(decision?.signalScore || decision?.entryQuality || 0);
  const direction = decision?.direction;
  const reasons: string[] = [];

  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  const opportunity = decision?.entryTier === "OPPORTUNITY";
  const scout = decision?.entryTier === "SCOUT";
  const minimumProbability = scout
    ? config.scoutMinProbability
    : opportunity
      ? config.opportunityMinProbability
      : config.alertMinProbability;
  const minimumScore = scout
    ? config.scoutMinScore
    : opportunity
      ? config.opportunityMinScore
      : config.alertMinScore;
  const cooldownMinutes = scout
    ? config.scoutCooldownMinutes
    : opportunity
      ? config.opportunityCooldownMinutes
      : config.alertCooldownMinutes;

  if (decision?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (probability < minimumProbability) reasons.push("probability-below-gate");
  if (score < minimumScore) reasons.push("score-below-gate");

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    appliedGate: { tier: decision?.entryTier || "UNKNOWN", minimumProbability, minimumScore, cooldownMinutes },
    cooldownMinutes,
    config
  };
}

function alertFingerprint(payload: AnyRecord, cooldownMinutes: number): string {
  const d = payload.tradeDecision || {};
  const bucketMs = cooldownMinutes * 60 * 1000;
  const bucket = Math.floor(Date.now() / bucketMs);
  // One alert per direction in each cooldown bucket. Tier/mode changes cannot spam LINE.
  return [
    "gold-pulse-v9.8",
    payload.symbol || "XAU/USD",
    d.direction || "WAIT",
    bucket
  ].join("|");
}

export function buildSignalText(payload: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  const rr = d?.riskReward?.tp2;
  const tierLabel = d.entryTier === "SCOUT"
    ? "SCOUT ENTRY IDEA"
    : d.entryTier === "OPPORTUNITY"
      ? "OPPORTUNITY ENTRY IDEA"
      : d.entryTier === "ACTIVE"
      ? "ACTIVE ENTRY IDEA"
      : `${d.entryTier || "CONFIRMED"} ENTRY`;
  return [
    `${icon} GOLD PULSE X v9.8 SCOUT SIGNAL`,
    "",
    `${d.direction} · ${tierLabel} · ${d.mode || "TREND"}`,
    `XAU/USD · Model probability ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Grade ${payload?.smartFree?.confidence?.grade || "—"} · ${payload?.smartFree?.confidence?.label || "—"}`,
    `Session ${payload?.smartFree?.session || "—"} · Regime ${payload?.smartFree?.marketRegime || "—"}`,
    "",
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · ${Math.round(Number(d?.takeProfit?.tp1Chance || 0))}%`,
    `TP2 ${numberText(d?.takeProfit?.tp2)} · ${Math.round(Number(d?.takeProfit?.tp2Chance || 0))}%`,
    `TP3 ${numberText(d?.takeProfit?.tp3)} · ${Math.round(Number(d?.takeProfit?.tp3Chance || 0))}%`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward 1:${numberText(rr)}`,
    `Holding estimate ${d.expectedHoldingMinutes || "—"} min`,
    "",
    "Why this alert:",
    ...(payload?.smartFree?.explain || d.reasons || []).slice(0, 4).map((reason: string) => `• ${reason}`),
    "",
    `Market data: ${payload.source || "provider"}`,
    `Updated: ${payload.updatedAt || new Date().toISOString()}`,
    "",
    ["ACTIVE", "OPPORTUNITY", "SCOUT"].includes(d.entryTier)
      ? `⚠️ ${d.entryTier} เป็นสัญญาณเชิงรุก เกณฑ์ผ่อนกว่าระดับ CONFIRMED ต้องตรวจแท่งราคาและความเสี่ยงก่อนเข้าเอง`
      : "⚠️ การประเมินจากโมเดล ไม่ใช่คำแนะนำการลงทุน กรุณาตรวจสอบราคากับโบรกเกอร์และจำกัดความเสี่ยง"
  ].join("\n");
}

export async function sendSignalAlert(payload: AnyRecord) {
  const evaluation = evaluateAlert(payload);
  if (!evaluation.eligible) {
    return { sent: false, duplicate: false, reason: evaluation.reasons.join(",") || "not-eligible", evaluation };
  }

  const fingerprint = alertFingerprint(payload, evaluation.cooldownMinutes);
  const result = await sendLineText(buildSignalText(payload), fingerprint);
  return {
    sent: result.delivered,
    duplicate: result.duplicate,
    reason: result.ok ? (result.duplicate ? "duplicate-blocked-by-line" : "sent") : result.detail || `line-http-${result.status}`,
    mode: result.mode,
    status: result.status,
    retryKey: result.retryKey,
    evaluation
  };
}
