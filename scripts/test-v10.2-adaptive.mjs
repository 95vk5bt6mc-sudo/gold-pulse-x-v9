import assert from "node:assert/strict";
import {
  bangkokDayKey,
  calculateAdaptiveQuality,
  evaluateAdaptiveCadence,
  requiredQualityForElapsed,
  stateAfterSent
} from "../lib/core/adaptive-quality.js";

const now = new Date("2026-08-04T03:00:00.000Z");
const config = {
  targetSignalIntervalMinutes: 30,
  technicalMinimumGapMinutes: 2,
  adaptiveColdStartQuality: 78,
  adaptiveEliteQuality: 92,
  adaptiveEarlyQuality: 86,
  adaptiveTargetQuality: 80,
  adaptiveLateQuality: 76,
  adaptiveQualityFloor: 72,
  adaptiveReversalPenalty: 4,
  adaptiveSameDirectionImprovement: 3,
  candidateExpiryMinutes: 20,
  dailyAlertCap: 32
};

function payload({
  probability = 70,
  score = 68,
  confirmations = 3,
  edge = 14,
  wait = 30,
  expectedMove = 1.1,
  tier = "CONFIRMED",
  direction = "BUY",
  mode = "TREND",
  agreement = "FULL",
  entryPrice = 4050
} = {}) {
  return {
    symbol: "XAU/USD",
    smartFree: { marketRegime: "TREND" },
    tradeDecision: {
      status: "ENTRY",
      direction,
      entryTier: tier,
      mode,
      forecastAgreement: agreement,
      targetProbability: probability,
      signalScore: score,
      confirmationCount: confirmations,
      probabilityMap: { directionalEdge: edge, wait },
      expectedMove: direction === "SELL" ? -Math.abs(expectedMove) : Math.abs(expectedMove),
      entryPrice
    }
  };
}

function stateMinutesAgo(minutes, overrides = {}) {
  return {
    version: 1,
    dayKey: bangkokDayKey(now),
    dailyCount: 3,
    lastSentAt: new Date(now.getTime() - minutes * 60_000).toISOString(),
    lastDirection: "BUY",
    lastQuality: 82,
    lastEntryPrice: 4048,
    lastTier: "CONFIRMED",
    candidate: null,
    ...overrides
  };
}

assert.equal(requiredQualityForElapsed(Infinity, config), 78);
assert.equal(requiredQualityForElapsed(5, config), 92);
assert.equal(requiredQualityForElapsed(15, config), 86);
assert.equal(requiredQualityForElapsed(25, config), 80);
assert.equal(requiredQualityForElapsed(35, config), 76);
assert.equal(requiredQualityForElapsed(50, config), 74);
assert.equal(requiredQualityForElapsed(70, config), 72);

const good = payload();
const goodQuality = calculateAdaptiveQuality(good);
assert.ok(goodQuality.quality >= 80, `expected good quality >= 80, got ${goodQuality.quality}`);

const firstSignal = evaluateAdaptiveCadence({ payload: good, state: null, now, config });
assert.equal(firstSignal.eligible, true);
assert.equal(firstSignal.requiredQuality, 78);

const earlyBlocked = evaluateAdaptiveCadence({ payload: good, state: stateMinutesAgo(5), now, config });
assert.equal(earlyBlocked.eligible, false);
assert.ok(earlyBlocked.reasons.includes("adaptive-quality-below-time-gate"));

const elite = payload({ probability: 86, score: 84, confirmations: 4, edge: 24, wait: 10, expectedMove: 1.7, tier: "STRONG", entryPrice: 4052 });
const eliteEarly = evaluateAdaptiveCadence({ payload: elite, state: stateMinutesAgo(5), now, config });
assert.equal(eliteEarly.eliteSignal, true);
assert.equal(eliteEarly.eligible, true);

const targetWindow = payload({ probability: 71, score: 68, confirmations: 3, edge: 13, wait: 32, expectedMove: 1.1, tier: "ACTIVE", agreement: "PARTIAL", entryPrice: 4051 });
const targetWindowEval = evaluateAdaptiveCadence({ payload: targetWindow, state: stateMinutesAgo(25), now, config });
assert.equal(targetWindowEval.eligible, true, JSON.stringify(targetWindowEval));

const lateGood = payload({ probability: 64, score: 63, confirmations: 3, edge: 12, wait: 35, expectedMove: 1.0, tier: "ACTIVE", agreement: "PARTIAL", entryPrice: 4051 });
const lateEval = evaluateAdaptiveCadence({ payload: lateGood, state: stateMinutesAgo(65), now, config });
assert.equal(lateEval.eligible, true, JSON.stringify(lateEval));

const weak = payload({ probability: 58, score: 58, confirmations: 2, edge: 8, wait: 52, expectedMove: 0.7, tier: "PULSE", agreement: "NONE" });
const weakLate = evaluateAdaptiveCadence({ payload: weak, state: stateMinutesAgo(120), now, config });
assert.equal(weakLate.eligible, false);
assert.ok(weakLate.reasons.includes("adaptive-quality-below-floor"));

const reversal = payload({ probability: 70, score: 68, confirmations: 3, edge: 15, wait: 28, expectedMove: 1.2, tier: "CONFIRMED", direction: "SELL", entryPrice: 4046 });
const reversalEval = evaluateAdaptiveCadence({ payload: reversal, state: stateMinutesAgo(25), now, config });
assert.equal(reversalEval.reversal, true);
assert.equal(reversalEval.requiredQuality, 84);
assert.equal(reversalEval.eligible, true, JSON.stringify(reversalEval));

const weakReversal = payload({ probability: 68, score: 65, confirmations: 2, edge: 13, wait: 30, expectedMove: 1.0, tier: "ACTIVE", direction: "SELL", agreement: "PARTIAL", entryPrice: 4046 });
const weakReversalEval = evaluateAdaptiveCadence({ payload: weakReversal, state: stateMinutesAgo(25), now, config });
assert.equal(weakReversalEval.eligible, false);
assert.ok(weakReversalEval.reasons.includes("adaptive-reversal-needs-3-confirmations"));

const staleRepeat = payload({ probability: 70, score: 68, confirmations: 3, edge: 14, wait: 30, expectedMove: 1.1, tier: "CONFIRMED", entryPrice: 4048.1 });
const staleEval = evaluateAdaptiveCadence({ payload: staleRepeat, state: stateMinutesAgo(25, { lastQuality: 85 }), now, config });
assert.equal(staleEval.eligible, false);
assert.ok(staleEval.reasons.includes("adaptive-stale-same-direction"));

const capped = evaluateAdaptiveCadence({ payload: elite, state: stateMinutesAgo(60, { dailyCount: 32 }), now, config });
assert.equal(capped.eligible, false);
assert.ok(capped.reasons.includes("adaptive-daily-safety-cap"));

const sentState = stateAfterSent({ previousState: stateMinutesAgo(65), adaptive: lateEval, payload: lateGood, now });
assert.equal(sentState.dailyCount, 4);
assert.equal(sentState.lastDirection, "BUY");
assert.equal(sentState.lastSentAt, now.toISOString());

console.log("✅ v10.2 adaptive quality tests passed");
console.log(JSON.stringify({
  goodQuality: goodQuality.quality,
  eliteQuality: calculateAdaptiveQuality(elite).quality,
  targetWindowQuality: targetWindowEval.quality,
  lateQuality: lateEval.quality,
  weakQuality: weakLate.quality
}, null, 2));
