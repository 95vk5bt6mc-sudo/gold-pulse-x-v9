import assert from "node:assert/strict";
import {
  analyzeFiveMinuteIntelligence,
  applyFiveMinuteIntelligenceOverlay
} from "../lib/intelligence/five-minute-intelligence.js";

const candles = [];
let price = 4000;
for (let i = 0; i < 500; i += 1) {
  const drift = Math.sin(i / 17) * 0.18 + Math.sin(i / 5) * 0.05 + 0.015;
  const open = price;
  const close = open + drift;
  const high = Math.max(open, close) + 0.18 + Math.abs(Math.sin(i)) * 0.08;
  const low = Math.min(open, close) - 0.18 - Math.abs(Math.cos(i)) * 0.08;
  price = close;
  candles.push({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i * 5))
      .toISOString()
      .slice(0, 19)
      .replace("T", " "),
    open,
    high,
    low,
    close
  });
}

const intelligence = analyzeFiveMinuteIntelligence(candles);
assert.equal(intelligence.ready, true);
assert.equal(intelligence.timeframe, "5min");
assert.equal(intelligence.patternMemory.forecasts.length, 3);
assert.ok(intelligence.patternMemory.matchedCases >= 50);
assert.ok(intelligence.patternMemory.averageSimilarity >= 0);
assert.ok(intelligence.trapRisk >= 0 && intelligence.trapRisk <= 100);

const overlaid = applyFiveMinuteIntelligenceOverlay({
  decision: "ACTIVE BUY",
  status: "ENTRY",
  direction: "BUY",
  entryTier: "ACTIVE",
  targetProbability: 65,
  signalScore: 62,
  reasons: []
}, intelligence);

assert.equal(overlaid.intelligenceOverlay.applied, true);
assert.ok(overlaid.targetProbability >= 0 && overlaid.targetProbability <= 92);
assert.ok(overlaid.signalScore >= 0 && overlaid.signalScore <= 100);

console.log("✅ v11 Pattern Intelligence tests passed");

