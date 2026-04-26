# Contributing

Thanks for considering a contribution.

## Local Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local configuration:

   ```bash
   cp wrangler.example.toml wrangler.toml
   cp .dev.vars.example .dev.vars
   ```

3. Fill `.dev.vars` and `wrangler.toml` with local or test values only.

4. Run checks:

   ```bash
   npm run check
   npm test
   ```

5. Run locally:

   ```bash
   npm run dev
   ```

## Pull Requests

- Keep changes focused and small.
- Do not include real device IDs, secrets, screenshots with operational data, or private deployment details.
- Add or update tests for behavior changes.
- Update the README when setup, configuration, endpoints, or deployment steps change.

## Code Style

- Use plain JavaScript modules.
- Prefer small pure functions for alerting, history, and automation rules.
- Keep Cloudflare-specific integration at the edges where practical.
