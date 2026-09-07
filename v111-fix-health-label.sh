#!/usr/bin/env bash
set -Eeuo pipefail

fail(){ echo "ERROR: $*" >&2; exit 1; }

[[ -d .git ]] || fail "ไม่ใช่ Git repository"
[[ -f app/api/health/route.js ]] || fail "ไม่พบ app/api/health/route.js"
[[ "$(git branch --show-current)" == "main" ]] || fail "ต้องอยู่ branch main"

echo "1/5 แก้ชื่อ app ใน Health API"
python3 - <<'PY'
from pathlib import Path
import re

p = Path("app/api/health/route.js")
s = p.read_text()

new = 'app: "GOLD PULSE X v11.1 MAIN TREND GUARD"'
s2, n = re.subn(r'app:\s*"GOLD PULSE X [^"]+"', new, s, count=1)

if n == 0:
    raise SystemExit("ERROR: ไม่พบ app label ใน Health API")

p.write_text(s2)
print("✅ Health app label -> GOLD PULSE X v11.1 MAIN TREND GUARD")
PY

echo "2/5 ตรวจ diff"
git diff --check -- app/api/health/route.js
git diff -- app/api/health/route.js

echo "3/5 Build"
npm run build

echo "4/5 Commit / Push"
git add app/api/health/route.js
if git diff --cached --quiet; then
  echo "ไม่มีการเปลี่ยนแปลงใหม่ให้ Commit"
else
  git commit -m "Fix v11.1 health app label"
  git push origin main
fi

echo "5/5 เสร็จ"
echo "SUCCESS: Health label แก้และ push แล้ว"
echo "ตรวจหลัง Vercel deploy:"
echo "https://gold-pulse-x-v9.vercel.app/api/health"
