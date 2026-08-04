# GOLD PULSE X v10.2.1 ADAPTIVE LITE — No Redis

- Upstash Redis is optional.
- The engine scans every 5 minutes and applies a stateless quality window:
  - minute 00–09 of each half-hour: quality >= 86
  - minute 10–19: quality >= 82
  - minute 20–29: quality >= 78
- LINE idempotency uses one key per 30-minute slot, so at most one alert is delivered in each slot.
- No signal is forced. A slot can produce zero alerts.
- Because there is no durable state, rolling time since the previous alert, daily counters, candidate memory, and reversal memory are best-effort only.
