import { NextResponse } from "next/server";
import { analyze } from "../../../lib/indicators";
import { getProvider } from "../../../lib/providers";
import { analyzeFiveMinuteIntelligence, applyFiveMinuteIntelligenceOverlay } from "../../../lib/intelligence/five-minute-intelligence";
import { analyzeFiveCandleTruth, closedFiveMinuteCandles, closedOneMinuteCandles } from "../../../lib/intelligence/five-candle-truth";
import { finalizeSignalDecision } from "../../../lib/core/signal-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 20;
const DASHBOARD_DATA_TTL_MS = 10 * 60 * 1000;
const STALE_TTL_MS = 20 * 60 * 1000;
const UPSTREAM_CALLS_PER_REFRESH = 2;
const DAILY_CREDIT_LIMIT = 800;
const TRADING_TIMEZONE = "Asia/Bangkok";
const ACTIVE_START_HOUR = 8;
const ACTIVE_END_HOUR = 24;
const SERVER_SCAN_INTERVAL_MINUTES = 5;
const PLANNED_ACTIVE_HOURS = ACTIVE_END_HOUR - ACTIVE_START_HOUR;
const PLANNED_SERVER_SCANS = (PLANNED_ACTIVE_HOURS * 60) / SERVER_SCAN_INTERVAL_MINUTES;
const PLANNED_DASHBOARD_REFRESHES = (PLANNED_ACTIVE_HOURS * 60 * 60 * 1000) / DASHBOARD_DATA_TTL_MS;
const ESTIMATED_SERVER_CREDITS = PLANNED_SERVER_SCANS * UPSTREAM_CALLS_PER_REFRESH;
const ESTIMATED_DASHBOARD_CREDITS = PLANNED_DASHBOARD_REFRESHES * UPSTREAM_CALLS_PER_REFRESH;
const ESTIMATED_COMBINED_CREDITS = ESTIMATED_SERVER_CREDITS + ESTIMATED_DASHBOARD_CREDITS;

const globalStore = globalThis.__goldPulseStableStore || {
  clients: new Map(),
  cache: null,
  cacheAt: 0,
  inFlight: null,
};
globalThis.__goldPulseStableStore = globalStore;

function getBangkokParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TRADING_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { weekday: map.weekday, hour: Number(map.hour), minute: Number(map.minute) };
}

function tradingWindowState(date = new Date()) {
  const bkk = getBangkokParts(date);
  const minuteOfDay = bkk.hour * 60 + bkk.minute;
  const active = minuteOfDay >= ACTIVE_START_HOUR * 60 && minuteOfDay < ACTIVE_END_HOUR * 60;
  const session = !active ? "SLEEP" : bkk.hour < 14 ? "ASIA" : bkk.hour < 19 ? "LONDON" : "NEW YORK";
  const nextActiveAt = active
    ? null
    : new Date(date.getTime() + Math.max(1, ACTIVE_START_HOUR * 60 - minuteOfDay) * 60 * 1000).toISOString();
  return {
    active,
    code: active ? "ACTIVE" : "SMART_SLEEP",
    label: active ? "SMART TRADING ACTIVE" : "SMART SLEEP",
    reason: active ? "User trading window 08:00-24:00 Thailand time" : "Outside user trading hours; provider calls paused",
    timezone: TRADING_TIMEZONE,
    localTime: `${String(bkk.hour).padStart(2, "0")}:${String(bkk.minute).padStart(2, "0")}`,
    activeHours: "08:00-24:00",
    scanIntervalMinutes: SERVER_SCAN_INTERVAL_MINUTES,
    session,
    sessionNote: "User-defined Thailand trading blocks",
    nextActiveAt
  };
}

function confidenceGrade(probability = 0, score = 0) {
  const blended = Math.round(Number(probability || 0) * 0.65 + Number(score || 0) * 0.35);
  if (blended >= 88) return { grade: "A+", stars: 5, label: "EXCELLENT", blended };
  if (blended >= 80) return { grade: "A", stars: 5, label: "STRONG", blended };
  if (blended >= 72) return { grade: "B+", stars: 4, label: "GOOD", blended };
  if (blended >= 64) return { grade: "B", stars: 3, label: "WATCH", blended };
  if (blended >= 55) return { grade: "C", stars: 2, label: "WEAK", blended };
  return { grade: "D", stars: 1, label: "WAIT", blended };
}

function deriveMarketRegime(oneMinute, fiveMinute) {
  const oneCondition = String(oneMinute?.marketCondition || "").toUpperCase();
  const fiveCondition = String(fiveMinute?.marketCondition || "").toUpperCase();
  const volatility = String(oneMinute?.volatility || fiveMinute?.volatility || "").toUpperCase();
  const adx = Number(oneMinute?.indicators?.adx || fiveMinute?.indicators?.adx || 0);
  if (volatility.includes("HIGH") || volatility.includes("VOLATILE")) return "VOLATILE";
  if (oneCondition.includes("TREND") || fiveCondition.includes("TREND") || adx >= 25) return "TREND";
  if (oneCondition.includes("RANGE") || fiveCondition.includes("RANGE") || adx < 18) return "RANGE";
  return "MIXED";
}

function buildSmartFreeContext(tradeDecision, oneMinute, fiveMinute, date = new Date()) {
  const window = tradingWindowState(date);
  const rating = tradeDecision ? confidenceGrade(tradeDecision?.targetProbability, tradeDecision?.signalScore) : { grade: "—", stars: 0, label: window.active ? "NO DATA" : "SLEEP", blended: 0 };
  return {
    version: "11.0.0",
    window,
    session: window.session,
    marketRegime: oneMinute || fiveMinute ? deriveMarketRegime(oneMinute, fiveMinute) : window.active ? "NO DATA" : "SLEEP",
    confidence: rating,
    explain: (tradeDecision?.reasons || []).slice(0, 5),
    creditManager: {
      mode: window.active ? "ACTIVE" : "SLEEP",
      dailyCreditLimit: DAILY_CREDIT_LIMIT,
      plannedServerScansPerDay: PLANNED_SERVER_SCANS,
      upstreamCallsPerScan: UPSTREAM_CALLS_PER_REFRESH,
      estimatedServerCreditsPerDay: ESTIMATED_SERVER_CREDITS,
      estimatedDashboardCreditsPerDay: ESTIMATED_DASHBOARD_CREDITS,
      estimatedCombinedCreditsPerDay: ESTIMATED_COMBINED_CREDITS,
      estimatedReserveCredits: DAILY_CREDIT_LIMIT - ESTIMATED_COMBINED_CREDITS
    }
  };
}

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
  const actionable = (forecast) => ["BUY", "SELL"].includes(forecast?.direction);
  const sameForecast = actionable(f3) && f3?.direction === f5?.direction;
  const probabilityOf = (forecast, direction) => Number(
    forecast?.probabilities?.[String(direction || "").toLowerCase()] || 0
  );
  const averageProbability = (direction) => Math.round(
    (probabilityOf(f3, direction) + probabilityOf(f5, direction)) / 2
  );
  const buyProbability = averageProbability("BUY");
  const sellProbability = averageProbability("SELL");
  const waitProbability = averageProbability("WAIT");
  const directionalEdge = Math.abs(buyProbability - sellProbability);
  const probabilityLeader = buyProbability >= sellProbability ? "BUY" : "SELL";
  const leaderProbability = probabilityLeader === "BUY" ? buyProbability : sellProbability;
  const trendDirectionalProbability = mainTrend === "BUY" ? buyProbability : mainTrend === "SELL" ? sellProbability : 0;
  const trendOppositeProbability = mainTrend === "BUY" ? sellProbability : mainTrend === "SELL" ? buyProbability : 0;
  const trendProbabilityGap = trendDirectionalProbability - trendOppositeProbability;

  const candidates = [f3, f5].filter(actionable);
  const trendCandidate = candidates
    .filter((item) => item.direction === mainTrend)
    .sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0))[0];
  const strongestCandidate = [...candidates]
    .sort((a, b) => Number(b?.confidence || 0) - Number(a?.confidence || 0))[0];
  const chosenForecast = sameForecast
    ? f3
    : Number(trendCandidate?.confidence || 0) >= 52
      ? trendCandidate
      : Number(strongestCandidate?.confidence || 0) >= 58
        ? strongestCandidate
        : null;

  let forecastDirection = chosenForecast?.direction || "WAIT";
  let opportunityFallback = false;
  let scoutFallback = false;
  let scoutSource = "NONE";
  const pulseFallback = false;
  const pulseSource = "DISABLED_CLASSIC";
  const pulseResult = null;

  // v9.7 opportunity path: forecast labels are WAIT, but 5M trend and probability leader agree.
  const opportunityAllowed = ["BUY", "SELL"].includes(mainTrend) &&
    probabilityLeader === mainTrend &&
    trendProbabilityGap >= 10 &&
    trendDirectionalProbability >= 34 &&
    (trendDirectionalProbability >= waitProbability - 8 || trendProbabilityGap >= 16);
  if (forecastDirection === "WAIT" && opportunityAllowed) {
    forecastDirection = mainTrend;
    opportunityFallback = true;
  }

  const atrValue = Math.max(0.01, Number(oneMinute?.indicators?.atr || 0));
  const rsi = Number(oneMinute?.indicators?.rsi || 50);
  const macd = Number(oneMinute?.indicators?.macdHistogram || 0);
  const support = Number(oneMinute?.levels?.support);
  const resistance = Number(oneMinute?.levels?.resistance);
  const nearSupport = Number.isFinite(support) && price - support <= Math.max(atrValue * 1.05, 0.40);
  const nearResistance = Number.isFinite(resistance) && resistance - price <= Math.max(atrValue * 1.05, 0.40);
  const oversold = rsi <= 40;
  const overbought = rsi >= 60;
  const momentumBuy = macd > -Math.max(atrValue * 0.008, 0.006) || rsi >= 51;
  const momentumSell = macd < Math.max(atrValue * 0.008, 0.006) || rsi <= 49;
  const leaderMomentum = probabilityLeader === "BUY" ? momentumBuy : momentumSell;
  const leaderLocation = probabilityLeader === "BUY" ? (nearSupport || oversold) : (nearResistance || overbought);
  const pulseExpectedMoveAbs = Number(Math.max(0.35, atrValue * 1.60).toFixed(2));

  // v9.8 scout path: do not stop at WAIT when the market still has a usable directional bias.
  // Trend remains the default. Counter-trend is allowed only with a clearly stronger probability edge
  // plus momentum/location evidence, preventing a weak 8-point conflict from flipping the direction.
  if (forecastDirection === "WAIT") {
    const mainTrendUsable = ["BUY", "SELL"].includes(mainTrend) &&
      trendDirectionalProbability >= 28 &&
      trendOppositeProbability - trendDirectionalProbability <= 8 &&
      waitProbability <= 50;
    const strongCounterTrend = ["BUY", "SELL"].includes(mainTrend) &&
      probabilityLeader !== mainTrend &&
      directionalEdge >= 18 &&
      leaderProbability >= 38 &&
      leaderMomentum &&
      (leaderLocation || directionalEdge >= 18);
    const rangeScout = false && mainTrend === "WAIT" &&
      directionalEdge >= 10 &&
      leaderProbability >= 32 &&
      leaderMomentum &&
      waitProbability <= 52;

    if (strongCounterTrend) {
      forecastDirection = probabilityLeader;
      scoutFallback = true;
      scoutSource = "COUNTER_EDGE";
    } else if (mainTrendUsable) {
      forecastDirection = mainTrend;
      scoutFallback = true;
      scoutSource = probabilityLeader === mainTrend ? "TREND_EDGE" : "TREND_PRIORITY";
    } else if (rangeScout) {
      forecastDirection = probabilityLeader;
      scoutFallback = true;
      scoutSource = "RANGE_EDGE";
    }
  }

  // v10.3.1 CLASSIC 9.8 PRO PLUS: PULSE fallback disabled.

  const forecastConflict = actionable(f3) && actionable(f5) && f3.direction !== f5.direction;
  const directionProbability = (forecast, direction) => Number(
    forecast?.probabilities?.[String(direction || "").toLowerCase()] || forecast?.confidence || 0
  );
  const selectedDirectionalProbability = forecastDirection === "BUY" ? buyProbability : forecastDirection === "SELL" ? sellProbability : 0;
  const avgForecastProbability = forecastDirection === "WAIT"
    ? 0
    : opportunityFallback
      ? trendDirectionalProbability
      : scoutFallback
        ? selectedDirectionalProbability
        : pulseFallback
          ? Math.max(selectedDirectionalProbability, Number(pulseResult?.probability || 0))
          : sameForecast
          ? Math.round((directionProbability(f3, forecastDirection) + directionProbability(f5, forecastDirection)) / 2)
          : Math.max(0, Math.round(directionProbability(chosenForecast, forecastDirection) - (forecastConflict ? 6 : 3)));

  const momentumAligned = forecastDirection === "BUY" ? momentumBuy : forecastDirection === "SELL" ? momentumSell : false;
  const locationAligned = (forecastDirection === "BUY" && (nearSupport || oversold)) ||
    (forecastDirection === "SELL" && (nearResistance || overbought));
  const reversalSetup = (forecastDirection === "BUY" && locationAligned && macd >= -Math.max(atrValue * 0.025, 0.02)) ||
    (forecastDirection === "SELL" && locationAligned && macd <= Math.max(atrValue * 0.025, 0.02));
  const trendAligned = forecastDirection !== "WAIT" && forecastDirection === mainTrend;
  const counterTrend = forecastDirection !== "WAIT" && forecastDirection === opposite && reversalSetup;
  const setupValid = trendAligned || counterTrend || momentumAligned || locationAligned;
  const riskHigh = oneMinute?.riskLevel === "HIGH";
  const directionalConfirmation = opportunityFallback && directionalEdge >= 10;
  const scoutDirectionalEvidence = scoutFallback && (
    (trendAligned && trendOppositeProbability - trendDirectionalProbability <= 10) ||
    (forecastDirection === probabilityLeader && directionalEdge >= 10)
  );
  const pulseDirectionalEvidence = pulseFallback && Number(pulseResult?.directionalVotes || 0) >= 2;
  const confirmationCount = [
    sameForecast || directionalConfirmation || scoutDirectionalEvidence || pulseDirectionalEvidence,
    trendAligned || counterTrend,
    momentumAligned,
    locationAligned || reversalSetup
  ].filter(Boolean).length;

  const historical = oneMinute?.historicalPattern;
  const validationSamples = Number(historical?.validation?.samples || 0);
  const validationAccuracy = Number(historical?.validation?.accuracy || 0);
  const patternSamples = Number(oneMinute?.backtest?.patternSamples || 0);
  const patternAccuracy = Number(oneMinute?.backtest?.patternAccuracy || 0);
  const sampleQuality = Math.min(100, Math.round((Math.min(validationSamples, 120) / 120) * 70 + (Math.min(patternSamples, 60) / 60) * 30));
  const validationQuality = validationSamples >= 40 ? validationAccuracy : Math.min(validationAccuracy, 58);
  const reliability = Number(oneMinute?.reliability || 0);

  const expectedMoveAbs = Number(Math.max(0.35, atrValue * (counterTrend ? 1.25 : 1.60)).toFixed(2));
  const targetMove = 1.0;
  const trendComponent = trendAligned ? Number(fiveMinute?.trendScore || 50) : counterTrend ? 100 - Number(fiveMinute?.trendScore || 50) : 50;
  const setupBonus = counterTrend && reversalSetup ? 9 : trendAligned ? 8 : momentumAligned ? 5 : locationAligned ? 4 : 0;
  const opportunityBonus = opportunityFallback ? Math.min(12, Math.round(directionalEdge * 0.60)) : 0;
  const scoutBonus = scoutFallback
    ? (trendAligned && momentumAligned ? 12 : trendAligned ? 9 : momentumAligned && locationAligned ? 8 : 5)
    : 0;
  const pulseBonus = pulseFallback
    ? Math.min(16, Math.round(Number(pulseResult?.directionalVotes || 0) * 2 + Number(pulseResult?.absoluteBias || 0) * 1.5))
    : 0;
  const conflictPenalty = forecastConflict && !trendAligned ? 5 : 0;
  const directionalConflictPenalty = scoutFallback && probabilityLeader !== forecastDirection
    ? Math.min(5, Math.max(0, directionalEdge - 5))
    : 0;
  const rawTargetProbability = forecastDirection === "WAIT" ? 0 : Math.max(0, Math.min(95, Math.round(
    avgForecastProbability * 0.40 +
    Math.min(100, expectedMoveAbs / targetMove * 70) * 0.18 +
    Number(oneMinute?.entryScore || 0) * 0.12 +
    trendComponent * 0.10 +
    reliability * 0.05 +
    validationQuality * 0.04 +
    sampleQuality * 0.02 +
    setupBonus + opportunityBonus + scoutBonus + pulseBonus - conflictPenalty - directionalConflictPenalty - (riskHigh ? 16 : 0)
  )));
  const evidenceCap = validationSamples < 10 ? 72 : validationSamples < 20 ? 78 : validationSamples < 40 ? 84 : 90;
  const targetProbability = pulseFallback
    ? Math.min(evidenceCap, Number(pulseResult?.probability || 0))
    : Math.min(rawTargetProbability, evidenceCap);

  const scoreBreakdown = {
    trend: trendAligned ? 25 : counterTrend ? 17 : forecastDirection !== "WAIT" ? 10 : 0,
    momentum: momentumAligned ? 20 : forecastDirection !== "WAIT" ? 8 : 0,
    rsi: forecastDirection === "BUY"
      ? (rsi >= 46 && rsi <= 70 ? 15 : oversold ? 13 : 6)
      : forecastDirection === "SELL"
        ? (rsi >= 30 && rsi <= 54 ? 15 : overbought ? 13 : 6)
        : 0,
    forecast: sameForecast
      ? Math.min(20, Math.round(avgForecastProbability * 0.20))
      : opportunityFallback
        ? Math.min(14, Math.round((avgForecastProbability + directionalEdge) * 0.18))
        : scoutFallback
          ? Math.min(12, Math.max(5, Math.round((avgForecastProbability + Math.max(6, directionalEdge)) * 0.18)))
          : pulseFallback
            ? Math.min(12, Math.max(5, Math.round(Number(pulseResult?.probability || 0) * 0.15 + Number(pulseResult?.directionalVotes || 0))))
            : forecastDirection !== "WAIT"
            ? Math.min(14, Math.round(avgForecastProbability * 0.16))
            : 0,
    pattern: Math.min(10, Math.round(((validationQuality + patternAccuracy) / 2) * 0.10)),
    volatility: expectedMoveAbs >= 1 ? 10 : expectedMoveAbs >= 0.55 ? 7 : 4,
    location: locationAligned ? 5 : 0
  };
  const signalScoreRaw = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0) - conflictPenalty - directionalConflictPenalty - (riskHigh ? 18 : 0);
  const signalScore = Math.max(0, Math.min(100, Math.round(
    pulseFallback ? Number(pulseResult?.score || 0) : signalScoreRaw
  )));
  const qaAdvisoryPass = forecastDirection !== "WAIT" && signalScore >= 54 && validationSamples >= 10 && !riskHigh;

  let decision = "NO TRADE";
  let mode = "NONE";
  let status = "WEAK";
  let direction = "WAIT";
  let entryTier = "WAIT";

  const confirmedEntry = sameForecast && setupValid && !riskHigh && targetProbability >= 70 && signalScore >= 65 && expectedMoveAbs >= 0.55;
  const activeEntry = !opportunityFallback && !scoutFallback && forecastDirection !== "WAIT" && setupValid && !riskHigh && confirmationCount >= 2 &&
    targetProbability >= 63 && signalScore >= 58 && expectedMoveAbs >= 0.50;
  const opportunityEntry = opportunityFallback && trendAligned && momentumAligned && !riskHigh &&
    confirmationCount >= 2 && directionalEdge >= 10 && targetProbability >= 55 && signalScore >= 62 && expectedMoveAbs >= 0.55;
  const scoutEntry = scoutFallback && setupValid && !riskHigh && confirmationCount >= 3 &&
    targetProbability >= 57 && signalScore >= 63 && expectedMoveAbs >= 0.60;
  const pulseEntry = pulseFallback && !riskHigh && Number(pulseResult?.directionalVotes || 0) >= 3 &&
    targetProbability >= 58 && signalScore >= 60 && expectedMoveAbs >= 0.85;

  if (confirmedEntry || activeEntry || opportunityEntry || scoutEntry || pulseEntry) {
    direction = forecastDirection;
    mode = counterTrend ? "COUNTER_TREND" : trendAligned ? "TREND" : locationAligned ? "REVERSAL_ZONE" : "MOMENTUM";
    status = "ENTRY";
    if (sameForecast && targetProbability >= 82 && signalScore >= 80) {
      entryTier = "STRONG";
      decision = `STRONG ${direction}`;
    } else if (confirmedEntry) {
      entryTier = "CONFIRMED";
      decision = `CONFIRMED ${direction}`;
    } else if (opportunityEntry) {
      entryTier = "OPPORTUNITY";
      decision = `OPPORTUNITY ${direction}`;
    } else if (scoutEntry) {
      entryTier = "SCOUT";
      decision = `SCOUT ${direction}`;
    } else if (pulseEntry) {
      entryTier = "PULSE";
      decision = `PULSE ${direction}`;
    } else {
      entryTier = "ACTIVE";
      decision = `ACTIVE ${direction}`;
    }
  } else if (forecastDirection !== "WAIT" && !riskHigh && confirmationCount >= 1 && targetProbability >= 48 && signalScore >= 46) {
    direction = forecastDirection;
    mode = counterTrend ? "COUNTER_TREND" : trendAligned ? "TREND" : "WATCH";
    status = "WATCH";
    entryTier = "WATCH";
    decision = `WATCH ${direction}`;
  } else if (forecastDirection !== "WAIT" && targetProbability >= 45) {
    decision = "SIGNAL WEAKENING - WAIT";
    entryTier = "WEAKENING";
  } else {
    decision = "SIGNAL WEAK - WAIT";
  }

  const sign = direction === "SELL" ? -1 : 1;
  const entryPrice = direction !== "WAIT" ? Number(price.toFixed(2)) : null;
  // TP1 is exactly a 1.00 XAU/USD price move. Account P/L still depends on
  // lot size, contract specification, spread and commission.
  const tp1Distance = targetMove;
  const tp2Distance = Number(Math.max(1.20, Math.min(2.80, expectedMoveAbs * 1.30)).toFixed(2));
  const tp3Distance = Number(Math.max(tp2Distance + 0.40, Math.min(4.50, expectedMoveAbs * 1.90)).toFixed(2));
  const structuralStop = direction === "BUY" && Number.isFinite(support) ? Math.max(0.55, price - support + 0.12) :
    direction === "SELL" && Number.isFinite(resistance) ? Math.max(0.55, resistance - price + 0.12) : 0;
  const stopDistance = Number(Math.max(0.65, Math.min(2.20, Math.max(atrValue * 0.90, structuralStop))).toFixed(2));
  const tp1 = entryPrice == null ? null : Number((entryPrice + sign * tp1Distance).toFixed(2));
  const tp2 = entryPrice == null ? null : Number((entryPrice + sign * tp2Distance).toFixed(2));
  const tp3 = entryPrice == null ? null : Number((entryPrice + sign * tp3Distance).toFixed(2));
  const stopLoss = entryPrice == null ? null : Number((entryPrice - sign * stopDistance).toFixed(2));
  const rr1 = Number((tp1Distance / stopDistance).toFixed(2));
  const rr2 = Number((tp2Distance / stopDistance).toFixed(2));
  const rr3 = Number((tp3Distance / stopDistance).toFixed(2));
  const tp1Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(92, targetProbability));
  const tp2Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(88, Math.round(targetProbability - Math.max(6, (tp2Distance - tp1Distance) * 8))));
  const tp3Chance = direction === "WAIT" ? 0 : Math.max(0, Math.min(82, Math.round(targetProbability - Math.max(13, (tp3Distance - tp1Distance) * 9))));
  const exitAdvice = status !== "ENTRY"
    ? "WAIT FOR ENTRY"
    : ["ACTIVE", "OPPORTUNITY", "SCOUT", "PULSE"].includes(entryTier)
      ? `${entryTier} IDEA - USE SMALLER RISK / CONFIRM CANDLE`
      : targetProbability < 68 || signalScore < 62
        ? "EXIT / DO NOT ENTER"
        : momentumAligned
          ? "HOLD WITH TP"
          : "MOMENTUM WEAK - PROTECT PROFIT";

  const reasons = [
    `5M main trend: ${trendBias}`,
    `3-candle forecast: ${f3?.direction || "WAIT"} ${f3?.confidence || 0}%`,
    `5-candle forecast: ${f5?.direction || "WAIT"} ${f5?.confidence || 0}%`,
    `Selected direction: ${forecastDirection} | ${sameForecast ? "full agreement" : opportunityFallback ? "trend + probability edge" : scoutFallback ? `scout ${scoutSource}` : pulseFallback ? `pulse ${pulseSource}` : forecastConflict ? "trend-weighted conflict" : "single forecast"}`,
    `Probability map BUY ${buyProbability}% | SELL ${sellProbability}% | WAIT ${waitProbability}% | edge ${directionalEdge}`,
    `Dynamic score ${signalScore}/100 | model estimate ${targetProbability}%`,
    `Confirmations ${confirmationCount}/4 | RSI ${Number.isFinite(rsi) ? rsi.toFixed(1) : "-"}`
  ];
  if (trendAligned) reasons.push("Direction follows the 5M main trend");
  if (counterTrend) reasons.push("Counter-trend reversal evidence detected");
  if (entryTier === "ACTIVE") reasons.push("ACTIVE gate passed: probability 63, score 58, at least 2 confirmations");
  if (entryTier === "OPPORTUNITY") reasons.push("OPPORTUNITY gate passed: probability 55, score 62, edge 10, 5M trend and momentum agree");
  if (entryTier === "SCOUT") reasons.push("SCOUT gate passed: probability 57, score 63 and at least 3 confirmations; use reduced risk");
  if (entryTier === "PULSE") reasons.push(`PULSE gate passed: ${pulseResult?.directionalVotes || 0} directional votes, probability 58, score 60, bias ${pulseResult?.biasScore || 0}; TP1 targets a 1.00 price move`);
  if (["CONFIRMED", "STRONG"].includes(entryTier)) reasons.push("Forecast agreement and confirmed-entry gates passed");
  if (forecastConflict) reasons.push("Forecast 3/5 conflict: score reduced and 5M trend weighted more heavily");
  if (riskHigh) reasons.push("Signal blocked because risk is HIGH");

  return {
    decision, status, mode, direction, entryTier,
    mainTrend: trendBias,
    forecast3: f3 || null,
    forecast5: f5 || null,
    forecastAgreement: sameForecast ? "FULL" : opportunityFallback ? "TREND_EDGE" : scoutFallback ? `SCOUT_${scoutSource}` : pulseFallback ? `PULSE_${pulseSource}` : forecastConflict ? "CONFLICT_WEIGHTED" : forecastDirection !== "WAIT" ? "PARTIAL" : "NONE",
    probabilityMap: { buy: buyProbability, sell: sellProbability, wait: waitProbability, directionalEdge },
    opportunityFallback,
    scoutFallback,
    scoutSource,
    pulseFallback,
    pulseSource,
    pulseEvidence: pulseResult,
    confirmationCount,
    targetDollar: targetMove,
    targetMeaning: "1.00 XAU/USD price move; account profit depends on lot size, spread and commission",
    targetProbability,
    rawTargetProbability,
    probabilityLabel: "MODEL ESTIMATE - NOT VERIFIED WIN RATE",
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
      grade: qaAdvisoryPass ? (signalScore >= 78 ? "A+" : signalScore >= 68 ? "A" : signalScore >= 58 ? "B" : "C") : "ADVISORY",
      validationSamples, validationAccuracy, patternSamples, patternAccuracy, sampleQuality, evidenceCap,
      checks: {
        forecastAgreement: sameForecast,
        forecastActionable: forecastDirection !== "WAIT",
        adequateSamples: validationSamples >= 10,
        scoreGate: signalScore >= 54,
        riskAccepted: !riskHigh,
        setupValid,
        confirmationCount
      }
    },
    trendAlignment: trendAligned ? Math.round(((oneMinute?.trendScore || 0) + (fiveMinute?.trendScore || 0)) / 2) : counterTrend ? Math.round(100 - ((oneMinute?.trendScore || 0) + (fiveMinute?.trendScore || 0)) / 2) : 0,
    estimatedCandles: expectedMoveAbs > 0 ? Math.max(1, Math.min(12, Math.ceil(targetMove / Math.max(atrValue * 0.45, 0.05)))) : null,
    alertKey: status === "ENTRY" ? `${entryTier}:${mode}:${direction}:${m1SafeTime(oneMinute)}` : null,
    cooldownMinutes: null,
    targetSignalIntervalMinutes: 30,
    adaptiveCadence: false,
    patternIntelligenceEnabled: true,
    reasons,
    note: "v11 ใช้ Classic 9.8 Pro Plus ร่วมกับ 5M Pattern Intelligence, divergence, liquidity sweep, fake-breakout และ market-structure overlay. Pattern memory ในรอบสดใช้ข้อมูลที่ provider โหลดมา ไม่ใช่คลังหลายล้านรูปแบบและไม่รับประกันกำไร."
  };
}
function m1SafeTime(analysis) {
  return analysis?.historicalPattern?.currentPatternAt || "latest";
}

function buildPayload(m1, m5, mode = "live") {
  const m1Closed = closedOneMinuteCandles(m1);
  const m5Closed = closedFiveMinuteCandles(m5);
  const oneAnalysis = analyze([...m1Closed], 5);
  const fiveAnalysis = analyze([...m5Closed], 5);
  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5Closed);
  const fiveCandleTruth = analyzeFiveCandleTruth(m5Closed);
  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1Closed.at(-1)?.close || 0);
  const intelligenceDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const tradeDecision = finalizeSignalDecision(intelligenceDecision, { fiveCandleTruth });
  const smartFree = buildSmartFreeContext(tradeDecision, oneAnalysis, fiveAnalysis);
  return {
    ok: true,
    symbol: "XAU/USD",
    source: `${process.env.GOLD_PULSE_DATA_PROVIDER || "twelve-data"} raw OHLC`,
    dataMode: mode,
    updatedAt: new Date().toISOString(),
    market: marketState(),
    tradingWindow: smartFree.window,
    smartFree,
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
      dashboardUpstreamCacheSeconds: DASHBOARD_DATA_TTL_MS / 1000,
      serverScanForcesFreshProviderData: true,
      upstreamCallsPerRefresh: UPSTREAM_CALLS_PER_REFRESH,
      serverScanIntervalMinutes: SERVER_SCAN_INTERVAL_MINUTES,
      activeHours: "08:00-24:00 Asia/Bangkok",
      plannedServerScansPerDay: PLANNED_SERVER_SCANS,
      estimatedServerCreditsPerDay: ESTIMATED_SERVER_CREDITS,
      estimatedDashboardCreditsPerDay: ESTIMATED_DASHBOARD_CREDITS,
      estimatedCombinedCreditsPerDay: ESTIMATED_COMBINED_CREDITS,
      dailyCreditLimit: DAILY_CREDIT_LIMIT,
      estimatedReserveCredits: DAILY_CREDIT_LIMIT - ESTIMATED_COMBINED_CREDITS,
      usageMode: "smart-free active-window scheduler"
    },
    oneMinute: { candles: m1Closed.slice(-140), analysis: oneAnalysis },
    fiveMinute: { candles: m5.slice(-140), analysis: fiveAnalysis },
    fiveMinuteIntelligence,
    fiveCandleTruth,
    tradeDecision
  };
}


async function getFreshData(key, { forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && globalStore.cache && now - globalStore.cacheAt < DASHBOARD_DATA_TTL_MS) return globalStore.cache;
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

function smartSleepPayload() {
  const window = tradingWindowState();
  const cached = globalStore.cache;
  if (cached) {
    return {
      ...cached,
      dataMode: "smart-sleep-cache",
      updatedAt: new Date().toISOString(),
      market: marketState(),
      tradingWindow: window,
      smartFree: {
        ...cached.smartFree,
        window,
        session: "SLEEP",
        creditManager: { ...cached.smartFree?.creditManager, mode: "SLEEP" }
      },
      refreshPolicy: {
        ...cached.refreshPolicy,
        dashboardSeconds: 300,
        upstreamCallsPerRefresh: 0,
        estimatedCreditsWhileSleeping: 0
      }
    };
  }
  return {
    ok: true,
    symbol: "XAU/USD",
    source: "Smart Free schedule",
    dataMode: "smart-sleep",
    updatedAt: new Date().toISOString(),
    market: marketState(),
    tradingWindow: window,
    smartFree: buildSmartFreeContext(null, null, null),
    refreshPolicy: { dashboardSeconds: 300, upstreamCallsPerRefresh: 0, estimatedCreditsWhileSleeping: 0 },
    oneMinute: { candles: [], analysis: null },
    fiveMinute: { candles: [], analysis: null },
    tradeDecision: null
  };
}

function closedMarketPayload() {
  const cached = globalStore.cache;
  if (cached) {
    return {
      ...cached,
      dataMode: "last-session-cache",
      market: marketState(),
      tradingWindow: tradingWindowState(),
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
    tradingWindow: tradingWindowState(),
    smartFree: buildSmartFreeContext(null, null, null),
    refreshPolicy: { dashboardSeconds: 300, upstreamCallsPerRefresh: 0 },
    oneMinute: { candles: [], analysis: null },
    fiveMinute: { candles: [], analysis: null }
  };
}

function responseHeaders(limit, cacheControl = "public, s-maxage=45, stale-while-revalidate=120") {
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

  if (!tradingWindowState().active) {
    return NextResponse.json(smartSleepPayload(), {
      headers: responseHeaders(limit, "public, s-maxage=300, stale-while-revalidate=600")
    });
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
    const forceRefresh = request.nextUrl.searchParams.get("source") === "server-scan" || request.nextUrl.searchParams.get("manualTest") === "1";
    const payload = await getFreshData(key, { forceRefresh });
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
