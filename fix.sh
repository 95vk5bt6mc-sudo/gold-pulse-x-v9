#!/usr/bin/env bash
set -Eeuo pipefail

die(){ echo "❌ $*" >&2; exit 1; }
ok(){ echo "✅ $*"; }

[[ -d .git ]] || die "เปิดที่ root ของ repo"
[[ -f app/page.js ]] || die "ไม่พบ app/page.js"

echo "1/4 FIX UI"
python3 - <<'PY'
from pathlib import Path

p = Path("app/page.js")
s = p.read_text()

replacements = {
    "GOLD PULSE X v11.1 MAIN TREND GUARD": "GOLD PULSE X v11.1.1 TREND PERSISTENCE HARD GATE",
    "v11.1 MAIN TREND": "v11.1.1 TREND PERSISTENCE",
    "MAIN TREND GUARD": "TREND PERSISTENCE HARD GATE",
}

changed = False
for old, new in replacements.items():
    if old in s:
        s = s.replace(old, new)
        changed = True

if not changed:
    raise SystemExit("❌ ไม่พบข้อความ v11.1 เดิมใน app/page.js")

p.write_text(s)
print("✅ อัปเดตชื่อหน้า Dashboard เป็น v11.1.1 แล้ว")
PY

echo "2/4 BUILD"
npm run build

echo "3/4 COMMIT"
git add app/page.js
git commit -m "Update dashboard to v11.1.1 Trend Persistence Hard Gate"

echo "4/4 PUSH"
git push origin main

ok "UI v11.1.1 push แล้ว"
echo "รอ Vercel 1–3 นาที แล้วรีเฟรชหน้าเว็บ"
