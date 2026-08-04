#!/usr/bin/env bash
set -Eeuo pipefail

python3 - <<'PY'
from pathlib import Path
import re

# Dashboard
p = Path("app/page.js")
s = p.read_text()

s = s.replace(
    "X v10.2 ADAPTIVE QUALITY",
    "X v10.3.1 CLASSIC 9.8 PRO PLUS"
)

new_logic = '''<section className="panel logic">
  <p className="eyebrow">MODEL LOGIC v10.3.1 CLASSIC 9.8 PRO PLUS</p>
  <h2>ระบบ v9.8 ที่ปรับตัวกรองให้แข็งและมีคุณภาพขึ้น</h2>
  <p>ใช้แนวโน้ม 5M และ Forecast 3/5 แท่งเป็นแกนหลัก ตรวจ Momentum, Directional Edge, Confirmation, Market Regime และความเสี่ยงก่อนส่ง LINE ปิด PULSE และไม่ผ่อนเกณฑ์เพราะรอนาน สแกนผ่าน cron-job.org ทุก 5 นาที โดยไม่ใช้ Redis และไม่รับประกันจำนวนสัญญาณหรือผลกำไร</p>
</section>'''

s, count = re.subn(
    r'<section className="panel logic">.*?</section>',
    new_logic,
    s,
    count=1,
    flags=re.S
)

if count != 1:
    raise SystemExit("ERROR: ไม่พบส่วน MODEL LOGIC ใน app/page.js")

p.write_text(s)

# Browser title
p = Path("app/layout.js")
s = p.read_text()
s = s.replace(
    'title: "GOLD PULSE X v10.2 Adaptive Quality"',
    'title: "GOLD PULSE X v10.3.1 Classic 9.8 Pro Plus"'
)
s = s.replace(
    'description: "XAU/USD dashboard with cron-job.org scans and adaptive-quality LINE alerts"',
    'description: "XAU/USD Classic 9.8 Pro Plus dashboard with cron-job.org scans and quality-first LINE alerts"'
)
p.write_text(s)

# Health API name
p = Path("app/api/health/route.js")
s = p.read_text()
s, count = re.subn(
    r'app: "GOLD PULSE X [^"]+"',
    'app: "GOLD PULSE X v10.3.1 CLASSIC 9.8 PRO PLUS"',
    s,
    count=1
)

if count != 1:
    raise SystemExit("ERROR: ไม่พบชื่อ App ใน Health API")

p.write_text(s)

# README
Path("README.md").write_text("""# GOLD PULSE X v10.3.1 — CLASSIC 9.8 PRO PLUS

ระบบวิเคราะห์ XAU/USD ใช้ข้อมูล 1M และ 5M โดยใช้แนวคิดของ v9.8 เป็นแกนหลัก และปรับตัวกรองคุณภาพให้เข้มขึ้น

## การทำงาน

- cron-job.org สแกนทุก 5 นาที
- Active hours 08:00–24:00 Asia/Bangkok
- ใช้ 5M Trend และ Forecast 3/5 แท่งเป็นแกน
- ตรวจ Momentum, Directional Edge, Confirmation และ Market Regime
- ปิด PULSE fallback
- ไม่ใช้ Adaptive time relaxation
- ไม่ใช้ Redis
- Risk HIGH ถูกบล็อก
- ส่ง LINE เฉพาะสัญญาณที่ผ่านเกณฑ์

ระบบไม่รับประกันจำนวนสัญญาณ อัตราชนะ หรือผลกำไร
""")

print("UI และเอกสารเปลี่ยนเป็น v10.3.1 แล้ว")
PY

npm run build
git add app/page.js app/layout.js app/api/health/route.js README.md
git commit -m "Update UI labels to v10.3.1 Classic 9.8 Pro Plus"
git push origin main
