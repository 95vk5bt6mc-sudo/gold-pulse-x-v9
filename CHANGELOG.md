# Changelog

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
