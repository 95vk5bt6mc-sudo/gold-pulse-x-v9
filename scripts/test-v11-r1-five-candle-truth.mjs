import assert from "node:assert/strict";
import { analyzeFiveCandleTruth, closedFiveMinuteCandles } from "../lib/intelligence/five-candle-truth.js";

const candles = [];
let price = 4000;
for (let i = 0; i < 520; i += 1) {
  const wave = Math.sin(i / 17) * 0.18 + Math.sin(i / 5) * 0.06 + Math.cos(i / 11) * 0.04;
  const open = price;
  const close = open + wave;
  const high = Math.max(open, close) + 0.16 + Math.abs(Math.sin(i)) * 0.08;
  const low = Math.min(open, close) - 0.16 - Math.abs(Math.cos(i)) * 0.08;
  price = close;
  candles.push({
    datetime: new Date(Date.UTC(2026, 0, 1, 0, i * 5)).toISOString().slice(0, 19).replace("T", " "),
    open, high, low, close
  });
}

const truth = analyzeFiveCandleTruth(candles);
assert.equal(truth.ready, true);
assert.equal(truth.mode, "shadow-audit");
assert.equal(truth.changesTradeDecision, false);
assert.equal(truth.closedCandlePolicy, "closed-only");
assert.equal(truth.patternMemory.forecasts.length, 5);
assert.equal(truth.validation.perCandle.length, 5);
assert.equal(truth.validation.mode, "no-lookahead-walk-forward");
assert.ok(truth.validation.anchors > 0);
assert.ok(truth.validation.directionalCoverage >= 0 && truth.validation.directionalCoverage <= 100);
assert.ok(truth.validation.directionalAccuracy == null || (truth.validation.directionalAccuracy >= 0 && truth.validation.directionalAccuracy <= 100));

const partial = [
  { datetime: "2026-08-12 15:05:00", open: 1, high: 2, low: 0.5, close: 1.5 },
  { datetime: "2026-08-12 15:10:00", open: 1.5, high: 1.6, low: 1.4, close: 1.55 }
];
const locked = closedFiveMinuteCandles(partial, Date.parse("2026-08-12T15:10:04+07:00"));
assert.equal(locked.length, 1);
assert.equal(locked[0].datetime, "2026-08-12 15:05:00");

console.log("✅ v11.0 R1 Five-Candle Truth tests passed");
