#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -d .git ]] || fail "ไม่ใช่ Git repository"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ -f app/api/gold/route.js ]] || fail "ไม่พบ app/api/gold/route.js"
[[ -f app/api/health/route.js ]] || fail "ไม่พบ app/api/health/route.js"

VERSION=$(node -p "require('./package.json').version")
if [[ "$VERSION" == "11.1.1" ]]; then
  ok "ระบบเป็น v11.1.1 TREND PERSISTENCE HARD GATE อยู่แล้ว"
  exit 0
fi
[[ "$VERSION" == "11.1.0" ]] || fail "รองรับการอัปเกรดจาก v11.1.0 เท่านั้น (พบ $VERSION)"

say "1/8 ตรวจ source และสร้าง backup"
DIRTY=$(git status --porcelain | grep -vE '^\?\? (gold-pulse-v11-debug-report\.txt|v1111-source-check\.txt|.*\.sh)$' || true)
[[ -z "$DIRTY" ]] || { printf '%s\n' "$DIRTY"; fail "มี source file ค้างอยู่ กรุณา Commit/Restore ก่อน"; }

grep -q 'function combinedTradeDecision(oneMinute, fiveMinute, price)' app/api/gold/route.js || fail "ไม่พบ combinedTradeDecision"
grep -q 'mainTrend: trendBias' app/api/gold/route.js || fail "ไม่พบ mainTrend: trendBias"
grep -q 'const intelligenceDecision = applyFiveMinuteIntelligenceOverlay' app/api/gold/route.js || fail "ไม่พบ intelligenceDecision"
grep -q 'const tradeDecision = finalizeSignalDecision' app/api/gold/route.js || fail "ไม่พบ final decision pipeline"

BACKUP="/tmp/gold-pulse-v11.1.1-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
cp package.json "$BACKUP/"
cp package-lock.json "$BACKUP/" 2>/dev/null || true
cp app/api/gold/route.js "$BACKUP/gold-route.js"
cp app/api/health/route.js "$BACKUP/health-route.js"
cp lib/config.ts "$BACKUP/config.ts" 2>/dev/null || true
cp scripts/static-check.mjs "$BACKUP/static-check.mjs" 2>/dev/null || true

say "2/8 ติดตั้ง HARD GATE"

python3 - <<'PY'
from pathlib import Path
import json, re

def require(c, m):
    if not c:
        raise SystemExit("ERROR: " + m)

# package
p = Path("package.json")
pkg = json.loads(p.read_text())
require(pkg.get("version") == "11.1.0", f"คาดหวัง 11.1.0 แต่พบ {pkg.get('version')}")
pkg["version"] = "11.1.1"
pkg["name"] = "gold-pulse-x-v11-trend-persistence-hard-gate"
pkg.setdefault("scripts", {})["test:persistence"] = "node scripts/test-v1111-trend-persistence.mjs"
p.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")

lp = Path("package-lock.json")
if lp.exists():
    lock = json.loads(lp.read_text())
    lock["version"] = "11.1.1"
    lock["name"] = pkg["name"]
    root = lock.setdefault("packages", {}).setdefault("", {})
    root["version"] = "11.1.1"
    root["name"] = pkg["name"]
    lp.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

# route
p = Path("app/api/gold/route.js")
s = p.read_text()

helper = '''
function emaSeriesForPersistence(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = current;
  for (let i = period; i < values.length; i += 1) {
    current = values[i] * k + current * (1 - k);
    out[i] = current;
  }
  return out;
}

function buildTrendPersistence(candles) {
  const requiredBars = 3;
  if (!Array.isArray(candles) || candles.length < 55) {
    return { ready: false, requiredBars, confirmedBars: 0, direction: "WAIT", reason: "insufficient-5m-history" };
  }

  const closes = candles.map((c) => Number(c?.close));
  if (!closes.every(Number.isFinite)) {
    return { ready: false, requiredBars, confirmedBars: 0, direction: "WAIT", reason: "invalid-5m-candles" };
  }

  const ema21 = emaSeriesForPersistence(closes, 21);
  const ema50 = emaSeriesForPersistence(closes, 50);

  const classify = (i) => {
    if (i < 3) return "WAIT";
    const close = closes[i];
    const e21 = ema21[i];
    const e50 = ema50[i];
    const e21Prev = ema21[i - 3];
    const e50Prev = ema50[i - 3];
    if (![close, e21, e50, e21Prev, e50Prev].every(Number.isFinite)) return "WAIT";

    if (close > e21 && e21 > e50 && e21 > e21Prev && e50 >= e50Prev) return "BUY";
    if (close < e21 && e21 < e50 && e21 < e21Prev && e50 <= e50Prev) return "SELL";
    return "WAIT";
  };

  const last = candles.length - 1;
  const states = [last - 2, last - 1, last].map(classify);
  const direction =
    states.every((x) => x === "BUY") ? "BUY" :
    states.every((x) => x === "SELL") ? "SELL" :
    "WAIT";

  return {
    ready: true,
    requiredBars,
    confirmedBars: direction === "WAIT" ? 0 : 3,
    direction,
    states,
    emaConfirmed: direction !== "WAIT",
    reason: direction === "WAIT" ? "3x5m-not-confirmed" : "3x5m-confirmed"
  };
}

function applyTrendPersistenceHardGate(decision, persistence) {
  if (!decision) return decision;

  const direction = String(decision.direction || "WAIT").toUpperCase();
  const mainTrendRaw = String(decision.mainTrend || "MIXED").toUpperCase();
  const mainTrendDirection =
    mainTrendRaw === "BULLISH" ? "BUY" :
    mainTrendRaw === "BEARISH" ? "SELL" :
    "WAIT";

  const output = { ...decision, trendPersistence: persistence };

  if (decision.status !== "ENTRY" || !["BUY", "SELL"].includes(direction)) return output;

  const pass =
    persistence?.ready === true &&
    persistence?.confirmedBars >= 3 &&
    persistence?.direction === direction &&
    mainTrendDirection === direction;

  if (pass) {
    output.reasons = [
      ...(decision.reasons || []),
      "TREND PERSISTENCE PASS: 3/3 CLOSED 5M + EMA21/EMA50 + MAIN TREND"
    ].slice(0, 12);
    return output;
  }

  output.originalDecision = decision.decision;
  output.originalDirection = direction;
  output.decision = "TREND PERSISTENCE HARD GATE - WAIT";
  output.status = "WATCH";
  output.direction = "WAIT";
  output.entryTier = "PERSISTENCE_BLOCK";
  output.alertKey = null;
  output.reasons = [
    ...(decision.reasons || []),
    "TREND PERSISTENCE BLOCK: requires 3/3 CLOSED 5M + EMA21/EMA50 + MAIN TREND"
  ].slice(0, 12);
  return output;
}

'''

if "function buildTrendPersistence(" not in s:
    marker = "function combinedTradeDecision(oneMinute, fiveMinute, price) {"
    require(marker in s, "ไม่พบตำแหน่งแทรก helper")
    s = s.replace(marker, helper + marker, 1)

old = '''  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5Closed);

  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1Closed.at(-1)?.close || 0);
  const intelligenceDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const tradeDecision = finalizeSignalDecision(intelligenceDecision, { fiveCandleTruth });'''

new = '''  const fiveMinuteIntelligence = analyzeFiveMinuteIntelligence(m5Closed);
  const trendPersistence = buildTrendPersistence(m5Closed);

  const baseTradeDecision = combinedTradeDecision(oneAnalysis, fiveAnalysis, m1Closed.at(-1)?.close || 0);
  const intelligenceDecision = applyFiveMinuteIntelligenceOverlay(baseTradeDecision, fiveMinuteIntelligence);
  const persistenceDecision = applyTrendPersistenceHardGate(intelligenceDecision, trendPersistence);
  const tradeDecision = finalizeSignalDecision(persistenceDecision, { fiveCandleTruth });'''

require(old in s or new in s, "ไม่พบ exact final pipeline")
s = s.replace(old, new, 1)

if "    trendPersistence," not in s:
    marker = "    fiveMinuteIntelligence,"
    require(marker in s, "ไม่พบ payload marker")
    s = s.replace(marker, marker + "\n    trendPersistence,", 1)

p.write_text(s)

# health
p = Path("app/api/health/route.js")
s = p.read_text()
s = re.sub(r'app:\s*"GOLD PULSE X [^"]+"', 'app: "GOLD PULSE X v11.1.1 TREND PERSISTENCE HARD GATE"', s, count=1)
s = s.replace('mode: "MAIN_TREND_FIRST",', 'mode: "MAIN_TREND_FIRST + 3X5M_PERSISTENCE_HARD_GATE",')
s = s.replace('persistence: "3 consecutive 5M candles",', 'persistence: "HARD GATE: 3 consecutive CLOSED 5M candles + EMA21/EMA50 alignment",')

if "trendPersistenceHardGate:" not in s:
    marker = "    patternIntelligence: {"
    require(marker in s, "ไม่พบ health marker")
    block = '''    trendPersistenceHardGate: {
      enabled: true,
      version: "11.1.1",
      requiredClosed5mCandles: 3,
      emaAlignment: "EMA21 vs EMA50 + slope confirmation",
      requiresMainTrendAlignment: true,
      failureAction: "WAIT / PERSISTENCE_BLOCK"
    },
'''
    s = s.replace(marker, block + marker, 1)

p.write_text(s)

# config
p = Path("lib/config.ts")
if p.exists():
    s = p.read_text()
    s = re.sub(r'version:\s*"11\.1\.0"', 'version: "11.1.1"', s, count=1)
    s = s.replace('"MAIN_TREND_GUARD_5M"', '"TREND_PERSISTENCE_HARD_GATE_5M"')
    p.write_text(s)

# test
Path("scripts/test-v1111-trend-persistence.mjs").write_text('''import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/gold/route.js", "utf8");
for (const marker of [
  "function buildTrendPersistence(",
  "function applyTrendPersistenceHardGate(",
  "3x5m-not-confirmed",
  "3x5m-confirmed",
  "TREND PERSISTENCE HARD GATE - WAIT",
  'entryTier = "PERSISTENCE_BLOCK"',
  "const trendPersistence = buildTrendPersistence(m5Closed);",
  "const persistenceDecision = applyTrendPersistenceHardGate"
]) assert.ok(route.includes(marker), `missing marker: ${marker}`);

assert.ok(route.includes("close > e21"));
assert.ok(route.includes("e21 > e50"));
assert.ok(route.includes("close < e21"));
assert.ok(route.includes("e21 < e50"));
assert.ok(route.includes("confirmedBars >= 3"));
assert.ok(route.includes("mainTrendDirection === direction"));

console.log("✅ v11.1.1 TREND PERSISTENCE HARD GATE source tests passed");
''')

# static check
p = Path("scripts/static-check.mjs")
if p.exists():
    s = p.read_text()
    s = s.replace('pkg.version !== "11.1.0"', 'pkg.version !== "11.1.1"')
    s = s.replace('package version must be 11.1.0', 'package version must be 11.1.1')
    s = s.replace('package version 11.1.0', 'package version 11.1.1')
    if '"scripts/test-v1111-trend-persistence.mjs"' not in s and '"scripts/test-v11-main-trend-guard.mjs",' in s:
        s = s.replace('"scripts/test-v11-main-trend-guard.mjs",',
                      '"scripts/test-v11-main-trend-guard.mjs",\n  "scripts/test-v1111-trend-persistence.mjs",', 1)
    p.write_text(s)

# README / changelog
p = Path("README.md")
if p.exists():
    s = p.read_text()
    section = '''
## v11.1.1 TREND PERSISTENCE HARD GATE

- ENTRY ต้องตรงกับ main trend
- 3 แท่ง 5M ที่ปิดแล้วล่าสุดต้องยืนยันทิศเดียวกัน
- ต้องผ่าน EMA21/EMA50 alignment และ slope confirmation
- ไม่ครบ 3/3 = WAIT / PERSISTENCE_BLOCK
- ใช้ CLOSED 5M candles เท่านั้น
'''
    if "## v11.1.1 TREND PERSISTENCE HARD GATE" not in s:
        p.write_text(s + section)

p = Path("CHANGELOG.md")
if p.exists():
    s = p.read_text()
    entry = '''# v11.1.1 — TREND PERSISTENCE HARD GATE

- Added hard 3x closed-5M persistence gate.
- Requires EMA21/EMA50 alignment and slope confirmation.
- Requires persistence direction to align with main trend and ENTRY direction.
- Failed persistence converts ENTRY to WAIT / PERSISTENCE_BLOCK.

'''
    if not s.startswith("# v11.1.1"):
        p.write_text(entry + s)
PY

say "3/8 ตรวจ syntax"
node --check app/api/gold/route.js
node --check scripts/test-v1111-trend-persistence.mjs

say "4/8 รัน tests"
npm run check
npm run test:intelligence
npm run test:trend-guard
npm run test:persistence

say "5/8 Build"
npm run build

say "6/8 ตรวจ diff"
git diff --stat
git diff --check

say "7/8 Commit / Push"
git add package.json package-lock.json README.md CHANGELOG.md app/api/gold/route.js app/api/health/route.js lib/config.ts scripts/static-check.mjs scripts/test-v1111-trend-persistence.mjs
git commit -m "Upgrade to v11.1.1 Trend Persistence Hard Gate"
git push origin main

say "8/8 เสร็จ"
ok "SUCCESS: GOLD PULSE X v11.1.1 TREND PERSISTENCE HARD GATE pushed to GitHub"
echo "ตรวจหลัง Vercel deploy:"
echo "https://gold-pulse-x-v9.vercel.app/api/health"
echo "คาดหวัง: version 11.1.1 | signalProfile TREND_PERSISTENCE_HARD_GATE_5M"
echo "Backup: $BACKUP"
