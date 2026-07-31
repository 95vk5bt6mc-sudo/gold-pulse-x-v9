# Security

- Never commit `.env`, API keys, LINE tokens, or `GOLD_PULSE_API_SECRET`.
- Store production secrets in Vercel Environment Variables and GitHub Actions Secrets.
- Use a random `GOLD_PULSE_API_SECRET` of at least 32 characters.
- Prefer `LINE_TARGET_ID` push mode over broadcast mode.
- `/api/scan` and `/api/notify` reject requests without the matching secret header.
- Rotate secrets immediately if they appear in logs, screenshots, commits, or chat messages.
