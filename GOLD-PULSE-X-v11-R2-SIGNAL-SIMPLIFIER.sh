#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

SELF="$(basename "$0")"
BACKUP=".git/gold-pulse-r2-backup-$(date +%Y%m%d-%H%M%S)"
BUILD_LOG="/tmp/gold-pulse-r2-build.log"

[[ -d .git ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"
[[ "$(node -p "require('./package.json').version")" == "11.0.0" ]] || fail "รองรับ v11.0.0 เท่านั้น"

say "1/10 ตรวจ Git และสำรอง Core เดิม"
git fetch origin main
UNKNOWN="$(git status --porcelain | grep -vE "^\?\? ${SELF//./\.}$" || true)"
[[ -z "$UNKNOWN" ]] || { git status --short; fail "มี local changes อื่นค้างอยู่"; }

mkdir -p "$BACKUP"
cp app/api/gold/route.js "$BACKUP/gold-route.js"
cp app/api/health/route.js "$BACKUP/health-route.js"
cp lib/alerts.ts "$BACKUP/alerts.ts"
cp lib/intelligence/five-candle-truth.js "$BACKUP/five-candle-truth.js"
cp scripts/static-check.mjs "$BACKUP/static-check.mjs"
cp CHANGELOG.md "$BACKUP/CHANGELOG.md"

rollback(){
  echo "กำลัง Rollback..."
  cp "$BACKUP/gold-route.js" app/api/gold/route.js || true
  cp "$BACKUP/health-route.js" app/api/health/route.js || true
  cp "$BACKUP/alerts.ts" lib/alerts.ts || true
  cp "$BACKUP/five-candle-truth.js" lib/intelligence/five-candle-truth.js || true
  cp "$BACKUP/static-check.mjs" scripts/static-check.mjs || true
  cp "$BACKUP/CHANGELOG.md" CHANGELOG.md || true
  rm -f lib/core/signal-policy.js scripts/test-v11-r2-signal-policy.mjs BUILD-REPORT-v11.0-R2-SIMPLIFIED-SIGNAL-POLICY.md
}
trap 'code=$?; if [[ $code -ne 0 ]]; then rollback; echo "R2 ไม่ถูก Push"; fi' EXIT

say "2/10 สร้าง Single Final Signal Policy"
cat > lib/core/signal-policy.js <<'EOF'
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
EOF

say "3/10 ล็อก 1M ให้ใช้เฉพาะแท่งปิด + ขยาย Walk-forward"
python3 - <<'PY'
from pathlib import Path
p = Path("lib/intelligence/five-candle-truth.js")
s = p.read_text()
old = '''export function closedFiveMinuteCandles(inputCandles, nowMs = Date.now()) {
  const candles = sanitize(inputCandles);
  if (!candles.length) return candles;
  const startMs = parseBangkokStart(candles.at(-1)?.datetime);
  if (Number.isFinite(startMs) && nowMs < startMs + 5 * 60 * 1000) return candles.slice(0, -1);
  return candles;
}'''
new = '''function closedCandlesByMinutes(inputCandles, minutes, nowMs = Date.now()) {
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
}'''
if old not in s:
    raise SystemExit("closed-candle block ไม่ตรงกับ R1 ที่คาดไว้")
s = s.replace(old, new, 1)
old2 = '  const start = Math.max(125, candles.length - 120);'
if old2 not in s:
    raise SystemExit("walk-forward window ไม่ตรงกับ R1 ที่คาดไว้")
s = s.replace(old2, '  const start = Math.max(125, candles.length - 320);', 1)
p.write_text(s)
PY

say "4/10 ต่อ Final Gate เข้ากับ API"
python3 - <<'PY'
from pathlib import Path
p = Path("app/api/gold/route.js")
s = p.read_text()
old_import = 'import { analyzeFiveCandleTruth, closedFiveMinuteCandles } from "../../../lib/intelligence/five-candle-truth";'
new_import = 'import { analyzeFiveCandleTruth, closedFiveMinuteCandles, closedOneMinuteCandles } from "../../../lib/intelligence/five-candle-truth";\nimport { finalizeSignalDecision } from "../../../lib/core/signal-policy";'
if old_import not in s:
    raise SystemExit("route import ไม่ตรงกับเวอร์ชันที่คาดไว้")
s = s.replace(old_import, new_import, 1)

old = '''function buildPayload(m1, m5, mode = "live") {
  const oneAnalysis = analyze([...m1], 5);
  const m5Closed = closedFiveMinuteCandles(m5);
  const fiveAnalysis = analyze([...m5Closed], 5);
  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5Closed);
  const fiveCandleTruth = analyzeFiveCandleTruth(m5Closed);
  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1.at(-1)?.close || 0);
  const tradeDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const smartFree = buildSmartFreeContext(tradeDecision, oneAnalysis, fiveAnalysis);'''
new = '''function buildPayload(m1, m5, mode = "live") {
  const m1Closed = closedOneMinuteCandles(m1);
  const m5Closed = closedFiveMinuteCandles(m5);
  const oneAnalysis = analyze([...m1Closed], 5);
  const fiveAnalysis = analyze([...m5Closed], 5);
  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5Closed);
  const fiveCandleTruth = analyzeFiveCandleTruth(m5Closed);
  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1Closed.at(-1)?.close || 0);
  const intelligenceDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const tradeDecision = finalizeSignalDecision(intelligenceDecision, { fiveCandleTruth });
  const smartFree = buildSmartFreeContext(tradeDecision, oneAnalysis, fiveAnalysis);'''
if old not in s:
    raise SystemExit("buildPayload block ไม่ตรงกับเวอร์ชันที่คาดไว้")
s = s.replace(old, new, 1)

old_out = '    oneMinute: { candles: m1.slice(-140), analysis: oneAnalysis },'
if old_out not in s:
    raise SystemExit("oneMinute output block ไม่ตรง")
s = s.replace(old_out, '    oneMinute: { candles: m1Closed.slice(-140), analysis: oneAnalysis },', 1)
p.write_text(s)
PY

say "5/10 ลด LINE ให้เหลือ Safety + Final Gate เดียว"
python3 - <<'PY'
from pathlib import Path
p = Path("lib/alerts.ts")
s = p.read_text()
start = s.index("export function evaluateAlert(payload: AnyRecord) {")
end = s.index("\nfunction fingerprint", start)
new = '''export function evaluateAlert(payload: AnyRecord) {
  const config = getRuntimeConfig();
  const d = payload?.tradeDecision || {};
  const probability = Number(d.targetProbability || 0);
  const score = Number(d.signalScore || d.entryQuality || 0);
  const direction = String(d.direction || "WAIT").toUpperCase();
  const tier = String(d.entryTier || "WAIT").toUpperCase();
  const mode = String(d.mode || "NONE").toUpperCase();
  const policy = d?.decisionPolicy || null;
  const marketRegime = String(payload?.smartFree?.marketRegime || "MIXED").toUpperCase();

  const reasons: string[] = [];
  if (!config.alertsEnabled) reasons.push("alerts-disabled");
  if (!config.lineConfigured) reasons.push("line-not-configured");
  if (payload?.market?.isOpen === false) reasons.push("market-closed");
  if (payload?.dataMode !== "live") reasons.push("data-not-live");
  if (d?.status !== "ENTRY") reasons.push("decision-not-entry");
  if (!["BUY", "SELL"].includes(direction)) reasons.push("direction-not-actionable");
  if (d?.qa?.checks?.riskAccepted === false) reasons.push("risk-high-blocked");
  if (d?.intelligenceOverlay?.blocked === true) reasons.push("intelligence-hard-block");
  if (policy?.version && policy.pass !== true) reasons.push("final-policy-not-passed");

  return {
    eligible: reasons.length === 0,
    reasons,
    probability,
    score,
    direction,
    tier,
    mode,
    marketRegime,
    confirmations: Number(d.confirmationCount || 0),
    directionalEdge: Number(d?.probabilityMap?.directionalEdge || 0),
    waitProbability: Number(d?.probabilityMap?.wait || 0),
    appliedGate: {
      policyVersion: policy?.version || "legacy",
      singleFinalGate: Boolean(policy?.version),
      policyPass: policy?.pass ?? null,
      quality: policy?.quality ?? null,
      evidenceCount: policy?.evidenceCount ?? null
    },
    config
  };
}
'''
s = s[:start] + new + s[end:]
p.write_text(s)
PY

say "6/10 อัปเดต Health / Static Check / Report"
python3 - <<'PY'
from pathlib import Path

p = Path("app/api/health/route.js")
s = p.read_text()
s = s.replace('app: "GOLD PULSE X v11.0 R1 FIVE-CANDLE TRUTH",',
              'app: "GOLD PULSE X v11.0 R2 SIMPLIFIED SIGNAL POLICY",', 1)
s = s.replace('mode: "shadow-audit",\n      changesTradeDecision: false,',
              'mode: "validated-gate-assist",\n      changesTradeDecision: true,', 1)
needle = '    patternIntelligence: {'
insert = '''    decisionPolicy: {
      version: "R2-SIMPLE-1",
      architecture: "single-final-gate",
      closedOneMinuteCandlesOnly: true,
      lineRechecksEntryThresholds: false,
      entryTiers: ["CONFIRMED", "STRONG"],
      fiveCandleTruthUse: "evidence only when walk-forward quality is sufficient"
    },
'''
if needle not in s:
    raise SystemExit("health marker not found")
s = s.replace(needle, insert + needle, 1)
p.write_text(s)

p = Path("scripts/static-check.mjs")
s = p.read_text()
s = s.replace('  "lib/config.ts",', '  "lib/config.ts",\n  "lib/core/signal-policy.js",', 1)
s = s.replace('  "patternIntelligenceEnabled: true"', '  "patternIntelligenceEnabled: true",\n  "finalizeSignalDecision",\n  "closedOneMinuteCandles"', 1)
p.write_text(s)

Path("BUILD-REPORT-v11.0-R2-SIMPLIFIED-SIGNAL-POLICY.md").write_text(
'''# GOLD PULSE X v11.0 R2 — SIMPLIFIED SIGNAL POLICY

## Purpose
Reduce duplicated entry gates and make Dashboard/LINE decisions consistent.

## Changes
- Closed-candle lock covers both 1M and 5M.
- Existing Classic/Pattern engines remain the direction generator.
- One final decision gate runs after Pattern Intelligence adjustments.
- R2 may demote a legacy ENTRY but never promote a legacy non-entry.
- Final actionable tiers are CONFIRMED and STRONG; otherwise WATCH/WAIT.
- LINE no longer re-applies independent probability/score/regime entry thresholds.
- Five-Candle Truth is used only when walk-forward accuracy, coverage and samples are sufficient.
- Five-Candle validation window expands from 120 to 320 recent closed 5M candles, with no extra provider calls.

## Safety
- HIGH risk and Pattern Intelligence hard blocks remain hard vetoes.
- Scan secret, cron-job.org, LINE delivery and provider architecture are unchanged.
- No new API, database, package, paid service or secret.

## Important
This improves logical consistency and applies a precision-first policy. It cannot guarantee future accuracy or profit; live out-of-sample monitoring remains necessary.
'''
)

p = Path("CHANGELOG.md")
s = p.read_text()
entry = '''## v11.0 R2 — Simplified Signal Policy
- Single final signal gate after Pattern Intelligence adjustments.
- Closed 1M + 5M candle locks.
- LINE trusts the final decision instead of duplicating entry thresholds.
- Five-Candle Truth is validated supporting evidence only.
- Visible entry tiers simplified to CONFIRMED / STRONG.

'''
if "## v11.0 R2 — Simplified Signal Policy" not in s:
    p.write_text(entry + s)
PY

cat > scripts/test-v11-r2-signal-policy.mjs <<'EOF'
import assert from "node:assert/strict";
import { finalizeSignalDecision } from "../lib/core/signal-policy.js";

const base = {
  decision: "ACTIVE BUY",
  status: "ENTRY",
  direction: "BUY",
  entryTier: "ACTIVE",
  mainTrend: "BULLISH",
  forecastAgreement: "FULL",
  targetProbability: 72,
  signalScore: 70,
  probabilityMap: { directionalEdge: 16 },
  qa: { checks: { riskAccepted: true } },
  intelligenceOverlay: { blocked: false },
  reasons: []
};

const truth = {
  ready: true,
  validation: {
    directionalAccuracy: 57,
    directionalCoverage: 40,
    perCandle: Array.from({ length: 5 }, (_, i) => ({ candle: i + 1, directionalSamples: 30 }))
  },
  patternMemory: { forecasts: [
    { direction: "BUY" }, { direction: "BUY" }, { direction: "WAIT" },
    { direction: "SELL" }, { direction: "WAIT" }
  ] }
};

const accepted = finalizeSignalDecision(base, { fiveCandleTruth: truth });
assert.equal(accepted.status, "ENTRY");
assert.equal(accepted.decisionPolicy.pass, true);
assert.ok(["CONFIRMED", "STRONG"].includes(accepted.entryTier));

const dropped = finalizeSignalDecision({ ...base, targetProbability: 50, signalScore: 48 }, { fiveCandleTruth: truth });
assert.equal(dropped.status, "WATCH");
assert.equal(dropped.decisionPolicy.pass, false);

const blocked = finalizeSignalDecision({ ...base, intelligenceOverlay: { blocked: true } }, { fiveCandleTruth: truth });
assert.equal(blocked.status, "WATCH");
assert.equal(blocked.decisionPolicy.safetyBlocked, true);

const watch = finalizeSignalDecision({ ...base, status: "WATCH", entryTier: "WATCH" }, { fiveCandleTruth: truth });
assert.equal(watch.status, "WATCH");
assert.equal(watch.decisionPolicy.pass, false);

console.log("✅ v11 R2 signal policy tests passed");
EOF

say "7/10 Syntax + Regression Tests"
node --check lib/core/signal-policy.js
node --check lib/intelligence/five-candle-truth.js
node --check app/api/gold/route.js
node --check app/api/health/route.js
node scripts/test-v11-r2-signal-policy.mjs
node scripts/test-v11-intelligence.mjs
node scripts/test-v11-r1-five-candle-truth.mjs
node scripts/static-check.mjs

say "8/10 TypeScript Check"
./node_modules/.bin/tsc --noEmit --pretty false

say "9/10 Production Build แบบ memory-safe"
rm -rf .next
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=2304"
if ! timeout 1200s ./node_modules/.bin/next build --webpack >"$BUILD_LOG" 2>&1; then
  tail -n 100 "$BUILD_LOG" || true
  fail "Production build ไม่ผ่าน"
fi
ok "BUILD PASS"

say "10/10 Commit + Push R2"
for helper in RESTORE.sh PATCH-V11-METADATA.sh "$SELF"; do
  if git ls-files --error-unmatch "$helper" >/dev/null 2>&1; then
    git rm -f -- "$helper" >/dev/null 2>&1 || true
  else
    rm -f -- "$helper" 2>/dev/null || true
  fi
done

git add \
  app/api/gold/route.js \
  app/api/health/route.js \
  lib/alerts.ts \
  lib/core/signal-policy.js \
  lib/intelligence/five-candle-truth.js \
  scripts/static-check.mjs \
  scripts/test-v11-r2-signal-policy.mjs \
  BUILD-REPORT-v11.0-R2-SIMPLIFIED-SIGNAL-POLICY.md \
  CHANGELOG.md

git diff --cached --check
git commit -m "Simplify v11 signal decision policy"
git push origin HEAD:main

trap - EXIT
ok "SUCCESS — GOLD PULSE X v11.0 R2 SIMPLIFIED SIGNAL POLICY PUSHED"
echo "✅ Closed 1M/5M only"
echo "✅ Single Final Gate"
echo "✅ LINE no duplicate entry thresholds"
echo "✅ Five-Candle validated assist"
echo "✅ Regression + TypeScript + Production Build PASS"
