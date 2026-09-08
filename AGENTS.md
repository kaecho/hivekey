# Repository Guidelines

## Project Structure & Module Organization
HiveKey is an Express API-key pool with a vanilla JavaScript dashboard.
- `src/`: backend; `index.js` wires the app, `routes/admin.js` exposes administration, `proxy.js`/`adapters.js` handle protocols, and `pool.js`/`scheduler.js` manage key selection.
- `public/`: dashboard HTML, CSS, JavaScript, and translations (`i18n.js`).
- `test/`: unit, integration, and protocol suites named `*.test.js`.
- `data/`: generated JSON persistence; ignored by Git.

## Build, Test, and Development Commands
Use Node.js ≥18.17; CI tests Node.js 20 and 22. There is no compilation step.
- `npm ci` — install locked dependencies.
- `npm start` — serve the app at `http://localhost:3000`.
- `npm run dev` — restart the server automatically when files change.
- `npm test` — run the complete suite with `node --test`.
- `node --test test/adapters.test.js` — run one suite.
- `docker compose up --build -d` — build and start the container.

## Coding Style & Naming Conventions
Use CommonJS (`require`, `module.exports`), two-space indentation, single-quoted strings, and semicolons. Use `camelCase` for functions/variables and `PascalCase` for classes; follow existing lowercase module filenames. No formatter or linter is configured; match nearby code.

Dashboard strings must use `t()` with corresponding `zh-CN` entries in `public/i18n.js`. Preserve the existing `data-action` event-delegation pattern.

## Testing Guidelines
Tests use `node:test` and `node:assert`. Give cases descriptive, behavior-oriented names. Add regression tests for changed scheduling, retries, authentication, and protocol handling, including SSE streaming where relevant. Use local mock upstreams and temporary data directories, not live credentials. No coverage threshold is configured; run the full suite before opening a PR.

## Commit & Pull Request Guidelines
Use concise imperative subjects, following history's `Add ...` and `Retry ...` patterns; `chore:` and `release:` prefixes also appear. PRs should explain changes, link related issues, list validation commands/results, and include screenshots for dashboard changes. Keep `README.md` and `README.zh-CN.md` synchronized for user-facing documentation changes.

## Security & Configuration Tips
Use `.env.example` as a reference and export variables explicitly; `.env` is not automatically loaded. Set a strong `ADMIN_PASSWORD`. Never commit `.env`, `data/`, `CLAUDE.local.md`, or API keys; persisted JSON contains plaintext secrets.
