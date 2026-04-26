# Condo Sentinel

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Lightweight IoT monitoring system for condos and small infrastructures.

## Features

- Monitoring of IoT devices (water level, gas, leak sensors, valves)
- Smart alerting with cooldowns and noise reduction
- Telegram notifications
- Simple web dashboard
- Rule-based automation engine

## Architecture

- Cloudflare Workers
- Tuya API integration
- KV storage for state and history

## Security

- No secrets in code
- Sensitive data stored in environment variables
- Local Cloudflare and Tuya credentials are intentionally ignored by Git
- Dashboard/API access control is planned, but not enabled in the current version

For vulnerability reporting and sensitive-data guidance, see [SECURITY.md](SECURITY.md).

## Project Structure

```
.
├── .github/workflows/deploy.yml
├── docs/
├── src/
│   ├── automations.js
│   ├── dashboard.js
│   ├── devices.js
│   ├── history.js
│   ├── notifications.js
│   ├── state.js
│   ├── tuya.js
│   ├── utils.js
│   └── worker.js
├── test/
├── .dev.vars.example
├── .gitignore
├── CONTRIBUTING.md
├── LICENSE
├── package.json
├── README.md
└── wrangler.example.toml
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example files:

```bash
cp wrangler.example.toml wrangler.toml
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` and `wrangler.toml` with your local values.

Create a Cloudflare KV namespace and replace `__KV_NAMESPACE_ID__` in `wrangler.toml`:

```bash
npx wrangler kv namespace create STATE
```

### 3. Login to Cloudflare

```bash
npx wrangler login
```

### 4. Run locally

```bash
npm run dev
```

### 5. Run checks

```bash
npm run check
npm test
```

### 6. Deploy

```bash
npm run deploy
```

## Environment Variables

See `.dev.vars.example` for the full list.

Main variables:

- `CLIENT_ID` → Tuya API client ID
- `CLIENT_SECRET` → Tuya API client secret
- `TUYA_BASE` → Tuya API base URL
- `TELEGRAM_BOT_TOKEN` → Telegram bot token
- `TELEGRAM_CHAT_ID` → Chat ID for alerts
- `DEVICE_REGISTRY_JSON` → JSON array with monitored devices
- `AUTOMATIONS_JSON` → JSON array with automation rules
- `DASHBOARD_ACCESS_TOKEN` → Reserved for dashboard/API access control

Optional:

- `APP_NAME`
- `DASHBOARD_TITLE`
- `COOLDOWN_MINUTES`
- `OFFLINE_COOLDOWN_MINUTES`
- `SENSOR_COOLDOWN_MINUTES`
- `HISTORY_MAX_POINTS`
- `HISTORY_MIN_INTERVAL_MINUTES`
- `HISTORY_MIN_DELTA_PERCENT`
- `DASHBOARD_STALE_AFTER_MINUTES`

## Endpoints

- `/dashboard` → Web UI
- `/api/status` → Current state
- `/api/history` → Device history

Access control is not enabled yet. Do not expose a production Worker URL broadly until authentication is added.

Planned authentication format:

```
Authorization: Bearer YOUR_TOKEN
```

## GitHub Actions Deploy

The deploy workflow generates `wrangler.toml` from `wrangler.example.toml` and deploys on pushes to `main`.

Configure these repository secrets before enabling public deployment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`

Runtime secrets and variables such as Tuya credentials, Telegram credentials, device registry, and automations should be configured in Cloudflare Workers settings or with Wrangler secrets/vars. Do not commit them.

## Production Checklist

- Replace all example values in `.dev.vars` and `wrangler.toml`
- Configure Cloudflare KV and repository secrets
- Keep `LOG_FULL_PAYLOAD=false`
- Keep `DRY_RUN=true` until Telegram alerts are verified
- Avoid real device IDs, locations, and operational data in issues, screenshots, examples, or commits
- Add dashboard/API authentication before exposing the Worker URL broadly

## How It Works

- Worker runs on schedule (cron)
- Fetches device data from Tuya API
- Applies alert logic and cooldown rules
- Stores state and history in KV
- Sends alerts via Telegram
- Dashboard fetches sanitized data via API

## Positioning: Condo Sentinel vs Home Assistant

Condo Sentinel is not intended to replace Home Assistant as a full smart home
platform. Home Assistant is the better choice when you need a local automation
hub with rich dashboards, many integrations, Zigbee/Z-Wave/Matter/MQTT support,
manual controls, scenes, local-first automations, and a large ecosystem.

This project has a different proposal: it is a lightweight, serverless sentinel
for shared infrastructure.

It is a better fit when the goal is to monitor a small operational environment,
such as a condo, pump room, water tank, garage, utility area, or small facility,
and answer questions like:

- Is the water level too low?
- Did a gas or leak sensor enter alarm state?
- Did a critical device go offline?
- Is a sensor returning invalid readings?
- Should the caretaker, manager, or maintenance team be notified?

Instead of running and maintaining a local server, Condo Sentinel runs on
Cloudflare Workers, reads Tuya Cloud device data on a schedule, stores compact
state/history in KV, and sends Telegram alerts with cooldowns and noise
reduction.

### When Condo Sentinel makes more sense

- You want monitoring and alerting, not a full home automation hub
- Devices are already connected through Tuya Cloud
- The environment is shared or operational, not a single private home
- You prefer a small serverless deployment over maintaining a Raspberry Pi or VM
- Alerts for maintenance staff matter more than advanced dashboard customization
- The system should be simple enough for non-technical stakeholders to understand

### When Home Assistant makes more sense

- You need automations to keep working locally without internet
- You use many device protocols or vendors
- You need manual device control, scenes, users, and advanced dashboards
- You want a broad smart home ecosystem instead of a focused monitoring service
- You need deep local integrations with MQTT, ESPHome, Zigbee, Z-Wave, or Matter

In short: Home Assistant is a mainstream smart home platform. Condo Sentinel is a
focused infrastructure monitor for cases where a small, opinionated, low-touch
alerting system is more appropriate than a full automation platform.

## Important Notes

- Do NOT commit `.dev.vars`
- Do NOT commit `wrangler.toml`
- Do NOT expose real device IDs or secrets
- Keep `LOG_FULL_PAYLOAD=false` in production
- Treat dashboard/API URLs as sensitive until authentication is implemented

## Status

Initial version — evolving into a reusable IoT monitoring platform.

## License

This project is licensed under the MIT License.

Copyright (c) 2026 Filipe Monteiro

See the LICENSE file for details.
