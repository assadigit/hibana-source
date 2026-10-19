# Hibana Project/Kanban — Data Model

> **Scope:** the authoritative persisted schema behind the project + Kanban experience
> (projects, dev tasks, sprints, categories, tags, archives, hurdles, links, screenshots),
> verified against the repository tree at **v0.4.1.35 / S209** (the kanban 1:1 parity round
> — uncommitted working tree; NO schema changes this session). Frontend-only shapes are marked
> as such. Every claim carries a source reference; unused/dead fields are stated as such.
>
> Companion documents: `FEATURE-INVENTORY.md` (what users can do), `API-AND-SYNC-CONTRACT.md`
> (how clients read/write this data), `USER-FLOWS.md`, `GO-DESKTOP-PORT-PLAN.md`, `TEST-MATRIX.md`.
> §6-§7 are the **data core of the Go Windows desktop replication spec pack** — clearly
> marked recommendations on top of the verified §2-§5 facts.

## 1. The three "boards" (a critical orientation fact)

Hibana has **three Kanban-like surfaces, none of which has a `board` or `board_columns` table**:

| Surface | Columns are… | Rows are… | Where |
|---|---|---|---|
| **Project Kanban** (this doc's focus) | the fixed `dev_tasks.status` enum: `idea, bug, planned, in_progress, done` | `dev_tasks` rows | `/kanban` (S205), `/board.html?project=`, embedded in `/project.html?id=` |
| Project stage board | the fixed `projects.status` enum (6 stages) | `projects` rows | `/projects.html?view=kanban` (server-rendered) |
| Ideas shelf | `spark_folders` rows as columns | spark `projects` rows | `/sparks.html` |

`migrations/0009_boards.sql` is **not** a Kanban migration — it adds a `board` column to
`canvas_elements` (`'canvas' | 'notebook'`). Columns in the project Kanban are **enum
constants enforced by SQL CHECK constraints**, not data rows: there is no per-board column
CRUD anywhere (no create/rename/reorder/delete-column API exists).

## 2. Core tables (authoritative shapes after migration 0064)

### 2.1 `projects` — the board's owner entity

Created in `migrations/0002_projects_history.sql:5`, rebuilt in `0031` and `0060_project_status_rename.sql:33-52`,
final ALTERs in `0063:23-24`. TypeScript row type: `src/types.ts:154-175` (`ProjectRow`); canonical status
order `STATUS_ORDER` at `src/types.ts:150`.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                          -- UUID; server-minted (crypto.randomUUID, src/lib/ids.ts:4-5) OR client-supplied on create (index.ts:394)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','client')),
  status TEXT NOT NULL DEFAULT 'spark' CHECK (status IN
      ('spark','planning','queued','developing','awaiting_dev','operational')),
  sort_order INTEGER NOT NULL DEFAULT 0,        -- manual drag order within a status column (stage board)
  latest_note TEXT NOT NULL DEFAULT '',         -- the project page's "quick note" (≤5000 chars)
  progress_percent INTEGER,                     -- ALWAYS NULL since 0051 (dead column, kept for compat)
  archived_state TEXT CHECK (archived_state IN ('online','offline')),  -- offline = parked (archive shelf)
  client_name TEXT,                             -- client-work module
  due_date TEXT,                                -- ISO date; reminders gate
  reminders_enabled INTEGER NOT NULL DEFAULT 0, -- 0006:4, carried by the 0060 rebuild
  folder_id TEXT,                               -- 0037:17 spark folder (FK dropped by 0060 rebuild; app-enforced)
  logo_path TEXT,                               -- 0047:3 GitHub-stored logo path
  created_at TEXT NOT NULL,                     -- ISO 8601 (UTC, JS Date.toISOString)
  updated_at TEXT NOT NULL,                     -- bumped by nearly every child mutation (see §4)
  deleted_at TEXT                               -- soft delete; 7-day purge cron hard-deletes after that
);
-- 0063:23-24: ALTER TABLE projects ADD COLUMN pinned_at TEXT; ADD COLUMN cover_shot_id TEXT;
-- Indexes (recreated at each rebuild): user_id, (user_id,status), (user_id,updated_at),
--   deleted_at (0002:22-25 / 0060:73-76), idx_projects_folder (0037:19, recreated 0063:29)
```

**Lifecycle semantics (all server-enforced):**
- **Soft delete**: `DELETE /api/projects/:id` sets `deleted_at` (`src/routes/projects/index.ts:716-728`);
  hard delete **only** for `status='spark'` + `?force=1` (purges screenshot bytes first, `:729-733`).
  A daily cron (`scheduledPurge`, `src/routes/admin.ts:692-724`) hard-deletes rows after 7 days and also
  purges expired sessions, stale rate-limit rows, and old error_log rows.
- **Archive/park**: `archived_state='offline'` (`POST /api/projects/:id/archive`, `index.ts:783`); restore
  via `unarchive` (`index.ts:801`). Distinct from delete. **Revive**: `awaiting_dev` → an active status
  (`index.ts:757`).
- **Ownership**: single-owner, no membership/sharing. Every access goes through `getOwnedProject`
  (`src/lib/html.ts:169-175`: `WHERE id AND user_id AND deleted_at IS NULL`). `users.role` (`owner|member`,
  `0001:10`) is an install-level admin-console role, not a project role.

### 2.2 `dev_tasks` — the Kanban cards

Created `migrations/0029_devboard_sprints.sql:28-39`; `bug` status added by the `0034:19-32` rebuild;
`category_id` re-pointed to the global `categories` table by the 0062 rebuild (`0062:123-138`).

```sql
CREATE TABLE dev_tasks (
  id TEXT PRIMARY KEY,                          -- UUID; ALWAYS server-minted (devboard.ts:231) — no client ids (§7)
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                          -- ≤100k chars: free text = the card's whole body (title + '\n' + content)
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN
      ('idea','bug','planned','in_progress','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,   -- 0062:129
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,        -- manual drag order within the project (reorder rewrites 0..n)
  created_at TEXT NOT NULL,                     -- timeline bar start
  done_at TEXT,                                 -- stamped entering 'done', cleared leaving it (devboard.ts:287-296)
  start_at TEXT,                                -- 0030:6 explicit timeline start (nullable)
  end_at TEXT,                                  -- 0030:7 explicit timeline end (nullable)
  search_tags TEXT NOT NULL DEFAULT '',         -- 0051:22 denormalized tag names for FTS (app-maintained)
  updated_at TEXT                               -- 0061:13 stamped on create + PATCH (NOT on tag changes — see §4)
);
-- Indexes: idx_dev_tasks_project (0029:40), _sprint (0029:41), _status (0042:11),
--   _updated (0061:21), _cat (0062:150)
```

**S208 DATA implications (no schema change — all payload-level):**
- **`shot_count` is COMPUTED, not a column.** `GET /api/projects/:id/devboard` derives it per task as
  `COALESCE((SELECT COUNT(*) FROM screenshots sc WHERE sc.task_id = t.id), 0)` — `src/routes/devboard.ts:152-153`,
  with the pre-0054 degradation belt (hard-coded `0 AS shot_count`, `devboard.ts:156-164`) so an old D1
  serves the board badge-less rather than 500ing. Pinned by `src/tests/devboard-shots.test.ts:64-109`.
- **Tags ride the task rows as joined arrays.** The same SELECT GROUP_CONCATs `dev_task_tags.tag_id` into
  a `tags` string (`devboard.ts:152`) which the payload splits into `tasks[].tags: [tagId…]`
  (`devboard.ts:187`); a flat `task_tags` join (`{task_id, id, name, color}`, `devboard-helpers.ts:160-167`)
  feeds card chips. Creates accept `tags: [name…]` find-or-create (`devboard.ts:58, 241`); PATCH is
  replace-set (`devboard.ts:71, 312`).
- **Type drift (honest note):** `DevTaskRow` (`src/types.ts:222-239`) omits `search_tags`, and
  `DevTaskStatus` (`src/types.ts:210`) omits `'bug'` even though the SQL CHECK (`0062:127`) and the Zod
  enum (`devboard.ts:30`) both include it — the payload row widens both at query time (`devboard.ts:144`).

**There are no per-task fields for:** due dates (those live on `projects` and to-do tasks only),
assignees (single-user product), checklists (title text may contain markdown `- [ ]` lists — rendered,
not structured), attachments-in-row (screenshots pin via their own `task_id`, §2.8), comments,
dependencies, custom fields, recurring rules. These absences are **by design** — the desktop port
must reproduce exactly this shape, not "fix" it.

### 2.3 `sprints`

`migrations/0029:8-15` + ALTERs `0039:7` (is_draft), `0052:14-15` (version, description).

```sql
CREATE TABLE sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,                     -- day-granularity; stamped at start
  ended_at TEXT,                                -- NULL while open
  created_at TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 0,          -- exactly one draft per project (409 draft_exists, devboard.ts:553)
  version TEXT,                                 -- 0052:14 free-text version label ("12.1")
  description TEXT                              -- 0052:15 the sprint doc (markdown, autosaved via PATCH :686-689)
);
CREATE INDEX idx_sprints_project ON sprints(project_id);
```

Server-enforced invariants (`src/routes/devboard.ts:535-745`): one open sprint per project at a
time; day-granularity non-overlap (`devboard.ts:637-672`); latest-sprint-only reopen (`:646-651, 715-732`);
draft→started closes the previous open sprint at day-before (`:587-613`); a deleted sprint's tasks are
detached (`sprint_id = NULL`, `:739-741`). No `updated_at` — a sprint PATCH is invisible to any
timestamp-based delta pull (§4).

### 2.4 `categories` + `project_categories` (task categories)

`migrations/0062_global_task_categories.sql:39-56`; categories rebuilt user-scoped by `0064:40-48`.

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- 0064:42
  name TEXT NOT NULL,
  color_fill TEXT NOT NULL,                     -- curated fill+ink PAIR (16 pairs, CSS --cat-sw-* tokens; 0062:29-33)
  color_text TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,       -- soft archive (delete = archive)
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_categories_user_name_live ON categories(user_id, lower(trim(name))) WHERE is_archived = 0;  -- 0064:124

CREATE TABLE project_categories (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)         -- per-project ENABLEMENT (replace-set via PUT, categories.ts:211, 226-227)
);
```

The devboard payload exposes only the project-visible slice: enabled ∪ task-referenced (archived
rows stay for history, `enabled=0`) — `devboard.ts:173-183`. Legacy `task_categories` (0029:18-26)
still exists as a table but is dead — folded into `categories` by 0062 (rows preserved, ids kept).

### 2.5 `tags` / `project_tags` / `dev_task_tags` (labels)

`migrations/0003_tags_hurdles_links.sql:4-20` + `0029:45-50`.

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f6d365',
  usage_count INTEGER NOT NULL DEFAULT 0,       -- app-maintained count of dev-task + project links
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE project_tags   (project_id …, tag_id …, PRIMARY KEY (project_id, tag_id));   -- project chips
CREATE TABLE dev_task_tags  (task_id … REFERENCES dev_tasks(id) ON DELETE CASCADE,
                             tag_id  … REFERENCES tags(id)       ON DELETE CASCADE,
                             PRIMARY KEY (task_id, tag_id));                                -- card labels
```

`tags.usage_count` is recomputed after every link/unlink/merge/delete (`refreshTagUsage`,
`devboard-helpers.ts:108-119` — dev-task links + project chips, `:113-116`). Renaming a tag to
an existing name **merges** (`PATCH /api/tags/:id`, `src/routes/tags.ts:83`); delete is
unused-tags-only (`409 tag_in_use`, `tags.ts:156-160`). `search_tags` is rewritten in batch after
merges/deletes (`syncTaskSearchTagsBatch`, `devboard-helpers.ts:140-151`; `tags.ts:113, 126, 148`).
The label manager lists via `GET /api/tags` usage-ordered (`tags.ts:51-66`); new tags take the
least-used palette color (`tagColorFor`, `devboard-helpers.ts:81-102`).

### 2.6 `project_archives` (done-task archive)

`migrations/0046:6-19` + `tags` JSON column `0051:20`.

```sql
CREATE TABLE project_archives (
  id TEXT PRIMARY KEY,                          -- the ORIGINAL dev_tasks id (restore re-inserts the same id)
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  priority TEXT NOT NULL DEFAULT 'medium',
  category_id TEXT,
  sprint_id TEXT,
  done_at TEXT,
  original_created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]'               -- JSON snapshot of label names+colors at archive time
);
```

This is the **only soft-landing for deleted work** in the Kanban domain: `POST …/devtasks/archive-done`
moves done tasks here (labels snapshotted before the cascade; `devboard.ts:334-376`); restore re-inserts
into `dev_tasks` with the same id and relinks labels (`devboard.ts:406-436`). Direct
`DELETE /api/devtasks/:id` is a **hard delete with no tombstone** (`devboard.ts:317-329`).

### 2.7 `hurdles`, `links` (project page siblings)

`migrations/0003:23-41` (+ `idx_hurdles_status` 0042:9). Hurdles = "where I'm stuck" notes
(`status open|solved`, `solved_at` stamped/cleared); links = labeled URLs (client-supplied id accepted,
`src/validation/schemas.ts:116`). Both scoped through the owning project, both hard-delete, both bump
`projects.updated_at` (`src/routes/core.ts:224-364`).

### 2.8 `screenshots` (attachments/media)

`migrations/0004:4-12` + ALTERs `0053:6` (resolved), `0054:12-14` (task_id, bytes), `0059:16` (filename).

```sql
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,                          -- client-supplied id accepted (core.ts:475) — see §7
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_path TEXT NOT NULL,                    -- storage key (kv→r2→github chain, services/shotstore.ts)
  mime_type TEXT NOT NULL DEFAULT 'image/png',  -- 11-mime allowlist below
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,          -- "resolved" flag (problem-media semantics)
  task_id TEXT REFERENCES dev_tasks(id) ON DELETE SET NULL,  -- pin to a card (same-project only)
  bytes INTEGER NOT NULL DEFAULT 0,             -- exact decoded byte count (enforced == buffer length)
  filename TEXT                                 -- original upload name (downloads; NULL = legacy image rows)
);
```

- **The 11-mime allowlist is exact**: png, jpeg, webp, gif, video/webm, pdf, csv, xlsx, docx,
  markdown, plain — `UPLOAD_FILE_MIMES`, `src/validation/schemas.ts:131-142`; the upload schema regexes
  `mimeType` against it (`schemas.ts:145-149`) and image bytes are magic-byte-sniffed (declared must
  match sniffed, `src/lib/http.ts:24-31`). No user_id column by design — ownership flows through
  `project_id` (`0054:10-12`).
- **task_id pinning semantics**: pin = `PATCH /api/screenshots/:id {taskId}` with a Zod uuid / `''` /
  `null` (`core.ts:511-519`); the target must be a dev_task in the SAME project owned by the caller
  (`core.ts:527-533`, else `404 task_not_found`); unpin = `''`/`null` (`core.ts:541-543`).
  `ON DELETE SET NULL` — deleting the task detaches the shot, never loses the picture.
- **bytes** is the exact decoded size at upload (`base64 sans padding × 3/4`, `core.ts:486-497`);
  **filename** is the sanitized original name (≤200 chars, `core.ts:489-496`), shown by doc tiles and
  Content-Disposition on serve (`core.ts:612-616`).

Deleting a screenshot also clears any `projects.cover_shot_id` referencing it (`core.ts:640`).
Object bytes: KV-first chain with `.thumb` variants (`src/services/shotstore.ts`); project **logos**
are GitHub-Contents-only (`PUT /api/projects/:id/logo`, `index.ts:857-884`; served `:886-903`).

### 2.9 `project_history_log` (activity feed)

`migrations/0002:28-34`: `(id, project_id REFERENCES projects ON DELETE CASCADE, note TEXT, created_at)` +
`idx_history_project`. Written by project PATCH (status change + latest-note change, `index.ts:699-710` —
the two history INSERTs at `:702, 708`), devtask create/done/archive/restore/delete, backlog ops, tag ops,
sprint ops (`logHistory`, `devboard-helpers.ts:23-27`). Read: the project page's "Latest Activity" feed
(server-rendered, `src/routes/projects/detail-helpers.ts:119-120`; capped at 20 rows, `:39-41`).

### 2.10 Full-text indexes (FTS5, external-content, trigger-maintained)

- `projects_fts` (`0004:27`, triggers `0004:30-43`; recreated by the 0060 rebuild `0060:78-94`) —
  title/description/note; search phrases quoted `'"…"'`
- `dev_tasks_fts` (`0051:30-33`, triggers `0051:34-43`; recreated by the 0062 rebuild `0062:152-164`) —
  title + `search_tags`; the tags column is app-maintained (`syncTaskSearchTags`, §2.5)
- Also `quick_notes`/`backlog_docs`/`sadhana_tasks`/`canvas_elements` FTS (`0040`) — adjacent domains
- `project_progress_log` (0050) was created then **dropped** in 0051:18; `progress_percent` is dead.

### 2.11 Identity & infra tables (adjacent)

- `users` / `sessions` / `invites` — `0001:5-35`. Sessions store **SHA-256 hex of the cookie token** as
  `sessions.id` (`src/auth/sessions.ts:35-45`); 30-day rolling expiry. Invites are registration codes,
  NOT project membership.
- `rate_limits` — `0014:7-13` (fixed 60s windows, keyed `name:ip`).
- `_migrations(name, applied_at)` — Node-side bookkeeping (`src/db/migrate-node.ts:18-25`); D1 applies via
  `scripts/d1-migrate.mjs`. Live schema version surfaced by `/api/health` as `schema_version` (63 at S209,
  `src/routes/health.ts:29-42`).
- `spark_folders` — `0037:8-15` + icon (0056:8) + pastel/banner columns (0063:25-27) — the Ideas columns.
- `backlog_docs` + `backlog_doc_revisions` — `0033:7-26` — per-project plan documents with revision history.
- `canvas_elements` — `0005:6-25` (rebuilt 0011/0023/0032/0036) — the ONLY entity with true LWW sync
  (`updated_at` comparison server-side + integer `deleted` tombstones, `core.ts:702-739`, skip at `:729`).

## 3. Frontend state shape (NOT persisted)

- **Board/sprint pages** (`/kanban`, `/board.html`, `/sprint.html`): `window.HibanaBoard.state`
  (`public/js/devboard.js:155`) mirrors `GET /api/projects/:id/devboard` (`load`, `devboard.js:157-166`):
  `{ projectId, project{id,title,status,type}, tasks[], categories[], sprints[], tags[] }` — since S208 each
  task row carries the computed `shot_count` and the joined `tags: [tagId…]` array (`devboard.ts:144-187`);
  the payload also carries the flat `task_tags` join (`devboard.ts:193`). All three surfaces read it.
- **Embedded board** (`/project.html?id=`): server fragment `#pd-board` (`detail-helpers.ts:412-497` —
  `.pd-board.db-frame` `:420`, Labels button `:437`) + a client truth state: after AJAX mutations
  `pdRepaintColumns` re-fetches `GET /api/projects/:id` (JSON `{project: {…ProjectRow, …loadDetail()}}`,
  `index.ts:649`) and derives pins + sprint names client-side from the SAME payload fields —
  `pdDetailMaps` counts `screenshots.task_id` and maps `sprints.id→name` (`public/js/project-page.js:3181-3189`),
  `pdTruthWrap` renders the pin + ◆ sprint badges (`project-page.js:3158-3177`). No new sync surface —
  the S209 repaint fix reuses detail-JSON fields (`devTasks`, `devTaskTags`, `categories`, `screenshots`, `sprints`).
- Filter/search state, collapsed columns (`hibana-pd-cols-collapsed`), last-used board
  (`hibana-kanban-last`, S205), recent projects (`hibana-recent-projects`) are localStorage-only —
  see `FEATURE-INVENTORY.md` §9.

## 4. Sync-relevant semantics (the desktop-port lenses)

1. **`updated_at` coverage is uneven.** `projects.updated_at` is bumped by nearly every child mutation —
   18 explicit `UPDATE projects SET updated_at` sites (plus the project PATCH/DELETE's own stamps): devtask
   create/patch/archive-done/restore (`devboard.ts:242, 313,
   373, 434`), task-tag + project-chip ops (`devboard.ts:828, 839`), screenshot upload/patch/delete
   (`core.ts:501, 553, 641`), hurdles/links (`core.ts:224-364`), backlog docs (`devboard.ts:773, 794`),
   logo (`index.ts:880, 914`) — a usable coarse sync key. Honest exception: **sprint mutations never bump
   it** (`devboard.ts:535-745` has no project stamp). `dev_tasks.updated_at` exists (0061) but is stamped
   **only on create + PATCH** (`devboard.ts:235-237, 299-303`) — tag add/remove (`setTaskTags`,
   `devboard-helpers.ts:191-225`) rewrites `search_tags` (`:219`) but does NOT bump it. No `updated_at`
   at all on: hurdles, links, screenshots, sprints, tags, categories. **No revision/version counters
   exist anywhere in the domain.**
2. **Deletion propagation:** `projects` has `deleted_at` (7-day tombstone window, purged by the daily
   cron). `dev_tasks` are hard-deleted — the only trace is the archive path (§2.6) or a history log row.
   `canvas_elements` is the only LWW-tombstoned table (`core.ts:702-739`). A second client cannot today
   observe task deletions — see `API-AND-SYNC-CONTRACT.md` §7b for the banked-M0 plan.
3. **Idempotency:** `POST /api/projects` accepts client UUIDs and returns 200 `duplicate:true` on replay
   (`index.ts:394-402`). Screenshot uploads accept client ids as canonical (`core.ts:475`) but have NO
   duplicate-replay belt — a literal replay PK-conflicts. `POST /api/projects/:id/devtasks` mints server
   ids only (`devboard.ts:231`) — an offline-created task cannot be replayed idempotently today (§7).
4. **Transaction semantics:** D1 `transaction()` is a write-only batch; reads inside see pre-batch state
   (`src/db/types.ts:16-38`). The Node adapter uses real BEGIN/COMMIT (`src/db/sqlite.ts:26-41`) — same SQL both sides.
5. **Time format:** all timestamps are `new Date().toISOString()` strings (UTC, millisecond precision);
   sprint dates are day-granularity; timeline bars derive `start_at ?? created_at → end_at ?? done_at ?? today`.
6. **S209 note:** the embedded board's repaint paths (§3) derive pins/sprints client-side from the SAME
   payload fields the server fragment reads — zero new columns, endpoints, or sync surface.

## 5. Verification pointers

- Schema-as-run: `migrations/` — **63 files** (0001-0064, the `0007` gap is original; `0064_user_categories.sql`
  current). Live schema version: 63 (`/api/health`, `health.ts:29-42`).
- Machine-enforced hot-path indexing: `src/tests/index-coverage.test.ts` (Rule 9: pins PK leftmost columns
  per table + `EXPLAIN QUERY PLAN` SEARCH-never-SCAN on the real query shapes, `:55-77`).
- Row types: `src/types.ts` (`ProjectRow:154-175`, `DevTaskRow:222-239`, `SprintRow:241-251`,
  `ScreenshotRow:305-323`, `TagRow:200-207`).
- S208 payload pin: `src/tests/devboard-shots.test.ts` — per-task `shot_count` counts pins, explicit 0
  for none, drops on unpin (`:64-109`).
- S209 parity pin: `src/tests/kanban-parity.test.ts` — the embedded fragment wears `.pd-board.db-frame` +
  the Labels button (`:56-86`), the ◆ sprint badge + `data-pd-sprint` (`:88-113`), and the server-rendered
  pin badge (`:115-136`); e2e companion `e2e/s209-kanban-parity.spec.ts`.
- S209 additions: **none** — the parity round added no schema, no migrations (schema_version stays 63);
  S208 likewise (payload-only; §2.2).

## 6. The SQLite mirror for the Go desktop client [RECOMMENDATION — clearly marked]

> Not implemented anywhere yet — the proposed DDL for the desktop's local cache + offline workspace
> (GO-DESKTOP-PORT-PLAN §4), column names/types copied VERBATIM from the verified §2 shapes. The cloud
> stays the source of truth; fresh installs populate the mirror by pull.

**Feasibility is already proven:** the exact same SQL runs on plain SQLite — the Node self-host is
`src/db/sqlite.ts` (node:sqlite, "Same SQL as the D1 adapter; only the driver differs", `sqlite.ts:6-9`)
and the very `migrations/` files apply to it via `src/db/migrate-node.ts:18-31`; a Go driver
(modernc.org/sqlite / mattn) executes the same DDL.

```sql
-- Cloud-subset mirror (types verbatim from §2.1-2.8) ------------------------------
CREATE TABLE projects (            -- §2.1: 0060:33-52 + 0063:23-24
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','client')),
  status TEXT NOT NULL DEFAULT 'spark' CHECK (status IN
      ('spark','planning','queued','developing','awaiting_dev','operational')),
  sort_order INTEGER NOT NULL DEFAULT 0, latest_note TEXT NOT NULL DEFAULT '',
  progress_percent INTEGER, archived_state TEXT CHECK (archived_state IN ('online','offline')),
  client_name TEXT, due_date TEXT, reminders_enabled INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT, logo_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT, pinned_at TEXT, cover_shot_id TEXT
);
CREATE TABLE dev_tasks (           -- §2.2: 0062:123-138
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','bug','planned','in_progress','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT, sprint_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, done_at TEXT, start_at TEXT, end_at TEXT,
  search_tags TEXT NOT NULL DEFAULT '', updated_at TEXT
);
CREATE TABLE sprints (             -- §2.3: 0029:8-15 + 0039:7 + 0052:14-15
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
  started_at TEXT NOT NULL, ended_at TEXT, created_at TEXT NOT NULL,
  is_draft INTEGER NOT NULL DEFAULT 0, version TEXT, description TEXT
);
CREATE TABLE categories (          -- §2.4: 0064:40-48
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  color_fill TEXT NOT NULL, color_text TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE tags (                -- §2.5: 0003:4-12
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f6d365', usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE (user_id, name)
);
CREATE TABLE dev_task_tags (       -- §2.5: 0029:45-50 — the card-label join
  task_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (task_id, tag_id)
);
CREATE TABLE project_categories (  -- §2.4: 0062:51-55
  project_id TEXT NOT NULL, category_id TEXT NOT NULL, PRIMARY KEY (project_id, category_id)
);
CREATE TABLE project_archives (    -- §2.6: 0046:6-19 + 0051:20
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done', priority TEXT NOT NULL DEFAULT 'medium',
  category_id TEXT, sprint_id TEXT, done_at TEXT, original_created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE screenshots (         -- §2.8 METADATA ONLY — object bytes stay in the store/local files
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, github_path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png', caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0,
  task_id TEXT, bytes INTEGER NOT NULL DEFAULT 0, filename TEXT
);
-- Local-only sync machinery (never pushed) ----------------------------------------
CREATE TABLE outbox (              -- GO-DESKTOP-PORT-PLAN §5: FIFO mutation queue
  seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, entity TEXT NOT NULL, id TEXT NOT NULL,
  payload TEXT NOT NULL, idempotency_key TEXT, created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE TABLE meta (                -- pull cursors, last-etag map, auth token
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
```

**Mapping notes:**
- **Timestamps are TEXT ISO-8601** everywhere (`toISOString()`, §4.5) — compare as strings
  (lexicographic == chronological for this format), exactly like the server's `?since=` delta plan
  (`API-AND-SYNC-CONTRACT.md` §7d).
- **CHECK constraints reproduce verbatim** — they are plain SQLite CHECKs in the source migrations
  (`0060:38-39, 0062:127-128`); keep them so local writes fail loudly instead of drifting.
- **The tags join keys**: `dev_task_tags(task_id, tag_id)` links `dev_tasks.id ↔ tags.id`; card chips
  need `tags.name/color` (the flat `task_tags` payload shape, `devboard-helpers.ts:154-159`).
  `search_tags` is server-maintained denormalization — recompute with the same `group_concat` recipe
  (`devboard-helpers.ts:125-132`) or leave it stale (search-only).
- **`user_id` columns stay verbatim** (constant = the signed-in user; trivial row-level diffing against
  cloud payloads). `project_tags` is optional — project chips are not the board's core loop.
- **FTS5 is available** in plain SQLite (the Node self-host runs the very FTS5 migrations) —
  `projects_fts`/`dev_tasks_fts` + triggers can be mirrored verbatim for local search, or omitted in
  v1 in favor of `LIKE` over title/search_tags.
- **What does NOT get mirrored:** `sessions`, `rate_limits`, `_migrations` (server/Node bookkeeping —
  the desktop keeps its auth token in `meta`); `users` except non-secret profile fields — **never**
  `users.password_hash` (Agents.md rule 8); `password_resets`, `invites`, `error_log`, Telegram/email/
  cron tables. Hurdles/links/backlog mirror with the same recipe when the desktop grows those tabs.
- **Deletion shadow (pre-tombstone):** keep purged task ids in a local grace list for 7 days
  (GO-DESKTOP-PORT-PLAN §5's "disappeared from pull = deleted") — the cloud schema has no dev_tasks
  tombstone to mirror yet (`API-AND-SYNC-CONTRACT.md` §7b).

## 7. Idempotency & identity for offline creates [RECOMMENDATION]

**Verified today:** `dev_tasks` ids are **server-minted** — `POST /api/projects/:id/devtasks` ignores
any client id and mints `crypto.randomUUID()` (`devboard.ts:231`; `src/lib/ids.ts:4-5`). Same for
sprints (`devboard.ts:542`), categories (`devboard.ts:511`), and tags (`devboard.ts:457`,
`devboard-helpers.ts:202`). By contrast `POST /api/projects` accepts a client UUID and replays
idempotently (`index.ts:394-402`: same user + same id → `200 {ok, duplicate:true}`; cross-user →
`409 id_conflict`), and screenshot/link creates accept client ids as canonical (`core.ts:475`,
`schemas.ts:145`) though without the duplicate-replay belt.

**The M0 addition (banked, not implemented):** `createDevTaskSchema` gains `id: z.string().uuid().optional()`
and the route becomes `const id = body.id ?? uuid()` with the projects-style pre-check — same user +
same id → `200 {ok:true, duplicate:true, id, tags:[…]}`; cross-user collision → `409 id_conflict`.
This mirrors `index.ts:394-402` verbatim; full contract: `API-AND-SYNC-CONTRACT.md` §7c. Additive and
web-client-transparent (the web client never sends it — every board mutation ends in a reload).

**What the desktop must do meanwhile (pre-M0):**
- **Pre-minting is type-compatible but not wire-compatible.** Agents.md rule 2 (`Agents.md:58-59`):
  "IDs are UUIDs. Client-generated for offline-creatable things (Canvas, Spark quick-add) — server
  accepts as canonical; server-generated otherwise." Dev tasks are in the server-generated class today —
  a client-minted UUID is silently discarded (`devboard.ts:231` calls `uuid()` unconditionally) and the
  row lands under a DIFFERENT id. Treat the local id as temporary.
- **The reconciliation loop:** create offline with a local UUID v4 → queue in `outbox` → on drain POST →
  capture the server's `201 {id}` → rewrite the local row + `dev_task_tags` joins to the server id.
  **A retried create duplicates** (no replay belt) — drain must be at-most-once per entry: mark done on
  first 2xx; on an UNKNOWN outcome (timeout after the write may have landed), hold the entry and re-pull
  the board (title+status match) before re-sending. That is exactly the friction M0 removes.
- **Don't pre-mint into cloud-shaped columns early:** the mirror's `dev_tasks.id` may hold the local id
  only while unsynced; after drain it MUST be the server id (else later PATCH/DELETE by id misses — the
  API addresses tasks by canonical id, `devboard.ts:261, 317`).
- Until M0 ships, **offline task creation is the one degraded flow**; every other offline-creatable
  entity here already has a client-id path (projects, links, screenshots) or a server-only one the
  desktop can defer (sprints/categories/tags: create online, reference offline).
