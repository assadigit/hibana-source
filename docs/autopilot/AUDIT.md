# Hibana Autopilot — AUDIT (findings ledger)

> One row per finding: ID | severity (critical/high/medium/low) | area | evidence (file:line / failing test) | status | fix commit.
> Nothing counts as a confirmed bug until reproduced by a failing test (PLAYBOOK §2, AG-6).
> Phase 0 will add the full code "Inventory" section (directory map, routes, migrations, bindings, entry points).

| ID | Severity | Area | Evidence | Status | Fix commit |
|----|----------|------|----------|--------|------------|
| — | — | — | (no findings recorded yet) | — | — |

## Pre-flight verification (session start — 2026-10-26, read-only audit of `main @ 7b830d7`)

Method: every project fact claimed in PLAYBOOK.md §1 was checked against the code by a read-only audit (no files modified). Evidence is file:line at commit 7b830d7. The autopilot prompt's facts are the claims; the code wins (PLAYBOOK §1).

### Facts VERIFIED (prompt matches code)

- **Frontend stack**: ~30 static HTML pages in `public/`; vendored `public/vendor/htmx.min.js`, `alpine.min.js`, `fabric.min.js`; Fabric used only for canvas/whiteboard (`public/js/canvas.js:8`, `public/js/whiteboard.js:8`); no React in deps; no CSS preprocessor (23 plain `public/css/*.css`); vanilla JS IIFE globals (50 files in `public/js/`).
- **Backend**: Hono TypeScript (`src/app.ts:43`). ONE codebase: Workers entry `src/index.ts` (D1 via `src/db/d1.ts`) AND Node entry `src/server.ts` (`@hono/node-server`, `node:sqlite` via `src/db/sqlite.ts`).
- **DB**: single `Db` interface (`src/db/types.ts:21-37`) behind the D1 and node:sqlite adapters; shared numbered migrations (`src/db/migrate-node.ts`).
- **Build**: `scripts/build.mjs` (esbuild) → content-hashed immutable `public/dist/` + `dist/manifest.json`; `--wire-html` / `--restore-html` flags (`scripts/build.mjs:40-41`). `public/dist/` is gitignored generated output.
- **Storage**: KV `HIBANA_SHOTS` (`src/services/kv.ts`); S3-compatible fallback (`src/services/r2.ts`); GitHub fallback repo `assadigit/hibana-safe` (`src/services/github.ts`, `wrangler.toml:68-69`). `shotcheck:local|:dev|:prod` scripts exist → `scripts/live-shot-check.mjs` (live upload → render → delete round trip). NOTE: the real chain has one extra first tier the prompt omits — Node-only disk store (`src/services/disk-shots.ts`, `HIBANA_SHOTS_DIR`) → kv → r2 → github (`src/services/shotstore.ts:11-15`).
- **Integrations**: Resend (`src/services/email.ts`), healthchecks.io (`src/services/healthcheck.ts`), Telegram bot (`src/services/telegram.ts`), Workers AI "Magic Button" (`[ai]` binding in `wrangler.toml:75-76`, `src/services/ai.ts`, `public/js/magic-wand.js`).
- **Bilingual**: EN/FA dictionaries (`public/js/i18n-en.js`, `i18n-fa.js`), RTL/LTR switching (`public/js/i18n.js:94`, `public/css/rtl.css`), Jalali + Gregorian calendars (`public/js/jalali.js`, vendor `jalaali.min.js`, `src/lib/jalali.ts`).
- **Infra**: both entry points exist; CI present (6 workflows: ci, cd, d1-migrate-dev, errors, release, uptime + dependabot); tests = vitest (`src/tests/`, 82 files) + Playwright e2e (2 shards) + `test:workers` portability smoke (`scripts/workers-smoke.mjs`).

### Mismatches (prompt vs code) — to be resolved in the right phase

- **M1** `npm run verify` DOES NOT exist (45 scripts; no `verify`). Phase 0 must create it — PLAYBOOK §5 PHASE 0 explicitly anticipates this ("if it does not exist").
- **M2** No plain `lint` script — only `lint:escape`; CI runs `npx eslint src/` directly (`ci.yml`). Phase 0 should fold this into `npm run verify`.
- **M3** The rule file is `Agents.md` (lowercase A; no `AGENTS.md`/`CLAUDE.md`) — deliberately consolidated in v0.3.9.2, and its contents are consistent with the code. PLAYBOOK §1 says AGENTS.md/CLAUDE.md "if present" — `Agents.md` qualifies as the repo's instruction file.
- **M4** Storage chain has an extra Node-only tier (disk-shots) before KV — the prompt §1 omits it. Harmless; must be included in the Phase 1 isolation audit and any storage tests.
- **M5** Migrations: 63 tracked files numbered 0001–0064 (the 0007 gap is original/intentional per `Agents.md`).
- **M6** No `engines` field in `package.json` enforcing Node 24+ — the requirement exists only in comments/`Agents.md`. Candidate fix for Phase 0 or 3.
- **M7** wrangler details: env key is `prod` (not `production`); no staging env; no `routes`/`custom_domains` keys in the toml; `compatibility_date = 2026-01-01`.

### Notable extras (in the repo, not mentioned in the prompt)

- A separate `hibana-desktop` Go/Wails repo exists (github.com/assadigit/hibana-desktop); THIS repo contains only its planning docs (`docs/project-kanban/GO-*.md`) and "session seal" commits (S215–S227) that document desktop rounds.
- Lighthouse CI (`lighthouserc.json` + `lighthouserc.mobile.json`) runs in ci.yml.
- `qa/` folder: 72 live-verify/probe scripts from past sessions (s174–s209).
- PWA: `public/sw.js`, `manifest.webmanifest`, `_headers`.
- bun is the package manager (`packageManager: bun@1.3.14`, `bun.lock`).
- ArvanCloud mirror origins (MIRROR_ORIGIN) for CSRF, captcha, rate limiting, ICS/Obsidian export services.
- Repo-root `worklog.md` (active session log) + `worklog-archive.md` (336KB archive) maintained by past non-autopilot sessions.

### Quick secrets check (HEAD only — NOT a history scan)

- No tracked `.env` / `*.pem` / `*.key` files; `credentials.md`, `.dev.vars`, `.secrets.env`, `.admin.secrets`, `.env`, cookies are all gitignored.
- Only token-pattern hit at HEAD: `scripts/purge-cache.mjs:60` contains a regex that matches Cloudflare deploy-token strings and reads the actual value from the gitignored `credentials.md` — no literal secret values tracked.
- The full git-history secret scan remains Phase 1 work (PLAYBOOK §5 PHASE 1).
