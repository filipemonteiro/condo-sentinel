# Condo Sentinel — Constitution

Non-negotiable constraints. Do not change these without an explicit architectural decision.

---

## 1. KV is the only storage layer

There is no database, no in-memory state shared between requests, no external cache. All persistent state lives in the `STATE` KV namespace under documented key prefixes. Do not introduce any other storage mechanism without replacing this architecture entirely.

---

## 2. Production logs must never expose identifiers or payloads

Logs must not contain:
- Device IDs (Tuya IDs or internal IDs)
- User emails or authentication headers
- Tuya API payloads or response bodies
- Secrets, tokens, or credentials
- Location names or operational context

**`LOG_FULL_PAYLOAD`** — this flag exists for short-lived local debugging only. Setting it to `true` in production will log raw Tuya status payloads including device IDs and readings. It must remain `false` in any environment with real operational data. There is no runtime guardrail; the constraint is enforced only by policy.

---

## 3. All /api/* routes require constant-time token comparison

`requireDashboardAuth()` in `worker.js` must always use `constantTimeEqual()` to compare the bearer token. Do not replace with `===` or any early-exit comparison — this prevents timing-based token enumeration attacks.

The function returns a response (blocking the handler) or `null` (allowing it). Every new API route must call it before accessing KV or returning data.

---

## 4. Alert state follows a strict three-field pattern

Every alert type in the system uses exactly these three fields in device or global state:

```
{alert}Active        boolean   — is the alert currently firing?
last{Alert}AlertAt   number    — Unix ms of last notification sent
cooldownMs           number    — minimum ms between repeat notifications
```

**Do not add new alert types that bypass this pattern.** The recovery logic, pending notification cleanup, and deduplication in `worker.js` depend on these fields being consistent across all device types.

---

## 5. Recovery messages must cancel their corresponding pending notifications

When a recovery notification is produced (e.g. device came back online), `removePendingNotificationsForRecoveries()` in `worker.js` removes the matching fault from `globalState.pendingNotifications`.

Matching is done by **string prefix**. The exact patterns are:

| Recovery message regex | Removes pending starting with |
|---|---|
| `✅ A consulta ao device "X" foi restabelecida.` | `⚠️ Falha ao consultar o device "X"` |
| `✅ O device "X" voltou a ficar online.` | `⚠️ O device "X" está offline` |
| `✅ O device "X" saiu do estado de alarme.` | `🚨 O device "X" entrou em alarme.` |
| `✅ A bateria do device "X" foi recuperada para` | `⚠️ A bateria do device "X" está baixa` |
| `✅ A leitura do sensor "X" foi restabelecida. Nível atual:` | `⚠️ O sensor "X" está com leitura inválida` |
| `✅ O nível do sensor "X" normalizou em` | `⚠️ O nível do sensor "X" está em` |

**If you rename or reformat any notification message, update `removePendingNotificationsForRecoveries()` in the same commit.** Breaking this pairing causes stale fault notifications to persist indefinitely.

---

## 6. `evaluateWaterReserveControl` only notifies — it does not actuate

The current automation engine announces *planned* valve actions via Telegram but does not open or close valves. This is intentional: the system is a monitoring sentinel, not a control system. The notification message explicitly says the action "will not be executed automatically in this version."

Do not implement actual valve control without a separate architectural decision covering safety, fail-safes, and state recovery.

---

## 7. Dashboard HTML route stays data-free

`/dashboard` renders a static HTML shell with no device data, no user data, no secrets, and no runtime identifiers embedded. It is intentionally unauthenticated. All runtime data flows through `/api/status`, `/api/history`, and `/api/dashboard-context`, which require bearer token auth.

Do not embed any operational data into the HTML template.

---

## 8. `wrangler.toml` must not contain runtime variables or secrets

The CI pipeline (`deploy.yml`) copies `wrangler.example.toml` → `wrangler.toml` and actively guards against runtime vars being present (the `Guard runtime secrets` step uses grep and exits 1). Runtime config lives in Cloudflare Workers settings or Wrangler secrets, not in committed files.
