# ติดตั้ง GOLD PULSE X v10.2 บน iPhone

## ส่วนที่ 1 — อัปเดตโค้ด

1. เข้า GitHub Repository `gold-pulse-x-v9`
2. กด `Add file` → `Upload files`
3. อัปโหลดไฟล์ `v102.sh`
4. Commit ไปที่ branch `main`
5. เปิด Codespaces เดิม
6. เปิด Terminal แล้วรัน:

```bash
git pull origin main
bash v102.sh
```

รอจนเห็น:

```text
SUCCESS: v10.2 Adaptive Quality pushed to GitHub.
```

ตัวติดตั้งรองรับต้นทาง v10.0.0 และ v10.1.0

## ส่วนที่ 2 — ยังไม่ต้องเชื่อม Upstash Redis ใน Vercel

v10.2 ต้องใช้ฐานข้อมูลเล็ก ๆ เพื่อจำเวลาส่งล่าสุดข้าม Vercel Functions

1. เข้า Vercel Dashboard
2. เปิดโปรเจกต์ `gold-pulse-x-v9`
3. เข้า `Storage` หรือ `Marketplace`
4. เลือก `Upstash Redis`
5. สร้างฐานข้อมูลฟรีหรือเชื่อมบัญชี Upstash เดิม
6. Connect ฐานข้อมูลเข้ากับโปรเจกต์นี้
7. ตรวจใน Project Settings → Environment Variables ว่ามี:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

8. Redeploy deployment ล่าสุด

ห้ามส่งภาพที่เห็นค่า Token และห้ามใส่ Token ลง GitHub

## ส่วนที่ 3 — ตรวจระบบ

เปิด:

```text
https://gold-pulse-x-v9.vercel.app/api/health
```

ควรเห็นค่าหลัก:

```text
version: 10.2.0
signalProfile: ADAPTIVE_QUALITY_30_LITE
adaptiveCadence.hardThirtyMinuteLimit: false
adaptiveState.configured: true
adaptiveState.ready: true
```

จากนั้นปล่อย cron-job.org ทำงานทุก 5 นาทีเหมือนเดิม ไม่ต้องเปลี่ยนความถี่และไม่ต้องเปิด GitHub schedule กลับมา

## เมื่อ Health ขึ้น 503

ดู `adaptiveState.warning` ก่อน หากระบุว่า Upstash variables หาย ให้กลับไปเชื่อม Upstash และ Redeploy
