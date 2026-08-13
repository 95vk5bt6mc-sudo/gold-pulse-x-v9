# GOLD PULSE X v11.0 R2.1 — LINE SMART QUOTA GUARD

## Scope
LINE delivery layer only. Signal Engine R2 is unchanged.

## Behavior
- Reads official LINE current-month target limit and approximate monthly consumption.
- Uses a cumulative business-day pacing budget in Asia/Bangkok.
- Default reserve: 30 messages for STRONG signals.
- CONFIRMED signals respect pacing and reserve protection.
- Manual LIVE TEST is lowest priority and cannot consume protected reserve.
- STRONG can use the protected reserve while any quota remains.
- When LINE returns monthly-limit 429, do not retry the same rejected request three times.
- LINE 5xx/timeouts still use the existing safe X-Line-Retry-Key retry behavior.

## Notes
LINE monthly consumption returned by the API is approximate. LINE itself remains the source of truth for whether a send is accepted.
No extra paid services, databases, API keys or packages are added.
