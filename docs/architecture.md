# Architecture

- Cloudflare Worker (core)
- Tuya API (device data)
- KV (state + history)
- Telegram (alerts)
- Dashboard (read-only UI)

Flow:

cron → fetch Tuya → process → store → notify → dashboard reads