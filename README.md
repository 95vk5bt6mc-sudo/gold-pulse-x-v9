# GOLD PULSE X v9.0 — FREE MODE

โปรเจกต์จริงแบบหลายไฟล์สำหรับติดตั้งบน **GitHub + Vercel Hobby + LINE Messaging API** โดยไม่ใช้ `setup.cjs` และไม่สร้างไฟล์ระหว่าง build

## สิ่งที่รุ่นนี้ทำได้

- Dashboard XAU/USD สำหรับ iPhone และคอมพิวเตอร์
- กราฟแท่งเทียนด้วย TradingView Lightweight Charts
- วิเคราะห์ EMA, RSI, MACD, ATR, ADX, แนวรับ/แนวต้าน และ Pattern Engine
- Decision Engine: BUY / SELL / WAIT พร้อม Entry, TP1–TP3, Stop Loss และ Risk:Reward
- GitHub Actions เรียก server scan ทุก 5, 10 หรือ 15 นาที
- ปิด Safari หรือล็อก iPhone ได้ เพราะการสแกนทำบน GitHub/Vercel
- LINE แจ้งเตือนจาก server เท่านั้น หน้า Dashboard จะไม่ส่งสัญญาณอัตโนมัติ
- LINE one-to-one push ผ่าน `LINE_TARGET_ID` หรือ broadcast เมื่อไม่กำหนด target
- กันข้อความซ้ำข้าม Vercel cold start ด้วย `X-Line-Retry-Key` ของ LINE
- PWA เพิ่มลง Home Screen ได้

## จุดที่เปลี่ยนจาก v8

1. ไม่มี `setup.cjs` และไม่มี `prebuild` ที่เขียนทับ repository
2. ไฟล์ทั้งหมดเป็นไฟล์จริง แก้และดู Git diff ได้
3. Core ฝั่ง server (`config`, `line`, `alerts`) เป็น TypeScript
4. Dashboard ไม่สามารถกระตุ้น LINE อัตโนมัติได้อีก — ต้องผ่าน `/api/scan` ที่มี secret
5. ระบบ LINE ใช้ retry key ป้องกันการส่งซ้ำภายในช่วง cooldown
6. ถ้า Provider ล้ม ระบบจะ **ไม่สร้างสัญญาณปลอม** และจะไม่แจ้งเตือน

## ค่าเริ่มต้น

- Scan interval: **10 นาที**
- Minimum probability: **80%**
- Minimum signal score: **70/100**
- Alert cooldown: **30 นาที**
- Provider: Twelve Data

## ติดตั้งแบบเร็ว

### 1) GitHub

สร้าง repository แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้

> สำหรับสแกนทุก 5–15 นาทีแบบไม่เสีย Actions minutes ควรใช้ **Public repository** เพราะงานบน GitHub-hosted runner ของ public repository ไม่คิด billable minutes ส่วน private repository จะคิดอย่างน้อยหนึ่งนาทีต่อ job

Secrets ไม่ถูกเปิดเผยแม้ repository เป็น public ตราบใดที่เก็บไว้ใน **Settings → Secrets and variables → Actions** และไม่พิมพ์ออกใน log

### 2) Vercel

Import repository เข้า Vercel แล้วเพิ่ม Environment Variables:

```env
TWELVE_DATA_API_KEY=...
GOLD_PULSE_API_SECRET=สุ่มยาวอย่างน้อย32ตัวอักษร
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
LINE_TARGET_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ALERT_MIN_PROBABILITY=80
ALERT_MIN_SCORE=70
ALERT_COOLDOWN_MINUTES=30
LINE_ALERTS_ENABLED=true
```

จากนั้น Deploy

### 3) LINE_TARGET_ID

ตั้ง Webhook URL ใน LINE Developers เป็น:

```text
https://ชื่อโปรเจกต์.vercel.app/api/line/webhook
```

เปิด Use webhook แล้วเพิ่ม Official Account เป็นเพื่อน หรือส่งคำว่า `id` หา Bot ระบบจะตอบกลับ `LINE_TARGET_ID` ของคุณ นำค่านั้นไปใส่ใน Vercel แล้ว Redeploy

ไม่ใส่ `LINE_TARGET_ID` ระบบจะใช้ broadcast ไปหาเพื่อนทั้งหมดของ Official Account ซึ่งใช้โควตาข้อความมากกว่า

### 4) GitHub Actions Secrets

Repository → Settings → Secrets and variables → Actions

```text
GOLD_PULSE_URL=https://ชื่อโปรเจกต์.vercel.app
GOLD_PULSE_API_SECRET=ค่าเดียวกับใน Vercel
```

ไปที่แท็บ Actions → GOLD PULSE Server Scan → Run workflow เพื่อทดสอบ

## เปลี่ยนความถี่สแกน

ค่าเริ่มต้น 10 นาที

```bash
npm run schedule:5
npm run schedule:10
npm run schedule:15
```

จากนั้น commit และ push ไฟล์ `.github/workflows/gold-pulse-scan.yml`

บน iPhone สามารถแก้บรรทัด cron ใน GitHub ได้โดยตรง:

```yaml
# ทุก 5 นาที
- cron: "3-59/5 * * * *"

# ทุก 10 นาที
- cron: "3-59/10 * * * *"

# ทุก 15 นาที
- cron: "3-59/15 * * * *"
```

ตั้งให้เริ่มนาที 3 แทนต้นชั่วโมงเพื่อลดโอกาสชนช่วงโหลดสูงของ GitHub Actions

## ทดสอบ Endpoint

```text
/api/health      ดูว่าตั้งค่า Provider, Secret และ LINE ครบหรือไม่
/api/provider    ดู Provider ที่เปิดใช้
/api/system      ดู version และสถานะ scan ล่าสุดแบบ best-effort
/api/gold        โหลดข้อมูลตลาดและ Dashboard โดยไม่ส่ง LINE
/api/scan        server scan ที่ต้องมี x-gold-pulse-secret
/api/notify      ส่ง LINE manual test ที่ต้องมี x-gold-pulse-secret
```

## ข้อจำกัดของ Free Mode

- GitHub Actions schedule ไม่ใช่ระบบ real-time และอาจเริ่มช้ากว่าเวลาที่กำหนด
- Vercel Hobby Cron รันถี่ 5–15 นาทีไม่ได้ จึงใช้ GitHub Actions เป็น scheduler
- Vercel serverless memory ไม่ถาวร สถานะ scan ล่าสุดใน `/api/system` อาจรีเซ็ตหลัง cold start
- การกัน LINE ซ้ำใช้ retry key ของ LINE ภายในช่วง cooldown และแพลตฟอร์ม LINE จัดการ retry key เป็นเวลา 24 ชั่วโมง
- Twelve Data และ LINE มีโควตาตามแผนที่ใช้งาน
- ราคาและสัญญาณอาจต่างจากโบรกเกอร์ เครื่องมือนี้ไม่ใช่คำแนะนำการลงทุน

## Local development

```bash
cp .env.example .env.local
npm install
npm run doctor
npm run dev
```

เปิด `http://localhost:3000`

## เอกสารทางการ

- GitHub scheduled workflows: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows#schedule
- Vercel Cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- LINE send messages: https://developers.line.biz/en/docs/messaging-api/sending-messages/
- LINE retry key: https://developers.line.biz/en/docs/messaging-api/retrying-api-request/

---

**คำเตือน:** ระบบนี้เป็นเครื่องมือวิเคราะห์เชิงทดลอง ไม่รับประกันกำไร และไม่ควรใช้แทนแผนบริหารความเสี่ยง
