#!/usr/bin/env bash
set -Eeuo pipefail

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok()  { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f package.json ]] || fail "เปิด Terminal ที่โฟลเดอร์เดียวกับ package.json"
[[ -d .git ]] || fail "โฟลเดอร์นี้ไม่ใช่ Git repository"
[[ -f lib/intelligence/five-minute-intelligence.js ]] || fail "ไม่พบ v11 Pattern Intelligence engine"

CURRENT_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || true)
if [[ "$CURRENT_VERSION" == "11.1.0" ]]; then
  ok "ระบบเป็น v11.1.0 MAIN TREND GUARD อยู่แล้ว"
  exit 0
fi
[[ "$CURRENT_VERSION" == "11.0.0" ]] || fail "รองรับการอัปเกรดจาก v11.0.0 เท่านั้น (พบ $CURRENT_VERSION)"

say "1/8 ตรวจสถานะและสร้าง backup"
DIRTY_APP=$(git status --porcelain | grep -vE '^\?\? (gold-pulse-v11-debug-report\.txt|gold-pulse-v11-debug-collector\.sh|v111-main-trend-guard.*\.sh)$' || true)
if [[ -n "$DIRTY_APP" ]]; then
  printf '%s\n' "$DIRTY_APP"
  fail "มี source file ค้างอยู่ กรุณา Commit/Restore งานเดิมให้เรียบร้อยก่อน"
fi
git status --short
BACKUP_DIR="/tmp/gold-pulse-backup-v11.1-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp package.json "$BACKUP_DIR/package.json"
cp lib/intelligence/five-minute-intelligence.js "$BACKUP_DIR/five-minute-intelligence.js"
cp scripts/static-check.mjs "$BACKUP_DIR/static-check.mjs" 2>/dev/null || true
cp app/api/health/route.js "$BACKUP_DIR/health-route.js" 2>/dev/null || true
cp lib/alerts.ts "$BACKUP_DIR/alerts.ts" 2>/dev/null || true
cp app/page.js "$BACKUP_DIR/page.js" 2>/dev/null || true
printf '%s\n' "$BACKUP_DIR" > /tmp/gold-pulse-v111-backup-dir

say "2/8 ติดตั้ง MAIN TREND GUARD"
python3 - <<'PATCH_EOF'
from pathlib import Path
import json
import re

def require(condition, message):
    if not condition:
        raise SystemExit(f"ERROR: {message}")

pkg_path = Path("package.json")
pkg = json.loads(pkg_path.read_text())
require(pkg.get("version") in {"11.0.0", "11.1.0"}, f"คาดหวัง v11.0.0 (พบ {pkg.get('version')})")
pkg["name"] = "gold-pulse-x-v11-main-trend-guard"
pkg["version"] = "11.1.0"
pkg.setdefault("scripts", {})["test:trend-guard"] = "node scripts/test-v11-main-trend-guard.mjs"
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")

lock_path = Path("package-lock.json")
if lock_path.exists():
    lock = json.loads(lock_path.read_text())
    lock["name"] = pkg["name"]
    lock["version"] = "11.1.0"
    root_pkg = lock.setdefault("packages", {}).setdefault("", {})
    root_pkg["name"] = pkg["name"]
    root_pkg["version"] = "11.1.0"
    lock_path.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

p = Path("lib/intelligence/five-minute-intelligence.js")
s = p.read_text()
for marker in [
    'export function applyFiveMinuteIntelligenceOverlay(baseDecision, intelligence) {',
    'const patternForecasts = intelligence.patternMemory?.forecasts || [];',
    'const fakeBreakout = intelligence.fakeBreakout || {};',
    'output.entryTier = "MAIN_TREND_BLOCK";'
]:
    require(marker in s, f"source ไม่ตรงกับ debug report: ไม่พบ {marker}")
require("function buildSeries(candles)" in s, "ไม่พบ buildSeries")
require("export function analyzeFiveMinuteIntelligence" in s, "ไม่พบ analyzeFiveMinuteIntelligence")
require("export function applyFiveMinuteIntelligenceOverlay" in s, "ไม่พบ applyFiveMinuteIntelligenceOverlay")

guard_code = r'''
function classifyTrendBar(candles, series, index) {
  if (index < 3) return "MIXED";
  const close = candles[index]?.close;
  const ema21Now = series.ema21[index];
  const ema50Now = series.ema50[index];
  const ema21Prev = series.ema21[index - 3];
  const ema50Prev = series.ema50[index - 3];
  if (![close, ema21Now, ema50Now, ema21Prev, ema50Prev].every(Number.isFinite)) return "MIXED";
  const bullish = close > ema21Now && ema21Now > ema50Now && ema21Now > ema21Prev && ema50Now >= ema50Prev;
  const bearish = close < ema21Now && ema21Now < ema50Now && ema21Now < ema21Prev && ema50Now <= ema50Prev;
  return bullish ? "BULLISH" : bearish ? "BEARISH" : "MIXED";
}

function consecutiveTrendCount(candles, series, direction, maxBars = 6) {
  let count = 0;
  for (let index = candles.length - 1; index >= 0 && count < maxBars; index -= 1) {
    if (classifyTrendBar(candles, series, index) !== direction) break;
    count += 1;
  }
  return count;
}

function assessMainTrend(candles, series, marketStructure, patternMemory) {
  const index = candles.length - 1;
  const close = candles[index]?.close;
  const ema21Now = series.ema21[index];
  const ema50Now = series.ema50[index];
  const ema21Prev = series.ema21[index - 3];
  const ema50Prev = series.ema50[index - 3];
  const rsiNow = series.rsi[index];
  const macdNow = finite(series.macdHistogram[index], 0);
  let bull = 0;
  let bear = 0;
  const evidence = [];

  if (Number.isFinite(close) && Number.isFinite(ema21Now)) {
    if (close > ema21Now) { bull += 1; evidence.push("close>EMA21"); }
    if (close < ema21Now) { bear += 1; evidence.push("close<EMA21"); }
  }
  if (Number.isFinite(ema21Now) && Number.isFinite(ema50Now)) {
    if (ema21Now > ema50Now) { bull += 2; evidence.push("EMA21>EMA50"); }
    if (ema21Now < ema50Now) { bear += 2; evidence.push("EMA21<EMA50"); }
  }
  if ([ema21Now, ema21Prev].every(Number.isFinite)) {
    if (ema21Now > ema21Prev) { bull += 1; evidence.push("EMA21 rising"); }
    if (ema21Now < ema21Prev) { bear += 1; evidence.push("EMA21 falling"); }
  }
  if ([ema50Now, ema50Prev].every(Number.isFinite)) {
    if (ema50Now > ema50Prev) { bull += 1; evidence.push("EMA50 rising"); }
    if (ema50Now < ema50Prev) { bear += 1; evidence.push("EMA50 falling"); }
  }
  if (marketStructure?.trend === "BULLISH") { bull += 3; evidence.push("structure bullish"); }
  if (marketStructure?.trend === "BEARISH") { bear += 3; evidence.push("structure bearish"); }
  if (Number.isFinite(rsiNow)) {
    if (rsiNow >= 54) { bull += 1; evidence.push("RSI>=54"); }
    if (rsiNow <= 46) { bear += 1; evidence.push("RSI<=46"); }
  }
  if (macdNow > 0) { bull += 1; evidence.push("MACD histogram positive"); }
  if (macdNow < 0) { bear += 1; evidence.push("MACD histogram negative"); }
  const firstForecast = patternMemory?.forecasts?.[0];
  if (firstForecast?.direction === "BUY" && firstForecast.confidence >= 50) bull += 1;
  if (firstForecast?.direction === "SELL" && firstForecast.confidence >= 50) bear += 1;

  const rawDirection = bull - bear >= 3 ? "BULLISH" : bear - bull >= 3 ? "BEARISH" : "MIXED";
  const bullishPersistence = consecutiveTrendCount(candles, series, "BULLISH");
  const bearishPersistence = consecutiveTrendCount(candles, series, "BEARISH");
  const persistenceBars = rawDirection === "BULLISH" ? bullishPersistence : rawDirection === "BEARISH" ? bearishPersistence : 0;
  const maxVotes = Math.max(1, bull + bear);
  const dominance = Math.abs(bull - bear) / maxVotes;
  const strength = Math.round(clamp(45 + dominance * 35 + Math.min(15, persistenceBars * 5), 0, 100));
  const persistent = persistenceBars >= 3;
  const established = ["BULLISH", "BEARISH"].includes(rawDirection) && persistent && strength >= 65;

  return {
    direction: established ? rawDirection : "MIXED",
    rawDirection,
    established,
    persistent,
    persistenceBars,
    strength,
    bullVotes: bull,
    bearVotes: bear,
    evidence: evidence.slice(0, 10)
  };
}

function reversalQualification(mainTrend, marketStructure, divergence, fakeBreakout, biasDirection) {
  if (!mainTrend || !["BULLISH", "BEARISH"].includes(mainTrend.rawDirection)) {
    return { qualified: false, direction: "WAIT", score: 0, confirmations: [] };
  }
  const targetDirection = mainTrend.rawDirection === "BULLISH" ? "SELL" : "BUY";
  const chochEvent = targetDirection === "BUY" ? "CHOCH_BULLISH" : "CHOCH_BEARISH";
  const choch = marketStructure?.event === chochEvent;
  const divergenceOk = divergence?.direction === targetDirection && finite(divergence?.strength, 0) >= 78 && finite(divergence?.confirmations, 0) >= 2;
  const trapOk = fakeBreakout?.favoredSide === targetDirection && finite(fakeBreakout?.risk, 0) >= 72;
  const biasOk = biasDirection === targetDirection;
  let score = 0;
  const confirmations = [];
  if (choch) { score += 30; confirmations.push(chochEvent); }
  if (divergenceOk) { score += Math.round(clamp(finite(divergence.strength, 0) * 0.35, 0, 35)); confirmations.push("confirmed divergence"); }
  if (trapOk) { score += Math.round(clamp(finite(fakeBreakout.risk, 0) * 0.25, 0, 25)); confirmations.push("fake breakout/liquidity sweep"); }
  if (biasOk) { score += 10; confirmations.push("pattern bias"); }
  score = Math.round(clamp(score, 0, 100));
  return { direction: targetDirection, score, qualified: choch && divergenceOk && trapOk && score >= 82, confirmations };
}
'''
if "function assessMainTrend(" not in s:
    s = s.replace("function buildSeries(candles) {", guard_code + "\nfunction buildSeries(candles) {", 1)

old_analyze = '''  const marketStructure = detectStructure(candles);
  const patternMemory = buildPatternMemory(candles, series);
  const bias = buildBias(patternMemory, marketStructure, fakeBreakout, divergences);
  const strongestDivergence = divergences[0] || null;'''
new_analyze = '''  const marketStructure = detectStructure(candles);
  const patternMemory = buildPatternMemory(candles, series);
  const bias = buildBias(patternMemory, marketStructure, fakeBreakout, divergences);
  const mainTrendGuard = assessMainTrend(candles, series, marketStructure, patternMemory);
  const strongestDivergence = divergences[0] || null;'''
require(old_analyze in s or new_analyze in s, "ไม่พบ analyze block สำหรับ mainTrendGuard")
s = s.replace(old_analyze, new_analyze, 1)

old_return = '''    fakeBreakout,
    marketStructure,
    bias,
    trapRisk,'''
new_return = '''    fakeBreakout,
    marketStructure,
    mainTrendGuard,
    bias,
    trapRisk,'''
require(old_return in s or new_return in s, "ไม่พบ return block สำหรับ mainTrendGuard")
s = s.replace(old_return, new_return, 1)

old_vars = '''  const fakeBreakout = intelligence.fakeBreakout || {};
  const divergence = intelligence.divergence?.strongest || null;'''
new_vars = '''  const fakeBreakout = intelligence.fakeBreakout || {};
  const divergence = intelligence.divergence?.strongest || null;
  const mainTrend = intelligence.mainTrendGuard || { direction: "MIXED", rawDirection: "MIXED", established: false, strength: 0, persistenceBars: 0 };
  const reversal = reversalQualification(mainTrend, intelligence.marketStructure, divergence, fakeBreakout, biasDirection);'''
require(old_vars in s or new_vars in s, "ไม่พบ overlay variable block จาก source จริง")
s = s.replace(old_vars, new_vars, 1)

gate_marker = '''  if (["BUY", "SELL"].includes(originalDirection) && biasDirection === originalDirection) {'''
gate_code = r'''  // MAIN TREND FIRST: trend-following is the default; counter-trend requires exceptional reversal evidence.
  if (baseDecision.status === "ENTRY" && ["BUY", "SELL"].includes(originalDirection)) {
    const aligned = (mainTrend.direction === "BULLISH" && originalDirection === "BUY") || (mainTrend.direction === "BEARISH" && originalDirection === "SELL");
    const opposite = (mainTrend.rawDirection === "BULLISH" && originalDirection === "SELL") || (mainTrend.rawDirection === "BEARISH" && originalDirection === "BUY");
    if (aligned) {
      probabilityDelta += 4;
      scoreDelta += 6;
      reasons.push(`MAIN TREND ${mainTrend.direction} supports ${originalDirection} · strength ${mainTrend.strength}% · persistence ${mainTrend.persistenceBars} bars`);
    } else if (opposite) {
      if (reversal.qualified && reversal.direction === originalDirection) {
        probabilityDelta -= 2;
        scoreDelta -= 3;
        reasons.push(`COUNTER-TREND allowed only by exceptional reversal score ${reversal.score}%`);
      } else {
        blocked = true;
        blocks.push("counter-trend-blocked");
        reasons.push(`MAIN TREND ${mainTrend.rawDirection} blocks ${originalDirection} · reversal ${reversal.score}% below requirement`);
      }
    } else {
      blocked = true;
      blocks.push("main-trend-not-established");
      reasons.push("Main trend is not established for 3 consecutive 5M bars · WAIT");
    }
    if (!mainTrend.established && !reversal.qualified) {
      blocked = true;
      if (!blocks.includes("trend-persistence-not-confirmed")) blocks.push("trend-persistence-not-confirmed");
    }
  }

'''
if "counter-trend-blocked" not in s:
    require(gate_marker in s, "ไม่พบตำแหน่งแทรก MAIN TREND FIRST gate")
    s = s.replace(gate_marker, gate_code + gate_marker, 1)

quality_marker = '''  const output = {
    ...baseDecision,'''
quality_code = r'''  if (baseDecision.status === "ENTRY" && ["BUY", "SELL"].includes(originalDirection) && !blocked) {
    const alignedTrend = (mainTrend.direction === "BULLISH" && originalDirection === "BUY") || (mainTrend.direction === "BEARISH" && originalDirection === "SELL");
    if (alignedTrend && (targetProbability < 68 || signalScore < 65)) {
      blocked = true;
      blocks.push("trend-entry-quality-too-low");
      reasons.push(`Trend ENTRY too weak: probability ${targetProbability}% / score ${signalScore}`);
    }
    if (!alignedTrend && reversal.qualified && (targetProbability < 78 || signalScore < 75)) {
      blocked = true;
      blocks.push("counter-trend-entry-quality-too-low");
      reasons.push(`Counter-trend requires probability >=78 and score >=75`);
    }
  }

'''
if "trend-entry-quality-too-low" not in s:
    require(quality_marker in s, "ไม่พบตำแหน่งแทรก minimum entry quality")
    s = s.replace(quality_marker, quality_code + quality_marker, 1)

old_diag = '''      biasDirection,
      trapRisk: intelligence.trapRisk'''
new_diag = '''      biasDirection,
      mainTrend: mainTrend.direction,
      mainTrendRaw: mainTrend.rawDirection,
      mainTrendStrength: mainTrend.strength,
      trendPersistenceBars: mainTrend.persistenceBars,
      reversalQualified: reversal.qualified,
      reversalScore: reversal.score,
      trapRisk: intelligence.trapRisk'''
require(old_diag in s or new_diag in s, "ไม่พบ overlay diagnostics block")
s = s.replace(old_diag, new_diag, 1)
s = s.replace('engine: "GOLD PULSE X v11 Pattern Intelligence Foundation"', 'engine: "GOLD PULSE X v11.1 Main Trend Guard"')
p.write_text(s)

Path("scripts/test-v11-main-trend-guard.mjs").write_text(r'''import assert from "node:assert/strict";
import { analyzeFiveMinuteIntelligence, applyFiveMinuteIntelligenceOverlay } from "../lib/intelligence/five-minute-intelligence.js";

function trendCandles(direction = "UP", count = 220) {
  const candles = [];
  let price = 3900;
  for (let i = 0; i < count; i += 1) {
    const drift = direction === "UP" ? 0.22 : -0.22;
    const wave = Math.sin(i / 9) * 0.025;
    const open = price;
    const close = open + drift + wave;
    const high = Math.max(open, close) + 0.08;
    const low = Math.min(open, close) - 0.08;
    price = close;
    candles.push({ datetime: new Date(Date.UTC(2026, 0, 1, 0, i * 5)).toISOString().slice(0, 19).replace("T", " "), open, high, low, close });
  }
  return candles;
}

const up = analyzeFiveMinuteIntelligence(trendCandles("UP"));
assert.equal(up.ready, true);
assert.ok(up.mainTrendGuard);
const counterSell = applyFiveMinuteIntelligenceOverlay({ decision: "ACTIVE SELL", status: "ENTRY", direction: "SELL", entryTier: "ACTIVE", targetProbability: 72, signalScore: 70, reasons: [] }, up);
assert.equal(counterSell.intelligenceOverlay.applied, true);
if (up.mainTrendGuard.rawDirection === "BULLISH") {
  assert.equal(counterSell.status, "WATCH");
  assert.equal(counterSell.direction, "WAIT");
}

const down = analyzeFiveMinuteIntelligence(trendCandles("DOWN"));
assert.equal(down.ready, true);
assert.ok(down.mainTrendGuard);
const counterBuy = applyFiveMinuteIntelligenceOverlay({ decision: "ACTIVE BUY", status: "ENTRY", direction: "BUY", entryTier: "ACTIVE", targetProbability: 72, signalScore: 70, reasons: [] }, down);
assert.equal(counterBuy.intelligenceOverlay.applied, true);
if (down.mainTrendGuard.rawDirection === "BEARISH") {
  assert.equal(counterBuy.status, "WATCH");
  assert.equal(counterBuy.direction, "WAIT");
}
console.log("✅ v11.1 MAIN TREND GUARD tests passed");
''')

p = Path("scripts/static-check.mjs")
if p.exists():
    s = p.read_text()
    if '"scripts/test-v11-main-trend-guard.mjs"' not in s and '"scripts/test-v11-intelligence.mjs",' in s:
        s = s.replace('"scripts/test-v11-intelligence.mjs",', '"scripts/test-v11-intelligence.mjs",\n  "scripts/test-v11-main-trend-guard.mjs",', 1)
    s = s.replace('if (pkg.version !== "11.0.0") {', 'if (pkg.version !== "11.1.0") {')
    s = s.replace('package version must be 11.0.0', 'package version must be 11.1.0')
    p.write_text(s)

p = Path("lib/config.ts")
if p.exists():
    s = p.read_text()
    s = re.sub(r'version:\s*"11\.0\.0"', 'version: "11.1.0"', s, count=1)
    s = s.replace('"PATTERN_INTELLIGENCE_5M"', '"MAIN_TREND_GUARD_5M"')
    p.write_text(s)

p = Path("app/api/health/route.js")
if p.exists():
    s = p.read_text()
    s = s.replace('app: "GOLD PULSE X v11.0 PATTERN INTELLIGENCE 5M"', 'app: "GOLD PULSE X v11.1 MAIN TREND GUARD"')
    s = s.replace('version: "11.0.0"', 'version: "11.1.0"')
    if "mainTrendGuard:" not in s:
        marker = '    patternIntelligence: {'
        if marker in s:
            block = '''    mainTrendGuard: {
      enabled: true,
      mode: "MAIN_TREND_FIRST",
      persistence: "3 consecutive 5M candles",
      trendEntryMinimum: "probability >= 68 and score >= 65",
      counterTrend: "blocked by default",
      reversalException: "CHOCH + confirmed divergence + fake breakout, reversal score >= 82"
    },
'''
            s = s.replace(marker, block + marker, 1)
    p.write_text(s)

p = Path("lib/alerts.ts")
if p.exists():
    s = p.read_text()
    s = s.replace("GOLD PULSE X v11 PATTERN INTELLIGENCE 5M", "GOLD PULSE X v11.1 MAIN TREND GUARD")
    s = s.replace('"gold-pulse-v11-pattern-intelligence"', '"gold-pulse-v11.1-main-trend-guard"')
    anchor = '    `Pattern bias ${d?.fiveMinuteIntelligence?.bias?.direction || "WAIT"} · Trap risk ${Number(d?.fiveMinuteIntelligence?.trapRisk || 0)}%`,'
    extra = anchor + '\n    `Main trend ${d?.fiveMinuteIntelligence?.mainTrendGuard?.direction || "MIXED"} · Strength ${Number(d?.fiveMinuteIntelligence?.mainTrendGuard?.strength || 0)}% · Persist ${Number(d?.fiveMinuteIntelligence?.mainTrendGuard?.persistenceBars || 0)}x5M`,'
    if anchor in s and "Main trend ${d?.fiveMinuteIntelligence?.mainTrendGuard" not in s:
        s = s.replace(anchor, extra, 1)
    p.write_text(s)

p = Path("app/page.js")
if p.exists():
    s = p.read_text()
    s = s.replace("X v11 PATTERN INTELLIGENCE 5M", "X v11.1 MAIN TREND GUARD")
    s = s.replace("Candle DNA · Divergence · Fake Breakout · Structure", "MAIN TREND FIRST · Candle DNA · Divergence · Fake Breakout · Structure", 1)
    p.write_text(s)

readme = Path("README.md")
if readme.exists():
    s = readme.read_text()
    entry = '''\n## v11.1 MAIN TREND GUARD\n\n- Main Trend First: BUY/SELL ต้องตามเทรนหลักที่ยืนยันแล้วเป็นค่าเริ่มต้น\n- ยืนยันเทรนอย่างน้อย 3 แท่ง 5M ต่อเนื่อง\n- MIXED / trend ยังไม่ชัด = WAIT\n- Counter-trend ถูกบล็อกโดยค่าเริ่มต้น\n- อนุญาต reversal สวนเทรนเฉพาะ CHOCH + confirmed divergence + fake breakout และ reversal score >= 82\n- Trend-following ENTRY ต้อง probability >= 68 และ signal score >= 65\n- ลด whipsaw และสัญญาณระยะสั้นที่กลับตัวเร็ว แต่จำนวนสัญญาณจะน้อยลง\n'''
    if "## v11.1 MAIN TREND GUARD" not in s:
        readme.write_text(s + entry)

changelog = Path("CHANGELOG.md")
if changelog.exists():
    s = changelog.read_text()
    entry = '''# v11.1.0 — MAIN TREND GUARD\n\n- Added MAIN TREND FIRST gating.\n- Requires 3 consecutive 5M trend-confirmation bars.\n- Blocks counter-trend entries by default.\n- Exceptional reversal requires CHOCH + confirmed divergence + fake breakout and reversal score >= 82.\n- Added stricter entry-quality thresholds and trend diagnostics.\n\n'''
    if not s.startswith("# v11.1.0"):
        changelog.write_text(entry + s)
PATCH_EOF

say "3/8 ตรวจ syntax"
node --check lib/intelligence/five-minute-intelligence.js
node --check scripts/test-v11-main-trend-guard.mjs

say "4/8 รัน Regression Tests"
npm run check
npm run test:intelligence
npm run test:trend-guard

say "5/8 Build"
npm run build

say "6/8 แสดง diff ก่อน commit"
git diff --stat
git status --short

say "7/8 Commit และ Push"
git add \
  package.json package-lock.json \
  README.md CHANGELOG.md \
  app/page.js app/api/health/route.js \
  lib/config.ts lib/alerts.ts \
  lib/intelligence/five-minute-intelligence.js \
  scripts/static-check.mjs \
  scripts/test-v11-main-trend-guard.mjs

git commit -m "Upgrade to v11.1 Main Trend Guard"
git push origin main

say "8/8 เสร็จสิ้น"
ok "SUCCESS: GOLD PULSE X v11.1 MAIN TREND GUARD pushed to GitHub."
printf '%s\n' \
  "รอ Vercel 1–3 นาที แล้วตรวจ /api/health" \
  "คาดหวัง: version 11.1.0 | signalProfile MAIN_TREND_GUARD_5M" \
  "Main Trend First = เปิด" \
  "Counter-trend = block โดยค่าเริ่มต้น" \
  "Trend persistence = 3 x 5M" \
  "หมายเหตุ: ระบบจะส่งสัญญาณน้อยลงเพื่อเน้นเทรนหลักและลด whipsaw" \
  "Backup ก่อนแก้ถูกเก็บไว้ใน /tmp/gold-pulse-backup-v11.1-*"
