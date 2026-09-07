
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


function classifyTrendBar(candles, series, index) {
  if (index < 3) return "MIXED";
  const close = candles[index]?.close;
  const ema21Now = series.ema21[index];
  const ema50Now = series.ema50[index];
  const ema21Prev = series.ema21[index - 3];
  const ema50Prev = series.ema50[index - 3];
  if (![close, ema21Now, ema50Now, ema21Prev, ema50Prev].every(Number.isFinite)) return "MIXED";
  const bullish = close > ema21Now && ema21Now > ema50Now && ema21Now > ema21Prev && ema50Now >= ema50Prev;
  const bearish = close < ema21Now && ema21Now < ema50Now && ema21Now < ema21Prev && ema50Now <= ema50Prev;
  return bullish ? "BULLISH" : bearish ? "BEARISH" : "MIXED";
}

function consecutiveTrendCount(candles, series, direction, maxBars = 6) {
  let count = 0;
  for (let index = candles.length - 1; index >= 0 && count < maxBars; index -= 1) {
    if (classifyTrendBar(candles, series, index) !== direction) break;
    count += 1;
  }
  return count;
}

function assessMainTrend(candles, series, marketStructure, patternMemory) {
  const index = candles.length - 1;
  const close = candles[index]?.close;
  const ema21Now = series.ema21[index];
  const ema50Now = series.ema50[index];
  const ema21Prev = series.ema21[index - 3];
  const ema50Prev = series.ema50[index - 3];
  const rsiNow = series.rsi[index];
  const macdNow = finite(series.macdHistogram[index], 0);
  let bull = 0;
  let bear = 0;
  const evidence = [];

  if (Number.isFinite(close) && Number.isFinite(ema21Now)) {
    if (close > ema21Now) { bull += 1; evidence.push("close>EMA21"); }
    if (close < ema21Now) { bear += 1; evidence.push("close<EMA21"); }
  }
  if (Number.isFinite(ema21Now) && Number.isFinite(ema50Now)) {
    if (ema21Now > ema50Now) { bull += 2; evidence.push("EMA21>EMA50"); }
    if (ema21Now < ema50Now) { bear += 2; evidence.push("EMA21<EMA50"); }
  }
  if ([ema21Now, ema21Prev].every(Number.isFinite)) {
    if (ema21Now > ema21Prev) { bull += 1; evidence.push("EMA21 rising"); }
    if (ema21Now < ema21Prev) { bear += 1; evidence.push("EMA21 falling"); }
  }
  if ([ema50Now, ema50Prev].every(Number.isFinite)) {
    if (ema50Now > ema50Prev) { bull += 1; evidence.push("EMA50 rising"); }
    if (ema50Now < ema50Prev) { bear += 1; evidence.push("EMA50 falling"); }
  }
  if (marketStructure?.trend === "BULLISH") { bull += 3; evidence.push("structure bullish"); }
  if (marketStructure?.trend === "BEARISH") { bear += 3; evidence.push("structure bearish"); }
  if (Number.isFinite(rsiNow)) {
    if (rsiNow >= 54) { bull += 1; evidence.push("RSI>=54"); }
    if (rsiNow <= 46) { bear += 1; evidence.push("RSI<=46"); }
  }
  if (macdNow > 0) { bull += 1; evidence.push("MACD histogram positive"); }
  if (macdNow < 0) { bear += 1; evidence.push("MACD histogram negative"); }
  const firstForecast = patternMemory?.forecasts?.[0];
  if (firstForecast?.direction === "BUY" && firstForecast.confidence >= 50) bull += 1;
  if (firstForecast?.direction === "SELL" && firstForecast.confidence >= 50) bear += 1;

  const rawDirection = bull - bear >= 3 ? "BULLISH" : bear - bull >= 3 ? "BEARISH" : "MIXED";
  const bullishPersistence = consecutiveTrendCount(candles, series, "BULLISH");
  const bearishPersistence = consecutiveTrendCount(candles, series, "BEARISH");
  const persistenceBars = rawDirection === "BULLISH" ? bullishPersistence : rawDirection === "BEARISH" ? bearishPersistence : 0;
  const maxVotes = Math.max(1, bull + bear);
  const dominance = Math.abs(bull - bear) / maxVotes;
  const strength = Math.round(clamp(45 + dominance * 35 + Math.min(15, persistenceBars * 5), 0, 100));
  const persistent = persistenceBars >= 3;
  const established = ["BULLISH", "BEARISH"].includes(rawDirection) && persistent && strength >= 65;

  return {
    direction: established ? rawDirection : "MIXED",
    rawDirection,
    established,
    persistent,
    persistenceBars,
    strength,
    bullVotes: bull,
    bearVotes: bear,
    evidence: evidence.slice(0, 10)
  };
}

function reversalQualification(mainTrend, marketStructure, divergence, fakeBreakout, biasDirection) {
  if (!mainTrend || !["BULLISH", "BEARISH"].includes(mainTrend.rawDirection)) {
    return { qualified: false, direction: "WAIT", score: 0, confirmations: [] };
  }
  const targetDirection = mainTrend.rawDirection === "BULLISH" ? "SELL" : "BUY";
  const chochEvent = targetDirection === "BUY" ? "CHOCH_BULLISH" : "CHOCH_BEARISH";
  const choch = marketStructure?.event === chochEvent;
  const divergenceOk = divergence?.direction === targetDirection && finite(divergence?.strength, 0) >= 78 && finite(divergence?.confirmations, 0) >= 2;
  const trapOk = fakeBreakout?.favoredSide === targetDirection && finite(fakeBreakout?.risk, 0) >= 72;
  const biasOk = biasDirection === targetDirection;
  let score = 0;
  const confirmations = [];
  if (choch) { score += 30; confirmations.push(chochEvent); }
  if (divergenceOk) { score += Math.round(clamp(finite(divergence.strength, 0) * 0.35, 0, 35)); confirmations.push("confirmed divergence"); }
  if (trapOk) { score += Math.round(clamp(finite(fakeBreakout.risk, 0) * 0.25, 0, 25)); confirmations.push("fake breakout/liquidity sweep"); }
  if (biasOk) { score += 10; confirmations.push("pattern bias"); }
  score = Math.round(clamp(score, 0, 100));
  return { direction: targetDirection, score, qualified: choch && divergenceOk && trapOk && score >= 82, confirmations };
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
  const mainTrendGuard = assessMainTrend(candles, series, marketStructure, patternMemory);
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
    engine: "GOLD PULSE X v11.1 Main Trend Guard",
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
    mainTrendGuard,
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
  const patternForecasts = intelligence.patternMemory?.forecasts || [];
  let patternBuyVotes = 0;
  let patternSellVotes = 0;
  if (patternForecasts[0]?.direction === "BUY") patternBuyVotes += 2;
  if (patternForecasts[0]?.direction === "SELL") patternSellVotes += 2;
  if (patternForecasts[1]?.direction === "BUY") patternBuyVotes += 1;
  if (patternForecasts[1]?.direction === "SELL") patternSellVotes += 1;
  const patternEdge = Math.abs(patternBuyVotes - patternSellVotes);
  const biasDirection = patternBuyVotes - patternSellVotes >= 2
    ? "BUY"
    : patternSellVotes - patternBuyVotes >= 2
      ? "SELL"
      : "WAIT";
  const fakeBreakout = intelligence.fakeBreakout || {};
  const divergence = intelligence.divergence?.strongest || null;
  const mainTrend = intelligence.mainTrendGuard || { direction: "MIXED", rawDirection: "MIXED", established: false, strength: 0, persistenceBars: 0 };
  const reversal = reversalQualification(mainTrend, intelligence.marketStructure, divergence, fakeBreakout, biasDirection);
  const reasons = [...(baseDecision.reasons || [])];
  let probabilityDelta = 0;
  let scoreDelta = 0;
  let blocked = false;
  const blocks = [];

  // MAIN TREND FIRST: trend-following is the default; counter-trend requires exceptional reversal evidence.
  if (baseDecision.status === "ENTRY" && ["BUY", "SELL"].includes(originalDirection)) {
    const aligned = (mainTrend.direction === "BULLISH" && originalDirection === "BUY") || (mainTrend.direction === "BEARISH" && originalDirection === "SELL");
    const opposite = (mainTrend.rawDirection === "BULLISH" && originalDirection === "SELL") || (mainTrend.rawDirection === "BEARISH" && originalDirection === "BUY");
    if (aligned) {
      probabilityDelta += 4;
      scoreDelta += 6;
      reasons.push(`MAIN TREND ${mainTrend.direction} supports ${originalDirection} · strength ${mainTrend.strength}% · persistence ${mainTrend.persistenceBars} bars`);
    } else if (opposite) {
      if (reversal.qualified && reversal.direction === originalDirection) {
        probabilityDelta -= 2;
        scoreDelta -= 3;
        reasons.push(`COUNTER-TREND allowed only by exceptional reversal score ${reversal.score}%`);
      } else {
        blocked = true;
        blocks.push("counter-trend-blocked");
        reasons.push(`MAIN TREND ${mainTrend.rawDirection} blocks ${originalDirection} · reversal ${reversal.score}% below requirement`);
      }
    } else {
      blocked = true;
      blocks.push("main-trend-not-established");
      reasons.push("Main trend is not established for 3 consecutive 5M bars · WAIT");
    }
    if (!mainTrend.established && !reversal.qualified) {
      blocked = true;
      if (!blocks.includes("trend-persistence-not-confirmed")) blocks.push("trend-persistence-not-confirmed");
    }
  }

  if (["BUY", "SELL"].includes(originalDirection) && biasDirection === originalDirection) {
    probabilityDelta += Math.min(6, 2 + finite(patternEdge, 0));
    scoreDelta += Math.min(7, 2 + finite(patternEdge, 0));
    reasons.push(`5M Pattern Intelligence สนับสนุน ${originalDirection}`);
  } else if (
    ["BUY", "SELL"].includes(originalDirection) &&
    ["BUY", "SELL"].includes(biasDirection) &&
    biasDirection !== originalDirection
  ) {
    probabilityDelta -= Math.min(10, 4 + finite(patternEdge, 0));
    scoreDelta -= Math.min(12, 5 + finite(patternEdge, 0));
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

  if (baseDecision.status === "ENTRY" && ["BUY", "SELL"].includes(originalDirection) && !blocked) {
    const alignedTrend = (mainTrend.direction === "BULLISH" && originalDirection === "BUY") || (mainTrend.direction === "BEARISH" && originalDirection === "SELL");
    if (alignedTrend && (targetProbability < 68 || signalScore < 65)) {
      blocked = true;
      blocks.push("trend-entry-quality-too-low");
      reasons.push(`Trend ENTRY too weak: probability ${targetProbability}% / score ${signalScore}`);
    }
    if (!alignedTrend && reversal.qualified && (targetProbability < 78 || signalScore < 75)) {
      blocked = true;
      blocks.push("counter-trend-entry-quality-too-low");
      reasons.push(`Counter-trend requires probability >=78 and score >=75`);
    }
  }

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
      mainTrend: mainTrend.direction,
      mainTrendRaw: mainTrend.rawDirection,
      mainTrendStrength: mainTrend.strength,
      trendPersistenceBars: mainTrend.persistenceBars,
      reversalQualified: reversal.qualified,
      reversalScore: reversal.score,
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

