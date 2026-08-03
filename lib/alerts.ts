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
  const pulse = decision?.entryTier === "PULSE";
  const minimumProbability = pulse
    ? config.pulseMinProbability
    : scout
      ? config.scoutMinProbability
      : opportunity
        ? config.opportunityMinProbability
        : config.alertMinProbability;
  const minimumScore = pulse
    ? config.pulseMinScore
    : scout
      ? config.scoutMinScore
      : opportunity
        ? config.opportunityMinScore
        : config.alertMinScore;
  const cooldownMinutes = pulse
    ? config.pulseCooldownMinutes
    : scout
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
  // PULSE is limited to one alert per 30-minute symbol bucket even if direction
  // flips. Higher tiers retain direction-specific retry protection.
  const directionBucket = d.entryTier === "PULSE" ? "PULSE_ANY" : (d.direction || "WAIT");
  return [
    "gold-pulse-v10.0",
    payload.symbol || "XAU/USD",
    directionBucket,
    bucket
  ].join("|");
}

export function buildSignalText(payload: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  const rr = d?.riskReward?.tp2;
  const tierLabel = d.entryTier === "PULSE"
    ? "PULSE ENTRY IDEA"
    : d.entryTier === "SCOUT"
      ? "SCOUT ENTRY IDEA"
      : d.entryTier === "OPPORTUNITY"
        ? "OPPORTUNITY ENTRY IDEA"
        : d.entryTier === "ACTIVE"
          ? "ACTIVE ENTRY IDEA"
          : `${d.entryTier || "CONFIRMED"} ENTRY`;

  return [
    `${icon} GOLD PULSE X v10 PULSE ENGINE`,
    "",
    `${d.direction} · ${tierLabel} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Grade ${payload?.smartFree?.confidence?.grade || "—"} · ${payload?.smartFree?.confidence?.label || "—"}`,
    `Session ${payload?.smartFree?.session || "—"} · Regime ${payload?.smartFree?.marketRegime || "—"}`,
    "",
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · target price move 1.00`,
    `TP2 ${numberText(d?.takeProfit?.tp2)} · ${Math.round(Number(d?.takeProfit?.tp2Chance || 0))}%`,
    `TP3 ${numberText(d?.takeProfit?.tp3)} · ${Math.round(Number(d?.takeProfit?.tp3Chance || 0))}%`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward 1:${numberText(rr)}`,
    `Holding estimate ${d.expectedHoldingMinutes || "—"} min`,
    "",
    "Why this alert:",
    ...(payload?.smartFree?.explain || d.reasons || []).slice(0, 5).map((reason: string) => `• ${reason}`),
    "",
    `Market data: ${payload.source || "provider"}`,
    `Updated: ${payload.updatedAt || new Date().toISOString()}`,
    "",
    ["ACTIVE", "OPPORTUNITY", "SCOUT", "PULSE"].includes(d.entryTier)
      ? `⚠️ ${d.entryTier} เป็นสัญญาณเชิงรุก ต้องตรวจแท่งราคาและลดความเสี่ยงก่อนเข้าเอง`
      : "⚠️ การประเมินจากโมเดล ไม่ใช่คำแนะนำการลงทุน กรุณาตรวจสอบราคากับโบรกเกอร์และจำกัดความเสี่ยง",
    "⚠️ TP1 ระยะ 1.00 คือการเคลื่อนที่ของราคา XAU/USD ไม่ใช่กำไรบัญชี $1 โดยอัตโนมัติ; กำไรจริงขึ้นกับ lot, spread และ commission"
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
