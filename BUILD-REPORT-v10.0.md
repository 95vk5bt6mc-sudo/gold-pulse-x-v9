# Build Report — GOLD PULSE X v10.0 Pulse Engine

## Root cause fixed

v9.8 could still remain WAIT for hours when the 3/5-candle forecast labels were WAIT and SCOUT evidence did not pass. v10 adds a final controlled PULSE fallback before returning WAIT.

## PULSE inputs

- 5M and 1M trend
- 5M and 1M momentum
- MACD histogram
- RSI bias
- 1M feature score
- BUY/SELL probability spread

## Safety gates retained

- Live market data required
- Market must be open
- Risk HIGH blocked
- At least two directional votes
- Minimum expected move 0.72
- One PULSE per symbol per 30-minute retry bucket
- LINE push target and API secret architecture unchanged

## $1 target clarification

TP1 is exactly 1.00 in XAU/USD price movement. It is not automatically $1 account profit. Account P/L depends on lot size, contract size, spread and commission.

## Tests run

- `node --check` on changed JavaScript routes and engine
- `node scripts/test-v10.mjs`
- `node scripts/static-check.mjs`
- Regression case: bearish 5M trend, BUY 33 / SELL 25 / WAIT 43 produces controlled PULSE SELL
- Bullish directional case produces PULSE BUY
- Risk HIGH remains blocked
- Directionless low-movement market remains WAIT

Full `next build` was not run in the generation environment because its internal npm registry did not provide the declared `@types/node` package. Vercel will perform the actual dependency install and production build after deployment.
