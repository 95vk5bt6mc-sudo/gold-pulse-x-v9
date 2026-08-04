# GOLD PULSE X v10.2 — ADAPTIVE QUALITY 30

ระบบวิเคราะห์ XAU/USD ใช้ข้อมูล 1M และ 5M, สแกนผ่าน cron-job.org ทุก 5 นาที และส่ง LINE เฉพาะจังหวะที่ผ่านทั้ง Base Entry Gate และ Adaptive Quality Gate

## หลักการ v10.2

```text
สแกนทุก 5 นาที
→ ตรวจ Base Entry Gate
→ คำนวณ Adaptive Quality
→ เทียบเกณฑ์ตามเวลาจากสัญญาณล่าสุด
→ ส่ง LINE เฉพาะจังหวะที่ผ่าน
```

ระบบไม่มีข้อจำกัดตายตัวหนึ่งออร์เดอร์ต่อครึ่งชั่วโมง:

- สัญญาณยอดเยี่ยมผ่านได้เร็ว
- สัญญาณคุณภาพดีมีแนวโน้มผ่านใกล้ 30 นาที
- สัญญาณอ่อนจะไม่ถูกฝืนส่ง แม้รอนาน
- สัญญาณซ้ำทิศเดิมและกลับทิศเร็วถูกตรวจเข้มขึ้น

## ค่าเริ่มต้น

| ช่วงเวลา | Adaptive Quality ขั้นต่ำ |
|---|---:|
| First qualified signal | 78 |
| 0–10 นาที | 92 |
| 10–20 นาที | 86 |
| 20–30 นาที | 80 |
| 30–45 นาที | 76 |
| 45–60 นาที | 74 |
| 60+ นาที | 72 |

เป้าหมาย 30 นาทีเป็น cadence estimate ไม่ใช่คำสั่งว่าต้องมีออร์เดอร์ครบทุกครึ่งชั่วโมง

## Upstash Redis จำเป็นต่อ LINE Alert

เพิ่ม Vercel Environment Variables:

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
ADAPTIVE_STATE_REQUIRED=true
```

ฐานข้อมูลใช้จำเวลาส่งล่าสุด ทิศทาง Quality ราคา Entry จำนวนสัญญาณประจำวัน และ Candidate ล่าสุด

หาก Upstash ยังไม่พร้อม ระบบจะไม่ส่ง Adaptive LINE Alert เพื่อป้องกันการส่งถี่จาก Vercel instances ที่จำสถานะร่วมกันไม่ได้

## Environment หลัก

ดูตัวอย่างทั้งหมดที่ `.env.example`

```text
TWELVE_DATA_API_KEY
GOLD_PULSE_API_SECRET
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_TARGET_ID
LINE_ALERTS_ENABLED=true
ADAPTIVE_SIGNAL_MODE=true
TARGET_SIGNAL_INTERVAL_MINUTES=30
DAILY_ALERT_SAFETY_CAP=32
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ADAPTIVE_STATE_REQUIRED=true
```

## Scheduler

- cron-job.org: ทุก 5 นาที
- Active hours: 08:00–24:00 Asia/Bangkok
- GitHub Actions: manual `workflow_dispatch` เท่านั้น

## ตรวจระบบ

```bash
node scripts/static-check.mjs
node scripts/test-v10.mjs
node scripts/test-v10-integration.mjs
node scripts/test-v10.2-adaptive.mjs
```

Health endpoint:

```text
/api/health
```

## คำเตือน

Probability และ Adaptive Quality เป็นคะแนนประเมินของระบบ ไม่ใช่อัตราชนะที่พิสูจน์แล้ว การแจ้งเตือนไม่ใช่คำแนะนำลงทุน ต้องตรวจราคาจริง สเปรด ค่าคอมมิชชัน และกำหนดความเสี่ยงเอง
