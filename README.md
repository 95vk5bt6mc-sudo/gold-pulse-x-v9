# GOLD PULSE X v11.0 — PATTERN INTELLIGENCE 5M

ระบบใช้ Classic 9.8 Pro Plus เป็นฐาน และเพิ่มการวิเคราะห์แท่ง 5 นาทีแบบหลายชั้น

## Intelligence ที่เปิดใช้งาน

- 5M Candle DNA Weighted KNN
- ความน่าจะเป็นอีก 5, 10 และ 15 นาที
- Regular / Hidden RSI divergence
- Regular / Hidden MACD divergence
- Liquidity sweep และ fake breakout
- BOS / CHOCH market structure
- Intelligence overlay ปรับคะแนนและบล็อก ENTRY เมื่อความเสี่ยงกับดักสูง
- cron-job.org เรียกทุก 5 นาที
- ไม่ใช้ Redis
- PULSE fallback ยังคงปิด

## ข้อจำกัดที่ต้องเข้าใจ

Live Pattern Memory ใช้แท่งที่ provider โหลดมาในรอบปัจจุบันเท่านั้น ปัจจุบันจึงยังไม่ใช่คลังหลายล้านรูปแบบ การสร้าง Million-Pattern Archive ต้องมีข้อมูล XAU/USD ย้อนหลังหลายปีและกระบวนการฝึกแบบ Offline เพิ่มเติม

ค่าความน่าจะเป็นเป็น Model Estimate ไม่ใช่อัตราชนะที่พิสูจน์แล้ว และระบบไม่รับประกันกำไร
