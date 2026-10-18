# Hibana Project/Kanban — Data Model

> **Scope:** the authoritative persisted schema behind the project + Kanban experience
> (projects, dev tasks, sprints, categories, tags, archives, hurdles, links, screenshots),
> verified against the repository tree at **v0.4.1.28 / S205**. Frontend-only shapes are
> marked as such. Every claim carries a source reference. Nothing here is invented —
> where a field is unused or dead, that is stated.
>
> Companion documents: `FEATURE-INVENTORY.md` (what users can do), `API-AND-SYNC-CONTRACT.md`
> (how clients read/write this data), `USER-FLOWS.md`, `GO-DESKTOP-PORT-PLAN.md`, `TEST-MATRIX.md`.

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

Created in `migrations/0002_projects_history.sql:5`, rebuilt in `0031` and `0060_project_status_rename.sql:33`,
final ALTERs in `0063:23-24`. TypeScript row type: `src/types.ts:154-175` (`ProjectRow`); canonical status
order `STATUS_ORDER` at `src/types.ts:150`.

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,                          -- UUID; server-minted (crypto.randomUUID) OR client-supplied on create
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
  reminders_enabled INTEGER NOT NULL DEFAULT 0, -- 0006:4
  folder_id TEXT,                               -- 0037:17 spark folder (FK dropped by 0060 rebuild; app-enforced)
  logo_path TEXT,                               -- 0047:3 GitHub-stored logo path
  created_at TEXT NOT NULL,                     -- ISO 8601 (UTC, JS Date.toISOString)
  updated_at TEXT NOT NULL,                     -- bumped by nearly every child mutation (see §4)
  deleted_at TEXT                               -- soft delete; 7-day purge cron hard-deletes after that
);
-- 0063:23-24: ALTER TABLE projects ADD COLUMN pinned_at TEXT; ADD COLUMN cover_shot_id TEXT;
-- Indexes (recreated at each rebuild): user_id, (user_id,status), (user_id,updated_at),
--   deleted_at, idx_projects_folder (0063:29)
```

**Lifecycle semantics (all server-enforced):**
- **Soft delete**: `DELETE /api/projects/:id` sets `deleted_at` — `src/routes/projects/index.ts:716`.
  Hard delete **only** for `status='spark'` + `?force=1` (purges screenshot bytes first, `index.ts:727-733`).
  A daily cron (`scheduledPurge`, `src/routes/admin.ts:692-725`) hard-deletes rows after 7 days, and also
  purges expired sessions, stale rate-limit rows, and old error_log rows.
- **Archive/park**: `archived_state='offline'` (`POST /api/projects/:id/archive`, `index.ts:783`);
  restore via `unarchive` (`index.ts:801`). Distinct from delete.
- **Revive**: `awaiting_dev` project → one of 4 active statuses (`index.ts:757`).
- **Ownership**: single-owner, no membership/sharing. Every access goes through
  `getOwnedProject` (`src/lib/html.ts:170-176`: `WHERE id AND user_id AND deleted_at IS NULL`).
  `users.role` (`owner|member`, `0001:10`) is an install-level admin-console role, not a project role.

### 2.2 `dev_tasks` — the Kanban cards

Created `migrations/0029_devboard_sprints.sql:28-39`; `bug` status added by the 0034 rebuild;
`category_id` re-pointed to the global `categories` table by the 0062 rebuild (`0062:123-138`).

```sql
CREATE TABLE dev_tasks (
  id TEXT PRIMARY KEY,                          -- UUID; ALWAYS server-minted (devboard.ts:217) — no client ids
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                          -- ≤100k chars: free text = the card's whole body (title + '\n' + content)
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN
      ('idea','bug','planned','in_progress','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,   -- 0062
  sprint_id TEXT REFERENCES sprints(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,        -- manual drag order within the project (reorder rewrites 0..n)
  created_at TEXT NOT NULL,                     -- timeline bar start
  done_at TEXT,                                 -- stamped entering 'done', cleared leaving it (devboard.ts:273-282)
  start_at TEXT,                                -- 0030:6 explicit timeline start (nullable)
  end_at TEXT,                                  -- 0030:7 explicit timeline end (nullable)
  search_tags TEXT NOT NULL DEFAULT '',         -- 0051:22 denormalized tag names for FTS (app-maintained)
  updated_at TEXT                               -- 0061:13 stamped on create + PATCH (NOT on tag changes — see §4)
);
-- Indexes: idx_dev_tasks_project (0029), _sprint (0029), _status (0042:11),
--   _updated (0061:21), category (0062:150)
```

**There are no per-task fields for:** due dates (dates exist on `projects` and to-do tasks only),
assignees (single-user product), checklists (title text may contain markdown `- [ ]` lists —
rendered, not structured data), attachments-in-row (screenshots pin via their own `task_id`),
comments (none exist anywhere for tasks), dependencies, custom fields, recurring rules.
These absences are **by design** — the desktop port must reproduce exactly this shape, not "fix" it.

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
  is_draft INTEGER NOT NULL DEFAULT 0,          -- exactly one draft per project (409 draft_exists)
  version TEXT,                                 -- 0052
  description TEXT                              -- 0052: the sprint doc (markdown, autosaved)
);
CREATE INDEX idx_sprints_project ON sprints(project_id);
```

Server-enforced invariants (`src/routes/devboard.ts:521-718`): one open sprint per project at a
time; day-granularity non-overlap; latest-sprint-only reopen; draft→started transition closes the
previous open sprint at day-before. A task's `sprint_id` is cleared (`SET NULL`) when the sprint is deleted.

### 2.4 `categories` + `project_categories` (task categories)

`migrations/0062_global_task_categories.sql:39-56`; categories rebuilt user-scoped by `0064:40-48`.

```sql
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color_fill TEXT NOT NULL,                     -- curated fill+ink PAIR (16 pairs, CSS --cat-sw-* tokens)
  color_text TEXT NOT NULL,
  is_archived INTEGER NOT NULL DEFAULT 0,       -- soft archive (delete = archive)
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_categories_user_name_live ON categories(user_id, lower(trim(name))) WHERE is_archived = 0;  -- 0064:124

CREATE TABLE project_categories (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, category_id)         -- per-project ENABLEMENT (replace-set via PUT)
);
```

Legacy `task_categories` (0029:18-26) still exists as a table but is dead — folded into `categories` by 0062.

### 2.5 `tags` / `project_tags` / `dev_task_tags` (labels)

`migrations/0003_tags_hurdles_links.sql:4-20` + `0029:45-50`.

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#f6d365',
  usage_count INTEGER NOT NULL DEFAULT 0,       -- app-maintained count of dev-task links
  created_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);
CREATE TABLE project_tags   (project_id …, tag_id …, PRIMARY KEY (project_id, tag_id));   -- project chips
CREATE TABLE dev_task_tags  (task_id … REFERENCES dev_tasks(id) ON DELETE CASCADE,
                             tag_id  … REFERENCES tags(id)       ON DELETE CASCADE,
                             PRIMARY KEY (task_id, tag_id));                                -- card labels
```

`tags.usage_count` is recomputed by the app after every link/unlink/merge/delete
(`src/routes/devboard.ts` usage recount helpers). Renaming a tag to an existing name **merges**
(`PATCH /api/tags/:id`, `src/routes/tags.ts:83`). `search_tags` on `dev_tasks` is rewritten in
batch after merges/deletes (`tags.ts:113,147`).

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
  tags TEXT NOT NULL DEFAULT '[]'               -- JSON snapshot of label names at archive time
);
```

This is the **only soft-landing for deleted work** in the Kanban domain: `POST …/devtasks/archive-done`
moves done tasks here (labels snapshotted, dev_tasks rows deleted); restore re-inserts into `dev_tasks`
with the same id and relinks labels (`devboard.ts:392`). Direct `DELETE /api/devtasks/:id` is a **hard
delete with no tombstone** (`devboard.ts:303`).

### 2.7 `hurdles`, `links` (project page siblings)

`migrations/0003:23-41` (+ `idx_hurdles_status` 0042:9). Hurdles = "where I'm stuck" notes
(`status open|solved`, `solved_at` stamped/cleared); links = labeled URLs. Both scoped through the
owning project, both hard-delete.

### 2.8 `screenshots` (attachments/media)

`migrations/0004:4-12` + ALTERs `0053:6` (resolved), `0054:12-14` (task_id, bytes), `0059` (filename).

```sql
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  github_path TEXT NOT NULL,                    -- storage key (kv→r2→github chain, services/shotstore.ts)
  mime_type TEXT NOT NULL DEFAULT 'image/png',  -- 11 allowlisted types incl. PDF/CSV/XLSX/DOCX/MD/TXT/WebM
  caption TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,          -- "resolved" flag (problem-media semantics)
  task_id TEXT REFERENCES dev_tasks(id) ON DELETE SET NULL,  -- pin to a card (same-project only)
  bytes INTEGER NOT NULL DEFAULT 0,             -- exact byte count (enforced == buffer length)
  filename TEXT                                 -- original upload name (downloads)
);
```

Deleting a screenshot also clears any `projects.cover_shot_id` referencing it (`src/routes/core.ts:640`).
Object bytes: KV-first chain with `.thumb` variants (`src/services/shotstore.ts`); project **logos**
are GitHub-Contents-only (`PUT /api/projects/:id/logo`, `index.ts:857`).

### 2.9 `project_history_log` (activity feed)

`migrations/0002:28-34`: `(id, project_id REFERENCES projects ON DELETE CASCADE, note TEXT, created_at)` +
`idx_history_project`. Written by project PATCH (status change + latest-note change, `index.ts:700-711`),
devtask create/done/archive/restore/delete, backlog ops, tag ops, sprint ops. Read: the project page's
"Latest Activity" tab (server-rendered, `detail-helpers.ts:546`; detail JSON caps at 20 rows).

### 2.10 Full-text indexes (FTS5, external-content, trigger-maintained)

- `projects_fts` (`0004:27`) — title/description/note; search phrases quoted `'"…"'`
- `dev_tasks_fts` (`0051:30-33`) — title + `search_tags`; tags column app-maintained
- Also `quick_notes`/`backlog_docs`/`sadhana_tasks`/`canvas_elements` FTS (`0040`) — adjacent domains
- `project_progress_log` (0050) was created then **dropped** in 0051:18; `progress_percent` is dead.

### 2.11 Identity & infra tables (adjacent)

- `users` / `sessions` / `invites` — `0001:5-35`. Sessions store **SHA-256 hex of the cookie token** as
  `sessions.id` (`src/auth/sessions.ts:35-45`); 30-day rolling expiry. Invites are registration codes,
  NOT project membership.
- `rate_limits` — `0014:7-13` (fixed 60s windows, keyed `name:ip`).
- `_migrations(name, applied_at)` — Node-side bookkeeping (`src/db/migrate-node.ts:18-31`); D1 applies via
  `scripts/d1-migrate.mjs`. Current schema version surfaced by `/api/health` as `schema_version` (63 at S204).
- `spark_folders` — `0037:8-15` + icon (0056) + pastel/banner columns (0063) — the Ideas columns, adjacent.
- `backlog_docs` + `backlog_doc_revisions` — `0033:7-26` — per-project plan documents with revision history.
- `canvas_elements` — `0005:6-25` (rebuilt 0011/0023/0032/0036) — the ONLY entity with true LWW sync
  (`updated_at` comparison server-side + integer `deleted` tombstones, `core.ts:702-751`).

## 3. Frontend state shape (NOT persisted)

`window.HibanaBoard.state` (`public/js/devboard.js:110`) mirrors `GET /api/projects/:id/devboard`:
`{ projectId, project, tasks[], categories[], sprints[], tags[] }` — tasks carry `tags: [tagId…]`.
The two rendering surfaces (project.html server-fragments vs board.html client render) read the same
payload. Filter/search state, collapsed columns (`hibana-pd-cols-collapsed`), last-used board
(`hibana-kanban-last`, S205), and recent projects (`hibana-recent-projects`) are localStorage-only —
see `FEATURE-INVENTORY.md` §9.

## 4. Sync-relevant semantics (the desktop-port lenses)

1. **`updated_at` coverage is uneven.** `projects.updated_at` is bumped by nearly every child mutation
   (devtask create/patch, tag/link/screenshot/hurdle/backlog ops) — a usable coarse sync key for projects.
   `dev_tasks.updated_at` exists (0061) but is stamped **only on create + PATCH** — tag add/remove
   (`setTaskTags`) does NOT bump it. No `updated_at` at all on: hurdles, links, screenshots, sprints,
   tags, categories. **There are no revision/version counters anywhere in the domain.**
2. **Deletion propagation:** `projects` has `deleted_at` (7-day tombstone window). `dev_tasks` are
   hard-deleted (the only trace is the archive path or a history log row). `canvas_elements` is the
   only LWW-tombstoned table. A second client cannot today observe task deletions — see
   `API-AND-SYNC-CONTRACT.md` §7 for the compatibility plan.
3. **Idempotency:** `POST /api/projects` accepts client UUIDs and returns 200 `duplicate:true` on replay
   (`index.ts:395-402`). `POST /api/projects/:id/devtasks` mints server ids only — an offline-created
   task cannot be replayed idempotently today.
4. **Transaction semantics:** D1 `transaction()` is a write-only batch; reads inside see pre-batch state
   (`src/db/types.ts:16-37`). The Node adapter uses real BEGIN/COMMIT. Same SQL runs on both.
5. **Time format:** all timestamps are `new Date().toISOString()` strings (UTC, millisecond precision);
   sprint dates are day-granularity; timeline bars derive `start_at ?? created_at → end_at ?? done_at ?? today`.

## 5. Verification pointers

- Schema-as-run: `migrations/` (63+ files, applied in order; `0064_user_categories.sql` current).
- Machine-enforced hot-path indexing: `src/tests/index-coverage.test.ts` (Rule 9: user_id/project_id
  lookups never degrade to table scans — pins the PK leftmost columns).
- Row types: `src/types.ts` (ProjectRow:154, DevTaskRow, SprintRow…).
- S205 additions: none — the entry-point round added **no schema, no migrations** (schema_version stays 63).
