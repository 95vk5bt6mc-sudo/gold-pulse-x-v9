# อัปเดต GOLD PULSE X v9.8 เป็น v10 บน iPhone

1. ดาวน์โหลด `v100.sh`
2. เข้า GitHub repository `gold-pulse-x-v9`
3. กด Add file → Upload files → เลือก `v100.sh` → Commit ไปที่ `main`
4. เปิด Codespaces เดิม
5. ใน Terminal รัน `git pull origin main`
6. รัน `bash v100.sh`
7. รอข้อความ `SUCCESS: v10 Pulse Engine pushed to GitHub.`
8. รอ Vercel Deploy ประมาณ 1–3 นาที
9. เปิด `/api/health` และตรวจ `version: 10.0.0`, `signalProfile: ACTIVE_20_PULSE`
10. ไป GitHub Actions → GOLD PULSE Server Scan → Run workflow
11. ใน Log ตรวจ `decision`, `pulseFallback` และ `lineAlert.sent`

ไม่ต้องแก้ LINE token, Vercel environment variables หรือ GitHub Actions secrets เพิ่ม หากระบบ v9.8 ส่ง LINE ได้อยู่แล้ว
