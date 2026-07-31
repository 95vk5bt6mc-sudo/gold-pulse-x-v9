import { historicalPatternForecast } from "./patternEngine";

export function ema(values, period) {
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < values.length; i += 1) {
    value = values[i] * k + value * (1 - k);
    out[i] = value;
  }
  return out;
}

export function rsi(values, period = 14) {
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

export function atr(candles, period = 14) {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prev = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;
  let value = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < tr.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
    out[i] = value;
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line = values.map((_, i) =>
    fastLine[i] != null && slowLine[i] != null ? fastLine[i] - slowLine[i] : null
  );
  const compact = line.filter((v) => v != null);
  const compactSignal = ema(compact, signalPeriod);
  const signal = Array(values.length).fill(null);
  let j = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (line[i] != null) signal[i] = compactSignal[j++];
  }
  return {
    line,
    signal,
    histogram: line.map((v, i) =>
      v != null && signal[i] != null ? v - signal[i] : null
    )
  };
}

export function adx(candles, period = 14) {
  const plusDM = Array(candles.length).fill(0);
  const minusDM = Array(candles.length).fill(0);
  const tr = Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  const smooth = (arr) => {
    const out = Array(arr.length).fill(null);
    if (arr.length <= period) return out;
    let sum = arr.slice(1, period + 1).reduce((a, b) => a + b, 0);
    out[period] = sum;
    for (let i = period + 1; i < arr.length; i += 1) {
      sum = sum - sum / period + arr[i];
      out[i] = sum;
    }
    return out;
  };

  const trS = smooth(tr);
  const plusS = smooth(plusDM);
  const minusS = smooth(minusDM);
  const dx = Array(candles.length).fill(null);
  const plusDI = Array(candles.length).fill(null);
  const minusDI = Array(candles.length).fill(null);

  for (let i = period; i < candles.length; i += 1) {
    if (!trS[i]) continue;
    plusDI[i] = 100 * plusS[i] / trS[i];
    minusDI[i] = 100 * minusS[i] / trS[i];
    const denom = plusDI[i] + minusDI[i];
    dx[i] = denom ? 100 * Math.abs(plusDI[i] - minusDI[i]) / denom : 0;
  }

  const adxOut = Array(candles.length).fill(null);
  const start = period * 2;
  if (candles.length > start) {
    let sum = dx.slice(period, start).filter((v) => v != null).reduce((a, b) => a + b, 0);
    adxOut[start - 1] = sum / period;
    for (let i = start; i < candles.length; i += 1) {
      adxOut[i] = ((adxOut[i - 1] || 0) * (period - 1) + (dx[i] || 0)) / period;
    }
  }

  return { adx: adxOut, plusDI, minusDI };
}

export function supportResistance(candles, lookback = 60) {
  const window = candles.slice(-lookback);
  if (!window.length) return { support: null, resistance: null };
  const lows = window.map((c) => c.low).sort((a, b) => a - b);
  const highs = window.map((c) => c.high).sort((a, b) => a - b);
  return {
    support: lows[Math.floor(lows.length * 0.15)],
    resistance: highs[Math.floor(highs.length * 0.85)]
  };
}

function featureAt(candles, index) {
  if (index < 205) return null;
  const close = candles.map((c) => c.close);
  const e9 = ema(close, 9);
  const e21 = ema(close, 21);
  const e50 = ema(close, 50);
  const e200 = ema(close, 200);
  const rs = rsi(close, 14);
  const at = atr(candles, 14);
  const m = macd(close);
  const d = adx(candles);

  if ([e9[index], e21[index], e50[index], e200[index], rs[index], at[index]].some((v) => v == null)) {
    return null;
  }

  const A = Math.max(at[index], 1e-9);
  const range = Math.max(candles[index].high - candles[index].low, 1e-9);
  const body = (candles[index].close - candles[index].open) / A;
  const closeLocation = ((candles[index].close - candles[index].low) / range - 0.5) * 2;
  const slope = (e9[index] - e9[index - 3]) / A;
  const roc3 = (close[index] - close[index - 3]) / A;
  const roc6 = (close[index] - close[index - 6]) / A;
  const histogram = m.histogram[index] || 0;
  const oldHistogram = m.histogram[index - 2] || 0;
  const adxValue = d.adx[index] || 0;
  const plusDI = d.plusDI[index] || 0;
  const minusDI = d.minusDI[index] || 0;

  let score = 0;
  score += close[index] > e9[index] ? 0.65 : -0.65;
  score += e9[index] > e21[index] ? 1.1 : -1.1;
  score += e21[index] > e50[index] ? 0.65 : -0.65;
  score += e50[index] > e200[index] ? 0.45 : -0.45;
  score += slope > 0 ? Math.min(1.0, Math.abs(slope)) : -Math.min(1.0, Math.abs(slope));
  score += roc3 > 0 ? Math.min(0.85, Math.abs(roc3)) : -Math.min(0.85, Math.abs(roc3));
  score += roc6 > 0 ? 0.4 : -0.4;
  score += rs[index] > 56 ? 0.75 : rs[index] < 44 ? -0.75 : 0;
  score += body > 0 ? Math.min(0.65, Math.abs(body)) : -Math.min(0.65, Math.abs(body));
  score += closeLocation * 0.35;
  score += histogram > 0 ? 0.5 : histogram < 0 ? -0.5 : 0;
  score += histogram > oldHistogram ? 0.25 : -0.25;
  score += plusDI > minusDI ? 0.4 : -0.4;
  if (adxValue < 16) score *= 0.72;

  return {
    score,
    ema9: e9[index],
    ema21: e21[index],
    ema50: e50[index],
    ema200: e200[index],
    rsi: rs[index],
    atr: at[index],
    macd: m.line[index],
    macdSignal: m.signal[index],
    macdHistogram: histogram,
    adx: adxValue,
    plusDI,
    minusDI,
    roc3,
    slope
  };
}

function direction(score) {
  if (score >= 2.35) return "BUY";
  if (score <= -2.35) return "SELL";
  return "WAIT";
}

function futureLabel(candles, index, feature, horizon = 3) {
  if (!feature || index + horizon >= candles.length) return null;
  const start = candles[index].close;
  const end = candles[index + horizon].close;
  const threshold = Math.max(feature.atr * 0.22, 0.08);
  let above = 0;
  let below = 0;
  for (let k = 1; k <= horizon; k += 1) {
    if (candles[index + k].close > start) above += 1;
    if (candles[index + k].close < start) below += 1;
  }
  if (end - start >= threshold && above >= 2) return "BUY";
  if (start - end >= threshold && below >= 2) return "SELL";
  return "WAIT";
}

function thaiReasons(feature, levels, price) {
  const reasons = [];
  if (feature.ema9 > feature.ema21) reasons.push("EMA 9 อยู่เหนือ EMA 21");
  else reasons.push("EMA 9 อยู่ต่ำกว่า EMA 21");

  if (feature.ema50 > feature.ema200) reasons.push("แนวโน้มหลัก EMA 50/200 เป็นบวก");
  else reasons.push("แนวโน้มหลัก EMA 50/200 เป็นลบ");

  if (feature.rsi >= 56) reasons.push("RSI สนับสนุนแรงซื้อ");
  else if (feature.rsi <= 44) reasons.push("RSI สนับสนุนแรงขาย");
  else reasons.push("RSI อยู่ในโซนกลาง");

  if (feature.adx >= 22) reasons.push("ADX บ่งชี้ว่ามีแนวโน้มค่อนข้างชัด");
  else reasons.push("ADX ต่ำ ตลาดอาจแกว่งตัว");

  if (price && levels.support && Math.abs(price - levels.support) < feature.atr * 0.8) {
    reasons.push("ราคาอยู่ใกล้แนวรับ");
  }
  if (price && levels.resistance && Math.abs(price - levels.resistance) < feature.atr * 0.8) {
    reasons.push("ราคาอยู่ใกล้แนวต้าน");
  }

  return reasons;
}

function horizonStats(candles, currentFeature, horizon) {
  const currentDirection = direction(currentFeature.score);
  let similar = 0;
  let similarWin = 0;
  let decided = 0;
  let decidedWin = 0;

  for (let j = 205; j < candles.length - horizon; j += 1) {
    const historical = featureAt(candles, j);
    if (!historical) continue;
    const prediction = direction(historical.score);
    const actual = futureLabel(candles, j, historical, horizon);

    if (prediction !== "WAIT") {
      decided += 1;
      if (prediction === actual) decidedWin += 1;
    }

    if (
      prediction === currentDirection &&
      Math.abs(historical.score - currentFeature.score) <= 1.25
    ) {
      similar += 1;
      if (prediction === actual) similarWin += 1;
    }
  }

  const patternAccuracy = similar ? similarWin / similar : 0;
  const overallAccuracy = decided ? decidedWin / decided : 0;
  return { similar, patternAccuracy, decided, overallAccuracy };
}

function forecastForHorizon(candles, feature, horizon) {
  const stats = horizonStats(candles, feature, horizon);
  const decay = 1 - (horizon - 1) * 0.12;
  const adjustedScore = feature.score * decay;
  const rawDirection = direction(adjustedScore);
  let dir = rawDirection;
  const strength = Math.min(1, Math.abs(adjustedScore) / 5.8);
  const weakTrend = feature.adx < 17;
  const conflictingMomentum =
    (adjustedScore > 0 && feature.macdHistogram < 0) ||
    (adjustedScore < 0 && feature.macdHistogram > 0);
  let waitReason = "";
  if (weakTrend) {
    dir = "WAIT";
    waitReason = "ADX ต่ำ แนวโน้มยังไม่ชัด";
  } else if (horizon === 1 && conflictingMomentum && Math.abs(adjustedScore) < 3.1) {
    dir = "WAIT";
    waitReason = "Momentum ขัดกับทิศทางหลัก";
  }

  const trendQuality = Math.min(1, feature.adx / 30);
  const historical = stats.patternAccuracy || stats.overallAccuracy || 0.5;
  const confidence = dir === "WAIT"
    ? Math.round(Math.min(90, Math.max(45, 48 + (1 - trendQuality) * 24 + (conflictingMomentum ? 10 : 0))))
    : Math.round(Math.min(92, Math.max(42, historical * 55 + strength * 28 + trendQuality * 17)));

  let buy = Math.max(4, Math.min(92, 50 + adjustedScore * 7.2));
  let sell = Math.max(4, Math.min(92, 50 - adjustedScore * 7.2));
  let wait = Math.max(6, Math.min(70, 58 - Math.abs(adjustedScore) * 9));

  if (dir === "WAIT") {
    wait = Math.max(wait, weakTrend ? 62 : 54);
    buy *= 0.72;
    sell *= 0.72;
  }

  const total = buy + sell + wait;
  const buyPct = Math.round((buy / total) * 100);
  const sellPct = Math.round((sell / total) * 100);
  const waitPct = 100 - buyPct - sellPct;

  return {
    candle: horizon,
    direction: dir,
    rawDirection,
    waitReason,
    confidence,
    probabilities: { buy: buyPct, sell: sellPct, wait: waitPct },
    backtestSamples: stats.similar,
    backtestAccuracy: Math.round(stats.patternAccuracy * 100)
  };
}

export function analyze(candles, horizon = 3) {
  const index = candles.length - 1;
  const feature = featureAt(candles, index);
  if (!feature) throw new Error("ข้อมูลแท่งไม่เพียงพอสำหรับ EMA 200");

  const forecasts = [1, 2, 3, 4, 5].map((h) => forecastForHorizon(candles, feature, h));
  const dir = forecasts[0].direction;
  const stats = horizonStats(candles, feature, horizon);
  const recentAtr = atr(candles, 14).slice(-60).filter((v) => v != null);
  const atrAverage = recentAtr.length ? recentAtr.reduce((a, b) => a + b, 0) / recentAtr.length : feature.atr;
  const volatilityRatio = atrAverage ? feature.atr / atrAverage : 1;

  const bullishAlignment =
    Number(feature.ema9 > feature.ema21) +
    Number(feature.ema21 > feature.ema50) +
    Number(feature.ema50 > feature.ema200);
  const bearishAlignment =
    Number(feature.ema9 < feature.ema21) +
    Number(feature.ema21 < feature.ema50) +
    Number(feature.ema50 < feature.ema200);
  const alignment = Math.max(bullishAlignment, bearishAlignment);
  const trendScore = Math.round(Math.min(100, Math.max(0,
    alignment * 20 +
    Math.min(20, feature.adx / 2) +
    Math.min(20, Math.abs(feature.slope) * 18)
  )));

  const momentumRaw = 50 + feature.roc3 * 14 + feature.slope * 10 +
    (feature.macdHistogram > 0 ? 12 : -12) +
    (feature.rsi > 55 ? 10 : feature.rsi < 45 ? -10 : 0);
  const momentumScore = Math.round(Math.min(100, Math.max(0, momentumRaw)));

  const marketCondition = feature.adx < 17
    ? "SIDEWAY"
    : volatilityRatio > 1.35
      ? "VOLATILE"
      : "TRENDING";

  const reliability = Math.round(Math.min(95, Math.max(25,
    (stats.patternAccuracy || stats.overallAccuracy || 0.5) * 62 +
    Math.min(1, feature.adx / 30) * 23 +
    (marketCondition === "TRENDING" ? 10 : marketCondition === "VOLATILE" ? 3 : 0)
  )));

  const levels = supportResistance(candles, 60);
  const price = candles[index].close;
  const distanceToSupport = levels.support != null ? Math.abs(price - levels.support) / Math.max(feature.atr, 1e-9) : 99;
  const distanceToResistance = levels.resistance != null ? Math.abs(levels.resistance - price) / Math.max(feature.atr, 1e-9) : 99;
  const nearBlockingLevel = (dir === "BUY" && distanceToResistance < 0.8) || (dir === "SELL" && distanceToSupport < 0.8);
  const riskPoints =
    (volatilityRatio > 1.35 ? 35 : volatilityRatio < 0.75 ? 8 : 18) +
    (feature.adx < 17 ? 28 : feature.adx > 35 ? 16 : 10) +
    (nearBlockingLevel ? 28 : 6);
  const riskLevel = riskPoints >= 65 ? "HIGH" : riskPoints >= 38 ? "MEDIUM" : "LOW";
  const alignmentBonus = trendScore * 0.28;
  const momentumDirectional = dir === "BUY" ? momentumScore : dir === "SELL" ? 100 - momentumScore : 50;
  const entryScore = Math.round(Math.max(0, Math.min(100,
    forecasts[0].confidence * 0.34 +
    reliability * 0.30 +
    alignmentBonus +
    momentumDirectional * 0.14 -
    (riskLevel === "HIGH" ? 18 : riskLevel === "MEDIUM" ? 7 : 0) -
    (nearBlockingLevel ? 12 : 0)
  )));
  const entryNote = dir === "WAIT"
    ? "รอสัญญาณชัดขึ้น"
    : nearBlockingLevel
      ? "ใกล้แนวรับ/แนวต้าน ควรระวัง"
      : entryScore >= 72
        ? "เงื่อนไขสอดคล้องค่อนข้างดี"
        : entryScore >= 55
          ? "เงื่อนไขปานกลาง ต้องคุมความเสี่ยง"
          : "คะแนนเข้าอ่อน ควรรอ";
  const confidence = Math.round(Math.max(0, Math.min(92, forecasts[0].confidence - (riskLevel === "HIGH" ? 7 : 0) - (nearBlockingLevel ? 5 : 0))));

  return {
    direction: dir,
    confidence,
    waitReason: forecasts[0].waitReason,
    reliability,
    riskLevel,
    riskPoints,
    entryScore,
    entryNote,
    score: Number(feature.score.toFixed(2)),
    horizon,
    forecasts,
    trendScore,
    trendBias: feature.ema9 > feature.ema21 && feature.ema21 > feature.ema50
      ? "BULLISH"
      : feature.ema9 < feature.ema21 && feature.ema21 < feature.ema50
        ? "BEARISH"
        : "MIXED",
    momentumScore,
    momentumState: momentumScore >= 62
      ? "INCREASING"
      : momentumScore <= 38
        ? "DECREASING"
        : "NEUTRAL",
    marketCondition,
    volatility: volatilityRatio > 1.35 ? "HIGH" : volatilityRatio < 0.75 ? "LOW" : "NORMAL",
    indicators: feature,
    levels,
    reasons: thaiReasons(feature, levels, price),
    backtest: {
      patternSamples: stats.similar,
      patternAccuracy: Math.round(stats.patternAccuracy * 100),
      decidedSamples: stats.decided,
      decidedAccuracy: Math.round(stats.overallAccuracy * 100)
    },
    threshold: Math.max(feature.atr * 0.22, 0.08),
    historicalPattern: historicalPatternForecast(candles)
  };
}
