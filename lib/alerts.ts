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
  const policy = d?.decisionPolicy || null;
  const marketRegime = String(payload?.smartFree?.marketRegime || "MIXED").toUpperCase();

  const reasons: string[] = [];
  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  if (d?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (d?.qa?.checks?.riskAccepted === false) reasons.push("risk-high-blocked");
  if (d?.intelligenceOverlay?.blocked === true) reasons.push("intelligence-hard-block");
  if (policy?.version && policy.pass !== true) reasons.push("final-policy-not-passed");

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    tier,
    mode,
    marketRegime,
    confirmations: Number(d.confirmationCount || 0),
    directionalEdge: Number(d?.probabilityMap?.directionalEdge || 0),
    waitProbability: Number(d?.probabilityMap?.wait || 0),
    appliedGate: {
      policyVersion: policy?.version || "legacy",
      singleFinalGate: Boolean(policy?.version),
      policyPass: policy?.pass ?? null,
      quality: policy?.quality ?? null,
      evidenceCount: policy?.evidenceCount ?? null
    },
    config
  };
}

function fingerprint(payload: AnyRecord, slotMinutes: number): string {
  const d = payload?.tradeDecision || {};
  const slot = Math.floor(Date.now() / (slotMinutes * 60 * 1000));
  return [
    "gold-pulse-v11-pattern-intelligence",
    payload.symbol || "XAU/USD",
    slot,
    d.direction || "WAIT"
  ].join("|");
}

export function buildSignalText(payload: AnyRecord, evaluation: AnyRecord): string {
  const d = payload.tradeDecision || {};
  const icon = d.direction === "BUY" ? "🟢" : "🔴";
  return [
    `${icon} GOLD PULSE X v11 PATTERN INTELLIGENCE 5M`,
    "",
    `${d.direction} · ${d.entryTier || "CONFIRMED"} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Confirmations ${Number(d.confirmationCount || 0)}/4 · Edge ${Number(d?.probabilityMap?.directionalEdge || 0)}`,
    `Market ${evaluation.marketRegime} · 5M trend ${d.mainTrend || "—"}`,
    `Pattern bias ${d?.fiveMinuteIntelligence?.bias?.direction || "WAIT"} · Trap risk ${Number(d?.fiveMinuteIntelligence?.trapRisk || 0)}%`,
    `Next 5M U${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.up || 0)} D${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.down || 0)} W${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.sideway || 0)}`,
    "",
    `5C future ${(payload?.fiveCandleTruth?.patternMemory?.forecasts || []).slice(0,5).map((f: { candle: number; direction: string }) => `#${f.candle}:${f.direction}`).join(" ") || "—"}`,
    `5C truth dir ${payload?.fiveCandleTruth?.validation?.directionalAccuracy ?? "—"}% · coverage ${payload?.fiveCandleTruth?.validation?.directionalCoverage ?? "—"}% · exact5 ${payload?.fiveCandleTruth?.validation?.exactFive?.accuracy ?? "—"}%`,
    `Entry reference ${numberText(d.entryPrice)}`,
    `TP1 ${numberText(d?.takeProfit?.tp1)} · TP2 ${numberText(d?.takeProfit?.tp2)} · TP3 ${numberText(d?.takeProfit?.tp3)}`,
    `Stop Loss reference ${numberText(d.stopLoss)}`,
    `Risk : Reward TP2 1:${numberText(d?.riskReward?.tp2)}`,
    "",
    "v11: Classic 9.8 Pro Plus + 5M Candle DNA + Divergence + Fake Breakout + Market Structure",
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

  const priority = evaluation.tier === "STRONG" ? "strong" : "confirmed";
  const result = await sendLineText(
    buildSignalText(payload, evaluation),
    fingerprint(payload, evaluation.config.deliverySlotMinutes),
    { priority }
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
    guardReason: result.guardReason || null,
    quota: result.quota || null,
    evaluation
  };
}
