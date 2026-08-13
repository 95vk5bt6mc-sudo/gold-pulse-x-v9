const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

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
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }
  gain /= period;
  loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const pc = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
  });
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let current = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < tr.length; i += 1) {
    current = (current * (period - 1) + tr[i]) / period;
    out[i] = current;
  }
  return out;
}

function macdHistogram(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const line = values.map((_, i) => fast[i] != null && slow[i] != null ? fast[i] - slow[i] : null);
  const compact = line.filter((v) => v != null);
  const compactSignal = ema(compact, 9);
  const signal = Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (line[i] != null) signal[i] = compactSignal[j++];
  }
  return line.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null);
}

function parseBangkokStart(datetime) {
  const text = String(datetime || "").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return NaN;
  return Date.parse(text.replace(" ", "T") + "+07:00");
}

function sanitize(input) {
  const deduped = new Map();
  for (const c of input || []) {
    const item = {
      datetime: String(c.datetime || ""),
      open: finite(c.open, NaN),
      high: finite(c.high, NaN),
      low: finite(c.low, NaN),
      close: finite(c.close, NaN)
    };
    if (!item.datetime) continue;
    if (![item.open, item.high, item.low, item.close].every(Number.isFinite)) continue;
    if (item.low > Math.min(item.open, item.close) || item.high < Math.max(item.open, item.close)) continue;
    deduped.set(item.datetime, item);
  }
  return [...deduped.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
}

function closedCandlesByMinutes(inputCandles, minutes, nowMs = Date.now()) {
  const candles = sanitize(inputCandles);
  if (!candles.length) return candles;
  const startMs = parseBangkokStart(candles.at(-1)?.datetime);
  if (Number.isFinite(startMs) && nowMs < startMs + minutes * 60 * 1000) return candles.slice(0, -1);
  return candles;
}

export function closedOneMinuteCandles(inputCandles, nowMs = Date.now()) {
  return closedCandlesByMinutes(inputCandles, 1, nowMs);
}

export function closedFiveMinuteCandles(inputCandles, nowMs = Date.now()) {
  return closedCandlesByMinutes(inputCandles, 5, nowMs);
}

function buildSeries(candles) {
  const close = candles.map((c) => c.close);
  return {
    ema9: ema(close, 9),
    ema21: ema(close, 21),
    ema50: ema(close, 50),
    rsi: rsi(close),
    atr: atr(candles),
    macd: macdHistogram(close)
  };
}

function featureVector(candles, index, series) {
  if (index < 55) return null;
  const c = candles[index];
  const a = Math.max(finite(series.atr[index], 0), 1e-9);
  if (![series.ema9[index], series.ema21[index], series.ema50[index], series.rsi[index]].every(Number.isFinite)) return null;
  const range = Math.max(c.high - c.low, 1e-9);
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  const returns = [1, 2, 3, 6, 12].map((n) => clamp((c.close - candles[index - n].close) / a, -8, 8));
  const recent = candles.slice(index - 20, index);
  const recentHigh = Math.max(...recent.map((x) => x.high));
  const recentLow = Math.min(...recent.map((x) => x.low));
  const recentAtr = series.atr.slice(Math.max(0, index - 30), index).filter(Number.isFinite);
  const avgAtr = recentAtr.length ? recentAtr.reduce((s, v) => s + v, 0) / recentAtr.length : a;
  return [
    clamp((c.close - c.open) / a, -4, 4),
    clamp((c.high - bodyHigh) / a, 0, 4),
    clamp((bodyLow - c.low) / a, 0, 4),
    clamp(((c.close - c.low) / range - 0.5) * 2, -1, 1),
    ...returns,
    clamp((series.ema9[index] - series.ema21[index]) / a, -8, 8),
    clamp((series.ema21[index] - series.ema50[index]) / a, -10, 10),
    clamp((series.ema9[index] - series.ema9[index - 3]) / a, -5, 5),
    clamp((series.rsi[index] - 50) / 25, -2, 2),
    clamp(finite(series.macd[index], 0) / a, -4, 4),
    clamp(a / Math.max(avgAtr, 1e-9), 0.25, 4),
    clamp((recentHigh - c.close) / a, -2, 12),
    clamp((c.close - recentLow) / a, -2, 12)
  ];
}

function distance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    total += d * d;
  }
  return Math.sqrt(total / a.length);
}

function futureCandleOutcome(candles, index, horizon, atrValue) {
  if (index + horizon >= candles.length) return "SIDEWAY";
  const future = candles[index + horizon];
  const body = future.close - future.open;
  const threshold = Math.max(atrValue * 0.045, 0.03);
  if (body >= threshold) return "UP";
  if (body <= -threshold) return "DOWN";
  return "SIDEWAY";
}

function probabilities(matches, horizon) {
  const counts = { UP: 1.5, DOWN: 1.5, SIDEWAY: 1.5 };
  for (const match of matches) counts[match.outcomes[horizon - 1]] += match.weight;
  const total = counts.UP + counts.DOWN + counts.SIDEWAY;
  const up = Math.round(counts.UP / total * 100);
  const down = Math.round(counts.DOWN / total * 100);
  return { up, down, sideway: 100 - up - down };
}

function buildMemory(candles, series, currentIndex = candles.length - 1) {
  const current = featureVector(candles, currentIndex, series);
  if (!current) return null;
  const raw = [];

  for (let index = 55; index <= currentIndex - 5; index += 1) {
    const vector = featureVector(candles, index, series);
    if (!vector) continue;
    const d = distance(current, vector);
    const similarity = clamp(1 - d / 3.2, 0, 1);
    const a = Math.max(finite(series.atr[index], 0), 0.01);
    raw.push({
      index,
      distance: d,
      similarity,
      outcomes: [1, 2, 3, 4, 5].map((h) => futureCandleOutcome(candles, index, h, a))
    });
  }

  raw.sort((a, b) => a.distance - b.distance);
  const target = Math.min(120, Math.max(40, Math.floor(raw.length * 0.22)));
  const selected = raw.slice(0, target).map((item) => ({
    ...item,
    weight: Math.pow(Math.max(0.04, item.similarity), 3) / Math.max(0.08, item.distance)
  }));

  const forecasts = [1, 2, 3, 4, 5].map((horizon) => {
    const p = probabilities(selected, horizon);
    const ranked = Object.entries(p).sort((a, b) => b[1] - a[1]);
    const [leader, runnerUp] = ranked;
    const rawDirection = leader[0] === "up" ? "BUY" : leader[0] === "down" ? "SELL" : "WAIT";
    const direction = leader[1] >= 43 && leader[1] - runnerUp[1] >= 6 ? rawDirection : "WAIT";
    return {
      candle: horizon,
      minutesAhead: horizon * 5,
      direction,
      confidence: leader[1],
      edge: leader[1] - runnerUp[1],
      probabilities: p
    };
  });

  const averageSimilarity = selected.length
    ? Math.round(selected.reduce((s, m) => s + m.similarity, 0) / selected.length * 100)
    : 0;

  return {
    engine: "Five-Candle DNA Weighted KNN",
    sourceCandles: currentIndex + 1,
    usableHistoricalCases: raw.length,
    matchedCases: selected.length,
    averageSimilarity,
    forecasts
  };
}

function directionToOutcome(direction) {
  if (direction === "BUY") return "UP";
  if (direction === "SELL") return "DOWN";
  return "SIDEWAY";
}

function walkForward(candles, series) {
  const perCandle = [1, 2, 3, 4, 5].map((candle) => ({ candle, samples: 0, correct: 0, directional: 0, directionalCorrect: 0 }));
  let anchors = 0;
  let predictions = 0;
  let correct = 0;
  let directional = 0;
  let directionalCorrect = 0;
  let exactFiveSamples = 0;
  let exactFiveCorrect = 0;
  const start = Math.max(125, candles.length - 320);
  const end = candles.length - 6;

  for (let anchor = start; anchor <= end; anchor += 2) {
    const memory = buildMemory(candles, series, anchor);
    if (!memory?.forecasts?.length) continue;
    anchors += 1;
    let allFiveDirectional = true;
    let allFiveCorrect = true;

    for (let h = 1; h <= 5; h += 1) {
      const forecast = memory.forecasts[h - 1];
      const predicted = directionToOutcome(forecast.direction);
      const a = Math.max(finite(series.atr[anchor], 0), 0.01);
      const actual = futureCandleOutcome(candles, anchor, h, a);
      const slot = perCandle[h - 1];
      slot.samples += 1;
      predictions += 1;
      if (predicted === actual) {
        slot.correct += 1;
        correct += 1;
      }
      if (forecast.direction === "BUY" || forecast.direction === "SELL") {
        slot.directional += 1;
        directional += 1;
        if (predicted === actual) {
          slot.directionalCorrect += 1;
          directionalCorrect += 1;
        } else {
          allFiveCorrect = false;
        }
      } else {
        allFiveDirectional = false;
        allFiveCorrect = false;
      }
    }

    if (allFiveDirectional) {
      exactFiveSamples += 1;
      if (allFiveCorrect) exactFiveCorrect += 1;
    }
  }

  return {
    mode: "no-lookahead-walk-forward",
    anchors,
    allAccuracy: predictions ? Math.round(correct / predictions * 100) : null,
    directionalAccuracy: directional ? Math.round(directionalCorrect / directional * 100) : null,
    directionalCoverage: predictions ? Math.round(directional / predictions * 100) : 0,
    exactFive: {
      samples: exactFiveSamples,
      correct: exactFiveCorrect,
      accuracy: exactFiveSamples ? Math.round(exactFiveCorrect / exactFiveSamples * 100) : null
    },
    perCandle: perCandle.map((slot) => ({
      candle: slot.candle,
      samples: slot.samples,
      accuracy: slot.samples ? Math.round(slot.correct / slot.samples * 100) : null,
      directionalSamples: slot.directional,
      directionalAccuracy: slot.directional ? Math.round(slot.directionalCorrect / slot.directional * 100) : null,
      directionalCoverage: slot.samples ? Math.round(slot.directional / slot.samples * 100) : 0
    }))
  };
}

function integrity(candles) {
  let gaps = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const a = parseBangkokStart(candles[i - 1].datetime);
    const b = parseBangkokStart(candles[i].datetime);
    if (Number.isFinite(a) && Number.isFinite(b) && b - a > 5 * 60 * 1000 + 1000) gaps += 1;
  }
  return { ok: gaps === 0, gaps, candles: candles.length };
}

export function analyzeFiveCandleTruth(inputCandles) {
  const sanitized = sanitize(inputCandles);
  const candles = closedFiveMinuteCandles(sanitized);
  const droppedOpenCandle = sanitized.length - candles.length;
  if (candles.length < 140) {
    return { ready: false, reason: "ต้องมีแท่ง 5M ที่ปิดแล้วอย่างน้อย 140 แท่ง", closedCandlePolicy: "closed-only" };
  }
  const series = buildSeries(candles);
  const memory = buildMemory(candles, series);
  const validation = walkForward(candles, series);
  return {
    ready: true,
    engine: "GOLD PULSE X v11.0 R1 Five-Candle Truth",
    mode: "shadow-audit",
    changesTradeDecision: false,
    closedCandlePolicy: "closed-only",
    droppedOpenCandle,
    lastClosedCandleAt: candles.at(-1)?.datetime || null,
    integrity: integrity(candles),
    patternMemory: memory,
    validation,
    note: "ทำนายทิศของแท่ง 5M ถัดไป #1-#5 และวัดแบบ no-lookahead walk-forward; เป็นความน่าจะเป็น ไม่ใช่การรับประกันอนาคต"
  };
}
