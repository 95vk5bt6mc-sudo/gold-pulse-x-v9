## v11.0 R2 — Simplified Signal Policy
- Single final signal gate after Pattern Intelligence adjustments.
- Closed 1M + 5M candle locks.
- LINE trusts the final decision instead of duplicating entry thresholds.
- Five-Candle Truth is validated supporting evidence only.
- Visible entry tiers simplified to CONFIRMED / STRONG.

# v11.0.0 — PATTERN INTELLIGENCE 5M

- Added 5M Candle DNA weighted-nearest-neighbor memory.
- Added next 5/10/15-minute UP/DOWN/SIDEWAY probability distributions.
- Added regular and hidden RSI/MACD divergence.
- Added liquidity-sweep and fake-breakout detection.
- Added BOS/CHOCH market-structure analysis.
- Added intelligence overlay that adjusts score/probability and blocks high-risk traps.
- Keeps cron-job.org every 5 minutes, no Redis, and PULSE disabled.
- Current live memory uses the provider candle window; million-pattern training is not yet active.

# v10.3.1 — CLASSIC 9.8 PRO PLUS

- Fixes stale v10.2 ALERT_MIN_* environment values overriding Classic thresholds.
- Uses dedicated CLASSIC_* environment keys with balanced built-in defaults.
- Adds RANGE, MIXED and COUNTER_TREND quality filters.
- Keeps v9.8 forecast-first logic and PULSE disabled.
- Keeps cron-job.org every 5 minutes and requires no Redis.
- Does not force a signal count or guarantee profitability.

# v10.3.0 — CLASSIC 9.8 PRO

- Restores v9.8-style 5M trend and forecast-first logic.
- Disables PULSE and time-based adaptive relaxation.
- Tightens OPPORTUNITY and SCOUT evidence.
- Uses cron-job.org every 5 minutes; no Redis required.
- Uses LINE retry-key as a best-effort 30-minute delivery guard.
- Signal count and profitability are not guaranteed.

# Changelog

## 10.2.0 — ADAPTIVE QUALITY 30

- Removed the fixed GLOBAL_30 LINE retry bucket.
- Added persistent adaptive timing with Upstash Redis.
- Added time-sensitive quality thresholds targeting roughly 30-minute cadence.
- Exceptional high-quality signals can pass before 30 minutes.
- Weak signals remain blocked even after long waits.
- Added reversal penalty, same-direction freshness rule and daily safety cap.
- Added adaptive unit tests, health diagnostics and iPhone deployment guide.
- LINE alerts pause safely when persistent state is required but unconfigured.

## 10.1.0 — BALANCED 30

- Global LINE limit: one accepted alert per fixed 30-minute window across every tier and direction.
- ACTIVE gate: probability 63, score 58.
- OPPORTUNITY gate: probability 55, score 62, directional edge 10.
- SCOUT gate: probability 57, score 63, three confirmations.
- PULSE gate: probability 58, score 60, three directional votes, expected move 0.85.
- Risk HIGH remains blocked.
- Scheduler label updated to cron-job.org every 5 minutes.

## 10.0.0 — Pulse Engine

- เพิ่ม PULSE BUY/SELL หลัง OPPORTUNITY และ SCOUT เพื่อแก้ช่วง WAIT ยาวหลายชั่วโมง
- PULSE รวมคะแนนโหวตจาก 5M/1M trend, 5M/1M momentum, MACD, RSI, feature score และ probability map
- PULSE gate: model estimate 52+, score 52+, อย่างน้อย 2 directional votes, expected move 0.72+, Risk HIGH ถูกบล็อก
- PULSE cooldown 30 นาที และใช้ retry fingerprint แบบหนึ่ง PULSE ต่อ symbol ต่อ bucket แม้ทิศทางสลับ
- TP1 ปรับให้เป็นระยะราคา XAU/USD 1.00 แบบตรงตัว
- เพิ่มคำเตือนชัดเจนว่า price move 1.00 ไม่เท่ากับกำไรบัญชี $1 โดยอัตโนมัติ
- เพิ่ม regression tests สำหรับเคส WAIT แบบ BEARISH/Probability conflict, BUY trend, Risk HIGH และตลาดไร้ทิศทาง
- เป้าหมายใกล้ 20 alerts/วันเป็นค่าการออกแบบ ไม่ใช่การรับประกันจำนวนหรือผลกำไร

## 9.8.0 — Scout Signal

- แก้กรณี Forecast 3/5 เป็น WAIT แล้วระบบหยุดก่อนสร้างสัญญาณ
- เพิ่ม SCOUT BUY/SELL โดยใช้เทรนด์ 5M, probability map, momentum, RSI และตำแหน่งราคาแบบรวมคะแนน
- เมื่อ probability ขัดกับเทรนด์เพียงเล็กน้อย ระบบให้เทรนด์เป็นหลัก; สวนเทรนด์ได้เฉพาะ edge แข็งแรงและมีหลักฐานเพิ่ม
- SCOUT gate: model estimate 52+, score 58+, อย่างน้อย 2 confirmations, Risk HIGH ถูกบล็อก
- SCOUT cooldown 45 นาที เพื่อควบคุมความถี่; OPPORTUNITY 30 นาที; ACTIVE/CONFIRMED 20 นาที
- เป้าหมายประมาณ 20 alerts/วันเป็นค่าการออกแบบ ไม่ใช่การรับประกันจำนวนหรือผลกำไร
- คง Risk HIGH block และ cooldown 20 นาที
- LINE ใช้ tier-specific gate เพื่อส่ง OPPORTUNITY โดยไม่ลดเกณฑ์ CONFIRMED
- เป้าหมายคือเพิ่มโอกาสเข้าใกล้ 20 alerts ต่อวัน ไม่รับประกันจำนวนหรือผลกำไร

## 9.6.0 — Active Signal
- One-shot patch from v9.5; no repository, Vercel project, LINE token, or GitHub secret recreation.
- Added ACTIVE signal profile targeting more frequent actionable alerts during 08:00–24:00.
- Entry gate: model probability 60, score 54, expected move 0.45, at least 2 confirmations, and HIGH risk remains blocked.
- Forecast 3/5 no longer must always agree; conflicts are penalized and weighted toward the 5M trend.
- Added ACTIVE / CONFIRMED / STRONG tiers with clear LINE wording.
- Reduced same-direction alert cooldown to 20 minutes and simplified duplicate fingerprint to reduce spam.
- Target of roughly 20 alerts/day is an engineering goal, not a guaranteed count or verified win rate.

## 9.5.0
- Added Smart Free active hours 08:00–24:00 Asia/Bangkok.
- Increased scheduled server scans from 10 minutes to 5 minutes only during the active window.
- Added Market Session, Market Regime, confidence grade/stars and AI Explain.
- Added planned credit budget: 384 server credits + up to 192 dashboard credits = about 576/800 credits per day, leaving about 224 credits for manual use.
- Preserved the existing repository, Vercel, LINE and provider architecture.


## 9.0.0
- Rebuilt v8 generator output as a real repository.
- Added typed server core for configuration, LINE delivery and alert evaluation.
- Restricted automatic LINE delivery to the secret-protected scan endpoint.
- Added LINE push target support and deterministic retry-key duplicate protection.
- Added 5/10/15-minute GitHub Actions schedule helper.
- Upgraded chart component to TradingView Lightweight Charts.
- Added PWA service-worker registration and iPhone deployment guide.
