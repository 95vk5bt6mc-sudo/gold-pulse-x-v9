#!/usr/bin/env bash
set -Eeuo pipefail

SELF="$(basename "$0")"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="/tmp/gold-pulse-r22-build.log"
FILES=(
  "lib/line.ts"
  "app/api/health/route.js"
  ".env.example"
  "CHANGELOG.md"
)

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

rollback(){
  code=$?
  if [[ $code -ne 0 ]]; then
    echo ""
    echo "⚠️ R2.2 ไม่ผ่าน — คืนไฟล์เดิม"
    git restore --source=HEAD -- "${FILES[@]}" 2>/dev/null || true
    rm -f BUILD-REPORT-v11.0-R2.2-LINE-QUOTA-SURVIVAL.md
    echo "✅ Rollback complete — ยังไม่ได้ commit/push"
  fi
}
trap rollback EXIT

[[ -d .git ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"
[[ -f lib/line.ts ]] || fail "ไม่พบ lib/line.ts — ต้องติดตั้ง R2.1 LINE Smart Quota Guard ก่อน"
[[ -f app/api/health/route.js ]] || fail "ไม่พบ app/api/health/route.js"

grep -q 'getLineQuotaSnapshot' lib/line.ts || fail "lib/line.ts ยังไม่ใช่ R2.1 quota guard"
grep -q 'function quotaDecision' lib/line.ts || fail "ไม่พบ quotaDecision ของ R2.1"

say "1/8 ตรวจ main / local changes"
git fetch origin main
OTHER="$(git status --porcelain | grep -vF "$SELF" || true)"
[[ -z "$OTHER" ]] || { git status --short; fail "มี local changes อื่นค้างอยู่"; }

say "2/8 สำรองไฟล์ก่อนแก้"
BACKUP_DIR=".git/gold-pulse-backups"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/pre-r22-line-quota-$STAMP.tar.gz" "${FILES[@]}" 2>/dev/null || true
ok "Backup: $BACKUP_DIR/pre-r22-line-quota-$STAMP.tar.gz"

say "3/8 อัปเกรด R2.2 — Hard Pace + Daily Cap + Strong Burst"
python3 - <<'PY'
from pathlib import Path
import re

p = Path("lib/line.ts")
s = p.read_text()

s = s.replace(
    'integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 30, 0, 10000)',
    'integerEnv("LINE_MONTHLY_RESERVE_MESSAGES", 45, 0, 10000)'
)

start = s.find("function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {")
end = s.find("\nfunction deterministicUuid", start)
if start < 0 or end < 0:
    raise SystemExit("ERROR: quotaDecision block ไม่ตรงกับ R2.1")

new = '''function quotaDecision(snapshot: LineQuotaSnapshot, priority: LinePriority) {
  if (!snapshot.checked || !snapshot.limited || snapshot.remaining == null) {
    return { allowed: true, reason: "quota-unlimited-or-unavailable" };
  }
  if (snapshot.remaining <= 0) {
    return { allowed: false, reason: "monthly-quota-exhausted" };
  }

  // R2.2: every priority, including STRONG, must respect a hard cumulative
  // monthly pace. This prevents early-month exhaustion while keeping the
  // existing 5-minute scanner unchanged.
  const hardPacedBudget = snapshot.monthlyLimit != null
    ? Math.floor(snapshot.monthlyLimit * (snapshot.businessDaysElapsed / snapshot.businessDaysTotal))
    : null;

  const dailyCap = integerEnv("LINE_DAILY_PUSH_CAP", 12, 1, 10000);
  const strongBurst = integerEnv("LINE_STRONG_DAILY_BURST", 2, 0, 1000);
  const dailyLimit = priority === "strong" ? dailyCap + strongBurst : dailyCap;

  if (snapshot.dailyUsed != null && snapshot.dailyUsed >= dailyLimit) {
    return {
      allowed: false,
      reason: priority === "strong" ? "strong-daily-cap-used" : "daily-cap-used"
    };
  }

  if (
    hardPacedBudget != null &&
    snapshot.totalUsage != null &&
    snapshot.totalUsage >= hardPacedBudget
  ) {
    return { allowed: false, reason: "hard-monthly-pace-used" };
  }

  if (priority === "strong") {
    return {
      allowed: true,
      reason: snapshot.survivalMode ? "strong-within-hard-pace-reserve" : "strong-within-hard-pace"
    };
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

p = Path(".env.example")
s = p.read_text() if p.exists() else ""
if "LINE_MONTHLY_RESERVE_MESSAGES=" in s:
    s = re.sub(r"LINE_MONTHLY_RESERVE_MESSAGES=\d+", "LINE_MONTHLY_RESERVE_MESSAGES=45", s)
else:
    s += "\nLINE_MONTHLY_RESERVE_MESSAGES=45\n"
if "LINE_DAILY_PUSH_CAP=" not in s:
    s += "# R2.2: hard daily push ceiling; scanner still runs every 5 minutes.\nLINE_DAILY_PUSH_CAP=12\n"
if "LINE_STRONG_DAILY_BURST=" not in s:
    s += "# R2.2: STRONG may exceed the normal daily ceiling by this many messages, but never the hard monthly pace.\nLINE_STRONG_DAILY_BURST=2\n"
p.write_text(s)

p = Path("app/api/health/route.js")
s = p.read_text()
old = '''    lineQuotaGuard: {
      enabled: true,
      version: "R2.1-SMART-QUOTA-1",
      monthlyReserveDefault: 30,
      pacing: "business-day cumulative budget",
      strongUsesReserve: true,
      confirmedUsesPacedBudget: true,
      manualTestPriority: "lowest",
      monthlyLimitRetry: false
    },'''
new_health = '''    lineQuotaGuard: {
      enabled: true,
      version: "R2.2-QUOTA-SURVIVAL-1",
      monthlyReserveDefault: 45,
      pacing: "hard cumulative business-day budget for all priorities",
      dailyPushCapDefault: 12,
      strongDailyBurstDefault: 2,
      strongBypassesMonthlyPace: false,
      confirmedUsesPacedBudget: true,
      manualTestPriority: "lowest",
      monthlyLimitRetry: false
    },'''
if old in s:
    s = s.replace(old, new_health, 1)
elif 'version: "R2.2-QUOTA-SURVIVAL-1"' not in s:
    raise SystemExit("ERROR: health ยังไม่ใช่ R2.1 ที่คาดไว้")
p.write_text(s)

p = Path("CHANGELOG.md")
s = p.read_text() if p.exists() else ""
entry = '''## v11.0 R2.2 — LINE Quota Survival\n- Applies a hard cumulative monthly pace to every LINE priority, including STRONG.\n- Default LINE reserve increased from 30 to 45 messages.\n- Adds a 12-message normal daily push cap and a 2-message STRONG burst allowance.\n- STRONG no longer bypasses the monthly pace.\n- Manual LIVE TEST is blocked earlier when quota headroom is low.\n- Signal Engine, scan cadence, market logic and provider calls are unchanged.\n\n'''
if "## v11.0 R2.2 — LINE Quota Survival" not in s:
    s = entry + s
p.write_text(s)
PY

cat > BUILD-REPORT-v11.0-R2.2-LINE-QUOTA-SURVIVAL.md <<'EOF'
# GOLD PULSE X v11.0 R2.2 — LINE QUOTA SURVIVAL

## Goal
Keep the free 300-message LINE quota alive through the month without changing the 5-minute market scanner or the Signal Engine.

## Policy
- All LINE priorities, including STRONG, obey a hard cumulative business-day pace.
- CONFIRMED also obeys the existing protected reserve budget.
- Default protected reserve: 45 messages.
- Normal daily push cap: 12.
- STRONG daily burst allowance: +2, but STRONG still cannot bypass the hard monthly pace.
- Manual LIVE TEST is lowest priority and is blocked earlier when quota headroom is low.
- Monthly-limit 429 behavior from R2.1 remains unchanged.

## Scope
LINE delivery layer only. No new paid service, database, provider call, package or API key.
EOF

say "4/8 Syntax / TypeScript"
node --check app/api/health/route.js
if [[ -x node_modules/.bin/tsc ]]; then
  ./node_modules/.bin/tsc --noEmit --pretty false
else
  fail "ไม่พบ TypeScript ใน node_modules"
fi

say "5/8 Regression tests"
[[ -f scripts/test-v11-r2-signal-policy.mjs ]] && node scripts/test-v11-r2-signal-policy.mjs
[[ -f scripts/test-v11-intelligence.mjs ]] && node scripts/test-v11-intelligence.mjs
[[ -f scripts/test-v11-r1-five-candle-truth.mjs ]] && node scripts/test-v11-r1-five-candle-truth.mjs
[[ -f scripts/static-check.mjs ]] && node scripts/static-check.mjs

say "6/8 Production build"
rm -rf .next
export NEXT_TELEMETRY_DISABLED=1
export NODE_OPTIONS="--max-old-space-size=2304"
if [[ -x node_modules/.bin/next ]]; then
  if ! timeout 1200s ./node_modules/.bin/next build --webpack >"$LOG" 2>&1; then
    tail -n 120 "$LOG" || true
    fail "Production build ไม่ผ่าน"
  fi
else
  if ! timeout 1200s npm run build >"$LOG" 2>&1; then
    tail -n 120 "$LOG" || true
    fail "Production build ไม่ผ่าน"
  fi
fi
ok "Production Build PASS"

say "7/8 Commit / Push"
if git ls-files --error-unmatch "$SELF" >/dev/null 2>&1; then
  git rm -f -- "$SELF" >/dev/null
fi

git add \
  lib/line.ts \
  app/api/health/route.js \
  .env.example \
  CHANGELOG.md \
  BUILD-REPORT-v11.0-R2.2-LINE-QUOTA-SURVIVAL.md

git diff --cached --check
if git diff --cached --quiet; then
  ok "ไม่มี change ใหม่ — R2.2 อาจติดตั้งอยู่แล้ว"
else
  git commit -m "Harden LINE quota survival pacing"
  git push origin HEAD:main
fi

trap - EXIT
rm -f -- "$SELF" 2>/dev/null || true
say "8/8 COMPLETE"
echo "✅ R2.2 LINE QUOTA SURVIVAL PUSHED"
echo "✅ 45-message reserve"
echo "✅ Daily cap 12"
echo "✅ STRONG burst +2 only"
echo "✅ STRONG cannot bypass hard monthly pace"
echo "✅ Signal Engine / scan cadence unchanged"
