# Build Report — GOLD PULSE X v9.7 Opportunity Signal

## Change summary

- Added a controlled `OPPORTUNITY BUY/SELL` fallback for cases where both forecast labels remain `WAIT` but the BUY/SELL probability edge agrees with the 5-minute trend.
- Opportunity gate: directional edge `>= 8`, model probability `>= 50`, signal score `>= 58`, at least 2 confirmations, momentum aligned, and `riskLevel !== HIGH`.
- Existing ACTIVE / CONFIRMED / STRONG logic remains intact.
- LINE alert evaluation now applies tier-specific gates for OPPORTUNITY signals.
- Cooldown remains 20 minutes per direction bucket.
- No Vercel or LINE secrets are changed.

## Verification completed

- JavaScript syntax checks passed.
- Repository static check passed.
- TypeScript files passed an isolated compiler check with Node environment stubs.
- Regression sample from the real v9.6 scan log changed from `SIGNAL WEAK — WAIT` to `OPPORTUNITY BUY`, with `ENTRY`, probability 61, score 83, and 3 confirmations.
- LINE eligibility test passed for the OPPORTUNITY sample.

## Important limitation

The target of approximately 20 alerts per active trading day is a design target, not a guarantee. Actual frequency depends on market structure and provider data. OPPORTUNITY alerts are intentionally more aggressive and require human confirmation before entering a trade.
