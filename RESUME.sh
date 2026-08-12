#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

SELF="$(basename "$0")"
LOG="/tmp/gold-pulse-r1-resume-build.log"

[[ -f package.json ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -d .git ]] || fail "ไม่พบ Git repository"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[[ "$VERSION" == "11.0.0" ]] || fail "รองรับ v11.0.0 เท่านั้น (พบ $VERSION)"

BRANCH="$(git branch --show-current 2>/dev/null || true)"
[[ "$BRANCH" == "main" ]] || fail "ต้องอยู่ branch main (พบ $BRANCH)"

say "1/7 ตรวจสถานะและยกเลิก rebase ค้างถ้ามี"
if [[ -d .git/rebase-merge || -d .git/rebase-apply ]]; then
  git rebase --abort || fail "ยกเลิก rebase ค้างไม่สำเร็จ"
fi

say "2/7 Fetch origin/main"
git fetch origin main || fail "git fetch ไม่สำเร็จ"

say "3/7 เคลียร์ไฟล์ตัวช่วย local ที่อาจชนตอน sync"
# Bash script can safely remove its own path while already running.
HELPER_LOCAL=(
  "$SELF"
  "FIX.sh"
  "RUN.sh"
  "AUTO-INSTALL-GOLD-PULSE-X-v11.0-R1.sh"
  "RUN-ONCE-GOLD-PULSE-BUILD-CHECK-v2.sh"
  "RUN-ONCE-GOLD-PULSE-BUILD-DIAG.sh"
)
for f in "${HELPER_LOCAL[@]}"; do
  if ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    rm -f -- "$f" 2>/dev/null || true
  fi
done

say "4/7 Sync origin/main แบบ merge (ไม่ detach HEAD)"
# Only merge if origin/main contains commits not already in local HEAD.
if ! git merge-base --is-ancestor origin/main HEAD; then
  git merge --no-edit origin/main || fail "Merge origin/main ไม่สำเร็จ — ยังไม่ Push"
else
  echo "Local HEAD มี origin/main อยู่แล้ว ไม่ต้อง merge"
fi

say "5/7 Production Build หลัง Sync"
if npm run build >"$LOG" 2>&1; then
  ok "BUILD PASS"
else
  printf '\n\033[1;31m❌ BUILD FAIL หลัง Sync\033[0m\n'
  grep -Ein -B2 -A8 'error|failed|cannot|module|syntax|type|unexpected|invalid|not found|compile|build' \
    "$LOG" 2>/dev/null | tail -n 70 || tail -n 50 "$LOG"
  printf '\nยังไม่ได้ Push\n'
  exit 1
fi

say "6/7 ลบไฟล์ติดตั้ง/ตรวจสอบชั่วคราวจาก GitHub"
HELPERS=(
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

git diff --check || fail "git diff --check ไม่ผ่าน"

if ! git diff --cached --quiet; then
  if [[ -z "$(git config user.name || true)" ]]; then git config user.name "GOLD PULSE Updater"; fi
  if [[ -z "$(git config user.email || true)" ]]; then git config user.email "gold-pulse-updater@users.noreply.github.com"; fi
  git commit -m "Finalize R1 and remove temporary installers" || fail "Cleanup commit ไม่สำเร็จ"
fi

say "7/7 Push main"
git push origin HEAD:main || fail "Push ไม่สำเร็จ"

ok "SUCCESS — GOLD PULSE X v11.0 R1 FIVE-CANDLE TRUTH DEPLOY SOURCE READY"
printf '\n✅ Build ผ่าน\n✅ Sync main ผ่าน\n✅ R1 ถูก Push\n✅ RUN/FIX/Installer/ZIP ชั่วคราวถูกลบจาก Repository\n✅ พร้อมให้ Vercel Deploy\n'
