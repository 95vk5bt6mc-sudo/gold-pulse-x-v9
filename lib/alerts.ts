import { getRuntimeConfig } from "./config";
import { sendLineText } from "./line";
import {
  evaluateAdaptiveCadence,
  stateAfterCandidate,
  stateAfterSent
} from "./core/adaptive-quality";
import {
  acquireAdaptiveLock,
  readAdaptiveState,
  writeAdaptiveState
} from "./core/adaptive-state";

type AnyRecord = Record<string, any>;

const evaluateAdaptiveCadenceAny = evaluateAdaptiveCadence as (args: AnyRecord) => AnyRecord;
const stateAfterCandidateAny = stateAfterCandidate as (args: AnyRecord) => AnyRecord;
const stateAfterSentAny = stateAfterSent as (args: AnyRecord) => AnyRecord;

const numberText = (value: unknown, digits = 2) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";

export function evaluateAlert(payload: AnyRecord) {
  const config = getRuntimeConfig();
  const decision = payload?.tradeDecision;
  const probability = Number(decision?.targetProbability || 0);
  const score = Number(decision?.signalScore || decision?.entryQuality || 0);
  const direction = decision?.direction;
  const tier = String(decision?.entryTier || "UNKNOWN").toUpperCase();
  const confirmations = Number(decision?.confirmationCount || 0);
  const directionalEdge = Number(decision?.probabilityMap?.directionalEdge || 0);
  const reasons: string[] = [];

  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");

  const opportunity = tier === "OPPORTUNITY";
  const scout = tier === "SCOUT";
  const pulse = tier === "PULSE";
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
  const minimumConfirmations = scout || pulse ? 3 : 2;

  if (decision?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (probability < minimumProbability) reasons.push("probability-below-base-gate");
  if (score < minimumScore) reasons.push("score-below-base-gate");
  if (confirmations < minimumConfirmations) reasons.push("confirmations-below-base-gate");
  if ((opportunity || scout || pulse) && directionalEdge < config.minimumDirectionalEdge) {
    reasons.push("directional-edge-below-base-gate");
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    tier,
    confirmations,
    directionalEdge,
    appliedGate: {
      tier,
      minimumProbability,
      minimumScore,
      minimumConfirmations,
      minimumDirectionalEdge: opportunity || scout || pulse ? config.minimumDirectionalEdge : null
    },
    config
  };
}

function bangkokMinute(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "minute")?.value || 0);
}

function alertFingerprint(payload: AnyRecord, stateMode?: string): string {
  const d = payload?.tradeDecision || {};
  if (stateMode === "memory-fallback") {
    const halfHourSlot = Math.floor(Date.now() / (30 * 60 * 1000));
    return ["gold-pulse-v10.2.1-lite", payload.symbol || "XAU/USD", halfHourSlot].join("|");
  }
  return [
    "gold-pulse-v10.2.1",
    payload.symbol || "XAU/USD",
    d.alertKey || payload.updatedAt || "latest",
    d.direction || "WAIT",
    d.entryTier || "UNKNOWN",
    Number(d.entryPrice || 0).toFixed(2)
  ].join("|");
}

function applyStatelessWindow(adaptive: AnyRecord, now = new Date()): AnyRecord {
  const minuteInWindow = bangkokMinute(now) % 30;
  const requiredQuality = minuteInWindow < 10 ? 86 : minuteInWindow < 20 ? 82 : 78;
  const reasons = (adaptive?.reasons || []).filter((reason: string) => reason !== "adaptive-quality-below-time-gate");
  if (Number(adaptive?.quality || 0) < requiredQuality && !adaptive?.eliteSignal) {
    reasons.push("stateless-quality-below-window-gate");
  }
  return {
    ...adaptive,
    eligible: reasons.length === 0,
    reasons,
    requiredQuality,
    elapsedMinutes: null,
    targetIntervalMinutes: 30,
    statelessWindow: true,
    minuteInWindow
  };
}

export function buildSignalText(payload: AnyRecord, adaptive: AnyRecord): string {
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
  const elapsed = adaptive?.elapsedMinutes == null
    ? "first qualified signal"
    : `${Number(adaptive.elapsedMinutes).toFixed(1)} min since last alert`;

  return [
    `${icon} GOLD PULSE X v10.2.1 ADAPTIVE LITE`,
    "",
    `${d.direction} · ${tierLabel} · ${d.mode || "TREND"}`,
    `XAU/USD · Model estimate ${Math.round(Number(d.targetProbability || 0))}%`,
    `Signal score ${Math.round(Number(d.signalScore || d.entryQuality || 0))}/100`,
    `Adaptive quality ${Math.round(Number(adaptive?.quality || 0))}/100 · required ${Math.round(Number(adaptive?.requiredQuality || 0))}`,
    `Timing ${elapsed} · target cadence ~${adaptive?.targetIntervalMinutes || 30} min`,
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
    adaptive?.statelessWindow
      ? "Adaptive Lite: คัดคุณภาพตามช่วงเวลา และจำกัดการส่งจริงไม่เกิน 1 ครั้งต่อสล็อต 30 นาทีผ่าน LINE idempotency"
      : "Adaptive rule: ไม่มีล็อกตาย 30 นาที; สัญญาณยอดเยี่ยมผ่านได้เร็ว และสัญญาณอ่อนจะไม่ถูกฝืนส่ง",
    `Market data: ${payload.source || "provider"}`,
    `Updated: ${payload.updatedAt || new Date().toISOString()}`,
    "",
    ["ACTIVE", "OPPORTUNITY", "SCOUT", "PULSE"].includes(d.entryTier)
      ? `⚠️ ${d.entryTier} เป็นสัญญาณเชิงรุก ต้องตรวจแท่งราคาและลดความเสี่ยงก่อนเข้าเอง`
      : "⚠️ การประเมินจากโมเดล ไม่ใช่คำแนะนำการลงทุน กรุณาตรวจสอบราคากับโบรกเกอร์และจำกัดความเสี่ยง",
    "⚠️ Adaptive quality และ Model estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว",
    "⚠️ TP1 ระยะ 1.00 คือการเคลื่อนที่ของราคา XAU/USD ไม่ใช่กำไรบัญชี $1 โดยอัตโนมัติ; กำไรจริงขึ้นกับ lot, spread และ commission"
  ].join("\n");
}

export async function sendSignalAlert(payload: AnyRecord) {
  const baseEvaluation = evaluateAlert(payload);
  if (!baseEvaluation.eligible) {
    return {
      sent: false,
      duplicate: false,
      reason: baseEvaluation.reasons.join(",") || "not-eligible",
      evaluation: baseEvaluation
    };
  }

  let lock: Awaited<ReturnType<typeof acquireAdaptiveLock>>;
  try {
    lock = await acquireAdaptiveLock();
  } catch (error) {
    return {
      sent: false,
      duplicate: false,
      reason: error instanceof Error ? error.message : "adaptive-state-lock-error",
      evaluation: baseEvaluation
    };
  }

  if (!lock.acquired) {
    return {
      sent: false,
      duplicate: false,
      reason: lock.reason || "adaptive-state-lock-busy",
      stateMode: lock.mode,
      evaluation: baseEvaluation
    };
  }

  try {
    const previousState = await readAdaptiveState(lock.connection);
    let adaptive = evaluateAdaptiveCadenceAny({
      payload,
      state: previousState,
      now: new Date(),
      config: baseEvaluation.config
    });

    if (lock.mode === "memory-fallback") {
      adaptive = applyStatelessWindow(adaptive, new Date());
    }

    if (!adaptive.eligible) {
      const candidateState = stateAfterCandidateAny({
        previousState,
        adaptive,
        payload,
        now: new Date(),
        config: baseEvaluation.config
      });
      await writeAdaptiveState(candidateState, lock.connection);
      return {
        sent: false,
        duplicate: false,
        reason: adaptive.reasons.join(",") || "adaptive-gate-blocked",
        stateMode: lock.mode,
        evaluation: baseEvaluation,
        adaptive
      };
    }

    const fingerprint = alertFingerprint(payload, lock.mode);
    const result = await sendLineText(buildSignalText(payload, adaptive), fingerprint);

    if (result.delivered || result.duplicate) {
      const nextState = stateAfterSentAny({
        previousState,
        adaptive,
        payload,
        now: new Date()
      });
      await writeAdaptiveState(nextState, lock.connection);
    }

    return {
      sent: result.delivered,
      duplicate: result.duplicate,
      reason: result.ok ? (result.duplicate ? "exact-alert-duplicate" : "sent") : result.detail || `line-http-${result.status}`,
      mode: result.mode,
      status: result.status,
      retryKey: result.retryKey,
      stateMode: lock.mode,
      evaluation: baseEvaluation,
      adaptive
    };
  } catch (error) {
    return {
      sent: false,
      duplicate: false,
      reason: error instanceof Error ? error.message : "adaptive-alert-exception",
      stateMode: lock.mode,
      evaluation: baseEvaluation
    };
  }
}
