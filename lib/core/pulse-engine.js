const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function addVote(votes, label, direction, weight) {
  if (!['BUY', 'SELL'].includes(direction) || !Number.isFinite(weight) || weight <= 0) return;
  votes.push({ label, direction, weight: Number(weight.toFixed(2)) });
}

function directionFromNumber(value, positiveThreshold, negativeThreshold = -positiveThreshold) {
  if (value >= positiveThreshold) return 'BUY';
  if (value <= negativeThreshold) return 'SELL';
  return 'WAIT';
}

/**
 * Controlled fallback for active scalping alerts.
 *
 * This function is intentionally independent from LINE and Vercel so it can be
 * regression-tested with plain Node.js. It never forces a signal when risk is
 * HIGH, data is missing, or the directional vote is too weak.
 */
export function evaluatePulseFallback({
  oneMinute,
  fiveMinute,
  buyProbability = 0,
  sellProbability = 0,
  waitProbability = 0,
  expectedMoveAbs = 0,
  mainTrend = 'WAIT'
} = {}) {
  const riskHigh = String(oneMinute?.riskLevel || '').toUpperCase() === 'HIGH';
  const atr = Math.max(0.01, Number(oneMinute?.indicators?.atr || 0));
  const rsi = Number(oneMinute?.indicators?.rsi || 50);
  const macdHistogram = Number(oneMinute?.indicators?.macdHistogram || 0);
  const oneScore = Number(oneMinute?.score || 0);
  const oneTrend = String(oneMinute?.trendBias || 'MIXED').toUpperCase();
  const fiveTrend = String(fiveMinute?.trendBias || mainTrend || 'MIXED').toUpperCase();
  const oneMomentum = Number(oneMinute?.momentumScore || 50);
  const fiveMomentum = Number(fiveMinute?.momentumScore || 50);
  const adx = Number(fiveMinute?.indicators?.adx || oneMinute?.indicators?.adx || 0);
  const marketCondition = String(fiveMinute?.marketCondition || oneMinute?.marketCondition || '').toUpperCase();

  const votes = [];
  addVote(votes, '5M trend', fiveTrend === 'BULLISH' ? 'BUY' : fiveTrend === 'BEARISH' ? 'SELL' : 'WAIT', 2.2);
  addVote(votes, '1M trend', oneTrend === 'BULLISH' ? 'BUY' : oneTrend === 'BEARISH' ? 'SELL' : 'WAIT', 1.2);

  const oneMomentumDirection = directionFromNumber(oneMomentum, 54, 46);
  const fiveMomentumDirection = directionFromNumber(fiveMomentum, 54, 46);
  addVote(votes, '1M momentum', oneMomentumDirection, 1.0);
  addVote(votes, '5M momentum', fiveMomentumDirection, 1.1);

  const macdThreshold = Math.max(atr * 0.0035, 0.0025);
  addVote(votes, 'MACD histogram', directionFromNumber(macdHistogram, macdThreshold, -macdThreshold), 0.9);
  addVote(votes, 'RSI bias', directionFromNumber(rsi, 52, 48), 0.6);
  addVote(votes, '1M feature score', directionFromNumber(oneScore, 0.75, -0.75), 1.0);

  const probabilitySpread = Number(buyProbability) - Number(sellProbability);
  const probabilityDirection = directionFromNumber(probabilitySpread, 4, -4);
  const probabilityWeight = clamp(Math.abs(probabilitySpread) / 8, 0.5, 1.5);
  addVote(votes, 'Probability map', probabilityDirection, probabilityWeight);

  const buyWeight = votes.filter((vote) => vote.direction === 'BUY').reduce((sum, vote) => sum + vote.weight, 0);
  const sellWeight = votes.filter((vote) => vote.direction === 'SELL').reduce((sum, vote) => sum + vote.weight, 0);
  const netBias = Number((buyWeight - sellWeight).toFixed(2));
  const direction = netBias > 0 ? 'BUY' : netBias < 0 ? 'SELL' : 'WAIT';
  const absoluteBias = Math.abs(netBias);
  const directionalVotes = votes.filter((vote) => vote.direction === direction).length;
  const opposingVotes = votes.filter((vote) => vote.direction !== direction).length;
  const directionalEdge = Math.abs(Number(buyProbability) - Number(sellProbability));
  const trendAligned = direction === 'BUY' ? fiveTrend === 'BULLISH' : direction === 'SELL' ? fiveTrend === 'BEARISH' : false;
  const momentumAligned = direction === 'BUY'
    ? oneMomentum >= 52 || fiveMomentum >= 52 || macdHistogram > 0
    : direction === 'SELL'
      ? oneMomentum <= 48 || fiveMomentum <= 48 || macdHistogram < 0
      : false;

  const rangePenalty = marketCondition.includes('SIDEWAY') || adx < 16 ? 0.45 : 0;
  const requiredBias = 2.20 + rangePenalty;
  const requiredMove = 0.85;

  const eligible = !riskHigh &&
    ['BUY', 'SELL'].includes(direction) &&
    directionalVotes >= 3 &&
    absoluteBias >= requiredBias &&
    Number(expectedMoveAbs) >= requiredMove &&
    Number(waitProbability) <= 62 &&
    (trendAligned || (momentumAligned && directionalEdge >= 10));

  const probability = eligible
    ? clamp(Math.round(
        50 +
        absoluteBias * 2.1 +
        directionalVotes * 1.2 +
        Math.min(10, directionalEdge) * 0.18 +
        (trendAligned ? 2 : 0) -
        opposingVotes * 0.5
      ), 58, 72)
    : 0;

  const score = eligible
    ? clamp(Math.round(
        47 +
        directionalVotes * 4 +
        absoluteBias * 2.3 +
        (trendAligned ? 4 : 0) +
        (momentumAligned ? 3 : 0) +
        Math.min(8, Math.max(0, Number(expectedMoveAbs) - 0.7) * 3) -
        opposingVotes
      ), 60, 82)
    : 0;

  return {
    eligible,
    direction,
    source: trendAligned ? 'TREND_PULSE' : momentumAligned ? 'MOMENTUM_PULSE' : 'EDGE_PULSE',
    probability,
    score,
    directionalVotes,
    opposingVotes,
    biasScore: netBias,
    absoluteBias,
    buyWeight: Number(buyWeight.toFixed(2)),
    sellWeight: Number(sellWeight.toFixed(2)),
    directionalEdge,
    trendAligned,
    momentumAligned,
    riskHigh,
    requiredBias,
    requiredMove,
    votes
  };
}
