import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluatePulseFallback } from '../lib/core/pulse-engine.js';

const base = {
  oneMinute: {
    riskLevel: 'MEDIUM',
    trendBias: 'BEARISH',
    momentumScore: 48,
    score: -1.1,
    marketCondition: 'TRENDING',
    indicators: { atr: 1.55, rsi: 50.5, macdHistogram: -0.02, adx: 21 }
  },
  fiveMinute: {
    trendBias: 'BEARISH',
    momentumScore: 47,
    marketCondition: 'TRENDING',
    indicators: { adx: 23 }
  },
  buyProbability: 33,
  sellProbability: 25,
  waitProbability: 43,
  expectedMoveAbs: 2.65,
  mainTrend: 'SELL'
};

const bearishConflict = evaluatePulseFallback(base);
assert.equal(bearishConflict.eligible, true, 'real WAIT-style bearish case should become a controlled PULSE');
assert.equal(bearishConflict.direction, 'SELL');
assert.ok(bearishConflict.probability >= 52);
assert.ok(bearishConflict.score >= 52);
assert.ok(bearishConflict.directionalVotes >= 2);

const bullish = evaluatePulseFallback({
  ...base,
  oneMinute: {
    ...base.oneMinute,
    trendBias: 'BULLISH',
    momentumScore: 58,
    score: 1.4,
    indicators: { atr: 1.2, rsi: 55, macdHistogram: 0.018, adx: 24 }
  },
  fiveMinute: {
    ...base.fiveMinute,
    trendBias: 'BULLISH',
    momentumScore: 57,
    indicators: { adx: 25 }
  },
  buyProbability: 36,
  sellProbability: 28,
  mainTrend: 'BUY'
});
assert.equal(bullish.eligible, true);
assert.equal(bullish.direction, 'BUY');

const highRisk = evaluatePulseFallback({
  ...base,
  oneMinute: { ...base.oneMinute, riskLevel: 'HIGH' }
});
assert.equal(highRisk.eligible, false, 'Risk HIGH must remain blocked');

const flat = evaluatePulseFallback({
  ...base,
  oneMinute: {
    riskLevel: 'LOW',
    trendBias: 'MIXED',
    momentumScore: 50,
    score: 0,
    marketCondition: 'SIDEWAY',
    indicators: { atr: 0.3, rsi: 50, macdHistogram: 0, adx: 12 }
  },
  fiveMinute: {
    trendBias: 'MIXED',
    momentumScore: 50,
    marketCondition: 'SIDEWAY',
    indicators: { adx: 12 }
  },
  buyProbability: 29,
  sellProbability: 28,
  waitProbability: 43,
  expectedMoveAbs: 0.48,
  mainTrend: 'WAIT'
});
assert.equal(flat.eligible, false, 'no-bias/low-move market should not be forced into a trade');

const route = fs.readFileSync(new URL('../app/api/gold/route.js', import.meta.url), 'utf8');
assert.match(route, /entryTier = "PULSE"/);
assert.match(route, /const tp1Distance = targetMove;/);
assert.match(route, /evaluatePulseFallback/);

const config = fs.readFileSync(new URL('../lib/config.ts', import.meta.url), 'utf8');
assert.match(config, /version: "10\.0\.0"/);
assert.match(config, /signalProfile: activeSignalMode \? "ACTIVE_20_PULSE"/);

console.log('✅ v10 PULSE regression tests passed');
console.log(JSON.stringify({ bearishConflict, bullish, highRisk, flat }, null, 2));
