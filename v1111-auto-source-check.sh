#!/usr/bin/env bash
set -Eeuo pipefail

OUT="v1111-source-check.txt"

[[ -f package.json ]] || { echo "❌ ERROR: ไม่พบ package.json"; exit 1; }
[[ -f app/api/gold/route.js ]] || { echo "❌ ERROR: ไม่พบ app/api/gold/route.js"; exit 1; }
[[ -f app/api/health/route.js ]] || { echo "❌ ERROR: ไม่พบ app/api/health/route.js"; exit 1; }

{
  echo "===== VERSION ====="
  node -p "require('./package.json').version"

  echo
  echo "===== DECISION ENGINE 200-380 ====="
  nl -ba app/api/gold/route.js | sed -n '200,380p'

  echo
  echo "===== FINAL PIPELINE 560-630 ====="
  nl -ba app/api/gold/route.js | sed -n '560,630p'

  echo
  echo "===== 5M ANALYSIS / TREND ====="
  grep -nEi "trendBias|mainTrend|fiveAnalysis|combinedTradeDecision|finalizeSignalDecision|marketRegime|EMA|ema21|ema50" app/api/gold/route.js || true

  echo
  echo "===== HEALTH MAIN TREND ====="
  grep -nA12 -B3 "mainTrendGuard" app/api/health/route.js || true

} > "$OUT"

echo "======================================"
echo "✅ SOURCE CHECK COMPLETE"
echo "📄 $OUT"
echo "======================================"
