# Configuration Reference

Complete reference for every environment variable and JSON schema the worker consumes. For where each layer lives (KV runtime > env vars > defaults), see [architecture.md](architecture.md#config-layers).

---

## Required Variables

| Variable | Description |
|---|---|
| `CLIENT_ID` | Tuya Cloud API client ID |
| `CLIENT_SECRET` | Tuya Cloud API client secret |
| `TUYA_BASE` | Tuya API base URL for your region (e.g. `https://openapi.tuyaus.com`) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for alerts |
| `TELEGRAM_CHAT_ID` | Chat that receives alerts |
| `DASHBOARD_ACCESS_TOKEN` | Bearer token required by all `/api/*` routes. Generate with `openssl rand -hex 32` |
| `DEVICE_REGISTRY_JSON` | JSON array of monitored devices (schema below) |

In production these live in Cloudflare Workers settings or Wrangler secrets — never in `wrangler.toml` (the deploy workflow actively blocks this).

## Optional Variables

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `true` | When `true`, notifications are logged but not sent |
| `LOG_FULL_PAYLOAD` | `false` | Debug only. Must stay `false` in production (see constitution §2) |
| `AUTOMATIONS_JSON` | `[]` | JSON array of automation rules (schema below) |
| `DASHBOARD_USERS_JSON` | `[]` | JSON array of dashboard users: `[{"email":"...","role":"admin"\|"viewer"}]` |
| `APP_NAME` | — | Informational app name |
| `DASHBOARD_TITLE` | `Condo Sentinel` | Title shown in the dashboard header |
| `DASHBOARD_STALE_AFTER_MINUTES` | `30` | Reading older than this marks the device as stale |
| `DASHBOARD_SESSION_TIMEOUT_MINUTES` | `30` | Dashboard session inactivity timeout |
| `COOLDOWN_MINUTES` | `60` | Default cooldown for low-level alerts |
| `OFFLINE_COOLDOWN_MINUTES` | `180` | Cooldown for device-offline alerts |
| `SENSOR_COOLDOWN_MINUTES` | `60` | Cooldown for sensor/API fault alerts |
| `BATTERY_THRESHOLD_PERCENT` | `20` | Battery percentage that triggers a low-battery alert |
| `BATTERY_COOLDOWN_MINUTES` | `180` | Cooldown for low-battery alerts |
| `HISTORY_MAX_POINTS` | `288` | Max history points kept per device |
| `HISTORY_MIN_INTERVAL_MINUTES` | `15` | Minimum interval between history writes without meaningful change |
| `HISTORY_MIN_DELTA_PERCENT` | `2` | Minimum percent delta that forces a history write |

## Cloudflare Access JWT Validation (recommended in production)

| Variable | Description |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | Your Access team domain, e.g. `myteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | The Application Audience (AUD) tag of the Access application protecting the worker |

When **both** are set, the dashboard user's email is accepted **only** from the `Cf-Access-Jwt-Assertion` JWT, cryptographically verified (RS256) against the team's public keys (`https://<team>/cdn-cgi/access/certs`, cached in KV for 1 hour). Plain headers like `Cf-Access-Authenticated-User-Email` are ignored because any client holding the bearer token could forge them.

When unset, the worker falls back to trusting the plain email header — acceptable only if Cloudflare Access fronts the worker and strips client-supplied copies of that header, or if every bearer-token holder is trusted as admin anyway. See [SECURITY.md](../SECURITY.md).

To find the AUD tag: Cloudflare Zero Trust dashboard → Access → Applications → your application → Overview tab.

---

## `DEVICE_REGISTRY_JSON` Schema

Array of device objects. Common fields:

| Field | Required | Description |
|---|---|---|
| `id` | yes | Tuya device ID |
| `type` | yes | One of `water_level_sensor`, `gas_sensor`, `water_leak_sensor`, `valve` |
| `name` | no | Display name used in alerts and dashboard (defaults to `id`) |
| `role` | no | Stable logical name (e.g. `tank_a`) referenced by automations and runtime config |
| `enabled` | no | Set `false` to skip the device without removing it (default `true`) |
| `offlineCooldownMinutes` | no | Per-device override of `OFFLINE_COOLDOWN_MINUTES` |
| `faultCooldownMinutes` | no | Per-device override of `SENSOR_COOLDOWN_MINUTES` |

### `water_level_sensor`

| Field | Default | Description |
|---|---|---|
| `thresholdPercent` | `20` | Level at/below which the low-level alert arms |
| `recoveryMarginPercent` | `10` | Recovery fires at `thresholdPercent + recoveryMarginPercent` |
| `minConsecutiveBreaches` | `2` | Consecutive low readings required before alerting |
| `cooldownMinutes` | `COOLDOWN_MINUTES` | Low-level alert cooldown |
| `batteryThresholdPercent` | `BATTERY_THRESHOLD_PERCENT` | Per-device battery threshold |
| `batteryCooldownMinutes` | `BATTERY_COOLDOWN_MINUTES` | Per-device battery cooldown |
| `levelCode` | `liquid_level_percent` | Tuya status code holding the level percentage |

### `gas_sensor` / `water_leak_sensor`

Alarm state is read from the first matching Tuya code (`gas_alarm`/`alarm`/`gas_state` for gas; `watersensor_state`/`water_state`/`leak_state`/`alarm` for leak). Supports `batteryThresholdPercent` and `batteryCooldownMinutes` overrides.

### `valve`

| Field | Default | Description |
|---|---|---|
| `statusCode` | `switch_1` | Tuya status code reported as the valve's current value |

### Example

```json
[
  {
    "id": "tuya-device-id-1",
    "name": "Water Tank A",
    "type": "water_level_sensor",
    "role": "tank_a",
    "thresholdPercent": 20,
    "recoveryMarginPercent": 10,
    "minConsecutiveBreaches": 2
  },
  {
    "id": "tuya-device-id-2",
    "name": "Main Valve",
    "type": "valve",
    "role": "valve_main"
  }
]
```

---

## `AUTOMATIONS_JSON` Schema

Array of rule objects. The only implemented type is `water_reserve_control`, which **only notifies** — it never actuates the valve (constitution §6).

| Field | Required | Default | Description |
|---|---|---|---|
| `id` | no | derived | Stable rule key; without it the key is derived from type + roles |
| `type` | yes | — | `water_reserve_control` |
| `enabled` | no | `true` | Set `false` to skip the rule |
| `name` | no | — | Display name used in the notification |
| `sourceRoles` | yes | — | Roles of `water_level_sensor` devices; **all** must have valid readings or the rule is skipped |
| `targetValveRole` | yes | — | Role of the valve the rule would act on |
| `trigger.allBelowPercent` | no | `20` | All sources must be at/below this level |
| `trigger.minConsecutiveChecks` | no | `3` | Consecutive matching checks before announcing |
| `action.openForMinutes` | no | `15` | Announced (not executed) valve-open duration |
| `notify.cooldownMinutes` | no | `120` | Cooldown between repeated announcements |

### Example

```json
[
  {
    "id": "auto_1",
    "type": "water_reserve_control",
    "enabled": true,
    "sourceRoles": ["tank_a", "tank_b"],
    "targetValveRole": "valve_main",
    "trigger": { "allBelowPercent": 20, "minConsecutiveChecks": 3 },
    "action": { "openForMinutes": 15 },
    "notify": { "cooldownMinutes": 120 }
  }
]
```

---

## Runtime Config (KV, admin-set)

Admins can override a fixed allow-list of fields at runtime via the dashboard (POST `/api/dashboard-context`). Values are validated and clamped by `normalizeDashboardRuntimeConfig()`; out-of-range values are silently dropped. The allow-lists are `EDITABLE_RUNTIME_CONFIG_FIELDS` and `EDITABLE_DEVICE_CONFIG_FIELDS` in `src/config.js` — never accept runtime input outside them.

Per-device runtime overrides are keyed by device `role` or `id` and merged on top of the registry entry by `applyRuntimeDeviceConfig()` (ID wins over role).
