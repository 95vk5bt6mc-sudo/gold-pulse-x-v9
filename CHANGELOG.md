# Changelog

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
