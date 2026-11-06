# Hibana Project/Kanban — API & Sync Contract

> **What this is:** the verified connection between the web client, the Cloudflare Worker
> (Hono), D1 (prod) / SQLite (Node self-host), storage, and auth — as of **v0.4.1.35 / S209**,
> plus the *clearly separated* compatibility contract a future **Go Windows desktop client**
> would need. §1–§6 and the web halves of §8–§9 describe EXISTING behavior with source
> references; §7, §10 and every "desktop" subsection are recommendations, marked as such.
> **§12 (S240/S241)** documents the Sprint, Deadline & Dependency feature surface
> (migration 0065, `feat/sprint-deadline-deps`) — the Phase 1+2 contract the desktop
> round consumes.
> Companion: `DATA-MODEL.md`, `GO-DESKTOP-PORT-PLAN.md`.

## 1. Runtime topology (verified)

- **One Hono app**, `createApp(cfg)` in `src/app.ts:42`. Workers entry `src/index.ts:54-57`
  (`fetch(request, env)` → `createApp(buildConfig(env))`); Node entry `src/server.ts:145`
  (same app, `node:sqlite`, migrations auto-applied at boot `server.ts:22`, port 3000
  `server.ts:157`). Cron entry: `scheduled()` `index.ts:70-108`.
- **D1** dev: `pm-app-dev`, prod: `pm-app-prod` (`wrangler.toml:79-82, 132-135`). One `Db`
  interface, two adapters (`src/db/d1.ts`, `src/db/sqlite.ts`) — same SQL everywhere.
- **Static frontend**: the same Worker serves `public/` via the Workers assets binding
  (`wrangler.toml:31-35`); `run_worker_first` negation globs route everything except the
  hot static set through the Worker (`wrangler.toml:47-64`). Worker-served page HTML is
  stamped `no-store` (S108, `app.ts:308-328`).
- **Two prod hosts, one Worker service**: `hibana.ir` is a Workers custom domain on
  `hibana-prod` (attach script `scripts/custom-domain.mjs`, zone `084061b09720c0506f4538e740377c4b`).
  `projects.hibana.ir` (S205) is a **zone-level Workers route** — `projects.hibana.ir/*` →
  `hibana-prod` + a proxied AAAA `100::` record (the account-level domains API 10405'd the
  session token; the zone route API worked — repo `worklog.md` S205 row). **Both hosts serve
  the identical app, including `/kanban`** (`app.ts:370-385`).
- **Media storage**: KV→R2→GitHub chain (`src/services/shotstore.ts:10-19`). Project logos
  are GitHub-Contents-only (`index.ts:857-882`; 503 `github_not_configured` at `:868`);
  spark-folder banners ride the shotstore chain (`index.ts:564-588`).
- **Crons**: 4×/day backup (`17 3,9,15,21 * * *` dev / `23 …` prod, `wrangler.toml:15,
  106`) + `*/30` reminders; the daily tick also runs the 7-day purge (`index.ts:108`, §7b).

## 2. Authentication (existing, cookie-session)

- **Session cookie**: `__Host-hibana_session` (SEC-10, `src/auth/sessions.ts:15`) — value =
  32 random bytes base64url (`sessions.ts:36-37`); **DB stores only the SHA-256 hex**
  (`sessions.ts:38-43`). Attributes, centralized in `sessionCookieHeader`
  (`sessions.ts:21-23`): `Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` —
  **no Domain attribute** (`__Host-` prefix forbids it → the cookie is HOST-ONLY).
- **Rolling 30-day sessions**, auto-extended when <15 days remain (`sessions.ts:17`,
  extend fired at `middleware.ts:85`); no refresh tokens; logout deletes the row
  (`auth.ts:165-170`).
- **Password/login**: PBKDF2-SHA256, 100k iterations (`password.ts:20`), stored
  `pbkdf2$<iter>$<saltB64>$<hashB64>` (`password.ts:49`). `POST /api/auth/login`
  (`auth.ts:64`) — JSON or urlencoded; per-IP (`auth.ts:61`) AND per-account (`auth.ts:94`)
  rate limit, 30/60s each.
- **Auth gate**: `requireAuth` (`src/auth/middleware.ts:40`) — one JOIN validates session+user
  (`middleware.ts:46` → `validateSessionWithUser` `sessions.ts:90-114`). No session → JSON
  clients get `401 {error:'unauthorized'}` (`middleware.ts:57`); document navigations
  (`Sec-Fetch-Dest: document` / `HX-Request` / `Accept: text/html`, `middleware.ts:22-36`)
  get `302 /login.html` — or `/login.html?next=<path+query>` for routes using the S205
  `loginNext` option (`middleware.ts:51-54`; `/kanban` is its only caller, `app.ts:372`).
  Banned users: JSON 403 `banned` (`middleware.ts:77-83`).
- **CSRF/origin gate (T6)**: every POST/PUT/PATCH/DELETE (except the Telegram webhook,
  `app.ts:174`) must carry `Origin` or `Referer` whose origin equals the request origin or
  is in `MIRROR_ORIGIN` (`app.ts:172-194`; prod mirrors `wrangler.toml:124`).
  **A request with neither header is 403'd** (`app.ts:189-192`). No CORS headers exist
  anywhere (single-origin by design).
- **Implication for a desktop client (fact, not recommendation):** the `__Host-` cookie is
  host-only, so `projects.hibana.ir` and `hibana.ir` sessions are **independent** — the user
  logs in once per host (both hit the same sessions table/infrastructure). A Go client that
  wants to share the web session cannot (browser cookie jars are not accessible); it must
  log in itself and hold its own cookie.

## 3. Endpoint surface — project/Kanban domain

All routes require auth. **Dual mode:** JSON for `fetch()` clients; HTML fragments when the
`HX-Request` header is present (`src/lib/http.ts:5`) — a desktop client always sends
`Accept: application/json` and **no** `HX-Request` header. Weak FNV-1a ETags on the hot
reads, `Cache-Control: private, no-cache` default on `/api/*` GETs — the full per-endpoint
table is §8. Writes need `Origin` (§2).

### 3.1 Projects — `src/routes/projects/index.ts` (mounted `/api/projects`, `app.ts:246`)

| Method & path | Line | Body (zod) | Returns | Notes |
|---|---|---|---|---|
| GET `/api/projects` | :33 | query: `status,tag,q,view,folder,archived,sort,stale` | `{projects:[row+{tags}]}` | default excludes sparks+archived; `sort=recent` = updated_at DESC (`:128-132`) |
| POST `/api/projects` | :389 | `createProjectSchema` (title ≤200, …, **optional client `id`** — `schemas.ts:33`) | 201 `{ok,id}` / 200 `{ok,duplicate}` / 409 `id_conflict` | **idempotent create by client UUID** (`:394-402`) — the pattern §7c mirrors |
| POST `/api/projects/reorder` | :454 | `{status, ids[]}` | `{ok}` | rewrites `sort_order` within ONE status column |
| GET `/api/projects/:id` | :633 | — | `{project:{…, hurdles, links, screenshots, history(20), tags, notes, canvasPromos, devTasks, devTaskTags, categories, sprints, backlog}}` | the whole detail pool (`loadDetail`, `detail-helpers.ts:30-83`; HX branch `:642-647`) |
| PATCH `/api/projects/:id` | :652 | `updateProjectSchema` (title, description, status, sort_order, latest_note, archived_state, client_name, due_date, reminders_enabled, folder_id, pinned, cover_shot_id) | `{ok}` | history rows on status/latest_note change |
| DELETE `/api/projects/:id?force=1` | :716 | — | `{ok, soft}` | soft delete; hard only for sparks + force |
| POST `/api/projects/:id/restore` | :746 | — | `{ok}` | clears `deleted_at` |
| POST `…/revive` / `…/archive` / `…/unarchive` | :757/:783/:801 | — | `{ok}` | stage lifecycle + park/unpark |
| POST `…/note` | :826 | `{note ≤5000}` | `{ok}` | latest_note + history |
| PUT `…/logo` / GET `…/logo/file` / DELETE `…/logo` | :857/:886/:906 | base64 ≤3.5MB | `{ok,path}` / bytes | GitHub-backed (`:869`); upload rate limit 30/60s (`:860`); file CC `public, max-age=3600, stale-while-revalidate=604800` (`:902`) |
| GET `…/duplicate-check?title=` | :621 | — | `{duplicate, existing}` | case-insensitive title match |
| sparks folders CRUD + banners | :471-:607 | | | Ideas-domain, adjacent; banners via the shotstore chain (`:576-585`) |

### 3.2 Dev board (cards) — `src/routes/devboard.ts` (root-mounted, `app.ts:392`; requireAuth `devboard.ts:136`)

| Method & path | Line | Body (zod) | Returns |
|---|---|---|---|
| **GET `/api/projects/:projectId/devboard`** | :139 | — | **the one board payload** — **now SEVEN keys** (S241): `{project:{id,title,status,type}, tasks:[task+{tags:[tagId], shot_count}], categories(+enabled), sprints, tags, task_tags, task_deps}`; task rows additionally carry the raw `due_at`/`due_origin_at` (S240) and the server-computed `effective_due_at`/`effective_due_source`/`effective_due_origin_at` triple (S241 — §12.2); sprint rows carry `status/emoji/due_at/due_origin_at/updated_at` (S240 — §12.1); tasks ordered `PRIO_ORDER_SQL, sort_order, created_at`; **S208: every task carries `shot_count`** with a pre-0054 fallback belt; `task_deps` = the flat per-project edge join with its own lagging-D1 `[]` belt (§12.3); ETag-wrapped. The pre-S241 six-key shape is PINNED by `src/tests/api-surface-s241.test.ts` (the island @ 04218ca contract — additive keys only, never removals/renames) |
| POST `/api/projects/:projectId/devtasks` | :199 | `createDevTaskSchema` (`:43-59`): title ≤100k, status?, priority?, category_id?, sprint_id?, start_at/end_at?, **`tags[]` names (≤12 × ≤48 chars, `:58`)** | 201 `{ok,id,tags}` — **server-minted id** (`:231`); **tags ride the create** via `setTaskTags` (`:241`, find-or-create); no `sprint_id` → the project's draft, else open sprint (`:216-230`) |
| POST `…/devtasks/reorder` | :247 | `{ids[] ≤500}` (`:101`) | `{ok}` — rewrites `sort_order` 0..n project-scoped (`:253-257`) |
| PATCH `/api/devtasks/:id` | :261 | `updateDevTaskSchema` (`:60-72`): title, status, priority, category_id, sprint_id, sort_order, start_at/end_at, tags replace-set | `{ok,tags}` — `done_at` stamped/cleared by status transition (`:287-296`); **`updated_at` stamped on every column edit** (`:299-303`); owner-rescoped (SEC-11, `:305-308`); tags are NOT a column — replace-set via `setTaskTags` (`:310-312`) |
| DELETE `/api/devtasks/:id` | :317 | — | `{ok}` — **hard delete** (`:325`), tag usage recount (`:324-326`), history row (`:327`) |
| POST `…/devtasks/archive-done` | :334 | — | `{ok, archived:n}` — moves done → `project_archives` with a label snapshot (`:344-366`), then deletes from dev_tasks (`:370`) |
| GET `…/archives` | :381 | — | `{archives:[… + tags[]]}` (label snapshots parsed, `:389-398`) |
| POST `…/archives/:aid/restore` | :406 | — | `{ok, tags}` — same id back into dev_tasks, relabeled via `setTaskTags` (`:432`) |
| DELETE `…/archives/:aid` | :439 | — | `{ok}` — permanent |
| POST/DELETE `/api/devtasks/:id/tags[/:tagId]` | :449/:470 | `{name ≤60, color?}` | find-or-create (`:456-463`) / unlink + usage recount + FTS sync (`:474-477`) |
| POST `…/categories` (find-or-create + enable) | :488 | `{name ≤80, color_fill, color_text}` | 201/200 existing (user-scoped reuse, `:497-509`) |
| sprints CRUD: POST `…/sprints` :535, PATCH `/api/sprints/:id` :616, `/start` :587, `/finish` :704, `/reopen` :715, DELETE :734 | | `{name?, version?, description?, started_at?, ended_at?}` | server-enforced sprint invariants — one draft (`:553`), one open sprint, day-granularity non-overlap (see DATA-MODEL §2.3); **the S240/S241 round added `/pause` + `/resume`, `emoji`/`due_at` bodies, the explicit lifecycle, deps endpoints and the error family — the COMPLETE surface is §12** |
| backlog docs CRUD | :749-:807 | `{title ≤200, content ≤50k}` | revisions cascade |
| project tag chips: POST `…/tags` :811 / DELETE `…/tags/:tagId` :832 | | `{name, color?}` | find-or-create + usage; bumps `projects.updated_at` (`:828/:839`) |

### 3.3 Hurdles/links/screenshots/media — `src/routes/core.ts` (root-mounted, `app.ts:387`; requireAuth `core.ts:163`)

`GET/POST/PATCH/DELETE` under `/api/projects/:projectId/{hurdles,links,screenshots}`
(hurdles `:186-273` + reorder `:236`, links `:302-353`, screenshots list `:390`);
`GET /api/media` (all user media, **no pagination**, `:405`). Upload:
`POST …/screenshots` (`:456`) — base64 ≤5MB, 11 allowlisted mimes, upload rate limit
30/60s (`:461`), `Content-Length > 7MB → 413 file_too_large` (`:468`), optional WebP thumb
rides along (`:483-485`). **The S208 pin contract**: `PATCH /api/screenshots/:id`
(`:520`) takes `{caption?, resolved?, taskId?, thumbBase64?}` (`:511-519`) — `taskId` =
a task **uuid pins** the shot; `''`/`null` **unpins**; the task must live in the SAME
project and belong to the caller (`:508-533`, else 404 `task_not_found` `:532`); the
board's editor pins staged shots with exactly this PATCH after create
(`devboard.js:229-234, 473`). **File serve**:
`GET /api/media/screenshots/:id/file[?variant=thumb]` (`:558`) — raw bytes,
`Cache-Control: private, max-age=3600` (`:606`); `?variant=thumb` serves the ≤320px WebP
tile, a miss falls back to the original + `X-Hibana-Thumb: miss` (`:581-593, 607`) which
the gallery self-heals; non-image docs get `Content-Disposition: attachment`
(`:612-616`); lazy byte-size self-heal (`:603-604`). `DELETE /api/screenshots/:id`
(`:621`) clears referencing `cover_shot_id`.

### 3.4 Adjacent read/write paths the board UX uses

- `GET /api/tags` (`src/routes/tags.ts:61-76`, mounted `app.ts:393`) — **the label
  manager's list**: user-scoped tags ordered `usage_count DESC, name` (`:65`), ETag-wrapped
  (`:73-75`). Its mutations: PATCH rename/recolor `:93`, POST merge `:142`, DELETE
  `:169` — unused tags outright; a used tag needs `?force=1` (S232) and then cascades
  (links drop + `search_tags` rewrite, 409 `tag_in_use` without it, `:173`).
- `GET /api/rail` (`src/routes/rail.ts:66`, `app.ts:417`) — the nav rail's compact
  projects/sparks/folders trees; **no-store** (`:162`).
- `GET /api/search?q=` (`src/routes/search.ts:33`, `app.ts:395`) — FTS groups (projects,
  tasks via `dev_tasks_fts`, notes, backlog…), LIMIT 20 per group (`:43-142`), ETag-wrapped
  (`:169-175`).
- `GET /api/ov-tasks?status=` (`src/routes/tasks.ts:78`, `app.ts:410`) — cross-project open
  items, `LIMIT 200` (`:95`), ordered `COALESCE(updated_at, created_at) DESC`.
- `GET /api/auth/me` (`auth.ts:172`) — identity + language/calendar prefs.
- `POST /api/ai/text` (`src/routes/ai.ts:66`, `app.ts:414`) — Workers-AI
  polish/rewrite/translate; rate limit 20/60s (`:67-70`); Node self-host → 503 notice
  (`:94-95`).

### 3.5 Error format (uniform)

`{ error: '<code>' }` (+ optional `message`); registry `src/lib/errors.ts:21-42`. Route-local
codes: `invalid_input` (400), `not_found` (404), `id_conflict` (409), `rate_limited` (429),
`duplicate_tag` (409), `tag_in_use` (409), `already_archived` (409), `draft_exists` (409),
`file_too_large` (413), `task_not_found` (404), `github_not_configured` (503), `banned`
(403), `forbidden` (403, the T6 gate). Unhandled → 500 `{error:'internal_error'}`; every
error is persisted to `error_log` (7-day retention, `app.ts:196-232`).

### 3.6 Rate limits (fixed 60s windows, D1-backed, fail-open, `src/services/ratelimit.ts:18-34, 38-40`)

auth 30 · webhook 300 · export 10 · import 5 · **upload 30** · broadcast 2 · ai 20 — per
`name:ip`; `clientIp` = `CF-Connecting-IP` → TRUST_PROXY XFF → socket peer
(`ratelimit.ts:112-124`).

## 4. How the web client persists & reads (verified behavior)

- **Board load = ONE request**: `GET /api/projects/:id/devboard` (`devboard.js:157-166`),
  then full client render. No pagination, no partial refetch — every mutation ends with
  `reload()` (`board-page.js:271` = `B().load(projectId); render()` — e.g. `board-page.js:583,
  650, 746, 764, 836`).
- **The S206 hardened fetch layer**: `api()` (`devboard.js:10-64`) — every GET dispatches
  with an AbortController signal + a 3s deadline + ONE fresh retry (`:33-53`; the
  browser/edge dispatch-hang workaround), and **`cache:'no-store'` rides every call**
  (`:33`). Non-OK responses throw with the HTTP status attached (`:54-63`) so pages can
  branch 404-gone vs transient.
- **Mutations**: direct `fetch` (JSON) per action — create/patch/delete task
  (`devboard.js:173-180`), reorder, tags, sprints; screenshots upload via XHR
  (`uploadShotXHR` `devboard.js:326-339`) + pin/unpin PATCH (`:473`). Optimistic UI only
  for priority-cycle (`board-page.js:637-645`) and DnD preview (`:771-830`); failures roll
  back via `reload()` + toast.
- **S205 switcher**: `GET /api/projects?sort=recent` with a 60s in-memory cache
  (`board-page.js:283-287`) + in-place `B().load(id)` + render — no page navigation. Last-used
  persisted in localStorage `hibana-kanban-last` (`board-page.js:295, 934`).
- **Label manager (S209 parity)**: `fetchTags()` = `fetch('/api/tags', {cache:'no-store'})`
  (`devboard.js:1277-1281`); rename/recolor/merge/delete are plain `fetch`es
  (`devboard.js:1336-1382`) + list refresh (`:1392-1397`); shared by /kanban, /board.html
  and the embedded project.html board.
- **Offline queue** (`public/js/queue.js`, IndexedDB): covers **canvas sync + project
  creates only** (`queue.js:1`, `:133-180`) — **NOT board mutations**; 401/403 keep items
  (`:125`), 400/404/409/422 drop (`:126`), 500 retries ≤5 then drop (`:127-132`).
- **Service worker** (`public/sw.js`, `hibana-v444` `:16`): precaches the shell incl.
  `/kanban` (`:45`) and `/api/nav` (`:50`); `/api/*` always network — offline →
  `503 {error:'offline'}` JSON (`:171-172`); navigations network-first with
  401 → `/login.html?next=…` redirect (`:188-194`); only 2xx navigations enter the offline
  cache (`:196-198`).

## 5. What does NOT exist today (verified absent — desktop blockers)

1. **No pagination** on the board/detail/list endpoints (full scans; caps only in search
   LIMIT 20 / ov-tasks LIMIT 200, `search.ts:43-142`, `tasks.ts:95`).
2. **No task deletion tombstones** — `DELETE /api/devtasks/:id` is a hard row delete
   (`devboard.ts:325`) — and no per-task change feed.
3. **`dev_tasks.updated_at` misses tag changes** — `setTaskTags`
   (`devboard-helpers.ts:191-225`) writes links/usage/FTS but never the timestamp; a
   tags-only PATCH skips the UPDATE entirely (`devboard.ts:297-309`). No `updated_at` on
   hurdles/links/screenshots/sprints/tags/categories (their writes carry only `created_at`,
   e.g. `devboard.ts:574, 611`; `core.ts:535-553`).
4. **No idempotency keys for task creates** — server-minted UUIDs only (`devboard.ts:231`).
5. **No token auth** — cookie session only (fine in a WebView; a native HTTP client must
   manage the cookie jar + send `Origin` on writes).
6. **No CORS** — a browser-based non-same-origin client cannot call the API at all;
   same-origin embeds (Wails) are unaffected.

## 6. Host/origin behavior relevant to `projects.hibana.ir` (S205)

1. **Both hosts serve the whole app** — `hibana.ir` via the Workers custom domain,
   `projects.hibana.ir` via the zone-level Workers route (§1); `/kanban` behaves identically
   on each (`app.ts:370-385`).
2. **CSRF gate is self-origin aware**: `self = new URL(c.req.url).origin` reflects the
   request's Host (`app.ts:175`) — same-origin POSTs from `projects.hibana.ir` pages pass.
   Cross-host writes from `hibana.ir` pages would 403 (they never happen: pages post to
   their own origin).
3. **Cookies are host-only** (§2) — `projects.hibana.ir` keeps its own session after one
   login; the two hosts never share one.
4. **CSP `form-action 'self'`** (`app.ts:99`, `public/_headers:111`) binds form posts to
   the serving host — satisfied. **Emails/ICS deep links** always use canonical `APP_URL`
   (`https://hibana.ir`, `wrangler.toml:117`, `src/lib/app-url.ts:18-35`) — unaffected by
   the subdomain.
5. **HSTS** omits `includeSubdomains` (`app.ts:115`, mail host is DNS-only) —
   `projects.hibana.ir` gets its own HSTS from its own responses (Cloudflare routes always
   serve HTTPS). **`/kanban` route** (`app.ts:370-385`, S205): auth-gated (`loginNext:
   true`, `:372`), serves board.html via the assets binding, `no-store` stamped
   (`:378-381`), `/kanban.html` → 301 `/kanban` (`:355`), deep-link query untouched;
   unit-pinned in `src/tests/kanban-route.test.ts` (7 tests).

## 7. The Go desktop compatibility contract — the banked M0 additions (RECOMMENDATION — not implemented; each is additive and web-client-transparent)

The port plan's §6 list, expanded to implementation precision; order = priority. Nothing
here changes any §3 response shape for a caller that doesn't opt in.

### 7a. `setTaskTags` must bump `dev_tasks.updated_at`

- **What**: one line in `setTaskTags` (`src/routes/devboard-helpers.ts:191-225` — the ONE
  helper behind create (`devboard.ts:241`), PATCH (`:312`) and archive-restore (`:432`)):
  after the link sync (`:219`), `UPDATE dev_tasks SET updated_at = ? WHERE id = ?`.
- **Why it's the gap**: the server already stamps `updated_at` on create
  (`devboard.ts:235-237`) and every column PATCH (`:299-303`); tags are the only mutation
  class that escapes, so a delta key on `updated_at` (§7d) would silently miss label edits.
- **Shapes & backward compatibility**: unchanged — same bodies, same `{ok, tags}`
  responses; `updated_at` already serializes into every payload (`SELECT t.*`,
  `devboard.ts:152-154`), so only a value moves. The one existing consumer that sorts on
  it (`GET /api/ov-tasks`, `tasks.ts:95`) gets strictly more correct ordering.
- **Tests it must ship with**: unit — a tags-only PATCH bumps `updated_at` while a
  no-op PATCH doesn't (extend the devboard suites); e2e — the §7d delta filter returns a
  task whose ONLY change was a tag swap.

### 7b. Soft-delete tombstones for `dev_tasks`

- **What**: `DELETE /api/devtasks/:id` (`devboard.ts:317-329`) becomes
  `UPDATE dev_tasks SET deleted_at = ?` (nullable column, one migration); the GET board
  query adds `AND t.deleted_at IS NULL` (`devboard.ts:154`) and `taskTagsForProject`
  gets the same predicate (`devboard-helpers.ts:160-167`). Tag usage recount
  (`refreshTagUsage`) runs at delete time exactly as today (`devboard.ts:324-326`).
- **Purge**: hard rows ride the EXISTING `scheduledPurge` (`src/routes/admin.ts:692-724`)
  — `DELETE FROM dev_tasks WHERE deleted_at IS NOT NULL AND deleted_at < cutoff(7d)` +
  `DELETE FROM dev_task_tags WHERE task_id IN (…)`, the same 7-day cutoff the
  projects/notes/todos purge uses (`admin.ts:695-716`); the cron fires on the daily tick
  (`index.ts:108`) — 03:17 UTC dev / 03:23 prod (`wrangler.toml:15, 106`); manual twin
  `POST /api/admin/purge` (`admin.ts:570-605`).
- **`?since=` inclusion semantics**: a delta response (§7d) includes `{id, deleted_at}`
  stubs for tombstoned rows within the 7-day window; after purge they disappear entirely —
  the desktop GCs any local row whose tombstone ages out.
- **Web-client-transparent**: the GET filters tombstones; the DELETE response stays
  `{ok:true}`; the board's confirm-delete → `reload()` contract (`board-page.js:554-583`)
  is untouched; `archive-done` keeps its move-to-`project_archives` semantics
  (`devboard.ts:334-376`) — archived ≠ deleted (restore, `:406-436`).
- **Tests**: unit — delete → GET excludes; `?since=` includes the stub; purge removes at
  7d (mirror `errorlog.test.ts:137`'s scheduledPurge pattern); e2e — the delete flow's UI
  contract unchanged.

### 7c. Idempotent task creates (optional client `id`)

- **What**: `createDevTaskSchema` gains `id: z.string().uuid().optional()`
  (`devboard.ts:43-59`); `const id = body.id ?? uuid()` (replacing `:231`); pre-check
  `SELECT id, user_id FROM dev_tasks WHERE id = ?` — same user + same id →
  `200 {ok:true, duplicate:true, id, tags:[…]}` (the existing row's tags); cross-user
  collision → `409 {error:'id_conflict'}`. This mirrors `POST /api/projects` verbatim
  (`index.ts:394-402`) — whose own comment states the rationale: offline replay must not
  500 on the primary key and wedge a retry loop forever. Optional field; the web client
  never sends it (board mutations are online-only — every one ends in `reload()`, §4).
- **Tests**: unit — replay returns the same id with ONE row; cross-user collision 409;
  e2e — the airplane-mode replay acceptance from the port plan's M3 ("zero duplicates").

### 7d. `GET /api/projects/:id/devboard?since=<iso>` — the delta filter

- **What**: optional query param on `devboard.ts:139-195`. With `since`, the tasks query
  adds `AND t.updated_at > ?` (strictly greater); tombstone stubs (7b) ride along;
  `task_tags` filters to the returned tasks. Response = the SAME shape plus
  `server_time: <iso>` (the cursor for the NEXT call — never the client clock). Without
  the param: byte-identical to today (the ETag contract test keeps passing).
- **Why the server is already 90% there**: `updated_at` is stamped on create
  (`devboard.ts:235-237`) and PATCH (`:299-303`); 7a completes tags; 7b supplies deletions;
  and every board mutation ALSO stamps `projects.updated_at` (`:242, 313, 373, 434`) — so
  a cheap "did this board change?" pre-check is `GET /api/projects?sort=recent` + ETag
  (`index.ts:33, 128-132`).
- **Backward compatibility**: additive query param; the web client never sends it.
- **Tests**: unit — filtering, the `>` boundary, `server_time` presence, no-param parity;
  e2e — web board behavior unchanged; a two-call sequence (full, then since) returns only
  the row mutated in between.

### 7e. SSE — later, optional [OWNER]

Not in M0. The web client is request/response (`devboard.js:157-166`); poll `?since=`
first. If measured insufficient: `GET /api/projects/:id/devboard/events` — cookie auth
works same-origin, heartbeat 25-30s, `Last-Event-ID` = the `since` cursor. Zero contract
pressure until then (port plan §6.5).

## 8. ETag / no-store / cache semantics (the exact rules — verified)

| Response class | Validator | Cache-Control | Where |
|---|---|---|---|
| `GET /api/projects` (JSON + HX fragments) | weak ETag | `private, no-cache` | `index.ts:147-213, 386` + `http.ts:103-127` |
| `GET /api/projects/:id` (JSON + detail fragment) | weak ETag | `private, no-cache` | `index.ts:647, 649` |
| `GET /api/projects/:id/devboard` | weak ETag | `private, no-cache` | `devboard.ts:185` |
| `GET /api/tags` | weak ETag | `private, no-cache` | `tags.ts:63-65` |
| `GET /api/search` | weak ETag | `private, no-cache` | `search.ts:169-175` |
| `GET /api/ov-tasks` (HX branch) | weak ETag | `private, no-cache` | `tasks.ts:121` (JSON branch `:122` is plain) |
| every other `/api/*` GET (default) | none | `private, no-cache` | `app.ts:141-154` |
| `GET /api/nav` | none | **no-store** | `nav-chrome.ts:21, 39` |
| `GET /api/rail` | none | **no-store** | `rail.ts:66, 162` |
| `GET /api/health` | none | **no-store** | `health.ts:25-27` |
| `GET /api/auth/captcha` | none | **no-store** | `registration.ts:44-47` |
| `GET /api/media/screenshots/:id/file` | none | `private, max-age=3600` | `core.ts:606` |
| logo / banner bytes | none | `public, max-age=3600, swr=604800` / `private, max-age=3600` | `index.ts:902, 604` |
| Worker-served page HTML (all `WORKER_PAGE_ROUTES` + asset HTML) | none | **no-store** | `app.ts:251-267, 308-328` |
| `/kanban` HTML | none | **no-store** | `app.ts:378-381` |

**Mechanics** (`http.ts:103-127`): the ETag is FNV-1a over the serialized body →
`W/"<base36>"` (`:108-113`) — so ANY byte of the payload changing flips it (a new tag, a
renamed task, a bumped count all count). `If-None-Match` is an exact string match →
`304` carrying the same ETag + `private, no-cache` (`:114-120`). Empty bodies skip the
wrapper (`:106`); any wrapper failure passes the original through (`:125-127`). POST/
PUT/PATCH/DELETE responses are never touched by the `/api` GET middleware (`app.ts:143`).

**What the DESKTOP client should do** (recommendation): store the last ETag per GET URL
and send `If-None-Match` on every poll — a 304 costs one header and zero body work (§10).
Cache media bytes for their 1h `max-age` (`core.ts:606`) — content-keyed by screenshot
id, immutable in practice. Never cache the no-store endpoints (`/api/nav`, `/api/rail`,
health, captcha). Note the WEB board client itself bypasses all of this
(`cache:'no-store'` on every devboard call, `devboard.js:33`) — the S206 Chromium
dispatch-hang workaround, not a server contract; a Go HTTP stack should use the ETag path.

## 9. Offline behavior + its desktop equivalent

**Verified web behavior** (`public/sw.js`, `hibana-v444` `:16`):

- **Shell precache**: the SW installs the app shell — all page HTML incl. `/kanban` (`:45`)
  and `/api/nav` (`:50`) — so a cold offline launch still renders the shell (~1.87MB `:83-84`).
- **`/api/*` is always network** — no offline data path at all: offline →
  `503 {error:'offline'}` JSON (`:171-172`); the board's data layer shows its error/retry
  states (`devboard.js:54-63` status branching).
- **Navigations are network-first** — online always lands the fresh deploy; 401 →
  `/login.html?next=<full URL>` (`:188-194`); only 2xx navigations enter the offline cache
  (`:196-198`); offline falls back to the cached shell.
- **Offline WRITES are narrow**: queue.js covers canvas sync + project creates only
  (`queue.js:1, 133-180`) — board mutations fail with a toast; the "N unsynced changes"
  badge (`queue.js:51-71`) is the user's only offline-write signal.

**Desktop equivalent** (recommendation, per GO-DESKTOP-PORT-PLAN §2/§4/§5): the local
SQLite mirror IS the offline data path (the web's `503-on-/api` hole is the desktop's core
win); the outbox replaces queue.js for ALL mutations; the offline indicator copies
queue.js's badge contract (idle/N-unsynced/saving/saved/auth, `queue.js:17-24`); the SW's
navigate-401→login maps to a session-expiry dialog → `POST /api/auth/login` → retry;
airplane mode = read from mirror + queue writes + drain on reconnect (§10). The SW itself
is irrelevant inside Wails' WebView2 (unverified there — port plan §11) — the Go store
makes it moot.

## 10. Conflict handling & the sync strategy for a desktop client with local storage (RECOMMENDATION — expands GO-DESKTOP-PORT-PLAN §5)

- **Pull cadence**: on app focus + a 5-minute timer + manual refresh. Per board:
  `GET /api/projects/:id/devboard` with `If-None-Match` (304 = nothing to do, §8); after
  M0 §7d, `?since=<last server_time>` and merge returned rows into the mirror. Between
  pulls, the cheap pre-check: `GET /api/projects?sort=recent` + ETag — every board
  mutation stamps `projects.updated_at` (`devboard.ts:242, 313, 373, 434`).
- **Outbox drain rules**: FIFO, ONE in-flight request at a time (serialize — ordering
  contracts like reorder rewriting `sort_order` 0..n (`devboard.ts:253-257`) assume
  sequential application); retry with exponential backoff (1s → cap 60s, +jitter). Status
  handling, mirroring the verified web queue semantics (`queue.js:125-132`) plus the
  server's actual codes: **401** → re-auth (`POST /api/auth/login`, `auth.ts:64`) then
  retry the same op once — never drop; **403** → check the `Origin` header first
  (`app.ts:172-194` — headerless writes 403), then treat as ban (`middleware.ts:77-83`);
  **404 on PATCH/DELETE** → the task was deleted or archived server-side
  (`devboard.ts:317-329, 334-376`) → drop the op, mark the entity for full re-pull;
  **409** (`draft_exists`, `tag_in_use`, `id_conflict`) → drop + surface; **429** → back
  off to the next 60s window (`ratelimit.ts:18-34, 72`); **5xx** → retry ≤5 then
  dead-letter (`queue.js:127-132`). **Pacing**: drain ≤N mutations/s; uploads count
  against the 30/60s upload bucket (`core.ts:461`, `index.ts:860`).
- **Conflict policy — LWW per field**: the server has no version columns (§5.3-4); a PATCH
  writes ONLY the fields the body carries (`devboard.ts:280-284` — the SET builder emits
  provided keys), so devices editing different fields merge cleanly; a same-field race is
  last-writer-wins silently. RECOMMENDED desktop behavior: when a pull advances a locally-
  dirty task's `updated_at` past the local base, show a **"changed on server"** notice and
  rebase the local edit onto the fresh server row — a merge UI is overkill for a
  single-user product **[OWNER — confirm]** (port plan §5).
- **Deletion propagation**: with §7b tombstones — the pull carries `{id, deleted_at}`
  stubs for 7 days (purge: `admin.ts:692-724`); without it — "disappeared from pull" =
  deleted, holding a **7-day local grace copy** before removing local data (port plan §5).
  Always distinguish ARCHIVED: a task absent from the board but present in
  `GET …/archives` (`devboard.ts:381-399`) moved via archive-done — keep it in the
  archives view (restorable, `:406-436`).
- **Attachments (screenshots)**: online — `POST /api/projects/:id/screenshots`
  (base64 ≤5MB, 11 mimes, `core.ts:456-504`) then `PATCH /api/screenshots/:id {taskId}`
  to pin (`:520-556`, rules `:508-543`); offline — queue the base64 in the outbox (the 5MB
  cap is the server's own); on drain, upload then pin. Reads: mirror only `?variant=thumb`
  tiles (`core.ts:581`) to bound disk, originals on demand via
  `/api/media/screenshots/:id/file` (1h `max-age`, `:606`).
- **ETag reuse for cheap polling**: keep the last ETag per board GET; `If-None-Match` on
  every poll → 304 = zero work. Remember the ETag is a body hash (§8) — it answers "did
  ANYTHING change", never "what changed"; that's `?since=` (§7d).

## 11. Contract stability guarantees (for the port plan)

- The response shapes above are **pinned by 646 unit tests (green in this tree, S209) +
  449 e2e tests at S208 + the S209 parity spec** (`e2e/s209-kanban-parity.spec.ts`, 7 tests)
  — additive changes (new optional fields) are the only safe kind; renames/removals break
  the web client first, which the suite catches before any desktop work is affected.
- Ordering contracts to preserve exactly: board tasks `CASE priority urgent→low,
  sort_order, created_at` (`devboard-helpers.ts:231-232`); projects list default
  `status, sort_order, updated_at DESC` (`index.ts:132`); `sort=recent` = `updated_at DESC`
  (`index.ts:128`).
- Legacy status normalization map (`LEGACY_STATUS`, `src/validation/schemas.ts:12-26`) — a
  desktop client should send only canonical values and can ignore the legacy map.
- **S241 island pin**: the pre-S241 payload shape above (six keys; every task/sprint/
  category/tag/task_tag/project key) is pinned by `src/tests/api-surface-s241.test.ts` —
  additive keys ride along, any removal/rename fails CI before it can reach a desktop
  build. The pinned island (`04218ca` web-ref) decodes with Go structs whose
  `json.Unmarshal` ignores unknown keys, so the S240/S241 additions are invisible to it
  until the Phase 9 re-pin.

## 12. The Sprint, Deadline & Dependency surface — S240/S241 (Phase 1+2, migration 0065)

Landed on `feat/sprint-deadline-deps` (S240 @ `81f2c05`, S241 on top): project-scoped
sprints with an explicit lifecycle + emoji + due dates, personal task deadlines with a
server-resolved effective deadline, and same-project task dependencies. **Everything in
this section is additive and backward-compatible** — old clients (including the desktop
island @ `04218ca`) keep working unchanged; the six-key payload became seven keys, task
rows gained six additive fields, sprint rows five. Implementation: `src/routes/devboard.ts`
(+ helpers in `src/routes/devboard-helpers.ts`), migration `0065_sprint_deadline_deps.sql`,
domain suite `src/tests/sprint-deadline-deps-domain.test.ts` (24 tests), API-surface suite
`src/tests/api-surface-s241.test.ts` (7 tests).

### 12.1 Sprint model + endpoints (S240)

`sprints` columns added by 0065: `status` (`planned|active|paused|completed`, backfilled;
`NULL` on a lagging D1 → derive from the legacy pair: `ended_at NOT NULL ⇒ completed`,
`is_draft=1 ⇒ planned`, else `active` — `sprintStatusOf`, `devboard-helpers.ts`), `emoji`
(one picker token, `EMOJI_TOKEN_RE`, ≤16 chars, NULL = default glyph), `due_at` +
`due_origin_at` (same origin rules as tasks, below), `updated_at` (stamped on every write —
the D8 sync field; NULL on legacy rows). The legacy `is_draft`/`ended_at` pair stays as the
timeline's band-edge representation and every writer keeps them in lock-step
(`ended_at NOT NULL ⇔ completed`, `is_draft=1 ⇔ planned`).

| Method & path | Body (zod) | Success | Errors / notes |
|---|---|---|---|
| POST `/api/projects/:projectId/sprints` | `{name?, version?, description?, emoji?, due_at?, started_at?, ended_at?}` | 201 `{ok,id,name,version,draft}` | nameless create auto-names `Sprint N` (bumps past collisions, ≤50 tries); duplicate name (case/trim-folded, project-scoped, ALL lifecycle states) → **409 `duplicate`** (write-time-only rule — legacy case-twins stay readable); one draft per project → **409 `draft_exists`**; create-with-dates auto-closes only the ACTIVE sibling (stamps `ended_at` + `status='completed'`, archives NOTHING — legacy timeline mechanics); new sprint `status = ended_at ? 'completed' : 'active'`; draft create → `status='planned'`; first `due_at` assignment stamps `due_origin_at` |
| POST `/api/sprints/:id/start` | — | 200 `{ok}` | `planned|paused → active`; another sprint active → **409 `{error:'sprint_active_exists', active_id}`** (NO auto-close — the Phase 4 conflict modal resolves: finish current / pause current / cancel); paused source = pure resume (window untouched); `active|completed → 400 already_started` (legacy shape) |
| POST `/api/sprints/:id/pause` (NEW) | — | 200 `{ok}` | `active → paused` only (else 400 `invalid_input`); keeps window + deadlines (§5.5) |
| POST `/api/sprints/:id/resume` (NEW) | — | 200 `{ok}` | `paused → active`, subject to one-active (same 409 shape as start) |
| POST `/api/sprints/:id/finish` | — | 200 `{ok, archived:n}` | → `completed` + `ended_at=now` + archives ONLY this sprint's `status='done'` tasks into `project_archives` (snapshot: `sprint_id` KEPT, tags JSON, `sprint_name_snapshot = sprint.name`); unfinished tasks untouched; re-finish legal (idempotent + archives newly-done); `planned/draft → 400` |
| POST `/api/sprints/:id/reopen` | — | 200 `{ok}` | `completed → active` (isLatest guard → 400; one-active → 409 `sprint_active_exists`); `active → 200` no-op; `paused → 400` |
| PATCH `/api/sprints/:id` | `{name?, version?, description?, emoji?, due_at?, started_at?, ended_at?}` | 200 `{ok}` | rename uniqueness-checked (409 `duplicate`; self re-assert legal); `due_at` origin rules: null→value stamps `due_origin_at`, value→value preserves it (extension ≠ re-assignment), null clears both; `ended_at` transitions move `status` in lock-step and NEVER archive; every PATCH stamps `updated_at` |
| DELETE `/api/sprints/:id` | — | 200 `{ok}` | `planned/paused` only; active → **409 `sprint_active`** (pause/finish first); completed → **409 `sprint_completed`** (history is not deletable); tasks DETACH (`sprint_id=NULL`, never deleted); archived rows get `sprint_name_snapshot = "<name> (deleted)"` + `sprint_id=NULL` (AP-27 hygiene) |

### 12.2 Task deadlines — raw fields + the effective resolution (S240/S241)

`dev_tasks` gained `due_at` (optional personal deadline, ISO-8601 instant — date-only
resolves client-side to local 23:59) and `due_origin_at` (progress START stamp: set on
first assignment, preserved on edits/extensions, cleared with `due_at`; re-adding starts a
fresh timeline). Origin rules run on create + PATCH (task) and create + PATCH (sprint):
null→value stamps, value→value preserves, value→null clears both.

**S245 (Phase 6 — §13.4) addition — the `due_origin_at` ride-along on the task PATCH:**
`PATCH /api/devtasks/:id` additionally accepts an optional `due_origin_at` body field
(validated ISO), honored ONLY when it accompanies a `due_at` null→value transition: the
client-sent instant is stamped instead of `now`. This is the mechanism behind the
inherited-deadline extension's task-only arm (spec §13.4): the override the arm creates
must "preserve the inherited deadline's original progress origin rather than making the
bar look newly assigned", so the J3 flow sends the sprint's `effective_due_origin_at`
along with the computed override value. Every other case IGNORES the field — value→value
still preserves the task's own stored origin (an extension is not a re-assignment),
value→null still clears both, and a body sending it without `due_at` is a no-op for it.
Additive + island-transparent (a Go struct decode ignores the key); the alternative — a
server special-case sniffing sprint inheritance inside the PATCH — was rejected because
it would fork the origin rules away from the body-driven write surface. Extension flows
are otherwise pure PATCH orchestration: the presets ADD TO THE EXISTING `due_at` (never
to the current moment — §13.1), and `PATCH /api/sprints/:id {due_at}` is the sprint-wide
arm (every inheriting task follows on the next payload pull; value→value preserves the
sprint's own origin).

**Effective deadline (S241 — the documented Phase 2 decision: computed SERVER-side, as
additive fields on the board payload's task rows):**

```
effective_due_at        — the resolved deadline instant (ISO-8601 or null)
effective_due_source    — 'task' | 'sprint' | null (which level won)
effective_due_origin_at — the progress start point for the WINNING level (spec pack §12.2):
                          task source → the task's due_origin_at;
                          sprint source → the SPRINT's due_origin_at (the shared start
                          point for every task inheriting it); coalesced to the due_at
                          itself when a legacy row lacks the stamp
```

Precedence (spec §10): **personal > sprint-inherited-while-not-completed > none**. A
completed sprint's due date is historically neutral — it stays visible in the `sprints`
section but never serves as an active deadline (§10.3); a paused sprint's deadline keeps
inheriting (§5.5). One shared helper — `effectiveDeadlineOf` (`devboard-helpers.ts`) — is
the single resolution (spec §18: web and desktop must not fork deadline logic; the desktop
consumes the computed fields and needs zero deadline logic of its own). On a lagging
pre-0065 D1 the fields serialize as the null triple.

**S244 (Phase 5) addition — the project detail pool carries the same triple:** the
`devTasks` rows of `GET /api/projects/:id` (both the JSON pool and the server-rendered
HTML fragment it feeds) now carry the additive `effective_due_at` / `effective_due_source`
/ `effective_due_origin_at` fields, computed through the SAME `effectiveDeadlineOf` seam
(`detail-helpers.ts` `devTasksWithDue`). The embedded project-page board's server render
and its client repaint twin (`project-page.js` `pdTruthWrap`) read the triple from there —
the web client still ships zero deadline resolution logic. Additive + island-transparent:
a Go struct decode ignores the keys, and no existing consumer reads them.

### 12.3 Task dependencies (S240 write / S241 read)

`dev_task_deps` (0065): `(blocker_task_id, blocked_task_id)` both `→dev_tasks ON DELETE
CASCADE`, `CHECK blocker<>blocked`, both-FK indexes. Soft/informational only (spec
assumption 2) — never blocks Kanban movement, never mutates priority/status/sprint/deadline.

| Method & path | Body | Success | Errors |
|---|---|---|---|
| POST `/api/devtasks/:id/deps` (NEW) | `{blocker_id}` | 201 `{ok:true}` new / 200 `{ok:true, existing:true}` idempotent | self / cross-project / foreign-user blocker → 400 `invalid_input`; closes a cycle (recursive CTE over `dev_task_deps`) → **409 `cycle`** (recorded divergence: registry default 400) |
| DELETE `/api/devtasks/:id/deps/:blockerId` (NEW) | — | 200 `{ok:true}` always (tag-link shape) | — |

**Read surface (S241): the payload's 7th key `task_deps`** — the flat per-project edge join
`{blocker_task_id, blocked_task_id}` (ordered by `created_at`), shaped like `task_tags` so
the client folds by task: *Blocked-by* = edges where `blocked_task_id = X`; the reverse
*Blocks N* counts = the same fold's other half (derived, NEVER a separate endpoint or
stored column — spec §15). Same-project is a write-time invariant, so the join is scoped
through the blocked task's project (rule 1 — a stranger's edges never leak); CASCADE keeps
it dangling-free; a lagging pre-0065 D1 serves `[]` (the categories belt precedent).

**S246 (Phase 7 — the dependencies UI) addition — the DETAIL POOL carries the same edges:**
`GET /api/projects/:id`'s pool (both the JSON path and the server-rendered HTML fragment)
now includes `taskDeps` — the SAME `taskDepsForProject` flat join, as an additive
camelCase key in the pool's own style (the `devTasks`/`devTaskTags` family). This is the
recorded embedded-fold decision: the embedded project-page board's dep badges fold from
the detail pool it already fetches (NEVER a second board pull), the server render folds
server-side at render time, and the client repaint twin (`pdTruthWrap`) reads the edges
off the same payload. The `/kanban` surface keeps folding the board payload's `task_deps`
key — one edge pool per surface, both from the one shared helper. Additive +
island-transparent (the desktop island is the /kanban surface; a Go struct decode ignores
the key). The UI's write path rides the two endpoints above through the shared `api()`
wrapper (`addTaskDep`/`removeTaskDep`) — zero new fetch sites; edit-mode picks mutate
LIVE (the 400 self / 409 cycle answers surface inline at the bad pick), add-mode picks
stage and POST right after the task-create ack.

### 12.4 Task endpoints' sprint/deadline guards (S240)

- **POST `/api/projects/:projectId/devtasks`** additionally accepts `due_at` (origin
  stamped on create). `sprint_id: null` = No sprint (always legal); **`sprint_id` undefined
  = the legacy draft/open auto-assign** (kept for old clients until the Phase 3 client fix
  — D2); NEW assignment to a completed sprint → **400 `sprint_completed`**.
- **PATCH `/api/devtasks/:id`** additionally accepts `due_at` (same origin rules,
  special-cased like `tags`) and, since S245, the optional `due_origin_at` ride-along
  (§12.2 above — honored only on a `due_at` null→value transition, ignored otherwise);
  MOVING a task to a completed sprint → 400 `sprint_completed`;
  re-asserting the task's CURRENT sprint stays legal (the old Edit modal resends fields
  verbatim). planned/active/paused targets all assignable (assumption 3: paused allowed).

### 12.5 Sprint overview counts — DECISION: client-derived (no endpoint)

Spec §7.4 (counts across the five Kanban statuses + total only, no percentages/analytics)
is **folded client-side from the board payload** — every task already carries `sprint_id` +
`status`, so `count(tasks where sprint_id = S, group by status)` is a trivial fold for both
the web UI (Phase 4) and the desktop mirror (offline, identical logic). No
`/sprints/:sid/overview` endpoint exists; do not add one without revisiting this decision
record (S241). Raw status → label mapping is the client's five-lane set
(`idea/bug/planned/in_progress/done`).

### 12.6 Sync implications (web ⇄ desktop)

- **Full-board replace still suffices — NO `?since=` deltas are needed for this feature.**
  The desktop's `GET /api/projects/:id/devboard` pull now carries sprints (with
  `status/emoji/due_at/due_origin_at/updated_at`), tasks (raw `due_at`/`due_origin_at` +
  the computed `effective_*` triple) and `task_deps`; every mutation still ends in the
  client's full re-pull (web) or mirror replace (desktop).
- `sprints.updated_at` (D8) exists for FUTURE delta work; do not build on it yet.
- The island @ `04218ca` ignores every additive key (Go struct decode) — verified by the
  S241 legacy-shape pin. The Phase 9 desktop round adds mirror schema v3 (`dev_task_deps`
  + the new columns), re-pins the island (new fetch call-sites trip the seam gates — D9),
  and consumes THIS section as its contract.
- One-active is enforced atomically server-side (partial unique index
  `idx_sprints_one_active` + the service-layer 409s) — sync/LWW can never produce two
  active sprints; a desktop "start" that loses the race gets `sprint_active_exists` +
  `active_id` and must surface the conflict, not retry.
- Conflict policy for the new fields is the existing LWW per field (§10) — no version
  columns were added.
