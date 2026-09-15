# Hibana

Personal project & idea manager — "a safe for my ideas."
EN/FA bilingual (RTL/LTR) · Jalali + Gregorian · Cloudflare Workers (D1) or plain Node 24+ (SQLite).

---

## For AI agents starting a new session — read this first

**You are working on Hibana**, a personal project/idea tracker for Ali (solo UI/UX designer
who directs AI coding agents — he never reads or patches code himself). The app's two jobs:
**never lose an idea; never lose your place.** It's "a SAFE for my ideas" — once a project
has real work, it can be archived (halted) but never destroyed.

### Mandatory reading (in order)
1. **`Agents.md`** — canonical rules (non-negotiables, verification ladder, cache-bust
   discipline, zip ritual, secrets handling). Read BEFORE any coding.
2. **`Changelogs.md` §1** — current state (version, SW cache name, what changed recently).
   Read the tail for recent session context.
3. **This README** — architecture map (where everything lives, how the system works).

### Credentials
Live in `credentials.md` (gitignored, local-only) OR the session prompt. Never commit, never
echo in chat, never zip into chat uploads. If a token is pasted in chat, rotate it per
Agents.md (exception: `BACKUP_ENCRYPTION_KEY` — NEVER rotate).

---

## Stack (current — corrects stale legacy docs)

- **Frontend:** static HTML + htmx + Alpine.js + Fabric.js (canvas/whiteboard only). No
  React. No CSS preprocessor. Plain CSS files + vanilla JS IIFE globals.
- **Backend:** Hono (TypeScript). ONE codebase deploys to **both** Cloudflare Workers (D1
  SQLite in prod) and plain Node 24+ (`node:sqlite`). Portability is a hard requirement.
- **DB:** SQLite. Same numbered migrations behind one `Db` interface (`src/db/`).
- **Build:** `scripts/build.mjs` (esbuild) → content-hashed immutable `public/dist/` +
  `manifest.json` → deploy-time HTML wiring (`--wire-html` / `--restore-html`).
- **Storage:** screenshots live on **Cloudflare Workers KV** (free 1 GB, no card, no
  TTL — pictures never expire until deleted in-app; `HIBANA_SHOTS` binding in both
  wrangler envs, `src/services/kv.ts`; Node self-host sets KV_ACCOUNT_ID /
  KV_NAMESPACE_ID / KV_API_TOKEN). Fallback chain: pluggable S3-compatible store
  (`src/services/r2.ts` — set R2_* env; **Backblaze B2** 10 GB free is the no-card pick
  if more space is ever needed) → private GitHub repo `assadigit/hibana-safe` (Contents
  API) for everything else (avatars, logos, backups). `npm run shotcheck:dev|:prod`
  runs a live upload→Cloudflare→render→delete round-trip against the real workers.
- **Integrations:** Resend (email), healthchecks.io (monitoring), Telegram bot
  (@Hibana_PM_bot), Cloudflare Workers AI (Magic Button).

---

## Project structure

```
hibana/
├── src/                          # Backend (Hono + TypeScript)
│   ├── app.ts                    # App factory — routes mounted here
│   ├── server.ts                 # Node entry (npm run start:node — port 3000)
│   ├── index.ts                  # Cloudflare Workers entry
│   ├── auth/                     # Sessions, password (PBKDF2), ban, middleware
│   ├── db/                       # Db interface: d1.ts (Workers) + sqlite.ts (Node) + types
│   ├── lib/                      # Helpers: html, http, i18n, jalali, ids, crypto, log
│   ├── routes/                   # API + page routes (see "Route files" below)
│   │   ├── integrations/         # telegram.ts + telegram-helpers.ts + import.ts
│   │   └── projects/             # index.ts (routes) + helpers.ts (renderers)
│   ├── services/                 # Business logic: backup, email, github, telegram, ai, etc.
│   ├── validation/               # Zod schemas (input validation on every endpoint)
│   ├── tests/                    # 399 vitest cases
│   └── vendor/                   # fabric-shim.ts
│
├── public/                       # Frontend (static, served by Worker or Node)
│   ├── *.html                    # 24 pages (dashboard, project, sadhana, calendar, etc.)
│   ├── css/                      # 22 modular CSS files (variables, base, layout, themes, rtl, etc.)
│   ├── js/                       # 47 JS files (app.js, i18n.js, canvas.js, *-page.js, etc.)
│   ├── vendor/                   # htmx, alpine, fabric, manrope, vazir
│   ├── dist/                     # Build output (content-hashed, gitignored)
│   ├── sw.js                     # Service worker (PWA)
│   └── manifest.webmanifest
│
├── scripts/                      # Build + ops
│   ├── build.mjs                 # esbuild → /dist/ + manifest.json + HTML wiring
│   ├── check-dist-wiring.mjs     # Verifies wired HTML matches manifest
│   ├── check-cache-bust.mjs      # CI gate: verifies ?v= bump discipline
│   ├── restore.mjs / restore-safe.mjs  # Backup restore
│   ├── seed-admin.mjs            # Create super-admin
│   ├── migrate-node.ts           # Local SQLite migration runner
│   └── ...                       # (email, backup, domain, zone ops scripts)
│
├── migrations/                   # 55 numbered .sql files (0001-0056; 0007 gap is original)
├── e2e/fixtures/                 # browser-injected a11y audit functions (a11y.spec.ts)
├── .github/workflows/            # CI: ci.yml (test+build gates) + cd.yml (auto-deploy)
│
├── Agents.md                     # ⚠️ READ FIRST — canonical agent rules
├── Changelogs.md                 # History + current state + ops runbook + open items
├── README.md                     # This file
├── package.json                  # v0.3.13.2
├── wrangler.toml                 # Cloudflare Workers config (dev + prod envs)
├── tsconfig.json
├── vitest.config.ts
└── .secrets.env.example          # Template — copy to .secrets.env (gitignored) for local dev
```

---

## How the system works

### Request flow
1. **Worker/Node** receives request → Hono router → `requireAuth` middleware (session
   cookie) → route handler.
2. **Route handler** validates input with Zod → calls `cfg.db` (D1 or SQLite) → returns
   JSON or HTML fragment (htmx swaps).
3. **Frontend** is static HTML. htmx makes AJAX requests, Alpine.js handles reactivity,
   Fabric.js powers canvas/whiteboard. No SSR, no React.

### Build pipeline (load-bearing)
```
scripts/build.mjs --prod --wire-html
  → esbuild bundles JS/CSS → /dist/ (content-hashed: app.<hash>.js)
  → manifest.json maps logical names → hashed filenames
  → rewrites HTML <script src="/js/app.js?v=1"> → <script src="/dist/app.<hash>.js">
  → check-dist-wiring.mjs verifies HTML refs match manifest
  → deploy: wrangler deploy (uploads /public/ as Worker assets)
  → restore-html: reverts HTML to canonical (?v=) form for git
```
**Canonical state** = HTML references `/js/app.js?v=N` (human-readable, git-tracked).
**Wired state** = HTML references `/dist/app.<hash>.js` (deploy-only, `.build-backup/`).

### CSS architecture (Session 25 refactor)
22 modular files, loaded in order via `<link>` in every HTML page:
```
variables → base → layout → dashboard → dashboard-todo → components → canvas →
quicknotes → to-do-list → polish-ui → calendar → notifications → polish-batch →
project-header → devboard → misc → sadhana-board → clip → themes → rtl →
task-controls → magic-wand
```
**Order matters** — the 16 feature files reproduce the original `app.css` cascade.
`themes.css` (dark overrides) loads after — safe by specificity.
`rtl.css` (RTL overrides) loads after themes — safe by specificity.

### JS architecture (Session 25 refactor)
- **IIFE globals pattern** — no ES modules, no bundler imports. Each JS file assigns to
  `window.hibana` / `window.hibanaCanvas` / `window.hibanaI18n` etc.
- **`window.__hib`** — shared namespace (app.js exposes 70 internal functions via
  `Object.assign`; `hib-init.js` destructures them for DOMContentLoaded handlers).
- **`window.__hibanaDictEN/FA`** — i18n dictionaries (separate files, loaded before i18n.js).
- **`window.__hibJalali`** — Jalali calendar functions (extracted to jalali.js).
- **Page-specific JS** — `*-page.js` files (one per HTML page, extracted from inline scripts).

### i18n (EN + FA)
- Server-side: `src/lib/i18n.ts` translates htmx fragments.
- Client-side: `public/js/i18n.js` + `i18n-en.js` + `i18n-fa.js`. Key parity enforced (953/953) via
  `scripts/check-i18n-parity.mjs` (CI gate).
- Persian digit normalization. CSS logical properties for RTL/LTR.

### Service worker (PWA)
`public/sw.js` — manifest-driven precache. `VERSION = "hibana-v387"` (bump ONLY on
sw.js logic changes — see the header comment in sw.js). Network-first for navigations,
cache-first for app shell.

---

## Quick start

```bash
# 1. Install deps
npm install

# 2. Create .secrets.env from template (gitignored — never commit)
cp .secrets.env.example .secrets.env
# Fill in: DB_PATH, GITHUB_TOKEN, TELEGRAM_BOT_TOKEN, RESEND_KEY, OWNER_EMAIL, etc.

# 3. Run migrations (creates local SQLite DB)
npm run migrate:node

# 4. Start the Node server (port 3000)
npm run start:node
# OR: npm run dev (wrangler dev — needs Cloudflare account)
```

**Local test user:** `ali@hibana.local` / `hibana123` (seed via `npm run seed:admin:node`
or create via API). On the Node path, Workers AI returns 503 (expected — Workers-only).

---

## Verification ladder (run before calling anything "done")

```bash
npm run typecheck              # tsc --noEmit — 0 errors
npm test                       # 399 vitest cases — all green
node scripts/build.mjs --prod --wire-html   # Build + wire HTML
node scripts/check-dist-wiring.mjs          # Verify wired HTML matches manifest
npm run check-cache-bust       # Verify ?v= bump discipline
```

**Browser E2E:** FA/RTL + EN/LTR, light + dark, desktop + 390px. Test on local Node server
(port 3000). Use `agent-browser` CLI for automated screenshots.

**Deploy:** `npm run deploy` (dev) or `npm run deploy:prod` (prod). Live probe after
deploy: `curl https://hibana.ir/api/health` → `{"ok":true}`.

---

## Route files (src/routes/)

| File | Concern | Lines |
|------|---------|-------|
| `integrations/telegram.ts` + `telegram-helpers.ts` | Telegram bot (webhook, commands, keyboards) | 934 + 333 |
| `integrations/import.ts` | Obsidian .md/.zip import | 98 |
| `projects/index.ts` + `helpers.ts` | Project CRUD + HTML rendering | 438 + 842 |
| `sadhana.ts` + `sadhana-helpers.ts` | To-do list board (quadrants, tasks, recurrence) | 932 + 137 |
| `devboard.ts` + `devboard-helpers.ts` | Dev tasks, sprints, backlog | 680 + 164 |
| `quicknotes.ts` + `quicknotes-helpers.ts` | Quick notes + notebook | 323 + 311 |
| `admin.ts` | Admin panel (users, emails, backups, errors) | 550 |
| `core.ts` | Hurdles, links, screenshots, canvas sync | 460 |
| `dashboard.ts` | Dashboard page render | 446 |
| `auth.ts` / `registration.ts` / `reset.ts` | Auth flows | 202 / 306 / — |
| `module.ts` | Canvas elements promote, module routes | 205 |

---

## Key non-negotiables (from Agents.md — read the full file)

1. **Every user-owned table has `user_id`** — every query filters on it. Never a query
   without the `user_id` filter.
2. **IDs are UUIDs** — client-generated for offline-creatable things, server-generated otherwise.
3. **All timestamps stored UTC** — calendar conversion only at render time.
4. **Schema changes ONLY via numbered files in `migrations/`** — never ad-hoc `ALTER TABLE`.
   Schema changes need Ali's explicit written approval.
5. **Every credential is a secret** — `wrangler secret put` / env vars. Never hardcoded.
6. **Password hashing: PBKDF2** via Web Crypto (600k iterations, SHA-256). Never bcrypt/argon2.
7. **Validate all API input with Zod** at the route level, on every endpoint.
8. **Telegram webhook validates the secret-token header** — unauthenticated calls never create data.

---

## Cache-bust discipline (load-bearing)

Any CSS/JS change bumps `?v=` on EVERY referencing HTML page AND the SW cache name.
Since v0.3.0 `/dist/` is content-hashed; SW version bumps only on `sw.js` logic changes
or when existing clients need to re-fetch the manifest. `check-cache-bust` is a CI gate.

**Current numbers (v0.3.13.2):** SW `hibana-v387`, 73 manifest entries, schema 55, 399 tests.

---

## Deploy

```bash
# Dev (hibana.aliassadi.workers.dev)
npm run deploy

# Prod (hibana.ir)
npm run deploy:prod
```

Each deploy runs: `build --prod --wire-html` → `check-dist-wiring` → `wrangler deploy` →
`build --restore-html` (reverts HTML to canonical form for git).

**Prod D1:** `pm-app-prod`. **Dev D1:** `pm-app-dev`. Both at schema 55.
**Custom domain:** hibana.ir (attached via Cloudflare dashboard, not wrangler.toml).
**Deep links** (cron emails, Telegram reminders, the ICS feed — anything built outside a
request) read `APP_URL` from `wrangler.toml` `[env.prod.vars]` — the one line to change on
a domain migration (see the domain-migration runbook in Changelogs.md §6). Request-scoped
links derive the origin from the request itself.

---

## Doc map

- **`Agents.md`** — rules, how to work on Hibana (READ FIRST).
- **`Changelogs.md`** — history, current state, ops runbook, open items, rejected features.
- **`README.md`** — this file (architecture + quick start).
- **`.secrets.env.example`** — template for local env vars.
- **`credentials.md`** — live credentials (gitignored, local-only — never committed, never zipped).

---

## Session 49 summary (most recent)

Codebase-health session on the stable S48p ship: CI green for the first time since
2026-09-13 (ESLint S41 + stale 404 visual baseline), the S48n sprint-draft regression
fixed (e2e-pinned), dead code removed, `HibanaChips.htmlToMd` extracted to chip-render.js,
sw.js 53KB→10.8KB, Changelogs.md 2,550→~1,000 lines. Audit verdict: monolith splits are
NO-GO (closure-bound IIFEs). See `Changelogs.md` §1 for full details.
