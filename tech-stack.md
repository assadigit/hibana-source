# Hibana — Tech Stack

Complete technical reference for the Hibana project. Share this with any new
coding agent or developer joining the project.

---

## Overview

Hibana is a personal project & idea management web app — "a safe for my ideas."
It runs on Cloudflare Workers (edge) with a portable Node.js fallback. The frontend
is static HTML + htmx + Alpine.js + Fabric.js (no React, no build step, no bundler).

---

## Backend

### Runtime
- **Cloudflare Workers** (primary) — serverless edge runtime. The Worker serves both
  the API and static assets from a single origin.
- **Node.js** (fallback) — `@hono/node-server` + `better-sqlite3` for local dev and
  self-hosting. Same codebase, different DB adapter.

### Framework
- **Hono** v4.6 — web framework. One `createApp(cfg)` factory; the Worker entry
  (`src/index.ts`) and Node entry (`src/server.ts`) are thin shells over it.
- **Zod** v3.24 — input validation on every endpoint (`src/validation/schemas.ts`).

### Database
- **Cloudflare D1** (production) — managed SQLite at the edge. Two databases:
  `pm-app-dev` and `pm-app-prod`, configured as named wrangler environments.
- **better-sqlite3** (local Node) — same SQL, same numbered migrations.
- **Abstraction**: all DB access goes through `src/db/types.ts` → `Db` interface
  (`query`, `execute`, `transaction`). D1 adapter: `src/db/d1.ts`. Node adapter:
  `src/db/sqlite.ts`. Search uses SQLite FTS5 (isolated to `src/routes/search.ts`).
- **Migrations**: 38 numbered SQL files in `migrations/` (0001–0039; the `0007` gap is
  intentional and pre-existing). Applied via `wrangler d1 migrations apply` (CF) or
  `scripts/migrate-node.ts` (Node). **Schema is at 0039.** 9 of the 38 files
  (`0031`–`0039`) were reconstructed during the source-recovery session (see
  `RECOVERED.md`) so fresh environments reproduce the live D1 schema exactly.
  The live DBs are already at 0039 — never re-apply migrations to live without the
  `d1_migrations` bookkeeping backfill (P1.9 / F-L17, approval-gated).

### File storage
- **Private GitHub repo** (`hibana-safe`) via the Contents API. D1 stores paths only.
  Upload: `src/services/github.ts`. Files >1MB require `Accept: application/vnd.github.v3.raw`.

### Email
- **Resend** (free tier). `src/services/email.ts`. Sending-only API key.

### Auth
- **PBKDF2** via Web Crypto (`crypto.subtle`, 100k+ iterations, SHA-256). No bcrypt/argon2
  (native bindings don't run on Workers).
- **Sessions**: SHA-256-hashed token in `sessions` table. httpOnly `SameSite=Lax` cookie,
  30-day rolling expiry.
- **CSRF**: Origin/Referer check on all state-changing requests (`src/app.ts`).

### Rate limiting
- In-app: `src/services/ratelimit.ts` (login/reset/webhook, 30-300 req/60s/IP).
  Stale buckets purged by daily cron.

### Scheduled jobs (cron)
- `17 3,9,15,21 * * *` — 4× daily backup to GitHub (03:17/09:17/15:17/21:17 UTC;
  RECOVERED hotfix widened it from the original 03:17 daily).
- `*/30 * * * *` — every 30 min: Sadhana deadline reminders (7d/3d/1d/0d/2h).
- Tick logic: `utcMin % 30 !== 0` = a backup slot; `backupTick && hour === 3`
  uniquely identifies the 03:17 daily slot where purge + weekly sweep + client
  reminders also run. The jobs run **sequentially** (not `Promise.all`) so backup
  and reminders don't contend for the Worker's subrequest budget (P1.4 / F-L3).

### Backend structure
```
src/
  index.ts              — Worker entry (fetch + scheduled)
  server.ts             — Node entry (http server)
  app.ts                — createApp() — Hono instance, middleware, route mounting
  types.ts              — Env, Config, UserRow, ProjectRow, etc.
  validation/schemas.ts — Zod schemas for every endpoint
  db/
    types.ts            — Db interface
    d1.ts               — D1 adapter
    sqlite.ts           — better-sqlite3 adapter
    migrate-node.ts     — Node migration runner
  routes/
    auth.ts, registration.ts, reset.ts — auth
    projects.ts         — project CRUD + 4 views (cards/list/sticky/kanban)
    core.ts             — hurdles, links, screenshots, changelogs, canvas sync
    dashboard.ts        — dashboard fragment (htmx HTML + JSON)
    sadhana.ts          — quadrant task board (920 lines)
    search.ts           — FTS5 search
    tags.ts              — tag CRUD + merge
    settings.ts         — user prefs + avatar
    reports.ts          — snapshot + activity + heatmap
    export.ts           — JSON + Markdown + CSV export
    calendar.ts         — calendar view (tasks + sadhana by due_date)
    timeline.ts         — activity feed + on-this-day
    notifications.ts    — derived notifications (overdue/stale/upcoming)
    admin.ts            — backup + purge (owner)
    module.ts           — client projects module
    quicknotes.ts       — dashboard quick notebook
    media.ts, links.ts, hurdles.ts — child resources
    canvas.ts           — canvas element sync
    dev.ts, health.ts, integrations.ts — dev/health/telegram+import
  services/
    sadhana.ts          — recurrence, sweep, reminders
    github.ts           — GitHub Contents API client
    email.ts, reset.ts, verify.ts, turnstile.ts, telegram.ts, ratelimit.ts,
    backup.ts, progress.ts, reminders.ts
  lib/
    htmlx.ts            — typed HTML builder (escapes by default)
    errors.ts           — ApiError + ErrorCode registry
    html.ts             — shared HTML helpers (icon, STATUS_BADGE, timeAgo)
    http.ts             — esc(), jsonBody(), etag(), requestOrigin()
    i18n.ts             — server-side trL/trFor/localeOf
    jalali.ts           — Jalali (Shamsi) calendar conversion (pure math)
    ids.ts, markdown.ts, obsidian.ts, sadhana-task-controls.ts
  auth/
    middleware.ts       — requireAuth
    password.ts         — PBKDF2 hash/verify
    sessions.ts         — create/lookup/destroy
```

---

## Frontend

### Stack
- **Static HTML** — no build step, no React, no bundler. Pages are `.html` files in
  `public/`. Served by the Worker's assets binding (CF) or the Node server's static
  fallback.
- **htmx** v1 (self-hosted `public/vendor/htmx.min.js`) — server-rendered HTML
  fragments. Routes branch on `HX-Request` header: JSON for fetch(), HTML for htmx.
- **Alpine.js** v3 (self-hosted `public/vendor/alpine.min.js`) — lightweight reactivity
  for settings, reports, filters.
- **Fabric.js** v5.3 (self-hosted `public/vendor/fabric.min.js`) — canvas drawing
  for the Canvas and Notebook pages.
- **jalaali-js** (self-hosted `public/vendor/jalaali.min.js`) — Jalali date conversion
  (also inlined in `calendar.html` + `jalali-holidays.js` for race-condition-free init).
- **Vazir** font (self-hosted) — Farsi. **Manrope** font (self-hosted) — Latin.
  **Bebas Notes** (self-hosted) — notebook handwriting.
- **Zero runtime CDN dependencies** — everything is self-hosted.

### Frontend JS modules
```
public/js/
  app.js               — global hibana object: theme, toast, quick-add, project-add,
                        nav boot, auth guard, PWA, FAB, notebook, drag-drag, sign-in
  boot.js              — pre-paint theme application
  queue.js             — IndexedDB offline queue (canvas + spark sync)
  nav.js               — SPA-like soft navigation + page mount system
  i18n.js              — client dictionary (EN+FA), Vazir injection, date conversion
  canvas.js            — Fabric canvas: pen, text, sticky notes, frames, sync
  whiteboard.js        — Fabric notebook: pen, text, autosave
  admin.js             — admin console: users/presence, bans, email console, backups
  devboard.js          — sprint/dev board: timeline, lanes, drag-reorder, clip edges
  emoji-picker.js      — emoji picker (quadrant); emoji-data.js is its data
  jalali-holidays.js   — Iranian holidays (fixed Jalali + dynamic Hijri via Intl)
  install-prompt.js    — PWA beforeinstallprompt capture
  go-to.js             — vim-style "g then letter" navigation
  zen-mode.js          — Ctrl+. focus/zen mode
  micro-interactions.js— task-complete pop, avatar skeleton
  tour.js              — onboarding tour + animated stat counters
  mobile-nav.js        — bottom-tab nav for mobile
  touch-drag.js        — touch/pen drag fallback for HTML5 DnD
  command-palette.js   — Ctrl+K palette: search, actions, recent, tags, fuzzy
```

### Frontend CSS
- **`public/css/app.css`** (4,501 lines) — single design-token system:
  - Light/dark themes via `html[data-theme]` + `prefers-color-scheme`
  - CSS custom properties for all colors, spacing, typography
  - `--brand` (amber) for identity accents
  - Status badge tints (spark/pending/building/working/archived)
  - RTL-ready (CSS logical properties)
  - `prefers-reduced-motion` guards on all animations
  - `@media print` stylesheet for reports + calendar
  - Responsive breakpoints (560px, 720px, 860px)
- **`public/css/task-controls.css`** — sadhana task controls (shared dashboard + board)

### Pages
```
public/
  dashboard.html, projects.html, project.html, sparks.html, clients.html
  canvas.html, whiteboard.html, sadhana.html (to-do list)
  calendar.html, timeline.html, notifications.html, reports.html
  settings.html, archive.html
  login.html, signup.html, confirm.html, reset.html
  partials/nav.html — nav partial (loaded via fetch by app.js)
  sw.js — service worker (PWA, cache-first for shell, network-first for API)
  manifest.webmanifest
```

---

## Deployment

### Cloudflare Workers
```bash
# Dev (default env = hibana)
npx wrangler d1 migrations apply pm-app-dev --remote
npx wrangler deploy

# Prod
npx wrangler d1 migrations apply pm-app-prod --remote
npx wrangler deploy --env prod
```

### Local Node
```bash
npm install
npm run migrate:node     # apply migrations to local SQLite
npm run seed:admin:node  # create the super-admin
npm run start:node       # start on http://localhost:8787
```

### Secrets
```bash
npx wrangler secret put GITHUB_TOKEN --env prod
npx wrangler secret put RESEND_KEY --env prod
npx wrangler secret put TELEGRAM_BOT_TOKEN --env prod
npx wrangler secret put TELEGRAM_SECRET --env prod
npx wrangler secret put CAPTCHA_SECRET_KEY --env prod   # math-captcha HMAC key
# TURNSTILE_SECRET_KEY is still honored as a legacy fallback for the captcha secret
# (see src/index.ts) — the Turnstile verification itself is gone.
```

### Custom domain
`hibana.ir` is attached via the Cloudflare dashboard (Worker → Settings → Domains).
The zone is active. HTTPS is enforced in-app (301 redirect on `x-forwarded-proto: http`).

---

## Testing

- **vitest** — 191 tests across 26 files. Run: `npm test`
- **TypeScript** — `npm run typecheck` (tsc --noEmit, authoritative)
- **Smoke** — `npm run smoke` (19-request in-process end-to-end)
- **Restore drill** — `npm run drill` (P0 backup restore)

---

## Key Architecture Decisions

1. **Single origin** — one Hono app serves static assets + JSON API + htmx HTML
   fragments. No CORS, same-site cookie.
2. **Portability** — DB access only through `Db` interface. Same SQL, same migrations.
   Worker entry + Node entry are thin shells.
3. **Soft delete** — `deleted_at` + 7-day purge by cron. Hard delete only for
   Sparks/Pending (before real work).
4. **Offline sync** — Canvas + Spark quick-add use IndexedDB queue with last-write-wins.
5. **No build step** — static HTML + vanilla JS + htmx/Alpine. Zero bundler, zero
   transpiler. Pages work without JS (progressive enhancement via htmx).
6. **DB is sacred** — no schema changes without explicit user approval. New features
   use existing columns or client-side storage (localStorage).

---

## File storage (GitHub)
- Private repo: `assadigit/hibana-safe`
- Paths: `/{user_id}/{project_id}/{screenshots|changelogs}/{filename}`
- Backup: JSON snapshot committed daily by cron (excludes `password_hash` + `sessions`)
- Retention: newest 60 snapshots

---

## Telegram bot
- Webhook: `/api/telegram/webhook` (authenticated by secret-token header, rule 11)
- Commands: `/note`, `/list`, `/idea`, `/help`, `/start <code>`, `/status`, `/pause`,
  `/resume`, `/reset`
- Account linking: Settings → Telegram → generate code → `/start <code>` in bot
- Reminders: Sadhana deadline reminders sent to linked chat (7d/3d/1d/0d/2h)
