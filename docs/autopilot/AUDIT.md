# Hibana Autopilot — AUDIT (findings ledger)

> One row per finding: ID | severity (critical/high/medium/low) | area | evidence (file:line / failing test) | status | fix commit.
> Nothing counts as a confirmed bug until reproduced by a failing test (PLAYBOOK §2, AG-6).
> Phase 0 will add the full code "Inventory" section (directory map, routes, migrations, bindings, entry points).

| ID | Severity | Area | Evidence | Status | Fix commit |
|----|----------|------|----------|--------|------------|
| AP-2 | low | e2e CI flake — s207 kanban-frame geometry | `e2e/s207-kanban-frame.spec.ts:121` failed on the Phase 0 CI run (shard 2) with `frameBox.left` Expected 0, Received **31** on attempt 1 and **3** on the in-run retry — two different offsets for the same assertion in one run is the signature of the runner-side render nondeterminism the S219 session already diagnosed (its offsets were 10/57/15px) and deferred to a future "flake-hunt" round. Zero product code changed this phase (public/ + src/ product files untouched). Re-run (attempt 2) failed again on the SAME single test (223/224 green) with offsets 57/31 — four random offsets total (31, 3, 57, 31) across two runs. DEFINITIVE LOCAL PROOF: the full s207 spec passes 5/5 (9.1 s) on this exact tree in this sandbox (Playwright chromium-headless-shell v1248) — the code is sound; the failure is runner-side geometry nondeterminism only. Not re-run again (AG-12 — never loop on the same failure); the flake-hunt round owns the fix. | OPEN — pre-existing, owned by the planned flake-hunt round (S196-style) | — |
| AP-1 | medium | offline queue retry persistence (client) | `src/tests/offline-queue.test.ts` "CHARACTERIZED BUG" test (green — pins the broken behavior): `public/js/queue.js:143-156` bumps `retries` on the object read via IndexedDB `getAll()` — but getAll returns structured clones, so the bump is never persisted (the re-`put` only happens inside the already-unreachable `drop.length > 0` branch). The MAX_RETRIES=5 drop shipped as the fix for the "1836 failed syncs / 45 stuck unsynced" incident is dead code in a real browser — items stay queued forever on persistent 5xx. Mitigations that keep this medium: the user-facing "clear queue" escape hatch (`clearAll`), the pagehide beacon, and re-auth retries. | OPEN — pinned by a green characterization test; test-first fix scheduled for Phase 2 (bug hunt) | — |

## Phase 0 — Inventory (recorded 2026-10-26, `main @ 2be1c30` + phase branch)

### Environment (this session's toolchain)

- Node **v24.21.0** (meets the Node 24+ requirement), bun **1.3.14** (matches `packageManager` pin), wrangler **4.149.0** (local, from `^4.148.0`), TypeScript **6.0.3**, vitest **5.0.3**, esbuild **0.28.2**, Playwright **1.64.0**.
- Cloudflare deploy credentials verified working: `wrangler whoami` OK (account `6ff25b58…976`).
- Runtime dependencies (6): hono, @hono/node-server, fabric, fflate, playwright, zod. Dev dependencies (11): @cloudflare/workers-types, @eslint/js, @playwright/test, @types/node, esbuild, eslint, tsx, typescript, typescript-eslint, vitest, wrangler.
- npm audit (CI's method — lock generated on the fly, `--omit=dev --audit-level=high`): **0 vulnerabilities**.

### Directory map (src/ 2-level)

- `src/app.ts` (Hono app factory), `src/index.ts` (**Workers entry** — fetch + scheduled), `src/server.ts` (**Node entry** — @hono/node-server + node:sqlite), `src/types.ts`, `src/vendor/fabric-shim.ts`.
- `src/auth/` (middleware, password [PBKDF2 100k via Web Crypto], sessions [__Host- cookie, D1-backed], ban).
- `src/db/` (types [the ONE `Db` interface], d1 [Workers adapter], sqlite [node:sqlite adapter], migrate-node [Node migration runner]).
- `src/lib/` (16 files: app-url, categories, cron, crypto, errors, html, htmlx, http, i18n, ids, jalali, log, markdown, obsidian, sadhana-task-controls…).
- `src/routes/` (30 files, incl. projects/, integrations/telegram+import, *-helpers).
- `src/services/` (20 files: ai, backup, backup-planb, captcha, disk-shots, email, errorlog, github, healthcheck, ics-export, kv, progress, r2, ratelimit, reminders, reset, sadhana, shotstore, telegram, verify).
- `src/tests/` (vitest — 86 files / 685 tests after Phase 0 additions; was 81/646).
- `src/validation/schemas.ts` (Zod, route-level).
- `public/`: ~30 HTML pages, `css/` (23 files), `js/` (50 files), `vendor/` (htmx, alpine, fabric, highlight, idiomorph, jalaali + fonts), `partials/nav.html`, `sw.js` + `manifest.webmanifest` (PWA), `_headers`, icons/logos.
- `scripts/`: build.mjs (esbuild + --wire-html/--restore-html), smoke.mjs (in-process HTTP smoke), workers-smoke.mjs (Workers-runtime smoke via wrangler dev --local), live-shot-check.mjs (remote storage round-trip), migrate-node.ts, restore*.mjs, d1-*.mjs, check-*.mjs gates, seed-admin, set-secrets, make-zip, rotate/, perf JSON baselines.
- `e2e/` (92 Playwright specs + fixtures), `qa/` (72 live-probe scripts, sessions s174–s209).

### Routes, migrations, bindings

- **~511 route registrations** across `src/routes/` + `src/app.ts`. Top-level mounts (`src/app.ts:243-417`): `/api/auth`, `/api/projects`, `/api/tags`, `/api/search`, `/api/dashboard`, `/api/notes`, `/api/vault`, `/api/sadhana`, `/api/admin`, `/api/dev`, `/api/reports`, `/api/settings`, `/api/export`, `/api/calendar`, `/api/timeline`, `/api/ov-tasks`, `/api/notifications`, `/api/ai`, `/api/rail`, `/api/health`, plus unprefixed HTML page routes.
- **Migrations: 63 tracked files** numbered 0001–0064 (0007 gap is original). First: `0001_users_sessions_invites.sql`; last: `0064_user_categories.sql`. Live schema_version reported by /api/health: **63**.
- **wrangler bindings**: `[assets] ASSETS ./public` (run_worker_first negation globs); `[vars]` ENVIRONMENT/GITHUB_OWNER/GITHUB_REPO; `[ai] AI`; `[[d1_databases]] DB = pm-app-dev` (id 80e02ce2…a984); `[[kv_namespaces]] HIBANA_SHOTS` (id 7c6eb81b…899); `[env.prod]`: D1 DB = pm-app-prod (d842fcb5…496), KV HIBANA_SHOTS (1a64052f…567), AI, vars +APP_URL=https://hibana.ir +MIRROR_ORIGIN. Crons: dev `17 3,9,15,21 * * *` + `*/30`; prod `23 …` + `*/30` (backup + reminders). No routes/custom_domains keys (hibana.ir attached via dashboard).
- **Largest tracked files (KB)**: e2e/screenshots login-desktop 828; public/js/project-page.js 352; worklog-archive.md 336; vendor/fabric.min.js 288; public/js/app.js 216; scripts/perf-after.json 204; perf-baseline.json 184; Changelogs.md 168; public/js/canvas.js 156; e2e screenshot 136; public/js/notes-page.js 132; vendor/highlight.min.js 128.

### CI/CD (6 workflows + dependabot)

- `ci.yml` — push(main, !md)/PR: bun install → npm audit → eslint(0-warn ratchet) → escape-lint → build → bundle-size → precache-size → typecheck → cache-bust → i18n parity → vitest → smoke → dist-wiring → workers-smoke (CF-secrets, required on main) → Lighthouse desktop+mobile; `e2e` job = 2-shard Playwright matrix.
- `cd.yml` — workflow_run-gated on CI success (main): build --wire-html → deploy DEV (hibana.aliassadi.workers.dev) → health probe → deploy PROD (hibana.ir) → health probe → zone-cache purge → --restore-html.
- `d1-migrate-dev.yml` (manual dispatch), `errors.yml` (daily cron → healthchecks.io), `release.yml` (tag+release per package.json version bump), `uptime.yml` (cron probe → healthchecks.io).

### SESSION TOOLING NOTE (for every future session in this sandbox)

- This sandbox's file-reading display pipeline **strips `[m` sequences** from rendered output (e.g. `BASE_URL[mode]` displays as `BASE_URLode`; `out[m[1]]` as `out[1]]`). The repo's own worklog S220 documented the same class of artifact. NEVER trust a suspicious "corruption" seen through Read/Grep/awk output — verify with `node --check` or `od -c` before recording a finding. (Applied this session: two suspected script corruptions were byte-verified as FALSE POSITIVES.)
- Background jobs started with `nohup … &` do NOT survive between sandbox tool invocations — run long commands in the foreground with explicit timeouts.

## Phase 0 — Baseline numbers (all green at `main @ 2be1c30` + phase branch, 2026-10-26)

| Gate | Result | Notes |
|------|--------|-------|
| `npm run typecheck` | **0 errors** (~7 s) | strict TS incl. noUnusedLocals/Parameters |
| `npx eslint src/ --max-warnings 0` | **0 warnings** | the S199 warning ratchet holds |
| `npm run build` | **85 manifest entries**, ~0.35 s | 75 dist files, content-hashed |
| `npm test` (vitest) | **685/685 pass**, 86 files, ~65 s | 646/81 at baseline + 39 new Phase 0 characterization tests |
| `npm run smoke` | **ALL PASS** (18 checks) | in-process, throwaway SQLite |
| `npm run test:workers` | **ALL PASS** (5 checks) | wrangler dev --local (miniflare); PBKDF2 verify on the Workers runtime |
| `npm run lint:escape` | **PASS** — 220 sinks / 51 files | XSS escape gate |
| `npm run check:bundle-size` | **PASS** — 1,789,541 B / 75 files | vs baseline 1,746,531 B (+2.5%; CI gate 15%) |
| `npm run check:precache-size` | **PASS** | +106 KB headroom |
| `npm run check-cache-bust` | **PASS** | no JS/CSS modified |
| `npm run check-i18n-parity` | **PASS — 1584/1584 keys** | EN+FA identical |
| dist-wiring check | **PASS** — 27 wired pages / 812 refs | canonical HTML restored byte-identical after |
| npm audit (CI method) | **0 vulnerabilities** | prod deps only, high+ |
| local Node server timings | health ~1 ms · /login.html ~1.3 ms · / ~1.2 ms | warm, throwaway DB, port 3021 |

### Characterization-test gap analysis (pre-existing coverage vs the PLAYBOOK §5 Phase 0 list)

Already covered strongly (adding more would be redundant): invite registration, hurdles, Telegram webhook (mock), cross-user isolation, rate limits, password reset, export completeness (incl. the schema-drift guard), folders/categories, the server half of canvas sync, EN/FA parity (the 1584-key script), login (3 levels).

Gaps closed this phase (39 new tests, 5 files): logout route + session-cookie attributes (`auth-logout-cookie.test.ts` — the logout route had ZERO tests); hard-delete status matrix ×6 statuses (`hard-delete-matrix.test.ts`); project edit round-trip + status history log (`project-edit-roundtrip.test.ts`); Jalali oracles/leap years/Nowruz boundaries/200-year sweep/client-server parity (`jalali-calendar.test.ts` — the two algorithm copies never cross-checked); offline queue client unit harness (`offline-queue.test.ts` — 255 lines of IndexedDB logic previously untested; discovered AP-1).

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

## Phase 1 — Security and data isolation (2026-10-26, branch `autopilot/phase-1-security-isolation`)

Method: four parallel read-only audit subagents (P1-a isolation × SC-5; P1-b auth/session + input/output; P1-c uploads/webhooks/logging; P1-d secrets history × supply chain), then EVERY claim independently re-verified against the code by the lead before acting (PLAYBOOK §2 — reports are untrusted input). Two claims were DISPROVEN during verification and are recorded below. Fixes are test-first: each has a red-then-green regression test (proven via git-stash round-trips).

### Findings ledger (Phase 1)

| ID | Severity | Area | Evidence | Status | Fix commit |
|----|----------|------|----------|--------|------------|
| AP-3 | medium | canvas sync cross-user WRITE (SC-5) | `core.ts` ON CONFLICT(id) DO UPDATE had no user scoping in the conflict arm — the LWW pre-check only sees the caller's rows, so a foreign element id rode the conflict arm onto the victim's row (overwrite/tombstone). The only SC-5 write-scoping hole found in ~511 routes / 660 SQL sites. | **FIXED** — `WHERE canvas_elements.user_id = ?` added; isolation-fixes.test.ts | 96a0d4b |
| AP-4 | medium | stored `javascript:` URLs (links feature) | `schemas.ts` create/updateLinkSchema used `z.string().url()` (any scheme); links fragment renders `<a href>` — escaping neutralizes markup, not URI schemes. | **FIXED** — http(s)-only regex; auth-input-fixes.test.ts | 7f7910c |
| AP-5 | medium-low | Resend fetch without timeout | `email.ts` resendEmail — the one outbound integration call with no AbortSignal (telegram 25s/60s, healthchecks 10s already had one); a stalled connection hung the auth flow/cron riding it. | **FIXED** — AbortSignal.timeout(15s); integration-logging-fixes.test.ts | 5758a5b |
| AP-6 | medium-low | provider internals to anonymous callers | `reset.ts:68` returned raw err.message on the public JSON path; `registration.ts` register 503 `detail` field carried the same (found by the LEAD during verification — missed by both auditors). | **FIXED** — generic `email_send_failed` codes; reason stays in email_log | 7f7910c |
| AP-7 | low | invite burn was check-then-act | `registration.ts` SELECT … used_at IS NULL outside the transaction → two concurrent registrations could both pass and double-spend one code (D1 serializes writes, not reads). | **FIXED** — atomic burn-first conditional UPDATE (SEC-5 pattern); used_by lands post-insert (users FK) | 7f7910c |
| AP-8 | low | login timing enumeration oracle | `auth.ts` unknown-account path returned 401 without running PBKDF2 (~100ms differential vs wrong-password). | **FIXED** — burnDummyVerify equalizes the work; bodies were already identical | 7f7910c |
| AP-9 | low | logo byte route Cache-Control: public | `projects/index.ts` — the only authed per-user byte route not following the S69 private discipline (media/avatar/banner all private). | **FIXED** — private, max-age=3600 | 96a0d4b |
| AP-10 | low | cover_shot_id clear unscoped | `core.ts:640` UPDATE … WHERE cover_shot_id = ? without user_id (no reachable leak — the only writer validates same-project — but SC-5 belt-and-suspenders). | **FIXED** — AND user_id = ? (drift rows survive) | 96a0d4b |
| AP-11 | low | invites/email sender unmetered | `registration.ts` /invites/email — the one Resend call without a rate bucket (authed member could flood). | **FIXED** — RATE_RULES.inviteEmail 5/60s/IP | 7f7910c |
| AP-12 | low | screenshot/doc bucket trusted declared MIME | avatars/logos/banners sniffed magic bytes (SEC-9) but the S86 doc bucket never inspected bytes — mislabeled HTML could ride an image/png path into any tier (serve-side allowlist + attachment + nosniff made it non-exploitable; defense-in-depth per PLAYBOOK "content sniffing"). | **FIXED** — sniffFileMime + declared==sniffed enforcement; non-WebP thumb dropped; undecodable base64 → 400; upload-sniff.test.ts | f39e9c7 |
| AP-13 | low | magic-wand latent XSS sink | `magic-wand.js` toasted the server-provided AI-error `body.message` unescaped into app.js's innerHTML toast (H2 contract: callers MUST escape). Not live-exploitable (all current messages are developer strings) — closed before it can become one. | **FIXED** — esc()'d + local canonical esc helper; source-contract pin test | 5758a5b |
| AP-14 | info | two client esc() helpers omitted single-quote | `project-page.js` ×2 — every attribute context at those sites uses double quotes (not exploitable); aligned to the canonical 5-char escaper anyway. | **FIXED** (hardening) | this phase |
| AP-15 | medium | node:sqlite adapter: concurrent transactions 500 | Discovered WHILE testing AP-7: the sqlite adapter's single shared connection cannot host two OPEN transactions — a concurrent write request pair yields "cannot start/commit transaction" 500s on the Node runtime (D1 unaffected; pre-existing, not introduced by Phase 1). | **OPEN** — Phase 2 (bug hunt) owns it; fix shape: serialize transactions per connection or connection-per-transaction | — |
| AP-16 | low | telegram NULL-user captures never purged | unlinked-capture rows grow unbounded (bounded per-row by Telegram's 4096-char cap). Storage hygiene, not security. | **OPEN** — DEBT (cron purge candidate) | — |
| AP-17 | low | kv/r2/github fetches lack timeouts | Resend (fixed, AP-5) was the playbook-mandated one; the storage-chain REST calls remain unbounded — but payload sizes vary (backup zips), so a blanket timeout needs per-call budgets. | **OPEN** — DEBT (payload-sized AbortSignal budgets) | — |
| AP-18 | info | CSP carries unsafe-inline + unsafe-eval | Required by the no-build frontend (inline scripts + Alpine expressions; documented at app.ts:76-80). CSP is therefore not an XSS backstop here — the escape discipline + escape-lint gate is the barrier (220→213 sinks tracked, PASS). | **ACCEPTED** — nonce/hash-based CSP recorded as the hardening direction (DEBT) | — |
| AP-19 | info | HSTS preload directive without includeSubDomains | Deliberate: mail.hibana.ir is DNS-only; includeSubDomains would break it. The preload LIST requires includeSubDomains, so list-submission is aspirational — the directive itself is harmless. | **ACCEPTED** | — |

### Verified clean during Phase 1 (no action needed)

- **Auth/session 8/8**: PBKDF2-SHA256 100k (the Workers platform cap — 600k throws; documented M2 revert) + per-hash iteration upgrade path; timing-safe compare; __Host- cookie with Secure/HttpOnly/SameSite=Lax; 256-bit tokens hashed-at-rest (sha256) in D1; rolling 30-day expiry enforced server-side; logout deletes the row; password change/reset kill all sessions; reset tokens single-use ATOMIC + 1h expiry + hashed; invites 48-bit CSPRNG; dual-key rate limits; identical error bodies.
- **SC-3 parameterized SQL**: complete interpolation inventory — every dynamic fragment is placeholder-generation, fixed constant, Zod-enum-keyed table map, or clamped integer; no user value is ever interpolated.
- **Server HTML escaping**: ~200 suspicious interpolations hand-verified — esc()/html tagged-template everywhere; markdown escapes-then-transforms with https?:-only hrefs; emails fully escaped.
- **CSRF**: Origin/Referer exact-match middleware on all state-changing routes (mirror origins allowed in prod); no state-changing GET routes exist; webhook exempt by design (secret-token gated).
- **CORS**: none configured (same-origin default) — no open CORS.
- **Security headers**: full set on BOTH the Worker middleware and `public/_headers` (kept in lockstep, test-pinned): nosniff, Referrer-Policy, XFO + frame-ancestors, COOP/CORP, Permissions-Policy, HSTS, CSP.
- **Telegram webhook**: timing-safe secret check before body parse; flood limiter; chat-id ownership resolution; captures never cross accounts; single-use 48-bit link codes; `bak` re-checks owner server-side.
- **Uploads beyond AP-12**: size caps before body buffering; traversal-proof keys (3 layers); auth-before-byte on every serve; attachment disposition + nosniff on docs.
- **Error handling**: central onError returns constant internal_error (no stack/message/path); errorlog owner-only, stack-truncated, 7-day retention.
- **Secrets history (672 commits, 11,054 blobs, 100% coverage)**: exactly ONE real secret ever committed — the healthchecks.io PING KEY (masked `fzla…(22)`) in a deleted worklog blob + old Changelogs copies; mitigated 2026-09-21 by slug randomization (the key alone cannot construct a valid ping URL) and deliberately kept at the 2026-09-26 rotation round. Rotation item recorded in REPORT.md as the single manual follow-up. Zero live secrets at HEAD; `.secrets.env.example` is the tracked placeholder template; credentials.md never tracked.
- **Supply chain**: runtime deps audit 0 vulnerabilities (CI method); dev-only: 3 advisories in undici via wrangler (dev tooling, not shipped; dependabot's lane — `npm audit fix --force` would DOWNGRADE wrangler, do not); no unused deps (playwright-as-runtime-dep is deliberate: qa/audit scripts import chromium); bun.lock frozen-clean; engines field ADDED this phase (closes M6); dependabot covers npm + github-actions weekly.

### Claims DISPROVEN during verification (auditor false positives)

- **ICS `months` unclamped (P1-b)**: `loadIcsEvents` already clamps to 1–24 (`ics-export.ts:114`, with its own doc comment "max 24"). No fix needed.
- **A second "corruption" class**: the sandbox display pipeline ANSI-strip artifact (documented in the Phase 0 section) recurred in auditor reports; byte-verified false positives again.
