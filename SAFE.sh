#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
warn(){ printf '\n\033[1;33m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

SELF="$(basename "$0")"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR=".git/gold-pulse-backups"
LOG="/tmp/gold-pulse-safe-build.log"

[[ -f package.json ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -d .git ]] || fail "ไม่พบ Git repository"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[[ "$VERSION" == "11.0.0" ]] || fail "SAFE.sh รองรับ v11.0.0 เท่านั้น (พบ $VERSION)"

BRANCH="$(git branch --show-current 2>/dev/null || true)"
[[ "$BRANCH" == "main" ]] || fail "ต้องอยู่ branch main (พบ $BRANCH)"

[[ -f lib/intelligence/five-candle-truth.js ]] || fail "ไม่พบ R1 five-candle-truth.js"
[[ -f lib/intelligence/five-minute-intelligence.js ]] || fail "ไม่พบ v11 five-minute-intelligence.js"
[[ -f lib/alerts.ts ]] || fail "ไม่พบ lib/alerts.ts"

if [[ -f .github/workflows/gold-pulse-scan.yml ]] && grep -Eq '^[[:space:]]*schedule:' .github/workflows/gold-pulse-scan.yml; then
  fail "GitHub schedule ยังเปิดอยู่ — ต้องให้ cron-job.org เป็น scheduler หลักเพียงตัวเดียว"
fi

say "1/9 สำรองสถานะก่อนทำต่อ"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/pre-safe-r1-$STAMP.tar.gz" \
  package.json next.config.mjs \
  app/page.js app/api/gold/route.js app/api/health/route.js \
  lib/alerts.ts lib/intelligence/five-minute-intelligence.js \
  lib/intelligence/five-candle-truth.js \
  scripts/static-check.mjs scripts/test-v11-intelligence.mjs \
  scripts/test-v11-r1-five-candle-truth.mjs \
  2>/dev/null || true

git diff > "$BACKUP_DIR/pre-safe-r1-$STAMP-working.patch" || true
git diff --cached > "$BACKUP_DIR/pre-safe-r1-$STAMP-staged.patch" || true
ok "Backup เก็บใน $BACKUP_DIR"

say "2/9 เคลียร์ Git operation ที่ค้าง"
if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  git rebase --abort || fail "ยกเลิก rebase ค้างไม่สำเร็จ"
fi
if [[ -f .git/MERGE_HEAD ]]; then
  git merge --abort || fail "ยกเลิก merge ค้างไม่สำเร็จ"
fi

say "3/9 ตรวจ R1 Regression + Static + TypeScript"
node --check lib/intelligence/five-candle-truth.js || fail "five-candle-truth syntax ไม่ผ่าน"
node --check lib/intelligence/five-minute-intelligence.js || fail "five-minute-intelligence syntax ไม่ผ่าน"
node --check app/api/gold/route.js || fail "Gold API syntax ไม่ผ่าน"
node --check app/api/health/route.js || fail "Health API syntax ไม่ผ่าน"

[[ -f scripts/test-v11-intelligence.mjs ]] && \
  node scripts/test-v11-intelligence.mjs || fail "v11 regression ไม่ผ่าน"

[[ -f scripts/test-v11-r1-five-candle-truth.mjs ]] && \
  node scripts/test-v11-r1-five-candle-truth.mjs || fail "R1 regression ไม่ผ่าน"

[[ -f scripts/static-check.mjs ]] && \
  node scripts/static-check.mjs || fail "Static check ไม่ผ่าน"

if [[ -x node_modules/.bin/tsc ]]; then
  node_modules/.bin/tsc --noEmit --pretty false || fail "TypeScript check ไม่ผ่าน"
else
  fail "ไม่พบ TypeScript ใน node_modules"
fi

say "4/9 Commit R1 local ที่ผ่าน Test ก่อน Sync"
R1_FILES=(
  "lib/intelligence/five-candle-truth.js"
  "lib/intelligence/five-minute-intelligence.js"
  "app/api/gold/route.js"
  "app/api/health/route.js"
  "app/page.js"
  "lib/alerts.ts"
  "scripts/static-check.mjs"
  "scripts/test-v11-r1-five-candle-truth.mjs"
  "BUILD-REPORT-v11.0-R1-FIVE-CANDLE-TRUTH.md"
)

for f in "${R1_FILES[@]}"; do
  [[ -e "$f" ]] && git add -- "$f"
done

git diff --cached --check || fail "R1 staged diff ไม่ผ่าน"

if ! git diff --cached --quiet; then
  [[ -n "$(git config user.name || true)" ]] || git config user.name "GOLD PULSE Updater"
  [[ -n "$(git config user.email || true)" ]] || git config user.email "gold-pulse-updater@users.noreply.github.com"
  git commit -m "Finalize v11 R1 five-candle truth" || fail "Commit R1 local ไม่สำเร็จ"
else
  echo "R1 ไม่มี change ใหม่ที่ต้อง commit"
fi

# Unknown local modifications are not allowed to be silently included.
UNKNOWN="$(git status --porcelain | grep -vE '^\?\? (SAFE\.sh|FIX\.sh|RUN\.sh|RESUME\.sh)$' || true)"
if [[ -n "$UNKNOWN" ]]; then
  warn "พบไฟล์ local อื่นที่ไม่ใช่ R1:"
  printf '%s\n' "$UNKNOWN"
  fail "หยุดเพื่อไม่เขียนทับไฟล์ที่ไม่รู้จัก"
fi

say "5/9 Fetch + Sync origin/main แบบ merge"
git fetch origin main || fail "git fetch origin main ไม่สำเร็จ"

if ! git merge-base --is-ancestor origin/main HEAD; then
  git merge --no-edit origin/main || fail "Merge origin/main ไม่สำเร็จ — ยังไม่ Push"
else
  echo "origin/main อยู่ใน local history แล้ว"
fi

say "6/9 ตรวจ TypeScript อีกครั้งหลัง Sync"
node_modules/.bin/tsc --noEmit --pretty false || fail "TypeScript หลัง Sync ไม่ผ่าน"

say "7/9 Memory-safe Production Build (Next 16 + Webpack)"
rm -rf .next 2>/dev/null || true

MEM_MB="$(awk '/MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 4096)"
if [[ "$MEM_MB" -lt 3500 ]]; then
  HEAP_MB=1536
elif [[ "$MEM_MB" -lt 6500 ]]; then
  HEAP_MB=2304
else
  HEAP_MB=3072
fi

echo "RAM ประมาณ ${MEM_MB} MB · Node heap limit ${HEAP_MB} MB"
echo "ใช้ next build --webpack เพื่อลดความเสี่ยง Turbopack ถูกตัดกลางทาง"
echo "กำลัง Build (อาจใช้เวลาหลายนาที):"

set +e
(
  export NEXT_TELEMETRY_DISABLED=1
  export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}"
  timeout 1200s node_modules/.bin/next build --webpack >"$LOG" 2>&1
) &
BUILD_PID=$!

while kill -0 "$BUILD_PID" 2>/dev/null; do
  printf '.'
  sleep 10
done

wait "$BUILD_PID"
BUILD_CODE=$?
set -e
printf '\n'

if [[ "$BUILD_CODE" -ne 0 ]]; then
  printf '\n\033[1;31m❌ MEMORY-SAFE BUILD FAIL (exit %s)\033[0m\n' "$BUILD_CODE"
  if [[ "$BUILD_CODE" -eq 124 ]]; then
    echo "Build เกินเวลา 20 นาที"
  elif [[ "$BUILD_CODE" -eq 137 ]]; then
    echo "Process ถูก kill — มีแนวโน้มว่า RAM ไม่พอ"
  fi
  echo "===== BUILD ERROR ====="
  tail -n 80 "$LOG" || true
  echo "===== END ====="
  echo "ยังไม่ได้ Push"
  exit 1
fi

ok "MEMORY-SAFE BUILD PASS"

say "8/9 ลบไฟล์ Helper/Installer ชั่วคราว"
HELPERS=(
  "SAFE.sh"
  "FIX.sh"
  "RUN.sh"
  "RESUME.sh"
  "AUTO-INSTALL-GOLD-PULSE-X-v11.0-R1.sh"
  "GOLD-PULSE-X-v11.0-R1-AUTO-INSTALL.zip"
  "GOLD-PULSE-X-BUILD-CHECK-v2-AUTO.zip"
  "RUN-ONCE-GOLD-PULSE-BUILD-CHECK-v2.sh"
  "GOLD-PULSE-X-R1-BUILD-DIAG-AUTO.zip"
  "RUN-ONCE-GOLD-PULSE-BUILD-DIAG.sh"
  "GOLD-PULSE-X-v11.0-R1-FIVE-CANDLE-TRUTH.zip"
)

for f in "${HELPERS[@]}"; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    git rm -f -- "$f" >/dev/null 2>&1 || true
  else
    rm -f -- "$f" 2>/dev/null || true
  fi
done

if ! git diff --cached --quiet; then
  [[ -n "$(git config user.name || true)" ]] || git config user.name "GOLD PULSE Updater"
  [[ -n "$(git config user.email || true)" ]] || git config user.email "gold-pulse-updater@users.noreply.github.com"
  git commit -m "Remove temporary R1 installers" || fail "Cleanup commit ไม่สำเร็จ"
fi

say "9/9 Push main แบบ Fast-forward เท่านั้น"
git fetch origin main || fail "fetch รอบสุดท้ายไม่สำเร็จ"

if ! git merge-base --is-ancestor origin/main HEAD; then
  fail "origin/main เปลี่ยนระหว่าง Build — หยุดเพื่อความปลอดภัย ยังไม่ Push"
fi

git push origin HEAD:main || fail "Push main ไม่สำเร็จ"

rm -f -- "$SELF" 2>/dev/null || true

ok "SUCCESS — GOLD PULSE X v11.0 R1 FIVE-CANDLE TRUTH SAFE BUILD + PUSH COMPLETE"
printf '\n✅ Regression PASS\n✅ TypeScript PASS\n✅ Webpack production build PASS\n✅ R1 Push main สำเร็จ\n✅ Helper/Installer ถูกลบ\n✅ ไม่เพิ่ม API / Database / Paid service\n✅ พร้อมให้ Vercel Deploy\n'
