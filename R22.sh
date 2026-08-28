#!/usr/bin/env bash
set -Eeuo pipefail

echo "🟡 GOLD PULSE X — R2.2 LINE QUOTA SURVIVAL"

[[ -f package.json && -f lib/line.ts ]] || {
  echo "❌ Run this file at /workspaces/gold-pulse-x-v9"
  exit 1
}

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p .git/r22-backup
cp lib/line.ts ".git/r22-backup/line.ts.$STAMP"
cp .env.example ".git/r22-backup/env.example.$STAMP" 2>/dev/null || true
cp app/api/health/route.js ".git/r22-backup/health.route.js.$STAMP" 2>/dev/null || true

python3 <<'PY'
from pathlib import Path
import re

p = Path("lib/line.ts")
s = p.read_text()

if "function quotaDecision" not in s or "getLineQuotaSnapshot" not in s:
    raise SystemExit("❌ R2.1 LINE quota guard not found")

s = s.replace(
    'integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 30, 0, 10000)',
    'integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 45, 0, 10000)'
)

start = s.find("function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {")
end = s.find("\nfunction deterministicUuid", start)
if start < 0 or end < 0:
    raise SystemExit("❌ Unsupported lib/line.ts layout")

new = '''function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {
  if (!snapshot.checked || !snapshot.limited || snapshot.remaining == null) {
    return { allowed: true, reason: "quota-unlimited-or-unavailable" };
  }
  if (snapshot.remaining <= 0) {
    return { allowed: false, reason: "monthly-quota-exhausted" };
  }

  const hardPacedBudget = snapshot.monthlyLimit != null
    ? Math.floor(snapshot.monthlyLimit * (snapshot.businessDaysElapsed / snapshot.businessDaysTotal))
    : null;

  const dailyCap = integerEnv("LINE_DAILY_PUSH_CAP", 12, 1, 10000);
  const strongBurst = integerEnv("LINE_STRONG_DAILY_BURST", 2, 0, 1000);
  const dailyLimit = priority === "strong" ? dailyCap + strongBurst : dailyCap;

  if (snapshot.dailyUsed != null && snapshot.dailyUsed >= dailyLimit) {
    return { allowed: false, reason: priority === "strong" ? "strong-daily-cap-used" : "daily-cap-used" };
  }

  if (hardPacedBudget != null && snapshot.totalUsage != null && snapshot.totalUsage >= hardPacedBudget) {
    return { allowed: false, reason: "hard-monthly-pace-used" };
  }

  if (priority === "strong") {
    return { allowed: true, reason: snapshot.survivalMode ? "strong-within-hard-pace-reserve" : "strong-within-hard-pace" };
  }

  if (snapshot.survivalMode || snapshot.remaining <= snapshot.reserve) {
    return { allowed: false, reason: "reserve-protected" };
  }
  if (snapshot.budgetHeadroom != null && snapshot.budgetHeadroom <= 0) {
    return { allowed: false, reason: "confirmed-pace-budget-used" };
  }

  if (priority === "test") {
    if (snapshot.remainingPercent != null && snapshot.remainingPercent <= 25) {
      return { allowed: false, reason: "test-reserve-protected" };
    }
    if (snapshot.budgetHeadroom != null && snapshot.budgetHeadroom < 3) {
      return { allowed: false, reason: "test-budget-protected" };
    }
  }

  return { allowed: true, reason: "within-r22-paced-budget" };
}
'''

s = s[:start] + new + s[end:]
p.write_text(s)

env = Path(".env.example")
e = env.read_text() if env.exists() else ""
if "LINE_MONTHLY_RESERVE_MESSAGES=" in e:
    e = re.sub(r"LINE_MONTHLY_RESERVE_MESSAGES=\d+", "LINE_MONTHLY_RESERVE_MESSAGES=45", e)
else:
    e += "\nLINE_MONTHLY_RESERVE_MESSAGES=45\n"
if "LINE_DAILY_PUSH_CAP=" not in e:
    e += "LINE_DAILY_PUSH_CAP=12\n"
if "LINE_STRONG_DAILY_BURST=" not in e:
    e += "LINE_STRONG_DAILY_BURST=2\n"
env.write_text(e)

health = Path("app/api/health/route.js")
if health.exists():
    h = health.read_text()
    h = h.replace('version: "R2.1-SMART-QUOTA-1"', 'version: "R2.2-QUOTA-SURVIVAL-1"')
    h = h.replace("monthlyReserveDefault: 30", "monthlyReserveDefault: 45")
    health.write_text(h)
PY

echo "🔎 Checking..."
if [[ -x node_modules/.bin/tsc ]]; then
  ./node_modules/.bin/tsc --noEmit --pretty false
fi

for t in \
  scripts/test-v11-r2-signal-policy.mjs \
  scripts/test-v11-intelligence.mjs \
  scripts/test-v11-r1-five-candle-truth.mjs
do
  [[ -f "$t" ]] && node "$t"
done

echo "📦 Building..."
if [[ -x node_modules/.bin/next ]]; then
  NEXT_TELEMETRY_DISABLED=1 node_modules/.bin/next build --webpack
else
  npm run build
fi

git add lib/line.ts .env.example app/api/health/route.js 2>/dev/null || true
git diff --cached --check

if git diff --cached --quiet; then
  echo "✅ R2.2 already installed / no new changes"
  exit 0
fi

git commit -m "Install R2.2 LINE quota survival"
git push origin HEAD:main

echo "✅ DONE — R2.2 installed and pushed"
echo "   Reserve: 45 | Daily cap: 12 | STRONG burst: +2"
