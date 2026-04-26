# Condo Sentinel

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

Lightweight IoT monitoring system for condos and small infrastructures.

## 🚀 Features

- Monitoring of IoT devices (water level, gas, leak sensors, valves)
- Smart alerting with cooldowns and noise reduction
- Telegram notifications
- Simple web dashboard
- Rule-based automation engine

## 🏗️ Architecture

- Cloudflare Workers
- Tuya API integration
- KV storage for state and history

## 🔐 Security

- No secrets in code
- Dashboard protected via access token
- Sensitive data stored in environment variables

## 📦 Project Structure

```
.
├── src/
│   └── worker.js
├── .dev.vars.example
├── .gitignore
├── wrangler.toml
└── README.md
```

## ⚙️ Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy example file:

```bash
cp .dev.vars.example .dev.vars
```

Fill the `.dev.vars` file with your real values.

### 3. Login to Cloudflare

```bash
npx wrangler login
```

### 4. Run locally

```bash
npx wrangler dev
```

### 5. Deploy

```bash
npx wrangler deploy
```

## 🔑 Environment Variables

See `.dev.vars.example` for the full list.

Main variables:

- `CLIENT_ID` → Tuya API client ID
- `CLIENT_SECRET` → Tuya API client secret
- `TUYA_BASE` → Tuya API base URL
- `TELEGRAM_BOT_TOKEN` → Telegram bot token
- `TELEGRAM_CHAT_ID` → Chat ID for alerts
- `DASHBOARD_ACCESS_TOKEN` → Token required to access API and dashboard

Optional:

- `APP_NAME`
- `DASHBOARD_TITLE`
- `COOLDOWN_MINUTES`
- `OFFLINE_COOLDOWN_MINUTES`
- `SENSOR_COOLDOWN_MINUTES`
- `HISTORY_MAX_POINTS`

## 📊 Endpoints

- `/dashboard` → Web UI
- `/api/status` → Current state (requires token)
- `/api/history` → Device history (requires token)

Authentication example:

```
Authorization: Bearer YOUR_TOKEN
```

## 🧠 How It Works

- Worker runs on schedule (cron)
- Fetches device data from Tuya API
- Applies alert logic and cooldown rules
- Stores state and history in KV
- Sends alerts via Telegram
- Dashboard fetches sanitized data via API

## 🏢 Positioning: Condo Sentinel vs Home Assistant

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

## ⚠️ Important Notes

- Do NOT commit `.dev.vars`
- Do NOT expose real device IDs or secrets
- Keep `LOG_FULL_PAYLOAD=false` in production
- Protect access token carefully

## 📌 Status

Initial version — evolving into a reusable IoT monitoring platform.

## 📄 License

This project is licensed under the MIT License.

Copyright (c) 2026 Filipe Monteiro

See the LICENSE file for details.
