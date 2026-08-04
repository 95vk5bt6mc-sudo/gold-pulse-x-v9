import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluatePulseFallback } from "../lib/core/pulse-engine.js";

const base = {
  oneMinute: {
    riskLevel: "MEDIUM",
    trendBias: "BEARISH",
    momentumScore: 48,
    score: -1.1,
    marketCondition: "TRENDING",
    indicators: { atr: 1.55, rsi: 50.5, macdHistogram: -0.02, adx: 21 }
  },
  fiveMinute: {
    trendBias: "BEARISH",
    momentumScore: 47,
    marketCondition: "TRENDING",
    indicators: { adx: 23 }
  },
  buyProbability: 33,
  sellProbability: 25,
  waitProbability: 43,
  expectedMoveAbs: 2.65,
  mainTrend: "SELL"
};

const balancedPulse = evaluatePulseFallback(base);
assert.equal(balancedPulse.eligible, true);
assert.equal(balancedPulse.direction, "SELL");
assert.ok(balancedPulse.probability >= 58);
assert.ok(balancedPulse.score >= 60);
assert.ok(balancedPulse.directionalVotes >= 3);
assert.equal(balancedPulse.requiredMove, 0.85);

const weakVotes = evaluatePulseFallback({
  ...base,
  oneMinute: {
    ...base.oneMinute,
    trendBias: "MIXED",
    momentumScore: 50,
    score: 0,
    indicators: { atr: 1.0, rsi: 50, macdHistogram: 0, adx: 18 }
  },
  fiveMinute: {
    ...base.fiveMinute,
    trendBias: "MIXED",
    momentumScore: 50,
    indicators: { adx: 18 }
  },
  buyProbability: 31,
  sellProbability: 27,
  waitProbability: 42,
  expectedMoveAbs: 1.0,
  mainTrend: "WAIT"
});
assert.equal(weakVotes.eligible, false, "less than three strong directional votes must remain WAIT");

const highRisk = evaluatePulseFallback({
  ...base,
  oneMinute: { ...base.oneMinute, riskLevel: "HIGH" }
});
assert.equal(highRisk.eligible, false, "Risk HIGH must remain blocked");

const flat = evaluatePulseFallback({
  ...base,
  oneMinute: {
    riskLevel: "LOW",
    trendBias: "MIXED",
    momentumScore: 50,
    score: 0,
    marketCondition: "SIDEWAY",
    indicators: { atr: 0.3, rsi: 50, macdHistogram: 0, adx: 12 }
  },
  fiveMinute: {
    trendBias: "MIXED",
    momentumScore: 50,
    marketCondition: "SIDEWAY",
    indicators: { adx: 12 }
  },
  buyProbability: 29,
  sellProbability: 28,
  waitProbability: 43,
  expectedMoveAbs: 0.48,
  mainTrend: "WAIT"
});
assert.equal(flat.eligible, false);

const config = fs.readFileSync(new URL("../lib/config.ts", import.meta.url), "utf8");
assert.match(config, /version: "10\.2\.0"/);
assert.match(config, /"ADAPTIVE_QUALITY_30"/);
assert.match(config, /targetSignalIntervalMinutes/);

const alerts = fs.readFileSync(new URL("../lib/alerts.ts", import.meta.url), "utf8");
assert.match(alerts, /evaluateAdaptiveCadence/);
assert.doesNotMatch(alerts, /directionBucket/);

console.log("✅ v10.2 adaptive regression tests passed");
console.log(JSON.stringify({ balancedPulse, weakVotes, highRisk, flat }, null, 2));
