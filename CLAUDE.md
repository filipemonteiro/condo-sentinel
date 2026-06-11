# Condo Sentinel — CLAUDE.md

IoT monitoring system running on Cloudflare Workers. Polls Tuya Cloud devices on a cron schedule, persists state/history in KV, sends Telegram alerts, serves a dashboard SPA.

## Commands

```bash
npm run dev       # wrangler dev — local worker with miniflare KV
npm run deploy    # wrangler deploy — deploy to Cloudflare
npm run check     # node --check on all src/*.js — syntax only, no types
npm test          # node --test — runs test/*.test.js with Node built-in runner
```

Before deploying: copy `wrangler.example.toml` → `wrangler.toml` and `cp .dev.vars.example .dev.vars`. Fill in real values locally; never commit either file.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (ESM, no bundler) |
| Storage | Cloudflare KV (`STATE` binding) — only storage layer |
| IoT data | Tuya Cloud API (HMAC-SHA256 signed) |
| Alerts | Telegram Bot API |
| Dashboard | SPA rendered as inline HTML string by the worker |
| CI/CD | GitHub Actions → `wrangler deploy` |
| Tests | Node.js `node:test` (no external framework) |

## Module Map

| File | Responsibility |
|---|---|
| `src/worker.js` | Entry point: HTTP router + cron `handleCheck` + notification pipeline |
| `src/access.js` | Cloudflare Access JWT validation (verified admin identity, opt-in via `CF_ACCESS_*`) |
| `src/config.js` | Merge env vars + KV runtime config → normalized `cfg` object |
| `src/state.js` | All KV reads/writes. Owns key schema. |
| `src/tuya.js` | Tuya API: token acquisition/cache, request signing, status + batch calls |
| `src/devices.js` | Per-type device inspection. Produces `reading` and pushes to `notifications[]` |
| `src/automations.js` | Rule evaluation engine. Currently only `water_reserve_control`. |
| `src/history.js` | Smart history append (interval + delta filtering) |
| `src/notifications.js` | Telegram send. Supports `DRY_RUN`. |
| `src/dashboard.js` | Aggregates KV state into dashboard payload + history API handler |
| `src/dashboard-template.js` | Assembles full HTML shell from CSS + JS modules |
| `src/dashboard-css.js` | Dashboard styles (dark oklch theme) |
| `src/dashboard-js.js` | Client-side JS: session, Chart.js rendering, device cards |

## Global Conventions

**Timestamps** — always Unix milliseconds (`Date.now()`). Config fields in minutes (env/KV), always converted to ms internally before use.

**Env coercion** — never parse env strings directly. Use `toInt(value, fallback)`, `toNumber(value)`, `toBool(value, fallback)` from `utils.js`.

**KV writes** — always check current value first; skip write if unchanged. Pattern in `state.js`: `if (current === next) return false`.

**Production logs** — never log device IDs, Tuya payloads, user emails, or secret values. Use generic messages and omit identifiers. `LOG_FULL_PAYLOAD` must stay `false` in production.

**Alert pattern** — every alert type uses the same state fields: `{alert}Active` (boolean) + `last{Alert}AlertAt` (ms timestamp) + `cooldownMs` (derived from config). Recovery clears the `Active` flag and removes the pending notification.

**Config priority** — KV runtime config (admin-set) overrides env vars, which override `DEFAULT_CONFIG` in `config.js`.

## Docs

- [docs/constitution.md](docs/constitution.md) — non-negotiable constraints
- [docs/architecture.md](docs/architecture.md) — flow diagrams, KV schema, auth model
- [docs/configuration.md](docs/configuration.md) — env vars + `DEVICE_REGISTRY_JSON` / `AUTOMATIONS_JSON` schemas
- [src/CLAUDE.md](src/CLAUDE.md) — per-module SDD specs
