# Security Policy

## Supported Versions

This project is currently in an early public-ready stage. Security fixes are handled on the `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities or accidental exposure of real device data.

Report security concerns privately to the repository owner. Include:

- A short description of the issue
- Steps to reproduce, if applicable
- Impacted files, endpoints, or deployment settings
- Any evidence that secrets, device IDs, or operational data may have been exposed

## Sensitive Data

Do not commit real values for:

- `.dev.vars`
- `wrangler.toml`
- Tuya client credentials
- Telegram bot tokens or chat IDs
- Cloudflare account IDs, API tokens, or KV namespace IDs
- Real device IDs, names, locations, or operational infrastructure details

Dashboard data APIs require `DASHBOARD_ACCESS_TOKEN` using a Bearer token. Use a strong random value, rotate it if exposed, and keep the Worker URL shared only with trusted operators.
