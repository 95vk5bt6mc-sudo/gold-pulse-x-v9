#!/usr/bin/env bash
set -u

OUT="gold-pulse-v11-debug-report.txt"

{
  echo "============================================================"
  echo "GOLD PULSE X v11 DEBUG COLLECTOR"
  echo "Generated: $(date)"
  echo "Working dir: $(pwd)"
  echo "============================================================"
  echo

  echo "===== 1) GIT STATUS ====="
  git status --short 2>&1 || true
  echo

  echo "===== 2) PACKAGE VERSION ====="
  if [ -f package.json ]; then
    node -p "require('./package.json').version" 2>&1 || true
  else
    echo "package.json not found"
  fi
  echo

  echo "===== 3) INTELLIGENCE FILE INFO ====="
  if [ -f lib/intelligence/five-minute-intelligence.js ]; then
    wc -l lib/intelligence/five-minute-intelligence.js 2>&1 || true
  else
    echo "lib/intelligence/five-minute-intelligence.js not found"
  fi
  echo

  echo "===== 4) MATCHED SYMBOLS ====="
  if [ -f lib/intelligence/five-minute-intelligence.js ]; then
    grep -nEi "overlay|intelligence|decision|export function|entryTier|blocked|fakeBreakout|divergence|marketStructure|biasDirection" lib/intelligence/five-minute-intelligence.js 2>&1 | tail -120 || true
  fi
  echo

  echo "===== 5) SOURCE LINES 480-640 ====="
  if [ -f lib/intelligence/five-minute-intelligence.js ]; then
    nl -ba lib/intelligence/five-minute-intelligence.js | sed -n '480,640p' 2>&1 || true
  fi
  echo

  echo "===== 6) API GOLD INTELLIGENCE REFERENCES ====="
  if [ -f app/api/gold/route.js ]; then
    grep -nEi "fiveMinuteIntelligence|analyzeFiveMinute|applyFiveMinute|tradeDecision|mainTrend|patternIntelligence" app/api/gold/route.js 2>&1 || true
  else
    echo "app/api/gold/route.js not found"
  fi
  echo

  echo "===== 7) HEALTH REFERENCES ====="
  if [ -f app/api/health/route.js ]; then
    grep -nEi "version|patternIntelligence|scheduler|cron-job|signalProfile|mainTrend" app/api/health/route.js 2>&1 || true
  else
    echo "app/api/health/route.js not found"
  fi
  echo

  echo "===== 8) ALERT REFERENCES ====="
  if [ -f lib/alerts.ts ]; then
    grep -nEi "Pattern bias|Trap risk|Next 5M|trend|GOLD PULSE X v11|intelligence" lib/alerts.ts 2>&1 || true
  else
    echo "lib/alerts.ts not found"
  fi
  echo

  echo "===== 9) STATIC CHECK SCRIPT ====="
  if [ -f scripts/static-check.mjs ]; then
    grep -nEi "intelligence|pattern|version|workflow" scripts/static-check.mjs 2>&1 || true
  else
    echo "scripts/static-check.mjs not found"
  fi
  echo

  echo "============================================================"
  echo "END OF REPORT"
  echo "This collector only READS files. It does not modify the app."
  echo "============================================================"
} > "$OUT"

echo
echo "✅ สร้างรายงานแล้ว: $OUT"
echo "เปิดไฟล์ $OUT ใน Explorer แล้วส่งไฟล์นั้นมาได้เลย"
echo
