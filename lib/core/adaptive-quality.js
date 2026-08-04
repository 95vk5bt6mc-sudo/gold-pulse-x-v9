const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function bangkokDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function forecastAgreementBonus(value = "") {
  const agreement = String(value).toUpperCase();
  if (agreement === "FULL") return 6;
  if (agreement === "TREND_EDGE") return 4;
  if (agreement === "PARTIAL") return 3;
  if (agreement.startsWith("SCOUT_")) return 1;
  if (agreement.startsWith("PULSE_")) return 0;
  if (agreement.includes("CONFLICT")) return -3;
  return 0;
}

function tierBonus(value = "") {
  const tier = String(value).toUpperCase();
  if (tier === "STRONG") return 8;
  if (tier === "CONFIRMED") return 6;
  if (tier === "ACTIVE") return 3;
  if (tier === "OPPORTUNITY") return 2;
  if (tier === "SCOUT") return 0;
  if (tier === "PULSE") return -1;
  return -4;
}

/**
 * Builds a quality score used only for alert timing. It is not a verified win
 * rate and does not replace the trade-decision gates in app/api/gold/route.js.
 */
export function calculateAdaptiveQuality(payload = {}) {
  const decision = payload?.tradeDecision || {};
  const probability = number(decision.targetProbability);
  const score = number(decision.signalScore || decision.entryQuality);
  const confirmations = number(decision.confirmationCount);
  const edge = number(decision?.probabilityMap?.directionalEdge);
  const waitProbability = number(decision?.probabilityMap?.wait);
  const expectedMoveAbs = Math.abs(number(decision.expectedMove));
  const entryPrice = number(decision.entryPrice, NaN);
  const tier = String(decision.entryTier || "WAIT").toUpperCase();
  const direction = String(decision.direction || "WAIT").toUpperCase();
  const mode = String(decision.mode || "NONE").toUpperCase();
  const agreement = String(decision.forecastAgreement || "NONE").toUpperCase();
  const regime = String(payload?.smartFree?.marketRegime || "MIXED").toUpperCase();

  const probabilityPoints = probability * 0.52;
  const scorePoints = score * 0.36;
  const confirmationPoints = clamp(confirmations * 2.25, 0, 9);
  const edgePoints = clamp((edge - 6) * 0.35, 0, 7);
  const agreementPoints = forecastAgreementBonus(agreement);
  const tierPoints = tierBonus(tier);
  const movePoints = expectedMoveAbs >= 1.50 ? 4 : expectedMoveAbs >= 1.00 ? 3 : expectedMoveAbs >= 0.85 ? 1 : -3;
  const waitPenalty = clamp((waitProbability - 42) * 0.18, 0, 7);
  const counterTrendPenalty = mode === "COUNTER_TREND" ? 3 : 0;
  const rangePenalty = regime === "RANGE" && ["SCOUT", "PULSE"].includes(tier) ? 2 : 0;

  const quality = clamp(Math.round(
    probabilityPoints +
    scorePoints +
    confirmationPoints +
    edgePoints +
    agreementPoints +
    tierPoints +
    movePoints -
    waitPenalty -
    counterTrendPenalty -
    rangePenalty
  ), 0, 100);

  return {
    quality,
    probability,
    score,
    confirmations,
    edge,
    waitProbability,
    expectedMoveAbs,
    entryPrice,
    tier,
    direction,
    mode,
    agreement,
    regime,
    breakdown: {
      probability: Number(probabilityPoints.toFixed(2)),
      score: Number(scorePoints.toFixed(2)),
      confirmations: Number(confirmationPoints.toFixed(2)),
      directionalEdge: Number(edgePoints.toFixed(2)),
      forecastAgreement: agreementPoints,
      tier: tierPoints,
      expectedMove: movePoints,
      waitPenalty: Number(waitPenalty.toFixed(2)),
      counterTrendPenalty,
      rangePenalty
    }
  };
}

/**
 * The threshold relaxes gradually as time passes. There is no fixed 30-minute
 * lock. Exceptional signals can pass early; ordinary good signals tend to pass
 * near the 30-minute target; weak signals never pass below the quality floor.
 */
export function requiredQualityForElapsed(elapsedMinutes, config = {}) {
  const coldStart = number(config.adaptiveColdStartQuality, 78);
  const elite = number(config.adaptiveEliteQuality, 92);
  const early = number(config.adaptiveEarlyQuality, 86);
  const target = number(config.adaptiveTargetQuality, 80);
  const late = number(config.adaptiveLateQuality, 76);
  const floor = number(config.adaptiveQualityFloor, 72);
  const targetMinutes = number(config.targetSignalIntervalMinutes, 30);

  if (!Number.isFinite(elapsedMinutes)) return coldStart;
  if (elapsedMinutes < 10) return elite;
  if (elapsedMinutes < 20) return early;
  if (elapsedMinutes < targetMinutes) return target;
  if (elapsedMinutes < 45) return late;
  if (elapsedMinutes < 60) return Math.max(floor, late - 2);
  return floor;
}

function normalizedState(state = {}, now = new Date()) {
  state = state || {};
  const dayKey = bangkokDayKey(now);
  if (state.dayKey !== dayKey) {
    return {
      version: 1,
      dayKey,
      dailyCount: 0,
      lastSentAt: null,
      lastDirection: null,
      lastQuality: null,
      lastEntryPrice: null,
      lastTier: null,
      candidate: null
    };
  }
  return {
    version: 1,
    dayKey,
    dailyCount: number(state.dailyCount),
    lastSentAt: state.lastSentAt || null,
    lastDirection: state.lastDirection || null,
    lastQuality: Number.isFinite(Number(state.lastQuality)) ? Number(state.lastQuality) : null,
    lastEntryPrice: Number.isFinite(Number(state.lastEntryPrice)) ? Number(state.lastEntryPrice) : null,
    lastTier: state.lastTier || null,
    candidate: state.candidate || null
  };
}

export function evaluateAdaptiveCadence({ payload, state, now = new Date(), config = {} } = {}) {
  const quality = calculateAdaptiveQuality(payload);
  const currentState = normalizedState(state, now);
  const lastSentMs = currentState.lastSentAt ? Date.parse(currentState.lastSentAt) : NaN;
  const elapsedMinutes = Number.isFinite(lastSentMs)
    ? Math.max(0, (now.getTime() - lastSentMs) / 60000)
    : Infinity;

  const technicalMinimumGapMinutes = number(config.technicalMinimumGapMinutes, 2);
  const dailyAlertCap = number(config.dailyAlertCap, 32);
  const targetMinutes = number(config.targetSignalIntervalMinutes, 30);
  const reversalPenalty = number(config.adaptiveReversalPenalty, 4);
  const improvementNeeded = number(config.adaptiveSameDirectionImprovement, 3);
  const eliteQuality = number(config.adaptiveEliteQuality, 92);
  const qualityFloor = number(config.adaptiveQualityFloor, 72);

  let requiredQuality = requiredQualityForElapsed(elapsedMinutes, config);
  const reasons = [];
  const reversal = Boolean(currentState.lastDirection) &&
    currentState.lastDirection !== quality.direction &&
    ["BUY", "SELL"].includes(quality.direction);
  const sameDirection = Boolean(currentState.lastDirection) && currentState.lastDirection === quality.direction;
  const entryDistance = Number.isFinite(quality.entryPrice) && Number.isFinite(currentState.lastEntryPrice)
    ? Math.abs(quality.entryPrice - currentState.lastEntryPrice)
    : Infinity;

  const eliteSignal = quality.quality >= eliteQuality &&
    quality.probability >= 76 &&
    quality.score >= 70 &&
    quality.confirmations >= 3 &&
    quality.expectedMoveAbs >= 1.0 &&
    !["SCOUT", "PULSE"].includes(quality.tier);

  if (!["BUY", "SELL"].includes(quality.direction)) reasons.push("adaptive-direction-not-actionable");
  if (quality.quality < qualityFloor) reasons.push("adaptive-quality-below-floor");
  if (currentState.dailyCount >= dailyAlertCap) reasons.push("adaptive-daily-safety-cap");
  if (elapsedMinutes < technicalMinimumGapMinutes) reasons.push("adaptive-technical-dedup-gap");

  if (reversal && elapsedMinutes < targetMinutes) {
    requiredQuality += reversalPenalty;
    if (quality.confirmations < 3) reasons.push("adaptive-reversal-needs-3-confirmations");
  }

  // Repeated same-direction entries need either a meaningful price change or a
  // clearly better quality score, otherwise they are treated as stale repeats.
  if (sameDirection && elapsedMinutes < targetMinutes && entryDistance < 0.25) {
    const lastQuality = number(currentState.lastQuality, 0);
    if (quality.quality < lastQuality + improvementNeeded) {
      reasons.push("adaptive-stale-same-direction");
    }
  }

  if (quality.quality < requiredQuality && !eliteSignal) reasons.push("adaptive-quality-below-time-gate");

  return {
    eligible: reasons.length === 0,
    reasons,
    quality: quality.quality,
    requiredQuality,
    elapsedMinutes: Number.isFinite(elapsedMinutes) ? Number(elapsedMinutes.toFixed(1)) : null,
    targetIntervalMinutes: targetMinutes,
    eliteSignal,
    reversal,
    sameDirection,
    entryDistance: Number.isFinite(entryDistance) ? Number(entryDistance.toFixed(2)) : null,
    dailyCount: currentState.dailyCount,
    dailyAlertCap,
    state: currentState,
    evidence: quality
  };
}

export function stateAfterSent({ previousState, adaptive, payload, now = new Date() } = {}) {
  const state = normalizedState(previousState, now);
  const decision = payload?.tradeDecision || {};
  return {
    ...state,
    dayKey: bangkokDayKey(now),
    dailyCount: state.dailyCount + 1,
    lastSentAt: now.toISOString(),
    lastDirection: decision.direction || null,
    lastQuality: adaptive?.quality ?? null,
    lastEntryPrice: Number.isFinite(Number(decision.entryPrice)) ? Number(decision.entryPrice) : null,
    lastTier: decision.entryTier || null,
    candidate: null
  };
}

export function stateAfterCandidate({ previousState, adaptive, payload, now = new Date(), config = {} } = {}) {
  const state = normalizedState(previousState, now);
  const expiryMinutes = number(config.candidateExpiryMinutes, 20);
  const existingAt = state.candidate?.observedAt ? Date.parse(state.candidate.observedAt) : NaN;
  const existingFresh = Number.isFinite(existingAt) && now.getTime() - existingAt <= expiryMinutes * 60000;
  const existingQuality = existingFresh ? number(state.candidate?.quality, -1) : -1;

  if (!adaptive || adaptive.quality <= existingQuality) return state;
  const decision = payload?.tradeDecision || {};
  return {
    ...state,
    candidate: {
      observedAt: now.toISOString(),
      quality: adaptive.quality,
      requiredQuality: adaptive.requiredQuality,
      direction: decision.direction || null,
      tier: decision.entryTier || null,
      entryPrice: Number.isFinite(Number(decision.entryPrice)) ? Number(decision.entryPrice) : null
    }
  };
}
