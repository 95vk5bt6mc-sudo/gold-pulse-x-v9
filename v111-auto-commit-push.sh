#!/usr/bin/env bash
set -Eeuo pipefail

fail(){ echo "ERROR: $*" >&2; exit 1; }

[[ -d .git ]] || fail "ไม่ใช่ Git repository"
[[ -f package.json ]] || fail "ไม่พบ package.json"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"

echo "1/5 ตรวจสถานะ"
git status --short

echo "2/5 Stage เฉพาะไฟล์ v11.1"
for f in   package.json   package-lock.json   README.md   CHANGELOG.md   app/api/health/route.js   lib/config.ts   lib/alerts.ts   lib/intelligence/five-minute-intelligence.js   scripts/static-check.mjs   scripts/test-v11-main-trend-guard.mjs
do
  [[ -e "$f" ]] && git add -- "$f"
done

git reset --quiet -- gold-pulse-v11-debug-report.txt 2>/dev/null || true
git reset --quiet -- gold-pulse-v11-debug-collector.sh 2>/dev/null || true
git reset --quiet -- app/page.js 2>/dev/null || true

echo "===== STAGED FILES ====="
git diff --cached --name-status

git diff --cached --quiet && fail "ไม่มีไฟล์ให้ Commit"

echo "3/5 Commit"
git commit -m "Upgrade to v11.1 Main Trend Guard"

echo "4/5 Push"
git push origin main

echo "5/5 ตรวจสถานะ"
git status --short

echo "SUCCESS: Commit/Push v11.1 เรียบร้อย"
echo "ตรวจหลัง Vercel deploy:"
echo "https://gold-pulse-x-v9.vercel.app/api/health"
