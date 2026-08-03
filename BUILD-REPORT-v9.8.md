# Build Report — GOLD PULSE X v9.8 Scout Signal

## Fixed

- v9.7 could remain WAIT when the 5M trend and probability leader disagreed by a small margin.
- v9.8 adds a controlled SCOUT fallback and evaluates it before returning WAIT.
- The real user log case (BEARISH, BUY 33, SELL 25, WAIT 43, RSI 50.5) now becomes SCOUT SELL in the regression test.

## Alert pacing

- SCOUT: probability 52+, score 58+, at least 2 confirmations, 45-minute cooldown.
- OPPORTUNITY: probability 50+, score 58+, 30-minute cooldown.
- ACTIVE/CONFIRMED: existing gates, 20-minute cooldown.
- Risk HIGH remains blocked.

## Verification performed

- JavaScript syntax checks passed.
- Static repository check passed.
- TypeScript syntax/type structure checked with local declarations.
- Regression tests passed for the latest WAIT log, the earlier OPPORTUNITY BUY log, and Risk HIGH blocking.
- Full `npm install`/Next build could not run in the build container because its internal registry did not contain `@types/node`; Vercel will perform the real production build after deployment.

The 20-alert target is an estimate, not a guarantee and not a verified win rate.
