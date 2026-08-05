#!/usr/bin/env bash
set -Eeuo pipefail

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f package.json ]] || fail "เปิด Terminal ที่โฟลเดอร์เดียวกับ package.json"
[[ -d .git ]] || fail "โฟลเดอร์นี้ไม่ใช่ Git repository"

CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
if [[ "$CURRENT_VERSION" == "11.0.0" ]]; then
  ok "ระบบเป็น v11.0.0 PATTERN INTELLIGENCE 5M อยู่แล้ว"
  exit 0
fi
[[ "$CURRENT_VERSION" == "10.3.1" ]] || fail "รองรับการอัปเกรดจาก v10.3.1 เท่านั้น (พบ $CURRENT_VERSION)"

say "1/8 ซิงก์ branch main"
git pull --ff-only origin main

if grep -Eq '^[[:space:]]*schedule:' .github/workflows/gold-pulse-scan.yml; then
  fail "GitHub schedule ยังเปิดอยู่ ต้องใช้ cron-job.org เป็น scheduler หลักเพียงตัวเดียว"
fi

say "2/8 สร้าง 5M Pattern Intelligence Engine"
mkdir -p lib/intelligence
cat > lib/intelligence/five-minute-intelligence.js <<'MODULE_EOF'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => Number(finite(value).toFixed(digits));

function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i += 1) {
    current = values[i] * k + current * (1 - k);
    out[i] = current;
  }
  return out;
}

function rsi(values, period = 14) {
  const out = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = values[i] - values[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i += 1) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function atr(candles, period = 14) {
  const tr = candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previousClose = candles[index - 1].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let current = tr.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < candles.length; i += 1) {
    current = (current * (period - 1) + tr[i]) / period;
    out[i] = current;
  }
  return out;
}

function macdHistogram(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line = values.map((_, index) =>
    fastLine[index] != null && slowLine[index] != null ? fastLine[index] - slowLine[index] : null
  );
  const compact = line.filter((value) => value != null);
  const compactSignal = ema(compact, signalPeriod);
  const signal = Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (line[i] != null) signal[i] = compactSignal[j++];
  }
  return line.map((value, index) =>
    value != null && signal[index] != null ? value - signal[index] : null
  );
}

function sanitizeCandles(candles) {
  return (candles || [])
    .map((candle) => ({
      datetime: String(candle.datetime || ""),
      open: finite(candle.open, NaN),
      high: finite(candle.high, NaN),
      low: finite(candle.low, NaN),
      close: finite(candle.close, NaN)
    }))
    .filter((candle) =>
      candle.datetime &&
      [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
      candle.low <= Math.min(candle.open, candle.close) &&
      candle.high >= Math.max(candle.open, candle.close)
    );
}

function pivots(values, type, left = 3, right = 3) {
  const out = [];
  for (let i = left; i < values.length - right; i += 1) {
    if (!Number.isFinite(values[i])) continue;
    let ok = true;
    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i || !Number.isFinite(values[j])) continue;
      if (type === "HIGH" && values[j] >= values[i]) ok = false;
      if (type === "LOW" && values[j] <= values[i]) ok = false;
      if (!ok) break;
    }
    if (ok) out.push(i);
  }
  return out;
}

function pairRecent(indexes, currentIndex, maxAge = 90) {
  const recent = indexes.filter((index) => currentIndex - index <= maxAge);
  return recent.length >= 2 ? recent.slice(-2) : [];
}

function divergenceStrength(priceA, priceB, oscA, oscB) {
  const priceChange = Math.abs((priceB - priceA) / Math.max(Math.abs(priceA), 1e-9));
  const oscillatorChange = Math.abs(oscB - oscA);
  return Math.round(clamp(45 + priceChange * 5000 + oscillatorChange * 1.2, 45, 92));
}

function divergenceFor(candles, oscillator, name) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const currentIndex = candles.length - 1;
  const lowPair = pairRecent(pivots(lows, "LOW"), currentIndex);
  const highPair = pairRecent(pivots(highs, "HIGH"), currentIndex);
  const found = [];

  if (lowPair.length === 2) {
    const [a, b] = lowPair;
    if (Number.isFinite(oscillator[a]) && Number.isFinite(oscillator[b])) {
      if (lows[b] < lows[a] && oscillator[b] > oscillator[a]) {
        found.push({ type: "REGULAR_BULLISH", direction: "BUY", oscillator: name, strength: divergenceStrength(lows[a], lows[b], oscillator[a], oscillator[b]) });
      } else if (lows[b] > lows[a] && oscillator[b] < oscillator[a]) {
        found.push({ type: "HIDDEN_BULLISH", direction: "BUY", oscillator: name, strength: divergenceStrength(lows[a], lows[b], oscillator[a], oscillator[b]) });
      }
    }
  }

  if (highPair.length === 2) {
    const [a, b] = highPair;
    if (Number.isFinite(oscillator[a]) && Number.isFinite(oscillator[b])) {
      if (highs[b] > highs[a] && oscillator[b] < oscillator[a]) {
        found.push({ type: "REGULAR_BEARISH", direction: "SELL", oscillator: name, strength: divergenceStrength(highs[a], highs[b], oscillator[a], oscillator[b]) });
      } else if (highs[b] < highs[a] && oscillator[b] > oscillator[a]) {
        found.push({ type: "HIDDEN_BEARISH", direction: "SELL", oscillator: name, strength: divergenceStrength(highs[a], highs[b], oscillator[a], oscillator[b]) });
      }
    }
  }

  return found;
}

function detectDivergences(candles, rsiSeries, macdSeries) {
  const all = [
    ...divergenceFor(candles, rsiSeries, "RSI"),
    ...divergenceFor(candles, macdSeries, "MACD_HISTOGRAM")
  ];
  const grouped = new Map();
  for (const item of all) {
    const key = `${item.type}:${item.direction}`;
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...item, confirmations: 1 });
    else grouped.set(key, {
      ...current,
      strength: Math.round((current.strength + item.strength) / 2),
      confirmations: current.confirmations + 1,
      oscillator: `${current.oscillator}+${item.oscillator}`
    });
  }
  return [...grouped.values()].sort((a, b) => b.strength - a.strength);
}

function detectFakeBreakout(candles, atrSeries) {
  const index = candles.length - 1;
  const current = candles[index];
  const window = candles.slice(Math.max(0, index - 24), index);
  if (window.length < 12) return { direction: "NONE", risk: 0, reason: "insufficient-window" };

  const priorHigh = Math.max(...window.map((c) => c.high));
  const priorLow = Math.min(...window.map((c) => c.low));
  const currentAtr = Math.max(finite(atrSeries[index], current.high - current.low), 0.01);
  const range = Math.max(current.high - current.low, 1e-9);
  const bodyHigh = Math.max(current.open, current.close);
  const bodyLow = Math.min(current.open, current.close);
  const upperWickRatio = (current.high - bodyHigh) / range;
  const lowerWickRatio = (bodyLow - current.low) / range;
  const buffer = Math.max(currentAtr * 0.06, 0.02);

  if (current.high > priorHigh + buffer && current.close < priorHigh) {
    const risk = Math.round(clamp(
      55 + upperWickRatio * 40 + Math.min(15, (current.high - priorHigh) / currentAtr * 15),
      55,
      96
    ));
    return {
      direction: "BEARISH_TRAP",
      blockedSide: "BUY",
      favoredSide: "SELL",
      risk,
      level: round(priorHigh),
      wickRatio: round(upperWickRatio, 3),
      reason: "ราคาแทงเหนือ swing high แล้วปิดกลับต่ำกว่าแนวเดิม"
    };
  }

  if (current.low < priorLow - buffer && current.close > priorLow) {
    const risk = Math.round(clamp(
      55 + lowerWickRatio * 40 + Math.min(15, (priorLow - current.low) / currentAtr * 15),
      55,
      96
    ));
    return {
      direction: "BULLISH_TRAP",
      blockedSide: "SELL",
      favoredSide: "BUY",
      risk,
      level: round(priorLow),
      wickRatio: round(lowerWickRatio, 3),
      reason: "ราคาแทงต่ำกว่า swing low แล้วปิดกลับเหนือแนวเดิม"
    };
  }

  return {
    direction: "NONE",
    blockedSide: null,
    favoredSide: null,
    risk: Math.round(clamp(Math.max(upperWickRatio, lowerWickRatio) * 35, 0, 40)),
    level: null,
    wickRatio: round(Math.max(upperWickRatio, lowerWickRatio), 3),
    reason: "ไม่พบ liquidity sweep ที่ปิดกลับชัดเจน"
  };
}

function detectStructure(candles) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const highPivots = pivots(highs, "HIGH").slice(-3);
  const lowPivots = pivots(lows, "LOW").slice(-3);
  const close = candles.at(-1)?.close;
  const priorHigh = highPivots.length ? highs[highPivots.at(-1)] : null;
  const priorLow = lowPivots.length ? lows[lowPivots.at(-1)] : null;

  let trend = "MIXED";
  if (highPivots.length >= 2 && lowPivots.length >= 2) {
    const higherHigh = highs[highPivots.at(-1)] > highs[highPivots.at(-2)];
    const higherLow = lows[lowPivots.at(-1)] > lows[lowPivots.at(-2)];
    const lowerHigh = highs[highPivots.at(-1)] < highs[highPivots.at(-2)];
    const lowerLow = lows[lowPivots.at(-1)] < lows[lowPivots.at(-2)];
    if (higherHigh && higherLow) trend = "BULLISH";
    else if (lowerHigh && lowerLow) trend = "BEARISH";
  }

  let event = "NONE";
  let direction = "WAIT";
  if (Number.isFinite(priorHigh) && close > priorHigh) {
    direction = "BUY";
    event = trend === "BEARISH" ? "CHOCH_BULLISH" : "BOS_BULLISH";
  } else if (Number.isFinite(priorLow) && close < priorLow) {
    direction = "SELL";
    event = trend === "BULLISH" ? "CHOCH_BEARISH" : "BOS_BEARISH";
  }

  return {
    trend,
    event,
    direction,
    previousSwingHigh: Number.isFinite(priorHigh) ? round(priorHigh) : null,
    previousSwingLow: Number.isFinite(priorLow) ? round(priorLow) : null
  };
}

function buildSeries(candles) {
  const close = candles.map((c) => c.close);
  return {
    close,
    ema9: ema(close, 9),
    ema21: ema(close, 21),
    ema50: ema(close, 50),
    rsi: rsi(close, 14),
    atr: atr(candles, 14),
    macdHistogram: macdHistogram(close)
  };
}

function featureVector(candles, index, series) {
  if (index < 55) return null;
  const candle = candles[index];
  const atrValue = Math.max(finite(series.atr[index], 0), 1e-9);
  if (![series.ema9[index], series.ema21[index], series.ema50[index], series.rsi[index]].every(Number.isFinite)) {
    return null;
  }
  const range = Math.max(candle.high - candle.low, 1e-9);
  const bodyHigh = Math.max(candle.open, candle.close);
  const bodyLow = Math.min(candle.open, candle.close);
  const returns = [1, 3, 6, 12].map((lookback) =>
    clamp((candle.close - candles[index - lookback].close) / atrValue, -8, 8)
  );
  const recentHigh = Math.max(...candles.slice(index - 20, index).map((c) => c.high));
  const recentLow = Math.min(...candles.slice(index - 20, index).map((c) => c.low));
  const recentAtr = series.atr.slice(Math.max(0, index - 30), index).filter(Number.isFinite);
  const averageAtr = recentAtr.length
    ? recentAtr.reduce((sum, value) => sum + value, 0) / recentAtr.length
    : atrValue;
  return [
    clamp((candle.close - candle.open) / atrValue, -4, 4),
    clamp((candle.high - bodyHigh) / atrValue, 0, 4),
    clamp((bodyLow - candle.low) / atrValue, 0, 4),
    clamp(((candle.close - candle.low) / range - 0.5) * 2, -1, 1),
    ...returns,
    clamp((series.ema9[index] - series.ema21[index]) / atrValue, -8, 8),
    clamp((series.ema21[index] - series.ema50[index]) / atrValue, -10, 10),
    clamp((series.ema9[index] - series.ema9[index - 3]) / atrValue, -5, 5),
    clamp((series.rsi[index] - 50) / 25, -2, 2),
    clamp(finite(series.macdHistogram[index], 0) / atrValue, -4, 4),
    clamp(atrValue / Math.max(averageAtr, 1e-9), 0.25, 4),
    clamp((recentHigh - candle.close) / atrValue, -2, 12),
    clamp((candle.close - recentLow) / atrValue, -2, 12)
  ];
}

function vectorDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i];
    total += delta * delta;
  }
  return Math.sqrt(total / a.length);
}

function outcome(candles, index, horizon, atrValue) {
  if (index + horizon >= candles.length) return "SIDEWAY";
  const start = candles[index].close;
  const end = candles[index + horizon].close;
  const threshold = Math.max(atrValue * (0.17 + horizon * 0.03), 0.05);
  const move = end - start;
  if (move >= threshold) return "UP";
  if (move <= -threshold) return "DOWN";
  return "SIDEWAY";
}

function weightedProbabilities(matches, horizon) {
  const counts = { UP: 1.5, DOWN: 1.5, SIDEWAY: 1.5 };
  for (const match of matches) counts[match.outcomes[horizon - 1]] += match.weight;
  const total = counts.UP + counts.DOWN + counts.SIDEWAY;
  const up = Math.round(counts.UP / total * 100);
  const down = Math.round(counts.DOWN / total * 100);
  return { up, down, sideway: 100 - up - down };
}

function buildPatternMemory(candles, series) {
  const currentIndex = candles.length - 1;
  const current = featureVector(candles, currentIndex, series);
  if (!current) return null;

  const raw = [];
  for (let index = 55; index < currentIndex - 3; index += 1) {
    const vector = featureVector(candles, index, series);
    if (!vector) continue;
    const distance = vectorDistance(current, vector);
    const similarity = clamp(1 - distance / 3.2, 0, 1);
    const atrValue = Math.max(finite(series.atr[index], 0), 0.01);
    raw.push({
      index,
      distance,
      similarity,
      outcomes: [1, 2, 3].map((horizon) => outcome(candles, index, horizon, atrValue))
    });
  }

  raw.sort((a, b) => a.distance - b.distance);
  const target = Math.min(140, Math.max(50, Math.floor(raw.length * 0.22)));
  const selected = raw.slice(0, target).map((item) => ({
    ...item,
    weight: Math.pow(Math.max(0.04, item.similarity), 3) / Math.max(0.08, item.distance)
  }));

  const forecasts = [1, 2, 3].map((horizon) => {
    const distribution = weightedProbabilities(selected, horizon);
    const ranked = Object.entries(distribution).sort((a, b) => b[1] - a[1]);
    const [leader, runnerUp] = ranked;
    const rawDirection = leader[0] === "up" ? "BUY" : leader[0] === "down" ? "SELL" : "WAIT";
    return {
      candle: horizon,
      minutesAhead: horizon * 5,
      direction: leader[1] >= 43 && leader[1] - runnerUp[1] >= 6 ? rawDirection : "WAIT",
      confidence: leader[1],
      edge: leader[1] - runnerUp[1],
      probabilities: distribution
    };
  });

  const averageSimilarity = selected.length
    ? selected.reduce((sum, item) => sum + item.similarity, 0) / selected.length
    : 0;

  return {
    engine: "5M Candle DNA Weighted KNN",
    sourceCandles: candles.length,
    usableHistoricalCases: raw.length,
    matchedCases: selected.length,
    averageSimilarity: Math.round(averageSimilarity * 100),
    forecasts
  };
}

function buildBias(memory, structure, fakeBreakout, divergences) {
  const first = memory?.forecasts?.[0];
  const second = memory?.forecasts?.[1];
  let buyVotes = 0;
  let sellVotes = 0;

  if (first?.direction === "BUY") buyVotes += 2;
  if (first?.direction === "SELL") sellVotes += 2;
  if (second?.direction === "BUY") buyVotes += 1;
  if (second?.direction === "SELL") sellVotes += 1;
  if (structure.direction === "BUY") buyVotes += 1;
  if (structure.direction === "SELL") sellVotes += 1;
  if (fakeBreakout.favoredSide === "BUY") buyVotes += 2;
  if (fakeBreakout.favoredSide === "SELL") sellVotes += 2;

  for (const divergence of divergences) {
    const weight = divergence.confirmations >= 2 ? 2 : 1;
    if (divergence.direction === "BUY") buyVotes += weight;
    if (divergence.direction === "SELL") sellVotes += weight;
  }

  const direction = buyVotes - sellVotes >= 2
    ? "BUY"
    : sellVotes - buyVotes >= 2
      ? "SELL"
      : "WAIT";

  return {
    direction,
    buyVotes,
    sellVotes,
    edge: Math.abs(buyVotes - sellVotes)
  };
}

export function analyzeFiveMinuteIntelligence(inputCandles) {
  const candles = sanitizeCandles(inputCandles);
  if (candles.length < 120) {
    return {
      ready: false,
      timeframe: "5min",
      reason: "ต้องมีแท่ง 5 นาทีอย่างน้อย 120 แท่ง"
    };
  }

  const series = buildSeries(candles);
  const divergences = detectDivergences(candles, series.rsi, series.macdHistogram);
  const fakeBreakout = detectFakeBreakout(candles, series.atr);
  const marketStructure = detectStructure(candles);
  const patternMemory = buildPatternMemory(candles, series);
  const bias = buildBias(patternMemory, marketStructure, fakeBreakout, divergences);
  const strongestDivergence = divergences[0] || null;
  const trapRisk = Math.round(clamp(
    fakeBreakout.risk +
    (strongestDivergence?.strength || 0) * 0.18 +
    (String(marketStructure.event).startsWith("CHOCH") ? 12 : 0),
    0,
    100
  ));

  return {
    ready: true,
    engine: "GOLD PULSE X v11 Pattern Intelligence Foundation",
    timeframe: "5min",
    evaluatedAt: new Date().toISOString(),
    patternMemory,
    divergence: {
      detected: divergences.length > 0,
      strongest: strongestDivergence,
      signals: divergences.slice(0, 4)
    },
    fakeBreakout,
    marketStructure,
    bias,
    trapRisk,
    note: "วิเคราะห์จากข้อมูล 5M ที่โหลดในรอบปัจจุบัน ยังไม่ใช่คลังหลายล้านรูปแบบหรืออัตราชนะที่พิสูจน์แล้ว"
  };
}

export function applyFiveMinuteIntelligenceOverlay(baseDecision, intelligence) {
  if (!baseDecision || !intelligence?.ready) {
    return {
      ...baseDecision,
      intelligenceOverlay: {
        applied: false,
        reason: intelligence?.reason || "intelligence-not-ready"
      },
      fiveMinuteIntelligence: intelligence || null
    };
  }

  const originalDirection = String(baseDecision.direction || "WAIT").toUpperCase();
  const biasDirection = String(intelligence.bias?.direction || "WAIT").toUpperCase();
  const fakeBreakout = intelligence.fakeBreakout || {};
  const divergence = intelligence.divergence?.strongest || null;
  const reasons = [...(baseDecision.reasons || [])];
  let probabilityDelta = 0;
  let scoreDelta = 0;
  let blocked = false;
  const blocks = [];

  if (["BUY", "SELL"].includes(originalDirection) && biasDirection === originalDirection) {
    probabilityDelta += Math.min(6, 2 + finite(intelligence.bias?.edge, 0));
    scoreDelta += Math.min(7, 2 + finite(intelligence.bias?.edge, 0));
    reasons.push(`5M Pattern Intelligence สนับสนุน ${originalDirection}`);
  } else if (
    ["BUY", "SELL"].includes(originalDirection) &&
    ["BUY", "SELL"].includes(biasDirection) &&
    biasDirection !== originalDirection
  ) {
    probabilityDelta -= Math.min(10, 4 + finite(intelligence.bias?.edge, 0));
    scoreDelta -= Math.min(12, 5 + finite(intelligence.bias?.edge, 0));
    reasons.push(`5M Pattern Intelligence ขัดกับ ${originalDirection}`);
  }

  if (fakeBreakout.blockedSide === originalDirection) {
    probabilityDelta -= Math.round(fakeBreakout.risk * 0.12);
    scoreDelta -= Math.round(fakeBreakout.risk * 0.15);
    reasons.push(`Fake breakout risk ${fakeBreakout.risk}% ขัดกับ ${originalDirection}`);
    if (fakeBreakout.risk >= 72) {
      blocked = true;
      blocks.push("high-fake-breakout-risk");
    }
  }

  if (
    divergence &&
    divergence.direction !== originalDirection &&
    ["BUY", "SELL"].includes(originalDirection)
  ) {
    probabilityDelta -= Math.round(divergence.strength * 0.08);
    scoreDelta -= Math.round(divergence.strength * 0.10);
    reasons.push(`${divergence.type} ${divergence.oscillator} ขัดกับ ${originalDirection}`);
    if (divergence.strength >= 72 && divergence.confirmations >= 2) {
      blocked = true;
      blocks.push("confirmed-opposing-divergence");
    }
  } else if (divergence && divergence.direction === originalDirection) {
    probabilityDelta += Math.round(divergence.strength * 0.035);
    scoreDelta += Math.round(divergence.strength * 0.04);
    reasons.push(`${divergence.type} สนับสนุน ${originalDirection}`);
  }

  if (
    ["BUY", "SELL"].includes(intelligence.marketStructure?.direction) &&
    intelligence.marketStructure.direction !== originalDirection &&
    String(intelligence.marketStructure.event).startsWith("CHOCH")
  ) {
    scoreDelta -= 8;
    reasons.push(`${intelligence.marketStructure.event} ขัดกับ ${originalDirection}`);
  }

  const targetProbability = Math.round(clamp(
    finite(baseDecision.targetProbability, 0) + probabilityDelta,
    0,
    92
  ));
  const signalScore = Math.round(clamp(
    finite(baseDecision.signalScore, 0) + scoreDelta,
    0,
    100
  ));

  const output = {
    ...baseDecision,
    targetProbability,
    signalScore,
    entryQuality: signalScore,
    reasons: reasons.slice(0, 12),
    intelligenceOverlay: {
      applied: true,
      probabilityDelta,
      scoreDelta,
      blocked,
      blocks,
      biasDirection,
      trapRisk: intelligence.trapRisk
    },
    fiveMinuteIntelligence: intelligence
  };

  if (blocked && baseDecision.status === "ENTRY") {
    output.originalDecision = baseDecision.decision;
    output.originalDirection = originalDirection;
    output.decision = "PATTERN INTELLIGENCE BLOCK - WAIT";
    output.status = "WATCH";
    output.direction = "WAIT";
    output.entryTier = "INTELLIGENCE_BLOCK";
    output.alertKey = null;
  }

  return output;
}

MODULE_EOF

say "3/8 สร้าง Regression Test"
cat > scripts/test-v11-intelligence.mjs <<'TEST_EOF'
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

TEST_EOF

say "4/8 อัปเดต Static Check"
cat > scripts/static-check.mjs <<'CHECK_EOF'
import fs from "node:fs";
import path from "node:path";

const required = [
  "app/page.js",
  "app/api/gold/route.js",
  "app/api/health/route.js",
  "app/api/scan/route.js",
  "lib/alerts.ts",
  "lib/config.ts",
  "lib/intelligence/five-minute-intelligence.js",
  "scripts/test-v11-intelligence.mjs",
  ".github/workflows/gold-pulse-scan.yml",
  ".env.example"
];

let bad = false;
for (const item of required) {
  const exists = fs.existsSync(path.join(process.cwd(), item));
  console.log(`${exists ? "✅" : "❌"} ${item}`);
  if (!exists) bad = true;
}

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (pkg.version !== "11.0.0") {
  console.error(`❌ package version must be 11.0.0 (found ${pkg.version})`);
  bad = true;
} else {
  console.log("✅ package version 11.0.0");
}

const route = fs.readFileSync("app/api/gold/route.js", "utf8");
for (const marker of [
  "analyzeFiveMinuteIntelligence",
  "applyFiveMinuteIntelligenceOverlay",
  "fiveMinuteIntelligence",
  "patternIntelligenceEnabled: true"
]) {
  if (!route.includes(marker)) {
    console.error(`❌ missing route marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ route marker: ${marker}`);
  }
}

const health = fs.readFileSync("app/api/health/route.js", "utf8");
if (!health.includes("patternIntelligence") || !health.includes("cron-job.org")) {
  console.error("❌ health diagnostics missing patternIntelligence or cron-job.org");
  bad = true;
} else {
  console.log("✅ health diagnostics expose patternIntelligence and cron-job.org");
}

const intelligence = fs.readFileSync("lib/intelligence/five-minute-intelligence.js", "utf8");
for (const marker of [
  "5M Candle DNA Weighted KNN",
  "REGULAR_BULLISH",
  "REGULAR_BEARISH",
  "BEARISH_TRAP",
  "BULLISH_TRAP",
  "CHOCH_BULLISH",
  "CHOCH_BEARISH",
  "applyFiveMinuteIntelligenceOverlay"
]) {
  if (!intelligence.includes(marker)) {
    console.error(`❌ missing intelligence marker: ${marker}`);
    bad = true;
  } else {
    console.log(`✅ intelligence marker: ${marker}`);
  }
}

const workflow = fs.readFileSync(".github/workflows/gold-pulse-scan.yml", "utf8");
if (/\bschedule\s*:/.test(workflow)) {
  console.error("❌ GitHub automatic schedule must remain disabled; cron-job.org is primary");
  bad = true;
} else {
  console.log("✅ GitHub workflow remains manual-only");
}

if (bad) process.exit(1);

CHECK_EOF

say "5/8 เชื่อม Engine เข้ากับ API, LINE, Dashboard และ Health"
python3 - <<'PATCH_EOF'

from pathlib import Path
import json
import re

def require(condition, message):
    if not condition:
        raise SystemExit(f"ERROR: {message}")

pkg_path = Path("package.json")
pkg = json.loads(pkg_path.read_text())
require(pkg.get("version") in {"10.3.1", "11.0.0"}, f"รองรับการอัปเกรดจาก v10.3.1 เท่านั้น (พบ {pkg.get('version')})")
pkg["name"] = "gold-pulse-x-v11-pattern-intelligence-5m"
pkg["version"] = "11.0.0"
pkg.setdefault("scripts", {})["test:intelligence"] = "node scripts/test-v11-intelligence.mjs"
pkg["scripts"]["check"] = "node scripts/static-check.mjs"
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")

p = Path("lib/config.ts")
s = p.read_text()
s = re.sub(r'version:\s*"[^"]+"', 'version: "11.0.0"', s, count=1)
s = re.sub(
    r'signalProfile:\s*classicMode\s*\?\s*"[^"]+"\s*:\s*"CUSTOM"',
    'signalProfile: classicMode ? "PATTERN_INTELLIGENCE_5M" : "CUSTOM"',
    s,
    count=1
)
p.write_text(s)

p = Path("app/api/gold/route.js")
s = p.read_text()
import_line = 'import { getProvider } from "../../../lib/providers";\n'
new_import = 'import { analyzeFiveMinuteIntelligence, applyFiveMinuteIntelligenceOverlay } from "../../../lib/intelligence/five-minute-intelligence";\n'
require(import_line in s, "ไม่พบตำแหน่ง import ใน app/api/gold/route.js")
if new_import not in s:
    s = s.replace(import_line, import_line + new_import, 1)

s = s.replace('version: "10.3.1"', 'version: "11.0.0"', 1)

old_build = '''  const oneAnalysis = analyze([...m1], 5);
  const fiveAnalysis = analyze([...m5], 5);
  const tradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1.at(-1)?.close || 0);
  const smartFree = buildSmartFreeContext(tradeDecision, oneAnalysis, fiveAnalysis);'''
new_build = '''  const oneAnalysis = analyze([...m1], 5);
  const fiveAnalysis = analyze([...m5], 5);
  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5);
  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1.at(-1)?.close || 0);
  const tradeDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const smartFree = buildSmartFreeContext(tradeDecision, oneAnalysis, fiveAnalysis);'''
require(old_build in s or new_build in s, "ไม่พบ buildPayload block")
s = s.replace(old_build, new_build, 1)

old_payload = '    fiveMinute: { candles: m5.slice(-140), analysis: fiveAnalysis },\n    tradeDecision'
new_payload = '    fiveMinute: { candles: m5.slice(-140), analysis: fiveAnalysis },\n    fiveMinuteIntelligence,\n    tradeDecision'
require(old_payload in s or new_payload in s, "ไม่พบตำแหน่งเพิ่ม fiveMinuteIntelligence")
s = s.replace(old_payload, new_payload, 1)

s = s.replace(
    '    adaptiveCadence: true,\n    reasons,',
    '    adaptiveCadence: false,\n    patternIntelligenceEnabled: true,\n    reasons,',
    1
)
s = re.sub(
    r'    note: "v10\.2[^"]+"',
    '    note: "v11 ใช้ Classic 9.8 Pro Plus ร่วมกับ 5M Pattern Intelligence, divergence, liquidity sweep, fake-breakout และ market-structure overlay. Pattern memory ในรอบสดใช้ข้อมูลที่ provider โหลดมา ไม่ใช่คลังหลายล้านรูปแบบและไม่รับประกันกำไร."',
    s,
    count=1
)
p.write_text(s)

p = Path("lib/alerts.ts")
s = p.read_text()
s = s.replace('"gold-pulse-v10.3.1-classic"', '"gold-pulse-v11-pattern-intelligence"')
s = s.replace(
    '`${icon} GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS`,',
    '`${icon} GOLD PULSE X v11 PATTERN INTELLIGENCE 5M`,'
)
market_line = '    `Market ${evaluation.marketRegime} · 5M trend ${d.mainTrend || "—"}`,\n'
intelligence_lines = '''    `Market ${evaluation.marketRegime} · 5M trend ${d.mainTrend || "—"}`,
    `Pattern bias ${d?.fiveMinuteIntelligence?.bias?.direction || "WAIT"} · Trap risk ${Number(d?.fiveMinuteIntelligence?.trapRisk || 0)}%`,
    `Next 5M U${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.up || 0)} D${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.down || 0)} W${Number(d?.fiveMinuteIntelligence?.patternMemory?.forecasts?.[0]?.probabilities?.sideway || 0)}`,
'''
require(market_line in s or "Pattern bias" in s, "ไม่พบตำแหน่งเพิ่มข้อมูล Intelligence ใน LINE")
s = s.replace(market_line, intelligence_lines, 1)
s = s.replace(
    '"Classic 9.8 Pro Plus: ใช้ 5M trend + forecast เป็นแกน, ปิด PULSE และเพิ่มตัวกรอง Sideway/Mixed/Counter-trend",',
    '"v11: Classic 9.8 Pro Plus + 5M Candle DNA + Divergence + Fake Breakout + Market Structure",'
)
p.write_text(s)

p = Path("app/api/health/route.js")
s = p.read_text()
s = re.sub(
    r'app:\s*"GOLD PULSE X [^"]+"',
    'app: "GOLD PULSE X v11.0 PATTERN INTELLIGENCE 5M"',
    s,
    count=1
)
if "patternIntelligence:" not in s:
    marker = '    scheduler: "cron-job.org | every 5 minutes | endpoint active 08:00-24:00 Asia/Bangkok",'
    block = '''    patternIntelligence: {
      enabled: true,
      timeframe: "5min",
      mode: "live-overlay",
      features: [
        "5M Candle DNA Weighted KNN",
        "RSI/MACD regular and hidden divergence",
        "Liquidity sweep and fake breakout",
        "BOS/CHOCH market structure",
        "Next 5/10/15-minute probability distribution"
      ],
      currentLiveMemory: "Up to the provider window loaded per scan",
      millionPatternArchiveReady: false,
      note: "Million-pattern training requires an external historical dataset and offline training pipeline."
    },
'''
    require(marker in s, "ไม่พบ scheduler marker ใน Health API")
    s = s.replace(marker, block + marker, 1)
p.write_text(s)

p = Path("app/layout.js")
s = p.read_text()
s = re.sub(
    r'title:\s*"GOLD PULSE X [^"]+"',
    'title: "GOLD PULSE X v11 Pattern Intelligence 5M"',
    s,
    count=1
)
s = re.sub(
    r'description:\s*"[^"]+"',
    'description: "XAU/USD Classic 9.8 Pro Plus with 5M pattern memory, divergence, fake-breakout and market-structure analysis"',
    s,
    count=1
)
p.write_text(s)

p = Path("app/page.js")
s = p.read_text()
s = re.sub(
    r'GOLD PULSE <span>[^<]+</span>',
    'GOLD PULSE <span>X v11 PATTERN INTELLIGENCE 5M</span>',
    s,
    count=1
)

logic = '''<section className="panel logic"><p className="eyebrow">MODEL LOGIC v11 PATTERN INTELLIGENCE 5M</p><h2>ประเมินแท่ง 5 นาทีด้วย Pattern Memory และตัวกรองกับดักตลาด</h2><p>ใช้ Classic 9.8 Pro Plus เป็นฐาน แล้วเพิ่ม Candle DNA similarity, RSI/MACD divergence, liquidity sweep, fake breakout และ BOS/CHOCH ระบบจะแสดงความน่าจะเป็นของอีก 5, 10 และ 15 นาที และบล็อก ENTRY เมื่อพบกับดักหรือ divergence ฝั่งตรงข้ามที่แข็งแรง ข้อมูลสดยังจำกัดตามจำนวนแท่งที่ provider โหลดในแต่ละรอบ ไม่ใช่คลังหลายล้านรูปแบบและไม่รับประกันกำไร</p></section>'''
s, count = re.subn(
    r'<section className="panel logic">.*?</section>',
    logic,
    s,
    count=1,
    flags=re.S
)
require(count == 1, "ไม่พบ MODEL LOGIC panel ใน app/page.js")

if "5M PATTERN INTELLIGENCE" not in s:
    marker = '      <section className="panel reasons">'
    panel = '''      {data?.fiveMinuteIntelligence?.ready && (
        <section className="panel historyPanel">
          <div className="head">
            <div>
              <p className="eyebrow">5M PATTERN INTELLIGENCE</p>
              <h2>Candle DNA · Divergence · Fake Breakout · Structure</h2>
            </div>
            <span className="reliability">Trap risk {data.fiveMinuteIntelligence.trapRisk || 0}%</span>
          </div>
          <div className="historyStats">
            <span>Bias <b>{data.fiveMinuteIntelligence.bias?.direction || "WAIT"}</b></span>
            <span>Similarity <b>{data.fiveMinuteIntelligence.patternMemory?.averageSimilarity || 0}%</b></span>
            <span>Matches <b>{data.fiveMinuteIntelligence.patternMemory?.matchedCases || 0}</b></span>
            <span>Divergence <b>{data.fiveMinuteIntelligence.divergence?.strongest?.type || "NONE"}</b></span>
            <span>Fake breakout <b>{data.fiveMinuteIntelligence.fakeBreakout?.direction || "NONE"}</b></span>
            <span>Structure <b>{data.fiveMinuteIntelligence.marketStructure?.event || "NONE"}</b></span>
          </div>
          <div className="forecastGrid">
            {(data.fiveMinuteIntelligence.patternMemory?.forecasts || []).map((item) => (
              <div className={`forecast ${directionClass(item.direction)}`} key={`intelligence-${item.candle}`}>
                <small>NEXT {item.minutesAhead} MIN</small>
                <strong>{item.direction}</strong>
                <b>{item.confidence}%</b>
                <div className="prob">
                  <span>U {item.probabilities?.up || 0}</span>
                  <span>D {item.probabilities?.down || 0}</span>
                  <span>W {item.probabilities?.sideway || 0}</span>
                </div>
              </div>
            ))}
          </div>
          <small>Live memory ใช้แท่ง 5M ที่โหลดในรอบปัจจุบัน จึงเป็น Foundation ก่อนเชื่อมคลังข้อมูลหลายปี</small>
        </section>
      )}

'''
    require(marker in s, "ไม่พบตำแหน่งแทรก Intelligence panel")
    s = s.replace(marker, panel + marker, 1)
p.write_text(s)

Path("README.md").write_text('''# GOLD PULSE X v11.0 — PATTERN INTELLIGENCE 5M

ระบบใช้ Classic 9.8 Pro Plus เป็นฐาน และเพิ่มการวิเคราะห์แท่ง 5 นาทีแบบหลายชั้น

## Intelligence ที่เปิดใช้งาน

- 5M Candle DNA Weighted KNN
- ความน่าจะเป็นอีก 5, 10 และ 15 นาที
- Regular / Hidden RSI divergence
- Regular / Hidden MACD divergence
- Liquidity sweep และ fake breakout
- BOS / CHOCH market structure
- Intelligence overlay ปรับคะแนนและบล็อก ENTRY เมื่อความเสี่ยงกับดักสูง
- cron-job.org เรียกทุก 5 นาที
- ไม่ใช้ Redis
- PULSE fallback ยังคงปิด

## ข้อจำกัดที่ต้องเข้าใจ

Live Pattern Memory ใช้แท่งที่ provider โหลดมาในรอบปัจจุบันเท่านั้น ปัจจุบันจึงยังไม่ใช่คลังหลายล้านรูปแบบ การสร้าง Million-Pattern Archive ต้องมีข้อมูล XAU/USD ย้อนหลังหลายปีและกระบวนการฝึกแบบ Offline เพิ่มเติม

ค่าความน่าจะเป็นเป็น Model Estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว และระบบไม่รับประกันกำไร
''')

p = Path("CHANGELOG.md")
if p.exists():
    s = p.read_text()
    entry = '''# v11.0.0 — PATTERN INTELLIGENCE 5M

- Added 5M Candle DNA weighted-nearest-neighbor memory.
- Added next 5/10/15-minute UP/DOWN/SIDEWAY probability distributions.
- Added regular and hidden RSI/MACD divergence.
- Added liquidity-sweep and fake-breakout detection.
- Added BOS/CHOCH market-structure analysis.
- Added intelligence overlay that adjusts score/probability and blocks high-risk traps.
- Keeps cron-job.org every 5 minutes, no Redis, and PULSE disabled.
- Current live memory uses the provider candle window; million-pattern training is not yet active.

'''
    if not s.startswith("# v11.0.0"):
        p.write_text(entry + s)

PATCH_EOF

say "6/8 ตรวจระบบ"
npm run check
npm run test:intelligence
npm run build

say "7/8 Commit และ Push"
git add   package.json   README.md   CHANGELOG.md   app/page.js   app/layout.js   app/api/gold/route.js   app/api/health/route.js   lib/config.ts   lib/alerts.ts   lib/intelligence/five-minute-intelligence.js   scripts/static-check.mjs   scripts/test-v11-intelligence.mjs

git commit -m "Upgrade to v11 Pattern Intelligence 5M"
git push origin main

say "8/8 ลบตัวติดตั้งชั่วคราว"
INSTALLER=$(basename "$0")
if git ls-files --error-unmatch "$INSTALLER" >/dev/null 2>&1; then
  rm -f "$INSTALLER"
  git add -A
  git commit -m "Remove temporary v11 installer"
  git push origin main
fi

ok "SUCCESS: GOLD PULSE X v11.0 PATTERN INTELLIGENCE 5M pushed to GitHub."
printf '%s\n'   "รอ Vercel 1–3 นาที แล้วตรวจ /api/health"   "คาดหวัง: version 11.0.0 | signalProfile PATTERN_INTELLIGENCE_5M"   "หมายเหตุ: Live memory ใช้ข้อมูลใน provider window ยังไม่ใช่คลังหลายล้านรูปแบบ"
