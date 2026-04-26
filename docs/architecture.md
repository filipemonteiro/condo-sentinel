# Architecture

Condo Sentinel is a small Cloudflare Worker that polls Tuya Cloud devices on a cron schedule, stores compact state/history in KV, sends Telegram alerts, and exposes a read-only dashboard.

## Components

- `src/worker.js` wires scheduled checks and HTTP routes.
- `src/tuya.js` signs and sends Tuya Cloud API requests.
- `src/devices.js` inspects device readings and produces alert events.
- `src/automations.js` evaluates rule-based automation intent.
- `src/state.js` stores current state in Cloudflare KV.
- `src/history.js` stores compact per-device history in Cloudflare KV.
- `src/notifications.js` sends Telegram alerts.
- `src/dashboard.js` renders the dashboard and API responses.

## Flow

```text
cron -> Tuya API -> process devices -> evaluate automations -> store KV -> notify Telegram
                                                        |
                                                        v
                                             dashboard/API reads KV
```

## Storage

Current state is stored per device with keys like `state:device:<device-id>`. Historical points are stored with keys like `history:device:<device-id>`.

## Security Notes

Secrets and real deployment config belong in `.dev.vars`, `wrangler.toml`, Cloudflare Worker settings, or GitHub repository secrets. These files and values should not be committed.

Dashboard/API authentication is planned but not enabled in the current version, so production Worker URLs should be treated as sensitive.
