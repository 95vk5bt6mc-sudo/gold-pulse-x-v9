#!/usr/bin/env bash
set -Eeuo pipefail

fail(){ echo "ERROR: $*" >&2; exit 1; }

[[ -d .git ]] || fail "ไม่ใช่ Git repository"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"

echo "1/4 ตรวจ app/page.js"
if git diff --quiet -- app/page.js; then
  echo "app/page.js ไม่มีการเปลี่ยนแปลง"
else
  git diff --check -- app/page.js
  git add app/page.js
fi

echo "2/4 Commit"
if git diff --cached --quiet; then
  echo "ไม่มี staged change ใหม่สำหรับ app/page.js"
else
  git commit -m "Include v11.1 dashboard update"
fi

echo "3/4 Push"
git push origin main

echo "4/4 ตรวจสถานะสุดท้าย"
git status --short

echo
echo "SUCCESS: app/page.js ถูกจัดการและ push แล้ว"
echo "ถ้าเหลือเฉพาะ ?? gold-pulse-v11-debug-report.txt ถือว่าปกติ"
echo "ตรวจระบบหลัง Vercel deploy:"
echo "https://gold-pulse-x-v9.vercel.app/api/health"
