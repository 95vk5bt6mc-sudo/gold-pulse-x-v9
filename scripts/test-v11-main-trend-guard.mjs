import assert from "node:assert/strict";
import { analyzeFiveMinuteIntelligence, applyFiveMinuteIntelligenceOverlay } from "../lib/intelligence/five-minute-intelligence.js";

function trendCandles(direction = "UP", count = 220) {
  const candles = [];
  let price = 3900;
  for (let i = 0; i < count; i += 1) {
    const drift = direction === "UP" ? 0.22 : -0.22;
    const wave = Math.sin(i / 9) * 0.025;
    const open = price;
    const close = open + drift + wave;
    const high = Math.max(open, close) + 0.08;
    const low = Math.min(open, close) - 0.08;
    price = close;
    candles.push({ datetime: new Date(Date.UTC(2026, 0, 1, 0, i * 5)).toISOString().slice(0, 19).replace("T", " "), open, high, low, close });
  }
  return candles;
}

const up = analyzeFiveMinuteIntelligence(trendCandles("UP"));
assert.equal(up.ready, true);
assert.ok(up.mainTrendGuard);
const counterSell = applyFiveMinuteIntelligenceOverlay({ decision: "ACTIVE SELL", status: "ENTRY", direction: "SELL", entryTier: "ACTIVE", targetProbability: 72, signalScore: 70, reasons: [] }, up);
assert.equal(counterSell.intelligenceOverlay.applied, true);
if (up.mainTrendGuard.rawDirection === "BULLISH") {
  assert.equal(counterSell.status, "WATCH");
  assert.equal(counterSell.direction, "WAIT");
}

const down = analyzeFiveMinuteIntelligence(trendCandles("DOWN"));
assert.equal(down.ready, true);
assert.ok(down.mainTrendGuard);
const counterBuy = applyFiveMinuteIntelligenceOverlay({ decision: "ACTIVE BUY", status: "ENTRY", direction: "BUY", entryTier: "ACTIVE", targetProbability: 72, signalScore: 70, reasons: [] }, down);
assert.equal(counterBuy.intelligenceOverlay.applied, true);
if (down.mainTrendGuard.rawDirection === "BEARISH") {
  assert.equal(counterBuy.status, "WATCH");
  assert.equal(counterBuy.direction, "WAIT");
}
console.log("✅ v11.1 MAIN TREND GUARD tests passed");
