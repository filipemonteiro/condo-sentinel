# Condo Sentinel

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

## ⚠️ Important Notes

- Do NOT commit `.dev.vars`
- Do NOT expose real device IDs or secrets
- Keep `LOG_FULL_PAYLOAD=false` in production
- Protect access token carefully

## 📌 Status

Initial version — evolving into a reusable IoT monitoring platform.

## 📄 License

-