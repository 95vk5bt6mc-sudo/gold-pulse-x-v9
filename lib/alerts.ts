import { getRuntimeConfig } from "./config";
import { sendLineText } from "./line";

type AnyRecord = Record<string, any>;

const numberText = (value: unknown, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";

export function evaluateAlert(payload: AnyRecord) {
  const config = getRuntimeConfig();
  const d = payload?.tradeDecision || {};
  const probability = Number(d.targetProbability || 0);
  const score = Number(d.signalScore || d.entryQuality || 0);
  const direction = String(d.direction || "WAIT").toUpperCase();
  const tier = String(d.entryTier || "WAIT").toUpperCase();
  const mode = String(d.mode || "NONE").toUpperCase();
  const confirmations = Number(d.confirmationCount || 0);
  const directionalEdge = Number(d?.probabilityMap?.directionalEdge || 0);
  const waitProbability = Number(d?.probabilityMap?.wait || 0);
  const marketRegime = String(payload?.smartFree?.marketRegime || "MIXED").toUpperCase();

  const opportunity = tier === "OPPORTUNITY";
  const scout = tier === "SCOUT";
  const confirmed = tier === "CONFIRMED" || tier === "STRONG";
  const pulse = tier === "PULSE";

  const minimumProbability = confirmed
    ? config.confirmedMinProbability
    : scout
      ? config.scoutMinProbability
      : opportunity
        ? config.opportunityMinProbability
        : config.alertMinProbability;

  const minimumScore = confirmed
    ? config.confirmedMinScore
    : scout
      ? config.scoutMinScore
      : opportunity
        ? config.opportunityMinScore
        : config.alertMinScore;

  const minimumConfirmations = scout
    ? config.scoutMinimumConfirmations
    : config.minimumConfirmations;

  const reasons: string[] = [];
  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  if (d?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (pulse) reasons.push("pulse-disabled-classic-mode");
  if (d?.qa?.checks?.riskAccepted === false) reasons.push("risk-high-blocked");
  if (d?.qa?.checks?.setupValid === false) reasons.push("setup-invalid");
  if (probability < minimumProbability) reasons.push("probability-below-gate");
  if (score < minimumScore) reasons.push("score-below-gate");
  if (confirmations < minimumConfirmations) reasons.push("confirmations-below-gate");

  if ((opportunity || scout) && directionalEdge < config.minimumDirectionalEdge) {
    reasons.push("directional-edge-below-gate");
  }
  if (scout && waitProbability > 50) reasons.push("wait-probability-too-high-for-scout");

  // ตลาด Sideway/Mixed ต้องมีหลักฐานแข็งขึ้น แต่ CONFIRMED/STRONG ไม่ถูกลงโทษซ้ำ
  if (!confirmed && marketRegime === "RANGE") {
    if (directionalEdge < config.rangeMinimumEdge) reasons.push("range-edge-too-low");
    if (confirmations < 3) reasons.push("range-confirmations-too-low");
  }
  if (!confirmed && marketRegime === "MIXED") {
    if (directionalEdge < config.mixedMinimumEdge) reasons.push("mixed-edge-too-low");
    if (confirmations < 3) reasons.push("mixed-confirmations-too-low");
  }
  if (mode === "COUNTER_TREND") {
    if (directionalEdge < config.counterTrendMinimumEdge) reasons.push("counter-trend-edge-too-low");
    if (confirmations < 3) reasons.push("counter-trend-confirmations-too-low");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    tier,
    mode,
    marketRegime,
    confirmations,
    directionalEdge,
    waitProbability,
    appliedGate: {
      tier,
      minimumProbability,
      minimumScore,
      minimumConfirmations,
      minimumDirectionalEdge: opportunity || scout ? config.minimumDirectionalEdge : null
    },
    config
  };
}

function fingerprint(payload: AnyRecord, slotMinutes: number): string {
  const d = payload?.tradeDecision || {};
  const slot = Math.floor(Date.now() / (slotMinutes * 60 * 1000));
  return [
    "gold-pulse-v10.3.1-classic",
    payload.symbol || "XAU/USD",
    slot,
    d.direction || "WAIT"
  ].join("|");
}

export function buildSignalText(payload: AnyRecord, evaluation: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  return [
    `${icon} GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS`,
    "",
    `${d.direction} · ${d.entryTier || "CONFIRMED"} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Confirmations ${Number(d.confirmationCount || 0)}/4 · Edge ${Number(d?.probabilityMap?.directionalEdge || 0)}`,
    `Market ${evaluation.marketRegime} · 5M trend ${d.mainTrend || "—"}`,
    "",
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · TP2 ${numberText(d?.takeProfit?.tp2)} · TP3 ${numberText(d?.takeProfit?.tp3)}`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward TP2 1:${numberText(d?.riskReward?.tp2)}`,
    "",
    "Classic 9.8 Pro Plus: ใช้ 5M trend + forecast เป็นแกน, ปิด PULSE และเพิ่มตัวกรอง Sideway/Mixed/Counter-trend",
    "⚠️ Model estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว และไม่รับประกันกำไร",
    "⚠️ ตรวจราคาโบรกเกอร์ spread และจำกัดความเสี่ยงก่อนเข้า"
  ].join("\n");
}

export async function sendSignalAlert(payload: AnyRecord) {
  const evaluation = evaluateAlert(payload);
  if (!evaluation.eligible) {
    return {
      sent: false,
      duplicate: false,
      reason: evaluation.reasons.join(",") || "not-eligible",
      evaluation
    };
  }

  const result = await sendLineText(
    buildSignalText(payload, evaluation),
    fingerprint(payload, evaluation.config.deliverySlotMinutes)
  );

  return {
    sent: result.delivered,
    duplicate: result.duplicate,
    reason: result.ok
      ? (result.duplicate ? "slot-duplicate" : "sent")
      : result.detail || `line-http-${result.status}`,
    mode: result.mode,
    status: result.status,
    retryKey: result.retryKey,
    evaluation
  };
}
