#!/usr/bin/env bash
set -Eeuo pipefail

die(){ echo "❌ $*" >&2; exit 1; }
ok(){ echo "✅ $*"; }

[[ -d .git ]] || die "เปิดที่ root ของ repo"
[[ -f package.json ]] || die "ไม่พบ package.json"
[[ -f app/api/gold/route.js ]] || die "ไม่พบ app/api/gold/route.js"

echo "1/7 CLEAN"
git restore -- \
  package.json package-lock.json CHANGELOG.md \
  app/api/gold/route.js app/api/health/route.js \
  lib/config.ts scripts/static-check.mjs 2>/dev/null || true
rm -f scripts/test-v1111-trend-persistence.mjs

echo "2/7 PATCH"
python3 - <<'PY'
from pathlib import Path
import json, re, sys

def need(c, m):
    if not c:
        print("❌", m)
        sys.exit(1)

p = Path("package.json")
pkg = json.loads(p.read_text())
need(pkg.get("version") == "11.1.0", f"ต้องเริ่มจาก v11.1.0 แต่พบ {pkg.get('version')}")
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

p = Path("app/api/gold/route.js")
s = p.read_text()
need("function combinedTradeDecision(" in s, "ไม่พบ combinedTradeDecision")
need("analyzeFiveMinuteIntelligence(m5Closed)" in s, "ไม่พบ 5M intelligence pipeline")
need("applyFiveMinuteIntelligenceOverlay" in s, "ไม่พบ intelligence overlay")
need("finalizeSignalDecision(" in s, "ไม่พบ finalizeSignalDecision")

helper = '''
function emaSeriesForPersistence(values, period) {
  if (!Array.isArray(values) || values.length < period) return [];
  const out = Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let cur = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  out[period - 1] = cur;
  for (let i = period; i < values.length; i += 1) {
    cur = values[i] * k + cur * (1 - k);
    out[i] = cur;
  }
  return out;
}

function buildTrendPersistence(candles) {
  const requiredBars = 3;
  if (!Array.isArray(candles) || candles.length < 55) {
    return { ready:false, requiredBars, confirmedBars:0, direction:"WAIT", reason:"insufficient-5m-history" };
  }

  const closes = candles.map(c => Number(c?.close));
  if (!closes.every(Number.isFinite)) {
    return { ready:false, requiredBars, confirmedBars:0, direction:"WAIT", reason:"invalid-5m-candles" };
  }

  const e21 = emaSeriesForPersistence(closes, 21);
  const e50 = emaSeriesForPersistence(closes, 50);

  const classify = (i) => {
    if (i < 3) return "WAIT";
    const c = closes[i], a = e21[i], b = e50[i], ap = e21[i-3], bp = e50[i-3];
    if (![c,a,b,ap,bp].every(Number.isFinite)) return "WAIT";
    if (c > a && a > b && a > ap && b >= bp) return "BUY";
    if (c < a && a < b && a < ap && b <= bp) return "SELL";
    return "WAIT";
  };

  const n = candles.length - 1;
  const states = [n-2,n-1,n].map(classify);
  const direction = states.every(x=>x==="BUY") ? "BUY" : states.every(x=>x==="SELL") ? "SELL" : "WAIT";

  return {
    ready:true,
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

  const dir = String(decision.direction || "WAIT").toUpperCase();
  const mt = String(decision.mainTrend || "MIXED").toUpperCase();
  const mtDir = mt === "BULLISH" ? "BUY" : mt === "BEARISH" ? "SELL" : "WAIT";
  const out = { ...decision, trendPersistence:persistence };

  if (decision.status !== "ENTRY" || !["BUY","SELL"].includes(dir)) return out;

  const pass =
    persistence?.ready === true &&
    persistence?.confirmedBars >= 3 &&
    persistence?.direction === dir &&
    mtDir === dir;

  if (pass) {
    out.reasons = [...(decision.reasons || []),
      "TREND PERSISTENCE PASS: 3/3 CLOSED 5M + EMA21/EMA50 + MAIN TREND"
    ].slice(0,12);
    return out;
  }

  out.originalDecision = decision.decision;
  out.originalDirection = dir;
  out.decision = "TREND PERSISTENCE HARD GATE - WAIT";
  out.status = "WATCH";
  out.direction = "WAIT";
  out.entryTier = "PERSISTENCE_BLOCK";
  out.alertKey = null;
  out.reasons = [...(decision.reasons || []),
    "TREND PERSISTENCE BLOCK: requires 3/3 CLOSED 5M + EMA21/EMA50 + MAIN TREND"
  ].slice(0,12);
  return out;
}

'''

if "function buildTrendPersistence(" not in s:
    s = s.replace("function combinedTradeDecision(", helper + "function combinedTradeDecision(", 1)

if "const trendPersistence = buildTrendPersistence(m5Closed);" not in s:
    s, n1 = re.subn(
        r'(const\s+fiveMinuteIntelligence\s*=\s*analyzeFiveMinuteIntelligence\(m5Closed\);\s*)',
        r'\1\n  const trendPersistence = buildTrendPersistence(m5Closed);\n',
        s, count=1
    )
    need(n1 == 1, "แทรก trendPersistence ไม่สำเร็จ")

if "const persistenceDecision = applyTrendPersistenceHardGate(" not in s:
    s, n2 = re.subn(
        r'(const\s+intelligenceDecision\s*=\s*applyFiveMinuteIntelligenceOverlay\([^;]+;\s*)',
        r'\1\n  const persistenceDecision = applyTrendPersistenceHardGate(intelligenceDecision, trendPersistence);\n',
        s, count=1
    )
    need(n2 == 1, "แทรก persistenceDecision ไม่สำเร็จ")

if "finalizeSignalDecision(persistenceDecision," not in s:
    s, n3 = re.subn(
        r'finalizeSignalDecision\(\s*intelligenceDecision\s*,',
        'finalizeSignalDecision(persistenceDecision,',
        s, count=1
    )
    need(n3 == 1, "เปลี่ยน final gate ไม่สำเร็จ")

if "    trendPersistence," not in s:
    s = s.replace("    fiveMinuteIntelligence,", "    fiveMinuteIntelligence,\n    trendPersistence,", 1)

p.write_text(s)

p = Path("app/api/health/route.js")
h = p.read_text()
h = re.sub(
    r'app:\s*"GOLD PULSE X [^"]+"',
    'app: "GOLD PULSE X v11.1.1 TREND PERSISTENCE HARD GATE"',
    h, count=1
)
h = h.replace(
    'mode: "MAIN_TREND_FIRST",',
    'mode: "MAIN_TREND_FIRST + 3X5M_PERSISTENCE_HARD_GATE",'
)
h = h.replace(
    'persistence: "3 consecutive 5M candles",',
    'persistence: "HARD GATE: 3 consecutive CLOSED 5M + EMA21/EMA50",'
)
if "trendPersistenceHardGate:" not in h:
    h = h.replace(
        "    patternIntelligence: {",
        '''    trendPersistenceHardGate: {
      enabled: true,
      version: "11.1.1",
      requiredClosed5mCandles: 3,
      emaAlignment: "EMA21 vs EMA50 + slope confirmation",
      requiresMainTrendAlignment: true,
      failureAction: "WAIT / PERSISTENCE_BLOCK"
    },
    patternIntelligence: {''',
        1
    )
p.write_text(h)

p = Path("lib/config.ts")
if p.exists():
    c = p.read_text()
    c = re.sub(r'version:\s*"11\.1\.0"', 'version: "11.1.1"', c, count=1)
    c = c.replace('"MAIN_TREND_GUARD_5M"', '"TREND_PERSISTENCE_HARD_GATE_5M"')
    p.write_text(c)

p = Path("scripts/static-check.mjs")
if p.exists():
    t = p.read_text()
    t = t.replace('pkg.version !== "11.1.0"', 'pkg.version !== "11.1.1"')
    t = t.replace('package version must be 11.1.0', 'package version must be 11.1.1')
    t = t.replace('package version 11.1.0', 'package version 11.1.1')
    p.write_text(t)

Path("scripts/test-v1111-trend-persistence.mjs").write_text(
    'import assert from "node:assert/strict";\n'
    'import fs from "node:fs";\n'
    'const s = fs.readFileSync("app/api/gold/route.js","utf8");\n'
    'for (const m of [\n'
    '  "function buildTrendPersistence(",\n'
    '  "function applyTrendPersistenceHardGate(",\n'
    '  "3x5m-not-confirmed",\n'
    '  "3x5m-confirmed",\n'
    '  "TREND PERSISTENCE HARD GATE - WAIT",\n'
    '  \'entryTier = "PERSISTENCE_BLOCK"\',\n'
    '  "const trendPersistence = buildTrendPersistence(m5Closed);",\n'
    '  "const persistenceDecision = applyTrendPersistenceHardGate",\n'
    '  "finalizeSignalDecision(persistenceDecision,"\n'
    ']) assert.ok(s.includes(m), "missing: " + m);\n'
    'assert.ok(s.includes("confirmedBars >= 3"));\n'
    'assert.ok(s.includes(\'mtDir === dir\'));\n'
    'console.log("✅ v11.1.1 persistence source tests passed");\n'
)

p = Path("CHANGELOG.md")
if p.exists():
    c = p.read_text()
    if not c.startswith("# v11.1.1"):
        entry = (
            "# v11.1.1 — TREND PERSISTENCE HARD GATE\n\n"
            "- 3 closed 5M candles required.\n"
            "- EMA21/EMA50 alignment + slope required.\n"
            "- Must align with MAIN TREND.\n"
            "- Failure => WAIT / PERSISTENCE_BLOCK.\n\n"
        )
        p.write_text(entry + c)
PY

echo "3/7 TEST"
node --check app/api/gold/route.js
node --check scripts/test-v1111-trend-persistence.mjs
npm run check
npm run test:intelligence
npm run test:trend-guard
npm run test:persistence

echo "4/7 BUILD"
npm run build

echo "5/7 COMMIT"
git add package.json package-lock.json CHANGELOG.md \
  app/api/gold/route.js app/api/health/route.js \
  lib/config.ts scripts/static-check.mjs \
  scripts/test-v1111-trend-persistence.mjs
git commit -m "Upgrade to v11.1.1 Trend Persistence Hard Gate"

echo "6/7 SYNC"
git fetch origin
git rebase origin/main

echo "7/7 PUSH"
git push origin main

ok "GOLD PULSE X v11.1.1 พร้อมแล้ว"
echo "ตรวจ: https://gold-pulse-x-v9.vercel.app/api/health"
