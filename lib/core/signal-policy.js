const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const actionable = (direction) => ["BUY", "SELL"].includes(String(direction || "").toUpperCase());

function trendDirection(mainTrend) {
  const trend = String(mainTrend || "").toUpperCase();
  if (trend === "BULLISH") return "BUY";
  if (trend === "BEARISH") return "SELL";
  return "WAIT";
}

function assessFiveCandleTruth(fiveCandleTruth, direction) {
  const validation = fiveCandleTruth?.validation || {};
  const perCandle = Array.isArray(validation?.perCandle) ? validation.perCandle : [];
  const directionalSamples = perCandle.reduce((sum, slot) => sum + Number(slot?.directionalSamples || 0), 0);
  const accuracy = Number(validation?.directionalAccuracy || 0);
  const coverage = Number(validation?.directionalCoverage || 0);
  const trusted = Boolean(fiveCandleTruth?.ready) && accuracy >= 54 && coverage >= 25 && directionalSamples >= 80;
  const forecasts = (fiveCandleTruth?.patternMemory?.forecasts || []).slice(0, 3);
  const opposite = direction === "BUY" ? "SELL" : direction === "SELL" ? "BUY" : "WAIT";
  const supportVotes = forecasts.filter((item) => item?.direction === direction).length;
  const opposeVotes = forecasts.filter((item) => item?.direction === opposite).length;
  const support = !trusted ? "UNTRUSTED" : supportVotes >= 2 ? "SUPPORT" : opposeVotes >= 2 ? "OPPOSE" : "NEUTRAL";
  return { trusted, support, supportVotes, opposeVotes, directionalSamples, accuracy, coverage };
}

export function finalizeSignalDecision(baseDecision, { fiveCandleTruth = null } = {}) {
  if (!baseDecision) return baseDecision;

  const direction = String(baseDecision.direction || "WAIT").toUpperCase();
  const baseEntry = baseDecision.status === "ENTRY";
  const probability = Number(baseDecision.targetProbability || 0);
  const score = Number(baseDecision.signalScore || baseDecision.entryQuality || 0);
  const edge = Number(baseDecision?.probabilityMap?.directionalEdge || 0);
  const agreement = String(baseDecision.forecastAgreement || "NONE").toUpperCase();
  const riskAccepted = baseDecision?.qa?.checks?.riskAccepted !== false;
  const overlayBlocked = Boolean(baseDecision?.intelligenceOverlay?.blocked);

  const forecastEvidence = agreement === "FULL" ||
    (edge >= 12 && !["NONE", "CONFLICT_WEIGHTED"].includes(agreement));
  const trendEvidence = actionable(direction) && trendDirection(baseDecision.mainTrend) === direction;
  const truth = assessFiveCandleTruth(fiveCandleTruth, direction);
  const truthEvidence = truth.support === "SUPPORT";
  const truthAdjustment = truth.support === "SUPPORT" ? 4 : truth.support === "OPPOSE" ? -6 : 0;

  const quality = Math.round(clamp(probability * 0.58 + score * 0.42 + truthAdjustment, 0, 100));
  const evidence = { forecast: forecastEvidence, trend5m: trendEvidence, fiveCandleTruth: truthEvidence };
  const evidenceCount = Object.values(evidence).filter(Boolean).length;
  const safetyBlocked = !riskAccepted || overlayBlocked;

  // Precision-first: R2 may demote a legacy ENTRY, never promote a legacy non-entry.
  const pass = baseEntry && actionable(direction) && !safetyBlocked && quality >= 64 && evidenceCount >= 2;
  const strong = pass && quality >= 76 && evidenceCount === 3 && agreement === "FULL" && truth.support !== "OPPOSE";

  const output = {
    ...baseDecision,
    decisionPolicy: {
      version: "R2-SIMPLE-1",
      philosophy: "single-final-gate",
      pass,
      quality,
      minimumQuality: 64,
      evidenceCount,
      minimumEvidence: 2,
      evidence,
      safetyBlocked,
      fiveCandleTruth: truth,
      legacyEntryTier: baseDecision.entryTier || "WAIT"
    }
  };

  const reasons = [...(baseDecision.reasons || [])];
  reasons.push(`R2 final gate: quality ${quality}/100 | evidence ${evidenceCount}/3`);
  if (truth.trusted) reasons.push(`5C truth ${truth.support.toLowerCase()} | dir accuracy ${truth.accuracy}% | coverage ${truth.coverage}%`);
  else reasons.push("5C truth ยังไม่ผ่าน evidence gate จึงไม่ใช้บังคับทิศทาง");

  if (pass) {
    output.status = "ENTRY";
    output.direction = direction;
    output.entryTier = strong ? "STRONG" : "CONFIRMED";
    output.decision = `${output.entryTier} ${direction}`;
  } else if (actionable(direction)) {
    output.status = "WATCH";
    output.entryTier = "WATCH";
    output.decision = `WATCH ${direction}`;
    output.alertKey = null;
  } else {
    output.status = baseDecision.status === "WATCH" ? "WATCH" : "WEAK";
    output.direction = "WAIT";
    output.entryTier = "WAIT";
    output.decision = "SIGNAL WEAK - WAIT";
    output.alertKey = null;
  }

  output.reasons = reasons.slice(0, 12);
  return output;
}
