import assert from "node:assert/strict";
import { finalizeSignalDecision } from "../lib/core/signal-policy.js";

const base = {
  decision: "ACTIVE BUY",
  status: "ENTRY",
  direction: "BUY",
  entryTier: "ACTIVE",
  mainTrend: "BULLISH",
  forecastAgreement: "FULL",
  targetProbability: 72,
  signalScore: 70,
  probabilityMap: { directionalEdge: 16 },
  qa: { checks: { riskAccepted: true } },
  intelligenceOverlay: { blocked: false },
  reasons: []
};

const truth = {
  ready: true,
  validation: {
    directionalAccuracy: 57,
    directionalCoverage: 40,
    perCandle: Array.from({ length: 5 }, (_, i) => ({ candle: i + 1, directionalSamples: 30 }))
  },
  patternMemory: { forecasts: [
    { direction: "BUY" }, { direction: "BUY" }, { direction: "WAIT" },
    { direction: "SELL" }, { direction: "WAIT" }
  ] }
};

const accepted = finalizeSignalDecision(base, { fiveCandleTruth: truth });
assert.equal(accepted.status, "ENTRY");
assert.equal(accepted.decisionPolicy.pass, true);
assert.ok(["CONFIRMED", "STRONG"].includes(accepted.entryTier));

const dropped = finalizeSignalDecision({ ...base, targetProbability: 50, signalScore: 48 }, { fiveCandleTruth: truth });
assert.equal(dropped.status, "WATCH");
assert.equal(dropped.decisionPolicy.pass, false);

const blocked = finalizeSignalDecision({ ...base, intelligenceOverlay: { blocked: true } }, { fiveCandleTruth: truth });
assert.equal(blocked.status, "WATCH");
assert.equal(blocked.decisionPolicy.safetyBlocked, true);

const watch = finalizeSignalDecision({ ...base, status: "WATCH", entryTier: "WATCH" }, { fiveCandleTruth: truth });
assert.equal(watch.status, "WATCH");
assert.equal(watch.decisionPolicy.pass, false);

console.log("✅ v11 R2 signal policy tests passed");
