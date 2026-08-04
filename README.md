# GOLD PULSE X v10.3.1 — CLASSIC 9.8 PRO PLUS

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
