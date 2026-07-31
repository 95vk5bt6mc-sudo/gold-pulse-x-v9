# ติดตั้งจาก iPhone แบบทีละขั้น

1. แตก ZIP ในแอป Files
2. สร้าง GitHub repository แบบ Public เพื่อให้การสแกน 5–15 นาทีไม่กิน billable Actions minutes
3. อัปโหลดไฟล์ทั้งหมดขึ้น repository
4. เข้า Vercel ผ่าน Safari → Add New Project → Import Git Repository
5. ใส่ Environment Variables ตาม `.env.example`
6. Deploy และเปิด `/api/health`
7. ตั้ง LINE Webhook เป็น `https://โดเมน.vercel.app/api/line/webhook`
8. เพิ่ม Official Account เป็นเพื่อน หรือส่งคำว่า `id` เพื่อรับ `LINE_TARGET_ID`
9. ใส่ `LINE_TARGET_ID` ใน Vercel แล้ว Redeploy
10. ใส่ GitHub Actions secrets `GOLD_PULSE_URL` และ `GOLD_PULSE_API_SECRET`
11. เปิด Actions → GOLD PULSE Server Scan → Run workflow
12. ล็อกหน้าจอ iPhone แล้วรอ signal ที่ผ่านเกณฑ์ ระบบจะส่งผ่าน LINE จาก server

## เช็กว่าสำเร็จ

- `/api/health` ต้องแสดง `ok: true`
- `lineMode` ควรเป็น `push`
- Actions manual run ต้องเป็นสีเขียว
- ปุ่ม LIVE TEST BUY/SELL บน Dashboard ต้องส่ง LINE ได้
