# Hibana Project/Kanban — API & Sync Contract

> **What this is:** the verified connection between the web client, the Cloudflare Worker
> (Hono), D1 (prod) / SQLite (Node self-host), storage, and auth — as of **v0.4.1.28 / S205**,
> plus the *clearly separated* compatibility contract a future **Go Windows desktop client**
> would need. Everything in §1–§6 describes EXISTING behavior with source references;
> §7–§8 are recommendations, marked as such. Companion: `DATA-MODEL.md`, `GO-DESKTOP-PORT-PLAN.md`.

## 1. Runtime topology (verified)

- **One Hono app**, `createApp(cfg)` in `src/app.ts:42`. Workers entry `src/index.ts:54-57`
  (`fetch(request, env)` → `createApp(buildConfig(env))`); Node entry `src/server.ts:145`
  (same app, `node:sqlite`, migrations auto-applied at boot `server.ts:22`, port 3000).
- **D1** dev: `pm-app-dev`, prod: `pm-app-prod` (`wrangler.toml:79-93, 132-135`). One `Db`
  interface, two adapters (`src/db/d1.ts`, `src/db/sqlite.ts`) — same SQL everywhere.
- **Static frontend**: same Worker serves `public/` via the Workers assets binding
  (`wrangler.toml:31-35`); `run_worker_first` negation globs route everything except the
  hot static set through the Worker (`wrangler.toml:47-64`). Worker-served page HTML is
  stamped `no-store` (S108).
- **Prod domain**: `hibana.ir` is a Workers custom domain on service `hibana-prod`
  (attach script `scripts/custom-domain.mjs` — Cloudflare API, account
  `6ff25b582afd399d647e91a8db859676`, zone `084061b09720c0506f4538e740377c4b`).
  S205 adds `projects.hibana.ir` (same zone, same Worker service) as the dedicated Kanban
  entry — see §6.4.
- **Media storage**: KV→R2→GitHub chain (`src/services/shotstore.ts`); project logos are
  GitHub-Contents-only (`index.ts:857`); banners GitHub-only (`index.ts:564`).

## 2. Authentication (existing, cookie-session)

- **Session cookie**: `__Host-hibana_session` (SEC-10, `src/auth/sessions.ts:15`) — value =
  32 random bytes base64url; **DB stores only the SHA-256 hex** (`sessions.ts:35-45`).
  Attributes, centralized in `sessionCookieHeader` (`sessions.ts:21-23`):
  `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` — **no Domain attribute**
  (`__Host-` prefix forbids it → the cookie is HOST-ONLY).
- **Rolling 30-day sessions**, auto-extended when <15 days remain (`middleware.ts:60`);
  no refresh tokens; logout deletes the row (`auth.ts:165-170`).
- **Password**: PBKDF2-SHA256, 100k iterations, stored `pbkdf2$<iter>$<saltB64>$<hashB64>`
  (`src/auth/password.ts:20,49`). Login: `POST /api/auth/login` (`auth.ts:64-163`) — JSON or
  urlencoded; per-IP AND per-account rate limit (30/60s).
- **Auth gate**: `requireAuth` (`src/auth/middleware.ts:13`) — one JOIN validates session+user.
  No session → JSON clients get `401 {error:'unauthorized'}`; document navigations
  (`Sec-Fetch-Dest: document` / `HX-Request` / `Accept: text/html`) get `302 /login.html`
  (or `/login.html?next=<path+query>` for routes using the S205 `loginNext` option — `/kanban`).
- **CSRF/origin gate (T6)**: every POST/PUT/PATCH/DELETE (except the Telegram webhook) must
  carry `Origin` or `Referer` whose origin equals the request origin or is in `MIRROR_ORIGIN`
  (`src/app.ts:172-194`). **A request with neither header is 403'd.** No CORS headers exist
  anywhere (single-origin by design).
- **Implication for a desktop client (fact, not recommendation):** the `__Host-` cookie is
  host-only, so `projects.hibana.ir` and `hibana.ir` sessions are **independent** — the user
  logs in once per host (both hit the same sessions table/infrastructure). A Go client that
  wants to share the web session cannot (browser cookie jars are not accessible); it must
  log in itself and hold its own cookie.

## 3. Endpoint surface — project/Kanban domain

All routes require auth. **Dual mode:** JSON for `fetch()` clients; HTML fragments when the
`HX-Request` header is present (`src/lib/http.ts:5`) — a desktop client always sends
`Accept: application/json` and **no** `HX-Request` header. Weak FNV-1a ETags on reads
(`http.ts:103-127`, `If-None-Match` → 304); `Cache-Control: private, no-cache` default on
`/api/*` GETs (`app.ts:141-154`). Writes need `Origin` (§2).

### 3.1 Projects — `src/routes/projects/index.ts` (mounted `/api/projects`, `app.ts:246`)

| Method & path | Line | Body (zod) | Returns | Notes |
|---|---|---|---|---|
| GET `/api/projects` | :33 | query: `status,tag,q,view,folder,archived,sort,stale` | `{projects:[row+{tags}]}` | default excludes sparks+archived; `sort=recent` = updated_at DESC |
| POST `/api/projects` | :389 | `createProjectSchema` (title ≤200, …, **optional client `id`**) | 201 `{ok,id}` / 200 `{ok,duplicate}` / 409 `id_conflict` | idempotent create by client UUID |
| POST `/api/projects/reorder` | :454 | `{status, ids[]}` | `{ok}` | rewrites `sort_order` within ONE status column |
| GET `/api/projects/:id` | :633 | — | `{project:{…, hurdles, links, screenshots, history(20), tags, notes, canvasPromos, devTasks, devTaskTags, categories, sprints, backlog}}` | the whole detail pool |
| PATCH `/api/projects/:id` | :652 | `updateProjectSchema` (title, description, status, sort_order, latest_note, archived_state, client_name, due_date, reminders_enabled, folder_id, pinned, cover_shot_id) | `{ok}` | history rows on status/latest_note change |
| DELETE `/api/projects/:id?force=1` | :716 | — | `{ok, soft}` | soft delete; hard only for sparks + force |
| POST `/api/projects/:id/restore` | :746 | — | `{ok}` | clears `deleted_at` |
| POST `…/revive` / `…/archive` / `…/unarchive` | :757/:783/:801 | — | `{ok}` | stage lifecycle + park/unpark |
| POST `…/note` | :826 | `{note ≤5000}` | `{ok}` | latest_note + history |
| PUT `…/logo` / GET `…/logo/file` / DELETE `…/logo` | :857/:886/:906 | base64 ≤3.5MB | `{ok,path}` / bytes | GitHub-backed; upload rate limit 30/60s |
| GET `…/duplicate-check?title=` | :621 | — | `{duplicate, existing}` | case-insensitive title match |
| sparks folders CRUD + banners | :471-:607 | | | Ideas-domain, adjacent |

### 3.2 Dev board (cards) — `src/routes/devboard.ts` (root-mounted, `app.ts:355`)

| Method & path | Line | Body | Returns |
|---|---|---|---|
| **GET `/api/projects/:projectId/devboard`** | :139 | — | **the one board payload**: `{project:{id,title,status,type}, tasks:[task+{tags:[tagId]}], categories, sprints, tags}`; tasks ordered `PRIO_ORDER_SQL, sort_order, created_at` (`devboard-helpers.ts:231`) |
| POST `/api/projects/:projectId/devtasks` | :185 | `createDevTaskSchema` (title ≤100k, status?, priority?, category_id?, sprint_id?, start_at/end_at?, tags[] names ≤12) | 201 `{ok,id,tags}` — **server-minted id** |
| POST `…/devtasks/reorder` | :233 | `{ids[] ≤500}` | `{ok}` — rewrites `sort_order` 0..n project-scoped |
| PATCH `/api/devtasks/:id` | :247 | `updateDevTaskSchema` (title, status, priority, category_id, sprint_id, sort_order, start_at/end_at, tags replace-set) | `{ok,tags}` — `done_at` stamped/cleared by status transition; owner-rescoped (SEC-11) |
| DELETE `/api/devtasks/:id` | :303 | — | `{ok}` — **hard delete**, usage recount, history row |
| POST `…/devtasks/archive-done` | :320 | — | `{ok, archived:n}` — moves done → `project_archives` |
| GET `…/archives` | :367 | — | `{archives:[…]}` |
| POST `…/archives/:aid/restore` | :392 | — | `{ok, tags}` — same id back into dev_tasks |
| DELETE `…/archives/:aid` | :425 | — | `{ok}` — permanent |
| POST/DELETE `/api/devtasks/:id/tags[/:tagId]` | :435/:456 | `{name ≤60, color?}` | find-or-create / unlink + recount |
| POST `…/categories` (find-or-create + enable) | :474 | `{name ≤80, color_fill, color_text}` | 201/200 existing |
| sprints CRUD: POST `…/sprints`, `/api/sprints/:id` PATCH, `/start` :573, `/finish` :690, `/reopen` :701, DELETE :720 | | `{ok}` | server-enforced sprint invariants (see DATA-MODEL §2.3) |
| backlog docs CRUD | :735-:785 | `{title ≤200, content ≤50k}` | revisions cascade |

### 3.3 Hurdles/links/screenshots/media — `src/routes/core.ts` (`app.ts:350`)

`GET/POST/PATCH/DELETE` under `/api/projects/:projectId/{hurdles,links,screenshots}` (+ hurdles
reorder, multi-line hurdle create ≤50); `GET /api/media` (all user media, **no pagination**);
`PATCH /api/screenshots/:id` (caption/resolved/taskId/thumb); `GET /api/media/screenshots/:id/file?variant=thumb`
(raw bytes, `Cache-Control: private, max-age=3600`, lazy self-heal); `DELETE /api/screenshots/:id`
(clears referencing `cover_shot_id`). Upload: base64 ≤5MB, 11 allowlisted mime types, rate limit
`upload` 30/60s, Content-Length >7MB → 413 (`core.ts:456`).

### 3.4 Adjacent read paths the board UX uses

- `GET /api/rail` (`src/routes/rail.ts`) — the nav rail's compact projects/sparks/folders trees.
- `GET /api/search?q=` (`src/routes/search.ts:33`) — FTS groups (projects, tasks via `dev_tasks_fts`,
  notes, backlog…), LIMIT 20 per group.
- `GET /api/ov-tasks?status=` (`src/routes/tasks.ts:78`) — cross-project open items, `LIMIT 200`.
- `GET /api/auth/me` — identity + language/calendar prefs.
- `POST /api/ai/text` — Workers-AI polish/rewrite/translate (Workers-only; Node 503s).

### 3.5 Error format (uniform)

`{ error: '<code>' }` (+ optional `message`); registry `src/lib/errors.ts:21-42`. Route-local codes:
`invalid_input` (400), `not_found` (404), `id_conflict` (409), `rate_limited` (429), `duplicate_tag`
(409), `tag_in_use` (409), `already_archived` (409), `draft_exists` (409), `file_too_large` (413),
`github_not_configured` (503), `banned` (403). Unhandled → 500 `{error:'internal_error'}`; every error
is persisted to `error_log` (7-day retention, `app.ts:196-232`).

### 3.6 Rate limits (fixed 60s windows, D1-backed, fail-open, `src/services/ratelimit.ts`)

auth 30 · webhook 300 · export 10 · import 5 · **upload 30** · broadcast 2 · ai 20 — per `name:ip`
(`CF-Connecting-IP` → TRUST_PROXY XFF → socket peer).

## 4. How the web client persists & reads (verified behavior)

- **Board load = ONE request**: `GET /api/projects/:id/devboard` (`devboard.js:112-121`), then full
  client render. No pagination, no partial refetch — every mutation ends with `reload()` (fresh GET).
- **Mutations**: direct `fetch` (JSON) per action — create/patch/delete task, reorder, tags, sprints.
  Optimistic UI only for priority-cycle and DnD preview; failures roll back via `reload()` + toast.
- **S205 switcher**: `GET /api/projects?sort=recent` (60s in-memory cache) + in-place
  `B().load(id)` + render — no page navigation. Last-used persisted in localStorage `hibana-kanban-last`.
- **Offline queue** (`public/js/queue.js`, IndexedDB): covers canvas sync + project creates only —
  **NOT board mutations**; 401/403 keep items, 4xx drops, 500 retries ≤5.
- **Service worker** (`public/sw.js`, `hibana-v438`): precaches the shell incl. `/kanban` (S205);
  `/api/*` always network (offline → 503 `{error:'offline'}`); navigations network-first with
  401 → `/login.html?next=…` redirect.

## 5. What does NOT exist today (verified absent — desktop blockers)

1. **No pagination** on the board/detail/list endpoints (full scans; caps only in search/ov-tasks).
2. **No task deletion tombstones** (dev_tasks hard-delete) and no per-task change feed.
3. **`dev_tasks.updated_at` misses tag changes**; no `updated_at` on hurdles/links/screenshots/sprints/tags/categories.
4. **No idempotency keys for task creates** (server-minted UUIDs only).
5. **No token auth** — cookie session only (fine in a WebView; a native HTTP client must manage the
   cookie jar + send `Origin` on writes).
6. **No CORS** — a browser-based non-same-origin client cannot call the API at all; same-origin
   embeds (Wails) are unaffected.

## 6. Host/origin behavior relevant to `projects.hibana.ir` (S205)

1. **CSRF gate is self-origin aware**: `self = new URL(c.req.url).origin` reflects the request's Host
   (`app.ts:175`) — same-origin POSTs from `projects.hibana.ir` pages pass. Cross-host writes from
   `hibana.ir` pages would 403 (they never happen: pages post to their own origin).
2. **Cookies are host-only** (§2) — `projects.hibana.ir` keeps its own session after one login.
3. **CSP `form-action 'self'`** (`app.ts:99`, `public/_headers:111`) binds form posts to the serving host — satisfied.
4. **Emails/ICS deep links** always use canonical `APP_URL` (`https://hibana.ir`,
   `src/lib/app-url.ts:18-35`) — unaffected by the subdomain.
5. **HSTS** omits `includeSubdomains` (`app.ts:115`, mail host is DNS-only) — `projects.hibana.ir`
   gets its own HSTS from its own responses (Cloudflare custom domains always serve HTTPS).
6. **`/kanban` route** (`app.ts:356-385`, S205): auth-gated (`loginNext: true`), serves board.html
   via the assets binding, `no-store` stamped, `/kanban.html` → 301 `/kanban`, deep-link query
   untouched. Unit-pinned in `src/tests/kanban-route.test.ts` (7 tests).

## 7. Proposed compatibility contract for a future Go desktop client (RECOMMENDATION — not implemented)

Zero-breakage additions, all backward-compatible with the existing web client:

1. **`GET /api/projects/:id/devboard?since=<iso>`** — delta filter on `dev_tasks.updated_at` +
   `projects.updated_at` (server already stamps both; tag changes need `updated_at` bumped in
   `setTaskTags` — one line, fully backward compatible).
2. **Tombstones for dev tasks**: soft-delete (`deleted_at`) + include deleted rows in `?since=`
   responses for a 7-day window (mirrors the projects purge cron). Web client unaffected (it
   filters `deleted_at IS NULL` only if it opts into `includeDeleted`).
3. **Idempotent task create**: accept optional client `id` on `POST …/devtasks` with the same
   duplicate short-circuit `POST /api/projects` already implements (`index.ts:395-402` pattern).
4. **Session guidance**: the desktop client logs in through the SAME `POST /api/auth/login`,
   stores the cookie in its own jar, sends `Origin: https://hibana.ir` on every write, and treats
   401 as re-login (no refresh flow needed for a single-user desktop app; 30-day rolling is enough).
5. **Media**: reuse `/api/media/screenshots/:id/file` byte streams; uploads via the base64 endpoint
   (≤5MB) or a future multipart variant if large-file support is needed.

**Not required**: WebSocket/realtime push (the web client is request/response today; the desktop
can poll `?since=` or adopt Server-Sent Events later — a decision for the owner, not a prerequisite).

## 8. Contract stability guarantees (for the port plan)

- The response shapes above are **pinned by 642 unit tests + 426 e2e tests** (S205 numbers) —
  additive changes (new optional fields) are the only safe kind; renames/removals break the web
  client first, which the test suite catches before any desktop work is affected.
- Ordering contracts to preserve exactly: board tasks `CASE priority urgent→low, sort_order,
  created_at` (`devboard-helpers.ts:231`); projects list default `status, sort_order, updated_at DESC`.
- Legacy status normalization map (`LEGACY_STATUS`, `src/validation/schemas.ts:12-26`) — a desktop
  client should send only canonical values and can ignore the legacy map.
