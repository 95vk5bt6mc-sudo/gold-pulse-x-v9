# อัปเดต GOLD PULSE X v9.7 เป็น v9.8 บน iPhone

1. อัปโหลด `v98.sh` ที่หน้าแรกของ Repository เดียวกับ `package.json`
2. เปิด Codespaces เดิม
3. เปิด Terminal
4. รัน `git pull origin main`
5. รัน `bash v98.sh`
6. รอข้อความ `SUCCESS: v9.8 Scout Signal pushed to GitHub.`
7. รอ Vercel 1–3 นาที
8. เปิด `/api/health` และตรวจ `version: 9.8.0` กับ `signalProfile: ACTIVE_20_SCOUT`
9. ไปที่ Actions แล้ว Run workflow หนึ่งครั้ง

ไม่ต้องแก้ LINE Token, LINE Target ID, Vercel Environment Variables หรือ GitHub Secrets
