#!/usr/bin/env bash
set -Eeuo pipefail

FILE="BUILD-REPORT-v11.0-R1-FIVE-CANDLE-TRUTH.md"
COMMIT="76172652417b1791b31066770a3531ad3fe0cf48"

echo "=== GOLD PULSE X — RESTORE R1 BUILD REPORT ==="

[[ -d .git ]] || { echo "ERROR: ไม่พบ Git repository"; exit 1; }
[[ -f package.json ]] || { echo "ERROR: ต้องรันที่ root ของ gold-pulse-x-v9"; exit 1; }

git checkout "${COMMIT}^" -- "$FILE"
git add "$FILE"

if git diff --cached --quiet; then
  echo "ไฟล์มีอยู่แล้ว ไม่ต้อง restore"
else
  git commit -m "Restore R1 five-candle truth build report"
fi

git push origin main

echo "✅ RESTORE COMPLETE"
rm -f -- "$0" 2>/dev/null || true
