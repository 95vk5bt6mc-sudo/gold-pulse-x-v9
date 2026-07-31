import { ema, rsi, atr, macd, adx } from "./indicators";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const safe = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

function candleState(candles, index, atrSeries) {
  if (index <= 0 || index >= candles.length) return "WAIT";
  const a = Math.max(safe(atrSeries[index], 0), 1e-9);
  const move = candles[index].close - candles[index - 1].close;
  const threshold = Math.max(a * 0.12, 0.05);
  if (move >= threshold) return "BUY";
  if (move <= -threshold) return "SELL";
  return "WAIT";
}

function featureVector(candles, i, series) {
  if (i < 205 || i >= candles.length - 3) return null;
  const c = candles[i];
  const prev = candles[i - 1];
  const a = Math.max(safe(series.atr[i], 0), 1e-9);
  const range = Math.max(c.high - c.low, 1e-9);
  const body = (c.close - c.open) / a;
  const upper = (c.high - Math.max(c.open, c.close)) / a;
  const lower = (Math.min(c.open, c.close) - c.low) / a;
  const closeLocation = ((c.close - c.low) / range - 0.5) * 2;
  const hour = Number(String(c.datetime).slice(11, 13));
  const minute = Number(String(c.datetime).slice(14, 16));
  const tod = ((hour * 60 + minute) / 1440) * Math.PI * 2;
  return [
    clamp(body, -3, 3),
    clamp(upper, 0, 3),
    clamp(lower, 0, 3),
    clamp(closeLocation, -1, 1),
    clamp((c.close - prev.close) / a, -3, 3),
    clamp((c.close - candles[i - 3].close) / a, -5, 5),
    clamp((c.close - candles[i - 6].close) / a, -7, 7),
    clamp((series.e9[i] - series.e21[i]) / a, -6, 6),
    clamp((series.e21[i] - series.e50[i]) / a, -8, 8),
    clamp((series.e50[i] - series.e200[i]) / a, -12, 12),
    clamp((series.e9[i] - series.e9[i - 3]) / a, -4, 4),
    clamp((safe(series.rsi[i], 50) - 50) / 25, -2, 2),
    clamp(safe(series.macd.histogram[i], 0) / a, -3, 3),
    clamp(safe(series.adx.adx[i], 0) / 50, 0, 2),
    clamp((safe(series.adx.plusDI[i], 0) - safe(series.adx.minusDI[i], 0)) / 50, -2, 2),
    Math.sin(tod),
    Math.cos(tod)
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

function normalizeCounts(counts, alpha = 2) {
  const keys = ["BUY", "SELL", "WAIT"];
  const total = keys.reduce((s, k) => s + (counts[k] || 0) + alpha, 0);
  const pct = {};
  keys.forEach((k) => { pct[k.toLowerCase()] = Math.round(((counts[k] || 0) + alpha) / total * 100); });
  const delta = 100 - pct.buy - pct.sell - pct.wait;
  pct.wait += delta;
  return pct;
}

function weightedPrediction(matches, horizon) {
  const counts = { BUY: 0, SELL: 0, WAIT: 0 };
  for (const match of matches) {
    counts[match.sequence[horizon - 1]] += match.weight;
  }
  return normalizeCounts(counts, 1.5);
}

function topSequences(matches, limit = 5) {
  const counts = new Map();
  let total = 0;
  for (const match of matches) {
    const key = match.sequence.join(" → ");
    counts.set(key, (counts.get(key) || 0) + match.weight);
    total += match.weight;
  }
  return [...counts.entries()]
    .map(([sequence, weight]) => ({ sequence, probability: total ? Math.round(weight / total * 1000) / 10 : 0 }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, limit);
}

function decide(probabilities) {
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  const direction = first[0].toUpperCase();
  const edge = first[1] - second[1];
  if (first[1] < 42 || edge < 6) return { direction: "WAIT", confidence: first[1], edge };
  return { direction, confidence: first[1], edge };
}

function validationAccuracy(features, candles, atrSeries, start, end) {
  let tested = 0;
  let correct = 0;
  for (let i = start; i < end; i += 4) {
    const target = features[i];
    if (!target) continue;
    const candidates = [];
    for (let j = 205; j < i - 10; j += 1) {
      if (!features[j]) continue;
      const d = distance(target, features[j]);
      candidates.push({ d, state: candleState(candles, j + 1, atrSeries) });
    }
    candidates.sort((a, b) => a.d - b.d);
    const nearest = candidates.slice(0, 80);
    if (nearest.length < 30) continue;
    const counts = { BUY: 0, SELL: 0, WAIT: 0 };
    nearest.forEach((m) => { counts[m.state] += 1 / Math.max(0.08, m.d); });
    const pred = decide(normalizeCounts(counts, 1));
    const actual = candleState(candles, i + 1, atrSeries);
    tested += 1;
    if (pred.direction === actual) correct += 1;
  }
  return { samples: tested, accuracy: tested ? Math.round(correct / tested * 100) : 0 };
}

export function historicalPatternForecast(candles) {
  if (!Array.isArray(candles) || candles.length < 400) return null;
  const close = candles.map((c) => c.close);
  const series = {
    e9: ema(close, 9),
    e21: ema(close, 21),
    e50: ema(close, 50),
    e200: ema(close, 200),
    rsi: rsi(close, 14),
    atr: atr(candles, 14),
    macd: macd(close),
    adx: adx(candles, 14)
  };
  const features = candles.map((_, i) => featureVector(candles, i, series));
  const currentIndex = candles.length - 4;
  const current = features[currentIndex];
  if (!current) return null;

  const raw = [];
  for (let i = 205; i < currentIndex - 10; i += 1) {
    if (!features[i]) continue;
    const d = distance(current, features[i]);
    const sequence = [1, 2, 3].map((h) => candleState(candles, i + h, series.atr));
    raw.push({ index: i, distance: d, similarity: clamp(1 - d / 2.6, 0, 1), sequence });
  }
  raw.sort((a, b) => a.distance - b.distance);
  const sampleTarget = Math.min(600, Math.max(180, Math.floor(raw.length * 0.14)));
  const selected = raw.slice(0, sampleTarget).map((m) => ({
    ...m,
    weight: Math.pow(Math.max(0.05, m.similarity), 3) / Math.max(0.06, m.distance)
  }));

  const forecasts = [1, 2, 3].map((h) => {
    const probabilities = weightedPrediction(selected, h);
    const decision = decide(probabilities);
    return { candle: h, ...decision, probabilities };
  });
  const avgSimilarity = selected.length ? selected.reduce((s, m) => s + m.similarity, 0) / selected.length : 0;
  const validationStart = Math.max(260, candles.length - 900);
  const validationEnd = Math.max(validationStart, candles.length - 10);
  const validation = validationAccuracy(features, candles, series.atr, validationStart, validationEnd);

  return {
    engine: "Weighted KNN + Bayesian smoothing",
    sourceCandles: candles.length,
    usableHistoricalCases: raw.length,
    matchedCases: selected.length,
    averageSimilarity: Math.round(avgSimilarity * 100),
    minimumSimilarity: selected.length ? Math.round(selected[selected.length - 1].similarity * 100) : 0,
    forecasts,
    topSequences: topSequences(selected, 5),
    validation,
    currentPatternAt: candles[currentIndex]?.datetime || null,
    note: "คำนวณจากแท่งย้อนหลังที่โหลดในรอบปัจจุบัน ไม่ใช่โมเดลรับประกันผลกำไร"
  };
}
