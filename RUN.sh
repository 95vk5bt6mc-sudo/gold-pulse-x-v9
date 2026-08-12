#!/usr/bin/env bash
set -u

SELF="$(basename "$0")"
LOG="/tmp/gold-pulse-build-mobile.log"

cleanup() {
  rm -f -- "$0" 2>/dev/null || true
}
trap cleanup EXIT

echo
echo "========================================"
echo " GOLD PULSE X — MOBILE ONE-TAP CHECK"
echo "========================================"

if [[ ! -f package.json ]]; then
  echo "❌ ERROR: วาง RUN.sh ไว้ที่ root ของ gold-pulse-x-v9"
  exit 2
fi

echo "Version: $(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
echo "Branch : $(git branch --show-current 2>/dev/null || echo unknown)"
echo
echo "กำลังตรวจ Production Build..."

npm run build >"$LOG" 2>&1
CODE=$?

echo
if [[ "$CODE" -eq 0 ]]; then
  echo "✅ BUILD PASS"
  echo "Production build ผ่าน"
  echo "R1 พร้อมไปขั้น Commit/Push ต่อ"
  exit 0
fi

echo "❌ BUILD FAIL"
echo
echo "===== ERROR SUMMARY ====="

grep -Ein -B2 -A8 \
  'error|failed|failure|cannot|module|syntax|type|unexpected|invalid|not found|compile|build' \
  "$LOG" 2>/dev/null | tail -n 60 > /tmp/gold-pulse-mobile-important.txt || true

if [[ -s /tmp/gold-pulse-mobile-important.txt ]]; then
  cat /tmp/gold-pulse-mobile-important.txt
else
  tail -n 45 "$LOG"
fi

echo
echo "===== END ====="
echo "ไม่ได้ Commit / Push / แก้ Production"
echo "ส่งภาพตั้งแต่ BUILD FAIL ถึง END มาให้ผม"
exit "$CODE"
