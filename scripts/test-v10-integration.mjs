import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const routePath = path.join(root, "app/api/gold/route.js");
const source = fs.readFileSync(routePath, "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `missing function ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed function ${name}`);
}

const tempPath = path.join(root, "scripts/.tmp-v102-combined.mjs");
const moduleSource = [
  'import { evaluatePulseFallback } from "../lib/core/pulse-engine.js";',
  `export ${extractFunction("combinedTradeDecision")}`,
  extractFunction("m1SafeTime")
].join("\n");
fs.writeFileSync(tempPath, moduleSource);

try {
  const { combinedTradeDecision } = await import(`${pathToFileURL(tempPath).href}?t=${Date.now()}`);
  const waitForecast = (candle) => ({
    candle,
    direction: "WAIT",
    rawDirection: "WAIT",
    confidence: 53,
    probabilities: { buy: 30, sell: 20, wait: 50 },
    backtestSamples: 40,
    backtestAccuracy: 35
  });
  const oneMinute = {
    forecasts: [null, null, waitForecast(3), null, waitForecast(5)],
    indicators: { atr: 1.65, rsi: 50.5, macdHistogram: -0.02 },
    levels: { support: 4050, resistance: 4062 },
    riskLevel: "MEDIUM",
    historicalPattern: { validation: { samples: 58, accuracy: 47 }, currentPatternAt: "2026-08-04 08:00:00" },
    backtest: { patternSamples: 40, patternAccuracy: 35 },
    reliability: 50,
    entryScore: 50,
    trendScore: 55,
    score: -1.1,
    trendBias: "BEARISH",
    momentumScore: 48,
    marketCondition: "TRENDING"
  };
  const fiveMinute = {
    trendBias: "BEARISH",
    trendScore: 64,
    momentumScore: 47,
    marketCondition: "TRENDING",
    indicators: { adx: 23 }
  };

  const decision = combinedTradeDecision(oneMinute, fiveMinute, 4056.59);
  assert.equal(decision.status, "ENTRY");
  assert.equal(decision.entryTier, "PULSE");
  assert.equal(decision.direction, "SELL");
  assert.equal(decision.takeProfit.tp1, 4055.59);
  assert.equal(decision.targetDollar, 1);
  assert.ok(decision.targetProbability >= 58);
  assert.ok(decision.signalScore >= 60);
  assert.equal(decision.cooldownMinutes, null);
  assert.equal(decision.targetSignalIntervalMinutes, 30);
  assert.equal(decision.adaptiveCadence, true);

  const route = fs.readFileSync(routePath, "utf8");
  assert.match(route, /targetProbability >= 63 && signalScore >= 58/);
  assert.match(route, /targetProbability >= 57 && signalScore >= 63/);
  assert.match(route, /targetProbability >= 58 && signalScore >= 60/);

  console.log("✅ v10.2 combined decision integration passed");
  console.log(JSON.stringify({
    decision: decision.decision,
    tier: decision.entryTier,
    probability: decision.targetProbability,
    score: decision.signalScore,
    entry: decision.entryPrice,
    tp1: decision.takeProfit.tp1,
    targetSignalIntervalMinutes: decision.targetSignalIntervalMinutes
  }, null, 2));
} finally {
  fs.rmSync(tempPath, { force: true });
}
