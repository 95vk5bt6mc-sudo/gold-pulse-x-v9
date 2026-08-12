# GOLD PULSE X v11.0 R1 — FIVE-CANDLE TRUTH

## Why this patch exists
Cron runs a few seconds after each 5-minute boundary. A newly opened 5M bucket must not be treated as a completed candle. The existing v11 Pattern Intelligence also forecasts only 1/2/3 horizons and measures cumulative close movement, which is not the same as predicting the body direction of five unseen candles.

## R1 changes
- Adds five future 5M candle forecasts: #1, #2, #3, #4, #5.
- Target is each future candle body direction: BUY / SELL / WAIT (noise body).
- Adds closed-candle lock. Example: a scan at 15:10:04 uses 15:05 as the last completed 5M candle, never the just-opened 15:10 bucket.
- Adds no-lookahead walk-forward validation from the same real market window already fetched by GOLD PULSE.
- Reports directional accuracy, prediction coverage, per-candle accuracy, and exact-five accuracy.
- Runs in shadow-audit mode: five-candle predictions do not directly alter BUY/SELL entry gates in R1.
- Fixes v11 evidence double-counting: Pattern Memory drives the general intelligence bias; fake breakout/divergence/structure continue through their dedicated checks instead of being counted inside bias and again afterward.
- Keeps Classic 9.8 Pro Plus, PULSE-off policy, Risk HIGH blocking, LINE flow, cron-job.org cadence, and existing API architecture.

## Cost / privacy / security
- 0 new upstream market-data requests.
- 0 new packages.
- 0 databases / Redis.
- 0 paid APIs or services added.
- 0 new secrets.
- TWELVE_DATA_API_KEY remains server-side in Vercel Environment Variables.
- No market data or signal data is sent to a new third party by this patch.

## Important
No statistical system can guarantee the direction of five unseen market candles. R1 is intentionally designed to expose measured out-of-sample accuracy instead of presenting model confidence as proven accuracy.
