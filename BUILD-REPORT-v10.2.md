# GOLD PULSE X v10.2 — ADAPTIVE QUALITY 30

## เป้าหมาย

สแกนตลาดทุก 5 นาทีเหมือนเดิม แต่เลิกใช้กฎล็อกตาย “หนึ่งสัญญาณต่อช่วง 30 นาที” แล้วเปลี่ยนเป็นการคัดจังหวะตามคุณภาพตลาด โดยตั้งเป้าเชิงพฤติกรรมให้สัญญาณคุณภาพดีมีแนวโน้มเกิดใกล้ช่วงประมาณ 30 นาที

ระบบไม่บังคับให้มีออร์เดอร์ และสัญญาณระดับยอดเยี่ยมสามารถผ่านได้เร็วกว่าครึ่งชั่วโมง

## Adaptive Quality

คะแนน Alert Quality รวมข้อมูลหลักต่อไปนี้:

- Model probability
- Signal score
- จำนวน confirmations
- Directional edge
- Forecast agreement
- Entry tier
- Expected move
- WAIT probability
- Counter-trend / range penalty

ค่าเริ่มต้นของ Time Gate:

| เวลาจากสัญญาณล่าสุด | Quality ที่ต้องผ่าน |
|---|---:|
| เริ่มระบบ / ยังไม่มีประวัติ | 78 |
| ต่ำกว่า 10 นาที | 92 |
| 10–20 นาที | 86 |
| 20–30 นาที | 80 |
| 30–45 นาที | 76 |
| 45–60 นาที | 74 |
| ตั้งแต่ 60 นาที | 72 |

กฎเสริม:

- ไม่มี Hard Lock 30 นาที
- Technical de-dup gap 2 นาที ป้องกันคำขอซ้ำ
- สัญญาณกลับทิศก่อน 30 นาทีต้องเพิ่ม Quality อีก 4 คะแนนและมีอย่างน้อย 3 confirmations
- สัญญาณทิศเดิมที่ราคาแทบไม่เปลี่ยนต้องมี Quality ดีขึ้นอย่างน้อย 3 คะแนน
- Quality ต่ำกว่า 72 ไม่ส่งแม้รอนาน
- Risk HIGH ถูกบล็อก
- Safety cap 32 ข้อความต่อวัน

## Persistent State

v10.2 ใช้ Upstash Redis เพื่อจำ:

- เวลาส่งล่าสุด
- ทิศทางล่าสุด
- Quality ล่าสุด
- ราคา Entry ล่าสุด
- จำนวนสัญญาณประจำวัน
- Candidate ที่ดีที่สุดล่าสุด

Environment variables ที่ต้องมีใน Vercel:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
ADAPTIVE_STATE_REQUIRED=true
```

หากยังไม่เชื่อม Upstash ระบบวิเคราะห์และหน้า Dashboard ยังทำงาน แต่ LINE Adaptive Alert จะหยุดไว้เพื่อป้องกันการส่งถี่ผิดปกติ

## ผลการตรวจ

- Pure adaptive unit tests: ผ่าน
- Pulse regression tests: ผ่าน
- Combined-decision integration test: ผ่าน
- Static repository check: ผ่าน
- JavaScript syntax checks: ผ่าน
- TypeScript-specific adaptive errors: ไม่พบ

ไม่สามารถทำ `npm install` และ Next production build ใน environment ที่สร้างแพ็กเกจนี้ได้ เนื่องจาก internal npm registry ไม่มีแพ็กเกจ `@types/node` เวอร์ชันที่โปรเจกต์ร้องขอ จึงไม่กล่าวอ้างว่า production build ผ่านใน environment นี้ ต้องตรวจ Vercel deployment หลัง Push อีกครั้ง

## ความหมายของ Probability

Model estimate และ Adaptive Quality เป็นคะแนนคัดกรองเชิงระบบ ไม่ใช่อัตราชนะที่ยืนยันจากผลเทรดจริง ควรเก็บ log ผลลัพธ์แล้วปรับ threshold จากข้อมูลจริงในขั้นต่อไป
