# src/ — Module Specs (SDD)

All source files are Cloudflare Workers ESM modules. No bundler. No TypeScript. Node.js `node:test` for tests.

---

## worker.js

**Intent** — Entry point for both the cron trigger (`scheduled`) and HTTP requests (`fetch`). Orchestrates the full check cycle: load config + state → fetch Tuya data → process devices → evaluate automations → send notifications → persist state. Also owns the HTTP router, auth middleware, and the notification pipeline (pending, dedup, recovery cancellation).

**Constraints**
- `requireDashboardAuth()` must be called before any KV access or data return in every API route.
- `constantTimeEqual()` must be used for token comparison — never `===`.
- `handleCheck()` is exported for direct use in tests. Keep it side-effect-free w.r.t. the module scope.
- `saveAllDeviceStates` and `saveGlobalState` run in a `finally` block — state must always persist even if notification sending fails.

**Interfaces**
```js
export default { scheduled(event, env, ctx), fetch(request, env, ctx) }
export async function handleCheck(env)  // testable cron body
```

**Implementation notes**
- Config priority merging happens in `getConfig()` (config.js), not here.
- Pending notifications are stored in `globalState.pendingNotifications` as `{ message, lastAttemptAt, nextAttemptAt }`. Legacy string format is normalized by `normalizePendingNotifications()`.
- Recovery message → pending fault cancellation uses string prefix matching in `removePendingNotificationsForRecoveries()`. See `docs/constitution.md §5` for the exact patterns.
- `mergeUsers()` gives KV user-roles priority over `DASHBOARD_USERS_JSON`. KV entries are admin-set explicitly.
- `buildEditableDeviceConfigPayload()` builds per-device editable config from the registry + runtime config, filtering to `EDITABLE_DEVICE_CONFIG_FIELDS` only.
- `globalState` is loaded before `loadAllDeviceStates` in `handleCheck` — `globalState.devices` is forwarded to avoid a redundant KV read of `condo_automation_state` during legacy migration.


---

## config.js

**Intent** — Produces the `cfg` object consumed by every module during a worker execution. Merges three config layers (KV runtime > env vars > `DEFAULT_CONFIG`) and normalizes all values to their internal types (ms for durations, numbers for thresholds).

**Constraints**
- All duration fields in `DEFAULT_CONFIG` are in minutes. `getConfig()` converts them to ms. Callers receive ms, never minutes.
- `normalizeDashboardRuntimeConfig()` validates and clamps every field against `RUNTIME_CONFIG_RULES` / `DEVICE_CONFIG_RULES`. Out-of-range values are silently dropped (return `null` from normalizers → field omitted).
- `EDITABLE_RUNTIME_CONFIG_FIELDS` and `EDITABLE_DEVICE_CONFIG_FIELDS` are the canonical allow-lists for what admins can change at runtime. Never accept runtime input for fields not in these lists.

**Interfaces**
```js
export async function getConfig(env): Promise<CfgObject>
export function normalizeDashboardRuntimeConfig(input): NormalizedConfig
export const EDITABLE_RUNTIME_CONFIG_FIELDS: string[]
export const EDITABLE_DEVICE_CONFIG_FIELDS: string[]
```

**Implementation notes**
- `valueFor(name)` checks KV runtime config first, then `env[name]`, then `DEFAULT_CONFIG[name]`. This is the priority chain.
- `DASHBOARD_TITLE` alias: `normalizeDashboardRuntimeConfig` accepts either `DASHBOARD_TITLE` or `dashboardTitle` as input key (for backward compat with old KV values).
- `deviceConfigs` in the returned `cfg` is a map keyed by device role or device ID — applied in `devices.js` via `applyRuntimeDeviceConfig()`.

---

## state.js

**Intent** — All Cloudflare KV reads and writes. Owns the KV key schema. No business logic — just serialization, deserialization, and write-if-changed guards.

**Constraints**
- Every `save*` function must check if the value changed before writing. Pattern: serialize → compare with current → skip if equal. This is critical for KV write budget.
- Never add new KV keys without documenting them in `docs/architecture.md`.
- `loadDeviceState()` contains legacy migration from the old global `condo_automation_state` format. Do not remove until migration is verified complete in production.

**Interfaces**
```js
export function createDefaultDeviceState(device): DeviceState
export function defaultGlobalState(): GlobalState
export function mergeDeviceStateDefaults(existing): DeviceState
export function mergeAutomationStateDefaults(existing): AutomationState
export async function loadDeviceState(env, deviceId): Promise<DeviceState|null>
export async function saveDeviceState(env, deviceId, state): Promise<void>
export async function loadAllDeviceStates(env, devices): Promise<Record<id, DeviceState>>
export async function saveAllDeviceStates(env, deviceStates): Promise<void>
export async function loadGlobalState(env): Promise<GlobalState>
export async function saveGlobalState(env, state): Promise<boolean>
export async function loadDashboardRuntimeConfig(env): Promise<object|null>
export async function saveDashboardRuntimeConfig(env, config): Promise<boolean>
export async function loadDashboardUserMappings(env): Promise<UserMapping[]>
export async function saveDashboardUserMappings(env, users): Promise<boolean>
```

**Implementation notes**
- `loadGlobalState()` merges with `defaultGlobalState()` using spread — new fields added to the default are automatically available even for existing KV entries.
- Device state shape is defined by `createDefaultDeviceState()`. `mergeDeviceStateDefaults()` is for applying defaults to partially-loaded states from legacy KV.
- `loadDeviceState(env, deviceId, legacyDevices)` accepts an optional `legacyDevices` map. When provided, skips the KV read of `condo_automation_state` and uses the map directly. `handleCheck` in `worker.js` passes `globalState.devices` here to avoid a redundant read.
- `loadAllDeviceStates` forwards `legacyDevices` unchanged to each `loadDeviceState` call.

---

## tuya.js

**Intent** — All communication with the Tuya Cloud API. Handles OAuth token acquisition with KV caching, HMAC-SHA256 request signing, single-device status calls, and batch device info calls.

**Constraints**
- Token must be cached in KV (`tuya:access_token`). Never fetch a new token if a valid cached one exists (valid = >60s remaining).
- `fetchWithRetry()` retries only on HTTP 5xx or network errors — not on 4xx (those indicate config/auth problems, not transience).
- Batch endpoint takes at most 20 device IDs per call. `getTuyaDevicesBatchInfo()` slices and enforces this.
- Never log raw API responses unless `logFullPayload` is explicitly `true` (debug only, never in production).

**Interfaces**
```js
export async function getTuyaToken(env): Promise<string>
export async function buildTuyaSignedRequest(env, { method, path, body, accessToken }): Promise<{ headers }>
export async function getTuyaDeviceStatus(env, accessToken, deviceId, logFullPayload): Promise<TuyaStatusResponse>
export async function getTuyaDevicesBatchInfo(env, accessToken, deviceIds, logFullPayload): Promise<BatchItem[]>
export function buildBatchDeviceMap(batchResult): Record<id, BatchItem>
```

**Implementation notes**
- Signing algorithm: `HMAC-SHA256(clientSecret, clientId + [accessToken?] + t + nonce + stringToSign)` where `stringToSign = METHOD\nbodyHash\n\npath`.
- Token expiry: Tuya returns `expire_time` in seconds; stored as `expiresAt = Date.now() + expireTime * 1000`. Refreshed when `expiresAt - now < 60_000`.
- `redactIdentifier()` is used for device IDs in error messages — shows first/last 3 chars only.

---

## devices.js

**Intent** — Inspects each enabled device by querying the Tuya API and applying alert logic. Produces a `reading` object and pushes notification strings into `notifications[]`. Also populates `context` (used by automations).

**Constraints**
- `applyRuntimeDeviceConfig()` must be called on every device before inspection. This applies KV runtime overrides by role or by ID.
- Device type `default` case must warn and return `null` reading — do not throw.
- API fault / batch failure must not stop processing other devices. `processDevices` catches per-device errors.
- Never add a new device type without a corresponding `buildHistoryPoint()` case in `history.js` and a `shouldAppendHistoryPoint()` case.

**Interfaces**
```js
export async function processDevices(env, accessToken, enabledDevices, deviceStates, cfg, now, notifications, context): Promise<void>
export async function inspectDevice(env, accessToken, device, batchDeviceInfo, dState, cfg, now, notifications): Promise<{ online, batchIsOnline, reading }>
export async function inspectWaterLevelSensor(env, accessToken, device, dState, cfg, now, notifications): Promise<WaterLevelReading>
export async function inspectGenericStatusDevice(env, accessToken, device, dState, cfg, now, notifications, options): Promise<GenericReading>
export async function inspectValve(env, accessToken, device, dState, cfg, now, notifications): Promise<ValveReading>
export function applyRuntimeDeviceConfig(device, cfg): Device
```

**Implementation notes**
- `context` object is mutated in-place: `devicesById`, `devicesByRole`, `readingsByRole`, `availabilityByRole`, `batchInfoById`. Automations consume this.
- Device-level cooldowns override global: `device.offlineCooldownMinutes ?? cfg.defaultOfflineCooldownMs`. Pattern repeated for all cooldown types.
- `recordDeviceApiFault` / `recordDeviceApiRecovery` are symmetric — recovery clears `apiFaultActive` and sends a recovery notification if the fault was active.
- `inspectWaterLevelSensor` uses `device.levelCode || "liquid_level_percent"` — allows per-device override of the Tuya code for the level percentage field.
- Battery recovery threshold is `batteryThreshold + 5` (hardcoded hysteresis). Not configurable.

**Implementation notes (continued)**
- Battery recovery hysteresis is `BATTERY_RECOVERY_HYSTERESIS_PERCENT` (= 5, constant at top of file). Not configurable — intentional fixed margin.

---

## automations.js

**Intent** — Evaluates rule-based automation logic after all devices have been inspected. Reads from `context` (produced by `devices.js`), updates automation state, and pushes notification strings.

**Constraints**
- Automations only notify — they do not actuate any device. See `docs/constitution.md §6`.
- New automation types must be added as `case` branches in `evaluateAutomations()`. Unknown types log a warning and are skipped.
- `getAutomationKey()` must produce a stable, unique key for each rule. Rules without an `id` get a derived key from type + roles.

**Interfaces**
```js
export async function evaluateAutomations({ automations, state, now, notifications, context }): Promise<void>
export function evaluateWaterReserveControl(rule, aState, context, now, notifications): void
export function getAutomationKey(rule): string
export { mergeAutomationStateDefaults } from './state.js'
```

**Implementation notes**
- `water_reserve_control` requires all `sourceRoles` to have valid `water_level_sensor` readings. If any role is missing, invalid, or non-numeric, the rule is skipped entirely (early return).
- `aState.triggerCount` increments each check where all sources are below `allBelowPercent`. Resets to 0 on any check where at least one source is above threshold.
- Alert fires only when `triggerCount >= minConsecutiveChecks` AND not already active AND outside cooldown.
- `aState.plannedActionAlertActive` resets to `false` when the trigger condition clears — allows re-alerting next time the condition is met after a recovery.

**⚠️ Tech debt**
- Only one automation type implemented. The engine architecture supports more types but none exist yet.
- Actual valve actuation is not implemented. The notification message explicitly marks this as a future feature.

---

## history.js

**Intent** — Appends data points to per-device history arrays in KV, applying smart filtering to avoid writing on every cron tick. Keeps history bounded by `HISTORY_MAX_POINTS`.

**Constraints**
- Never write a history point if `shouldAppendHistoryPoint()` returns false. This is the primary KV write optimization.
- History arrays are always appended (push) and trimmed from the front (`slice(-maxPoints)`). Do not sort or reindex.
- `buildHistoryPoint()` returns `null` for unknown device types. Callers must handle `null`.

**Interfaces**
```js
export async function appendDeviceHistory(env, device, reading, online, now, cfg): Promise<boolean>
export function shouldAppendHistoryPoint({ device, last, next, minIntervalMs, minDeltaPercent }): boolean
export function buildHistoryPoint(device, reading, online, ts): HistoryPoint | null
export async function getDeviceHistory(env, deviceId): Promise<HistoryPoint[]>
```

**Implementation notes**
- `shouldAppendHistoryPoint` always writes if: online status changed, or no previous point exists.
- For `water_level_sensor`: also writes if validity changed, liquid state changed, percent changed by `>= minDeltaPercent`, or percent nullness changed.
- For `gas_sensor` / `water_leak_sensor`: also writes if alarm boolean or alarm value changed.
- For `valve`: also writes if `currentValue` changed.
- `minIntervalMs` is the fallback trigger — even with no meaningful change, a point is written after the interval elapses.

---

## notifications.js

**Intent** — Single-responsibility module for sending Telegram messages. Accepts a pre-built message string and sends it to `TELEGRAM_CHAT_ID` via the Bot API.

**Constraints**
- Must check both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` before attempting any network call — throw if either is absent.
- `dryRun = true` must prevent any network call. Log only.
- Error details from Telegram must be summarized (no raw response body in logs).

**Interfaces**
```js
export async function sendTelegramMessage(env, message, dryRun): Promise<void>
```

**Implementation notes**
- No retry logic here. Retry/persistence of failed notifications is handled in `worker.js` via `pendingNotifications`.
- `summarizeTelegramError()` extracts only `ok`, `error_code`, `description` — avoids leaking message content back into logs.

---

## dashboard.js

**Intent** — Aggregates KV device states into a sanitized dashboard status payload. Handles the `/api/history` response. Owns `escapeHtmlText()` used by the template.

**Constraints**
- `buildDashboardStatus()` must never return raw device IDs or internal state fields that aren't explicitly mapped. The payload shape is the public API contract.
- `escapeHtmlText()` must be used for any value interpolated into the HTML template.

**Interfaces**
```js
export async function buildDashboardStatus(env): Promise<StatusPayload>
export async function handleApiHistory(env, deviceId): Promise<Response>
export function escapeHtmlText(value): string
export { renderDashboardHtml } from './dashboard-template.js'
```

**Implementation notes**
- `stale` flag: a device is stale if `lastReading.readingUpdatedAt` exists and is older than `staleAfterMs`. Offline devices (no reading ever) are not marked stale.
- `summary` block is computed from `deviceViews` array — counts of online, offline, stale, alarm, fault, lowLevel devices.

**Implementation notes (continued)**
- `buildDashboardStatus()` loads `globalState` in parallel with device states via `Promise.all`. The `automations` field in the payload reflects `globalState.automations` — populated by `evaluateAutomations` during cron runs.

---

## dashboard-template.js

**Intent** — Assembles the full HTML shell by combining `dashboard-css.js` and `dashboard-js.js`. Renders minimal server-side values (title, session timeout) safely escaped.

**Constraints**
- Only `dashboardTitle` and `sessionTimeoutMinutes` may be rendered server-side. No device data, no user data, no tokens.
- All server-side interpolated strings must go through `escapeHtmlText()`.
- CSP is set in `utils.js htmlResponse()`. Template must not add inline scripts beyond the bundled `${js}` block already there.

**Interfaces**
```js
export function renderDashboardHtml(options: { sessionTimeoutMinutes, dashboardTitle, userRole }): string
```

**Implementation notes**
- `userRole` is not passed from `worker.js` and is not used in the template. Do not add server-side role rendering here — role data flows through `/api/dashboard-context`.
- Chart.js is loaded from `https://cdn.jsdelivr.net/npm/chart.js` — declared in CSP `script-src`.

---

## dashboard-css.js

**Intent** — Exports the full dashboard CSS as a string constant. Dark theme using `oklch()` color space with CSS custom properties.

**Interfaces**
```js
export const dashboardCss: string
```

**Implementation notes**
- Color system uses `oklch(lightness chroma hue)`. Alpha variants use `oklch(... / alpha)` syntax.
- Variables: `--bg`, `--card`, `--sidebar`, `--fg`, `--fg-muted`, `--border`, `--primary`, `--status-online/offline/warning/info` (each with `-bg` variant).
- Layout: fixed sidebar (`--sidebar-w: 224px`), fixed topbar (`--topbar-h: 52px`), main content uses `margin-left`.

---

## dashboard-js.js

**Intent** — Exports the client-side JavaScript as a template-literal string. Implements the full SPA: session management, authenticated fetch wrapper, device card rendering, history chart (Chart.js), config form (admin only).

**Constraints**
- Session token is stored in `sessionStorage` only — never `localStorage`. Clears on tab close.
- `authenticatedFetch()` must be used for all API calls — handles 401/503 and calls `showAuth()` on failure.
- `escHtml()` must be used for any user-visible string interpolated into innerHTML.

**Interfaces**
```js
export function dashboardJs(options: { sessionTimeoutMinutes }): string
```

**Implementation notes**
- `SESSION_TIMEOUT_MS` is embedded at render time from `sessionTimeoutMinutes` (passed from worker). Not dynamically updated after load.
- `currentDashboardContext` holds the `/api/dashboard-context` response (config, users, currentUser, devices).
- `currentDashboardStatus` holds the last `/api/status` response.
- History is filtered client-side by time range and optionally bucketed into 15m/1h/6h intervals before being passed to Chart.js.
- `historyCache` is a plain object keyed by deviceId — invalidated only on explicit refresh button click or section switch.

**⚠️ Tech debt**
- The entire JS is an untyped string. No linting, no type checking, no unit tests. Bugs in client-side rendering are caught only through manual browser testing.
- Config form rendering (`renderConfigForm`) is constructed as innerHTML strings — any new field requires manual HTML generation.
