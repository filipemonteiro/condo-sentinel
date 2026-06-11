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

## Cost Model

This project is designed to operate within free tiers of Cloudflare Workers and KV.

### Typical Usage (Free Tier)

| Resource | Approximate Daily Usage |
|----------|------------------------|
| Worker executions | ~288 (cron every 5 minutes) |
| KV writes | 100–500 (optimized history/state) |
| Tuya API calls | 300–1,000 (batched requests) |

### Built-in Optimizations

- **History writes**: Only on meaningful changes (configurable delta threshold)
- **Minimum intervals**: Configurable cooldown between writes
- **Alert cooldowns**: Reduces notification noise
- **Batched API requests**: Groups device status queries

This allows sustainable operation without paid infrastructure in small environments (up to ~10 devices).

## Dashboard

The dashboard is a single-page application with role-based access:

- **Viewer**: Can view device status, history, and charts
- **Admin**: All viewer permissions plus configuration management

### Features

- Real-time device status with badges for alerts (offline, low battery, alarm, etc.)
- Interactive charts for sensor history
- Configurable dashboard title
- Session-based authentication with inactivity timeout
- Responsive design

### Modular Architecture

The frontend is organized into separate modules for maintainability:

- `src/dashboard.js`: Core functions and API handlers
- `src/dashboard-template.js`: HTML template generation
- `src/dashboard-css.js`: Styles
- `src/dashboard-js.js`: Client-side JavaScript logic

### Troubleshooting

#### Dashboard shows no data / Menu doesn't appear

**Problem:** Dashboard appears but:
- Summary cards show empty
- No devices listed
- "Configurações" (Settings) button is missing

**Causes & Solutions:**

1. **Not recognized as admin (most common)**
   - Ensure `DASHBOARD_USERS_JSON` is set in environment variables
   - Verify format: `[{"email": "your@email.com", "role": "admin"}]`
   - Check browser console (`F12`) for error messages

2. **Cloudflare Access not sending email header**
   - Verify Cloudflare Access is configured on your domain
   - Check that login method is enabled (Google, GitHub, etc.)
   - Access the dashboard through your domain protected by Cloudflare Access, not directly via IP

3. **API call failures**
   - Open browser console (`F12`)
   - Check for error messages in Network tab
   - Verify `DASHBOARD_ACCESS_TOKEN` is set and matches in browser
   - Check worker logs: `wrangler tail`

4. **DEVICE_REGISTRY_JSON is empty**
   - If configured with `[]`, no devices will show
   - Add devices using the proper format (see Configuration section)

**Debug steps:**
1. Open browser console (`F12`)
2. Check for `console.error()` messages
3. Run `wrangler tail` to see worker logs
4. Verify runtime variables and secrets in the Cloudflare Workers dashboard

### Admin Configuration

Admins can configure:

- Dashboard title (displayed in header and page title)
- Future: Device-specific thresholds, notification rules

Configuration is stored in Cloudflare KV and persists across deployments.

#### Creating the First Admin

To set up the first admin user:

1. **Set `DASHBOARD_USERS_JSON` in Cloudflare Workers settings or with Wrangler secrets/vars.**

```bash
npx wrangler secret put DASHBOARD_USERS_JSON
```

Use a value like `[{"email":"your-email@example.com","role":"admin"}]`.

2. **Configure Cloudflare Access (recommended):**
   - Go to your Cloudflare dashboard
   - Navigate to "Access" → "Applications"
   - Add a new application for your dashboard domain
   - Set "Login method" to your preferred provider (Google, GitHub, etc.)
   - This will send the `CF-Access-Client-Email` header
   - **Strongly recommended:** also set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in the worker so the email is validated from the signed Access JWT instead of a forgeable header (see [docs/configuration.md](docs/configuration.md#cloudflare-access-jwt-validation-recommended-in-production))

3. **Deploy the worker:**
   ```bash
   wrangler deploy
   ```

4. **Access the dashboard:**
   - Visit `/dashboard` and enter your `DASHBOARD_ACCESS_TOKEN`
   - If Cloudflare Access is configured, your email will be recognized as admin
   - You'll see the "Configurações" (Settings) menu

5. **Manage users:**
   - Use the Settings menu to add/edit users
   - User mappings are stored in KV and persist across deployments

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
- `DASHBOARD_ACCESS_TOKEN` → Token required to access dashboard data APIs

Optional:

- `APP_NAME`
- `DASHBOARD_TITLE`
- `DASHBOARD_USERS_JSON` → dashboard users and roles (`[{"email":"...","role":"admin"}]`)
- `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` → enable Cloudflare Access JWT validation for admin identity (recommended in production)
- `COOLDOWN_MINUTES`
- `OFFLINE_COOLDOWN_MINUTES`
- `SENSOR_COOLDOWN_MINUTES`
- `BATTERY_THRESHOLD_PERCENT`
- `BATTERY_COOLDOWN_MINUTES`
- `HISTORY_MAX_POINTS`
- `HISTORY_MIN_INTERVAL_MINUTES`
- `HISTORY_MIN_DELTA_PERCENT`
- `DASHBOARD_STALE_AFTER_MINUTES`
- `DASHBOARD_SESSION_TIMEOUT_MINUTES`

Full reference, including the `DEVICE_REGISTRY_JSON` and `AUTOMATIONS_JSON` schemas, lives in [docs/configuration.md](docs/configuration.md).

## Endpoints

- `/dashboard` → Web UI
- `/api/status` → Current state (requires token, GET only)
- `/api/history?device=<id>` → Device history (requires token, GET only)
- `/api/dashboard-context` → GET: config + user context; POST: save runtime config and users (admin only)

Authentication format:

```
Authorization: Bearer YOUR_TOKEN
```

The dashboard asks for the token only when there is no active browser session. After a valid token is submitted, the UI hides the token form and sends the token in API requests. Sessions expire after inactivity; configure the timeout with `DASHBOARD_SESSION_TIMEOUT_MINUTES` (default: 30).

## GitHub Actions Deploy

CI (`ci.yml`) runs syntax checks and the full test suite on every pull request and non-main push. The deploy workflow (`deploy.yml`) runs the same checks, generates `wrangler.toml` from `wrangler.example.toml`, and deploys on pushes to `main` — a failing test blocks the deploy.

Configure these repository secrets before enabling public deployment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`

Runtime secrets and variables such as Tuya credentials, Telegram credentials, `DASHBOARD_ACCESS_TOKEN`, device registry, and automations should be configured in Cloudflare Workers settings or with Wrangler secrets/vars. Do not commit them.

Do not place runtime secrets or placeholder `[vars]` blocks in `wrangler.example.toml`; the deploy workflow copies that file into `wrangler.toml`, and committed placeholders can replace the real dashboard token during deployment.

## Production Checklist

- Replace all example values in `.dev.vars` and `wrangler.toml`
- Configure Cloudflare KV and repository secrets
- Keep `LOG_FULL_PAYLOAD=false`
- Keep request-level invocation logs disabled unless actively debugging
- Keep `DRY_RUN=true` until Telegram alerts are verified
- Avoid real device IDs, locations, and operational data in issues, screenshots, examples, or commits
- Configure `DASHBOARD_ACCESS_TOKEN` before exposing the dashboard

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
- Do not paste payloads from Tuya, Telegram, Cloudflare logs, or dashboard screenshots into public issues
- Use a strong `DASHBOARD_ACCESS_TOKEN` and rotate it if exposed

## Status

Initial version — evolving into a reusable IoT monitoring platform.

## License

This project is licensed under the MIT License.

Copyright (c) 2026 Filipe Monteiro

See the LICENSE file for details.
