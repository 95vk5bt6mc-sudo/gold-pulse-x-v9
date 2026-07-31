import { NextResponse } from "next/server";
import { analyze } from "../../../lib/indicators";
import { getProvider } from "../../../lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const DATA_TTL_MS = 240 * 1000;
const STALE_TTL_MS = 20 * 60 * 1000;
const UPSTREAM_CALLS_PER_REFRESH = 2;
const DAILY_CREDIT_LIMIT = 800;
const PLANNED_ACTIVE_HOURS = 23;
const ESTIMATED_DAILY_CREDITS = Math.ceil(
  (PLANNED_ACTIVE_HOURS * 60 * 60 * UPSTREAM_CALLS_PER_REFRESH) / (DATA_TTL_MS / 1000)
);

const globalStore = globalThis.__goldPulseStableStore || {
  clients: new Map(),
  cache: null,
  cacheAt: 0,
  inFlight: null,
};
globalThis.__goldPulseStableStore = globalStore;

function getNewYorkParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { weekday: map.weekday, hour: Number(map.hour), minute: Number(map.minute) };
}

function isSpotGoldOpen(date = new Date()) {
  const ny = getNewYorkParts(date);
  if (ny.weekday === "Sat") return false;
  if (ny.weekday === "Fri" && ny.hour >= 17) return false;
  if (ny.weekday === "Sun" && ny.hour < 18) return false;
  // Typical weekday maintenance break for spot gold: 17:00–18:00 New York.
  if (["Mon", "Tue", "Wed", "Thu"].includes(ny.weekday) && ny.hour === 17) return false;
  return true;
}

function nextMarketOpen(from = new Date()) {
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  for (let i = 1; i <= 72 * 60; i += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    if (isSpotGoldOpen(cursor)) return cursor.toISOString();
  }
  return null;
}

function marketState(date = new Date()) {
  const open = isSpotGoldOpen(date);
  const ny = getNewYorkParts(date);
  const dailyBreak = ["Mon", "Tue", "Wed", "Thu"].includes(ny.weekday) && ny.hour === 17;
  return {
    isOpen: open,
    code: open ? "OPEN" : dailyBreak ? "CLOSED_MAINTENANCE" : "CLOSED_WEEKEND",
    label: open ? "MARKET OPEN" : "MARKET CLOSED",
    reason: open ? "Spot gold session active" : dailyBreak ? "Daily market maintenance break" : "Weekend break",
    checkedAt: date.toISOString(),
    nextOpenAt: open ? null : nextMarketOpen(date)
  };
}

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim();
}

function rateLimit(ip) {
  const now = Date.now();
  const current = globalStore.clients.get(ip);
  if (!current || now >= current.resetAt) {
    globalStore.clients.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS };
  }
  current.count += 1;
  return {
    allowed: current.count <= MAX_REQUESTS,
    remaining: Math.max(0, MAX_REQUESTS - current.count),
    resetAt: current.resetAt
  };
}

function normalize(values) {
  const byTime = new Map();
  for (const item of values || []) {
    const candle = {
      datetime: String(item.datetime || ""),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close)
    };
    const validNumbers = [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite);
    const validOhlc = candle.low <= Math.min(candle.open, candle.close) &&
      candle.high >= Math.max(candle.open, candle.close) && candle.high >= candle.low;
    if (!candle.datetime || !validNumbers || !validOhlc) continue;
    byTime.set(candle.datetime, candle);
  }
  return [...byTime.values()].sort((a, b) => a.datetime.localeCompare(b.datetime));
}

async function fetchTimeframe(interval, key) {
  const provider = getProvider();
  const result = await provider.getCandles({
    symbol: "XAU/USD",
    interval,
    outputsize: 500,
    timezone: "Asia/Bangkok",
    apiKey: key
  });
  const candles = result.candles || [];
  if (candles.length < 230) throw new Error(`ข้อมูล ${interval} ไม่เพียงพอ`);
  return candles;
}

function combinedTradeDecision(oneMinute, fiveMinute, price) {
  const f3 = oneMinute?.forecasts?.[2];
  const f5 = oneMinute?.forecasts?.[4];
  const trendBias = fiveMinute?.trendBias || "MIXED";
  const mainTrend = trendBias === "BULLISH" ? "BUY" : trendBias === "BEARISH" ? "SELL" : "WAIT";
  const opposite = mainTrend === "BUY" ? "SELL" : mainTrend === "SELL" ? "BUY" : "WAIT";
  const sameForecast = f3?.direction === f5?.direction && ["BUY", "SELL"].includes(f3?.direction);
  const forecastDirection = sameForecast ? f3.direction : "WAIT";
  const avgForecastProbability = forecastDirection === "WAIT" ? 0 : Math.round(
    ((f3?.probabilities?.[forecastDirection.toLowerCase()] || 0) +
    (f5?.probabilities?.[forecastDirection.toLowerCase()] || 0)) / 2
  );
  const atrValue = Math.max(0.01, Number(oneMinute?.indicators?.atr || 0));
  const rsi = Number(oneMinute?.indicators?.rsi || 50);
  const macd = Number(oneMinute?.indicators?.macdHistogram || 0);
  const support = Number(oneMinute?.levels?.support);
  const resistance = Number(oneMinute?.levels?.resistance);
  const nearSupport = Number.isFinite(support) && price - support <= Math.max(atrValue * 0.9, 0.35);
  const nearResistance = Number.isFinite(resistance) && resistance - price <= Math.max(atrValue * 0.9, 0.35);
  const oversold = rsi <= 38;
  const overbought = rsi >= 62;
  const momentumBuy = macd > 0 || rsi >= 52;
  const momentumSell = macd < 0 || rsi <= 48;
  const momentumAligned = forecastDirection === "BUY" ? momentumBuy : forecastDirection === "SELL" ? momentumSell : false;
  const reversalSetup = (forecastDirection === "BUY" && (oversold || nearSupport) && macd >= -Math.max(atrValue * 0.02, 0.015)) ||
    (forecastDirection === "SELL" && (overbought || nearResistance) && macd <= Math.max(atrValue * 0.02, 0.015));
  const trendAligned = forecastDirection !== "WAIT" && forecastDirection === mainTrend;
  const counterTrend = forecastDirection !== "WAIT" && forecastDirection === opposite && reversalSetup;
  const setupValid = trendAligned || counterTrend || (forecastDirection !== "WAIT" && momentumAligned);
  const riskHigh = oneMinute?.riskLevel === "HIGH";

  const historical = oneMinute?.historicalPattern;
  const validationSamples = Number(historical?.validation?.samples || 0);
  const validationAccuracy = Number(historical?.validation?.accuracy || 0);
  const patternSamples = Number(oneMinute?.backtest?.patternSamples || 0);
  const patternAccuracy = Number(oneMinute?.backtest?.patternAccuracy || 0);
  const sampleQuality = Math.min(100, Math.round((Math.min(validationSamples, 120) / 120) * 70 + (Math.min(patternSamples, 60) / 60) * 30));
  const validationQuality = validationSamples >= 40 ? validationAccuracy : Math.min(validationAccuracy, 58);
  const reliability = Number(oneMinute?.reliability || 0);

  const expectedMoveAbs = Number(Math.max(0.35, atrValue * (counterTrend ? 1.35 : 1.75)).toFixed(2));
  const targetMove = 1.0;
  const trendComponent = trendAligned ? Number(fiveMinute?.trendScore || 50) : counterTrend ? 100 - Number(fiveMinute?.trendScore || 50) : 50;
  const setupBonus = counterTrend && reversalSetup ? 9 : trendAligned ? 7 : momentumAligned ? 4 : 0;
  const rawTargetProbability = forecastDirection === "WAIT" ? 0 : Math.max(0, Math.min(95, Math.round(
    avgForecastProbability * 0.48 +
    Math.min(100, expectedMoveAbs / targetMove * 70) * 0.18 +
    Number(oneMinute?.entryScore || 0) * 0.13 +
    trendComponent * 0.07 +
    reliability * 0.05 +
    validationQuality * 0.04 +
    sampleQuality * 0.02 + setupBonus - (riskHigh ? 16 : 0)
  )));
  const evidenceCap = validationSamples < 10 ? 72 : validationSamples < 20 ? 78 : validationSamples < 40 ? 84 : 90;
  const targetProbability = Math.min(rawTargetProbability, evidenceCap);

  const scoreBreakdown = {
    trend: trendAligned ? 25 : counterTrend ? 16 : 8,
    momentum: momentumAligned ? 20 : 7,
    rsi: forecastDirection === "BUY" ? (rsi >= 48 && rsi <= 68 ? 15 : oversold ? 13 : 5) : forecastDirection === "SELL" ? (rsi >= 32 && rsi <= 52 ? 15 : overbought ? 13 : 5) : 0,
    forecast: sameForecast ? Math.min(20, Math.round(avgForecastProbability * 0.20)) : 0,
    pattern: Math.min(10, Math.round(((validationQuality + patternAccuracy) / 2) * 0.10)),
    volatility: expectedMoveAbs >= 1 ? 10 : expectedMoveAbs >= 0.7 ? 7 : 3
  };
  const signalScoreRaw = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0) - (riskHigh ? 18 : 0);
  const signalScore = Math.max(0, Math.min(100, Math.round(signalScoreRaw)));
  const qaAdvisoryPass = sameForecast && signalScore >= 58 && validationSamples >= 10 && !riskHigh;

  let decision = "NO TRADE";
  let mode = "NONE";
  let status = "WEAK";
  let direction = "WAIT";
  let entryTier = "WAIT";
  const entryEligible = sameForecast && setupValid && !riskHigh && targetProbability >= 70 && signalScore >= 65 && expectedMoveAbs >= 0.65;
  if (entryEligible) {
    direction = forecastDirection;
    mode = counterTrend ? "COUNTER_TREND" : trendAligned ? "TREND" : "MOMENTUM";
    status = "ENTRY";
    if (targetProbability >= 85 && signalScore >= 85) {
      entryTier = "STRONG";
      decision = `STRONG ${direction}`;
    } else if (targetProbability >= 78 && signalScore >= 75) {
      entryTier = "CONFIRMED";
      decision = `CONFIRMED ${direction}`;
    } else {
      entryTier = "EARLY";
      decision = `EARLY ${direction}`;
    }
  } else if (sameForecast && !riskHigh && targetProbability >= 64 && signalScore >= 58) {
    direction = forecastDirection;
    mode = counterTrend ? "COUNTER_TREND" : trendAligned ? "TREND" : "WATCH";
    status = "WATCH";
    entryTier = "WATCH";
    decision = `WATCH ${direction}`;
  } else if (sameForecast && targetProbability >= 60) {
    decision = "SIGNAL WEAKENING — WAIT";
    entryTier = "WEAKENING";
  } else {
    decision = "SIGNAL WEAK — WAIT";
  }

  const sign = direction === "SELL" ? -1 : 1;
  const entryPrice = direction !== "WAIT" ? Number(price.toFixed(2)) : null;
  const tp1Distance = 1.0;
  const tp2Distance = Number(Math.max(1.5, Math.min(3.0, expectedMoveAbs * 1.35)).toFixed(2));
  const tp3Distance = Number(Math.max(tp2Distance + 0.5, Math.min(5.0, expectedMoveAbs * 2.0)).toFixed(2));
  const structuralStop = direction === "BUY" && Number.isFinite(support) ? Math.max(0.55, price - support + 0.12) :
    direction === "SELL" && Number.isFinite(resistance) ? Math.max(0.55, resistance - price + 0.12) : 0;
  const stopDistance = Number(Math.max(0.65, Math.min(2.2, Math.max(atrValue * 0.9, structuralStop))).toFixed(2));
  const tp1 = entryPrice == null ? null : Number((entryPrice + sign * tp1Distance).toFixed(2));
  const tp2 = entryPrice == null ? null : Number((entryPrice + sign * tp2Distance).toFixed(2));
  const tp3 = entryPrice == null ? null : Number((entryPrice + sign * tp3Distance).toFixed(2));
  const stopLoss = entryPrice == null ? null : Number((entryPrice - sign * stopDistance).toFixed(2));
  const rr1 = Number((tp1Distance / stopDistance).toFixed(2));
  const rr2 = Number((tp2Distance / stopDistance).toFixed(2));
  const rr3 = Number((tp3Distance / stopDistance).toFixed(2));
  const tp1Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(95, targetProbability));
  const tp2Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(90, Math.round(targetProbability - Math.max(6, (tp2Distance - 1) * 8))));
  const tp3Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(85, Math.round(targetProbability - Math.max(14, (tp3Distance - 1) * 10))));
  const exitAdvice = status !== "ENTRY" ? "WAIT FOR ENTRY" : targetProbability < 70 || signalScore < 65 ? "EXIT / DO NOT ENTER" : targetProbability < 74 ? "TAKE PROFIT WATCH" : momentumAligned ? "HOLD WITH TP" : "MOMENTUM WEAK — PROTECT PROFIT";

  const reasons = [
    `5M main trend: ${trendBias}`,
    `3-candle forecast: ${f3?.direction || "WAIT"} ${f3?.confidence || 0}%`,
    `5-candle forecast: ${f5?.direction || "WAIT"} ${f5?.confidence || 0}%`,
    `Dynamic score ${signalScore}/100 · probability ${targetProbability}%`,
    `RSI ${Number.isFinite(rsi) ? rsi.toFixed(1) : "—"} · ${nearSupport ? "near support" : nearResistance ? "near resistance" : "mid range"}`
  ];
  if (trendAligned) reasons.push("สัญญาณไปตามเทรนด์หลัก");
  if (counterTrend) reasons.push("พบจังหวะสวนเทรนด์พร้อมเงื่อนไขกลับตัว");
  if (entryEligible) reasons.push("ผ่านเกณฑ์เข้าออร์เดอร์ขั้นต่ำ Probability 70% และ Score 65");
  if (!sameForecast) reasons.push("Forecast 3 และ 5 แท่งยังไม่ตรงกัน");
  if (riskHigh) reasons.push("ตัดสัญญาณเพราะความเสี่ยงสูง");

  return {
    decision, status, mode, direction, entryTier,
    mainTrend: trendBias,
    forecast3: f3 || null,
    forecast5: f5 || null,
    targetDollar: targetMove,
    targetProbability,
    rawTargetProbability,
    probabilityLabel: "MODEL ESTIMATE — NOT VERIFIED WIN RATE",
    expectedMove: direction === "SELL" ? -expectedMoveAbs : expectedMoveAbs,
    targetPrice: tp1,
    entryPrice,
    takeProfit: { tp1, tp2, tp3, tp1Chance, tp2Chance, tp3Chance },
    stopLoss,
    stopDistance,
    riskReward: { tp1: rr1, tp2: rr2, tp3: rr3 },
    expectedHoldingMinutes: direction === "WAIT" ? null : Math.max(3, Math.min(30, Math.ceil(tp1Distance / Math.max(atrValue * 0.35, 0.05)))),
    exitAdvice,
    partialClose: direction === "WAIT" ? null : { tp1: "50%", tp2: "30%", tp3: "20%" },
    entryQuality: signalScore,
    signalScore,
    scoreBreakdown,
    qa: {
      passed: qaAdvisoryPass,
      grade: qaAdvisoryPass ? (signalScore >= 85 ? "A+" : signalScore >= 75 ? "A" : signalScore >= 65 ? "B" : "C") : "ADVISORY",
      validationSamples, validationAccuracy, patternSamples, patternAccuracy, sampleQuality, evidenceCap,
      checks: {
        forecastAgreement: sameForecast,
        adequateSamples: validationSamples >= 10,
        scoreGate: signalScore >= 65,
        riskAccepted: !riskHigh,
        setupValid
      }
    },
    trendAlignment: trendAligned ? Math.round(((oneMinute?.trendScore || 0) + (fiveMinute?.trendScore || 0)) / 2) : counterTrend ? Math.round(100 - ((oneMinute?.trendScore || 0) + (fiveMinute?.trendScore || 0)) / 2) : 0,
    estimatedCandles: expectedMoveAbs > 0 ? Math.max(1, Math.min(12, Math.ceil(targetMove / Math.max(atrValue * 0.45, 0.05)))) : null,
    alertKey: status === "ENTRY" ? `${entryTier}:${mode}:${direction}:${m1SafeTime(oneMinute)}` : null,
    cooldownMinutes: 10,
    reasons,
    note: "เข้าได้เมื่อ Probability ตั้งแต่ 70% พร้อม Dynamic Score และ Risk Gate; TP/SL เป็นค่าประเมินจาก ATR และแนวรับแนวต้าน ไม่รับประกันผลกำไร"
  };
}
function m1SafeTime(analysis) {
  return analysis?.historicalPattern?.currentPatternAt || "latest";
}

function buildPayload(m1, m5, mode = "live") {
  const oneAnalysis = analyze([...m1], 5);
  const fiveAnalysis = analyze([...m5], 5);
  const tradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1.at(-1)?.close || 0);
  return {
    ok: true,
    symbol: "XAU/USD",
    source: `${process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data"} raw OHLC`,
    dataMode: mode,
    updatedAt: new Date().toISOString(),
    market: marketState(),
    dataIntegrity: {
      chartSource: "raw provider OHLC",
      oneMinuteSource: "direct 1min endpoint",
      fiveMinuteSource: "direct 5min endpoint",
      syntheticAggregation: false,
      invalidCandlesDiscarded: true
    },
    refreshPolicy: {
      dashboardSeconds: 20,
      freeTierMode: true,
      liveDataCacheSeconds: DATA_TTL_MS / 1000,
      upstreamCacheSeconds: DATA_TTL_MS / 1000,
      upstreamCallsPerRefresh: UPSTREAM_CALLS_PER_REFRESH,
      estimatedCreditsPerDay: ESTIMATED_DAILY_CREDITS,
      dailyCreditLimit: DAILY_CREDIT_LIMIT,
      estimatedReserveCredits: DAILY_CREDIT_LIMIT - ESTIMATED_DAILY_CREDITS,
      usageMode: "smart session; no fixed time lock"
    },
    oneMinute: { candles: m1.slice(-140), analysis: oneAnalysis },
    fiveMinute: { candles: m5.slice(-140), analysis: fiveAnalysis },
    tradeDecision
  };
}


async function getFreshData(key) {
  const now = Date.now();
  if (globalStore.cache && now - globalStore.cacheAt < DATA_TTL_MS) return globalStore.cache;
  if (globalStore.inFlight) return globalStore.inFlight;

  globalStore.inFlight = (async () => {
    try {
      const [m1, m5] = await Promise.all([
        fetchTimeframe("1min", key),
        fetchTimeframe("5min", key)
      ]);
      const payload = buildPayload(m1, m5, "live");
      // Browser/dashboard requests never send LINE. Only the secret-protected
      // /api/scan endpoint is allowed to evaluate and send automatic alerts.
      payload.lineAlert = { sent: false, reason: "scan-endpoint-only" };
      globalStore.cache = payload;
      globalStore.cacheAt = Date.now();
      return payload;
    } finally {
      globalStore.inFlight = null;
    }
  })();
  return globalStore.inFlight;
}

function closedMarketPayload() {
  const cached = globalStore.cache;
  if (cached) {
    return {
      ...cached,
      dataMode: "last-session-cache",
      market: marketState(),
      refreshPolicy: {
        ...cached.refreshPolicy,
        upstreamCallsPerRefresh: 0,
        estimatedCreditsWhileClosed: 0
      }
    };
  }
  return {
    ok: true,
    symbol: "XAU/USD",
    source: "Session calendar",
    dataMode: "market-closed",
    updatedAt: new Date().toISOString(),
    market: marketState(),
    refreshPolicy: { dashboardSeconds: 300, upstreamCallsPerRefresh: 0 },
    oneMinute: { candles: [], analysis: null },
    fiveMinute: { candles: [], analysis: null }
  };
}

function responseHeaders(limit, cacheControl = "public, s-maxage=235, stale-while-revalidate=300") {
  return {
    "Cache-Control": cacheControl,
    "X-RateLimit-Limit": String(MAX_REQUESTS),
    "X-RateLimit-Remaining": String(limit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
    "X-Robots-Tag": "noindex, nofollow"
  };
}

export async function GET(request) {
  const limit = rateLimit(clientIp(request));
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "เรียกข้อมูลถี่เกินไป กรุณารอสักครู่" },
      { status: 429, headers: { ...responseHeaders(limit, "no-store"), "Retry-After": "300" } }
    );
  }

  if (!isSpotGoldOpen()) {
    return NextResponse.json(closedMarketPayload(), {
      headers: responseHeaders(limit, "public, s-maxage=300, stale-while-revalidate=600")
    });
  }

  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, message: "ยังไม่ได้ตั้งค่า TWELVE_DATA_API_KEY ใน Vercel" },
      { status: 503, headers: responseHeaders(limit, "no-store") }
    );
  }

  try {
    const payload = await getFreshData(key);
    return NextResponse.json(payload, { headers: responseHeaders(limit) });
  } catch (error) {
    const cacheAge = Date.now() - globalStore.cacheAt;
    if (globalStore.cache && cacheAge <= STALE_TTL_MS) {
      return NextResponse.json(
        { ...globalStore.cache, dataMode: "stale-cache", warning: "ใช้ข้อมูลล่าสุดที่เก็บไว้ชั่วคราว" },
        { headers: responseHeaders(limit, "public, s-maxage=60, stale-while-revalidate=180") }
      );
    }
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "โหลดข้อมูลตลาดไม่ได้" },
      { status: 503, headers: responseHeaders(limit, "no-store") }
    );
  }
}
