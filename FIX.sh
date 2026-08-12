#!/usr/bin/env bash
set -Eeuo pipefail

say(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
ok(){ printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail(){ printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

SELF="$(basename "$0")"
LOG="/tmp/gold-pulse-r1-fix-build.log"

[[ -f package.json ]] || fail "ต้องรันที่ root ของ gold-pulse-x-v9"
[[ -d .git ]] || fail "ไม่พบ Git repository"

VERSION="$(node -p "require('./package.json').version" 2>/dev/null || true)"
[[ "$VERSION" == "11.0.0" ]] || fail "รองรับ v11.0.0 เท่านั้น (พบ $VERSION)"
[[ -f lib/alerts.ts ]] || fail "ไม่พบ lib/alerts.ts"
[[ -f lib/intelligence/five-candle-truth.js ]] || fail "ไม่พบ R1 Five-Candle Truth ที่ติดตั้งค้างอยู่"

say "1/6 แก้ TypeScript 'f implicitly has an any type'"
python3 - <<'PY'
from pathlib import Path

p = Path("lib/alerts.ts")
s = p.read_text()

old = '.slice(0,5).map((f) => `#${f.candle}:${f.direction}`).join(" ")'
new = '.slice(0,5).map((f: { candle: number; direction: string }) => `#${f.candle}:${f.direction}`).join(" ")'

if new in s:
    print("Type fix already present")
elif old in s:
    s = s.replace(old, new, 1)
    p.write_text(s)
    print("Type fix applied")
else:
    raise SystemExit("ERROR: ไม่พบ 5C future callback ที่คาดไว้ใน lib/alerts.ts")
PY

say "2/6 ตรวจ Syntax + R1 Regression"
node --check lib/intelligence/five-candle-truth.js || fail "five-candle-truth syntax ไม่ผ่าน"
if [[ -f scripts/test-v11-r1-five-candle-truth.mjs ]]; then
  node scripts/test-v11-r1-five-candle-truth.mjs || fail "R1 regression ไม่ผ่าน"
fi
if [[ -f scripts/static-check.mjs ]]; then
  node scripts/static-check.mjs || fail "Static check ไม่ผ่าน"
fi

say "3/6 Production Build"
if npm run build >"$LOG" 2>&1; then
  ok "BUILD PASS"
else
  printf '\n\033[1;31m❌ BUILD FAIL\033[0m\n'
  grep -Ein -B2 -A8 'error|failed|cannot|module|syntax|type|unexpected|invalid|not found|compile|build' "$LOG" \
    2>/dev/null | tail -n 70 || tail -n 50 "$LOG"
  printf '\nยังไม่ได้ Commit / Push\n'
  exit 1
fi

say "4/6 Cleanup ไฟล์ชั่วคราว"
HELPERS=(
  "RUN.sh"
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

# ถ้า FIX.sh ถูกอัปโหลด/commit ไว้ใน GitHub ให้ stage การลบตัวเองด้วย
if git ls-files --error-unmatch "$SELF" >/dev/null 2>&1; then
  git rm -f -- "$SELF" >/dev/null 2>&1 || true
fi

say "5/6 Stage เฉพาะไฟล์ R1 ที่รู้จัก"
FILES=(
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
for f in "${FILES[@]}"; do
  [[ -e "$f" ]] && git add -- "$f"
done

git diff --cached --check || fail "พบปัญหาใน staged diff"

if git diff --cached --quiet; then
  ok "ไม่มี R1 change ใหม่ให้ Commit"
else
  if [[ -z "$(git config user.name || true)" ]]; then git config user.name "GOLD PULSE Updater"; fi
  if [[ -z "$(git config user.email || true)" ]]; then git config user.email "gold-pulse-updater@users.noreply.github.com"; fi
  git commit -m "Fix R1 type check and finalize five-candle truth" || fail "Commit ไม่สำเร็จ"
fi

say "6/6 Sync + Push"
git fetch origin main || fail "fetch origin main ไม่สำเร็จ"

if ! git merge-base --is-ancestor origin/main HEAD; then
  git pull --rebase origin main || fail "Rebase ไม่สำเร็จ — ยังไม่ Push"
fi

git push origin HEAD:main || fail "Push ไม่สำเร็จ"

# ลบ self ใน Codespace ถ้ายังเป็น untracked
rm -f -- "$SELF" 2>/dev/null || true

ok "SUCCESS — GOLD PULSE X v11.0 R1 FIVE-CANDLE TRUTH BUILD PASS + PUSHED"
printf '\nVercel สามารถ Deploy จาก main ต่อได้ และ Core Signal เดิมยังถูกเก็บไว้\n'
