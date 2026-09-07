#!/usr/bin/env bash
set -Eeuo pipefail
OUT="v1111-source-check.txt"
{
echo "===== VERSION ====="
node -p "require('./package.json').version"
echo "===== DECISION ENGINE 200-380 ====="
nl -ba app/api/gold/route.js | sed -n '200,380p'
echo "===== FINAL PIPELINE 560-630 ====="
nl -ba app/api/gold/route.js | sed -n '560,630p'
echo "===== 5M ANALYSIS / TREND ====="
grep -nEi "trendBias|mainTrend|fiveAnalysis|combinedTradeDecision|finalizeSignalDecision|marketRegime|EMA|ema21|ema50" app/api/gold/route.js || true
echo "===== HEALTH MAIN TREND ====="
grep -nA12 -B3 "mainTrendGuard" app/api/health/route.js || true
} > "$OUT"
echo "✅ DONE — $OUT created"
