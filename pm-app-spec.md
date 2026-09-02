# Personal Project & Idea Manager — Specification & Action Plan

*A personalized system to replace whiteboards, Obsidian, and Notion for tracking ideas and active projects — built around how Ali actually works, not a generic PM template.*

---

## 0. What This Project Is

**For any agent encountering this project fresh:** this is a personal project- and idea-management web app being built for Ali, a solo UI/UX designer and self-described "vibe coder" who runs an e-commerce business (Sedanama) and builds his own internal tools. He works 12-16 hour days across several self-directed projects at once, doesn't plan rigidly, and relies entirely on AI agents to write and maintain code — he doesn't read or patch it himself. That last fact shapes almost every decision in this spec: things need to be verifiably correct without him inspecting the implementation, hence the emphasis on tests (§11), a compact rules file for future agent sessions (`CLAUDE.md`), and "done when" criteria written in terms of observable behavior, not code.

The app exists to do two things he couldn't get from Obsidian, Notion, or a physical whiteboard: capture every idea before it's lost, and always show him exactly where he left off on whatever he's building. Everything else in this document — the Canvas, the status pipeline, the client-work module — exists in service of those two jobs. If a proposed feature doesn't serve one of them, it doesn't belong here without a specific reason.

This document is the full spec. `CLAUDE.md` at the repo root is the compact, load-bearing subset for coding agents who won't read this whole file. `vision.md` is Ali's own words and reasoning, largely unfiltered — read it for *why*, read this document for *what* and *how*.

---

## 1. Vision

Two jobs, and only two:

1. **Never lose an idea.** Every spark that hits — in the shower, mid-project, before sleep — gets captured in seconds and is safe forever.
2. **Never lose your place.** Every active project always tells you, at a glance: where it's at, what's left, and what's actively blocking it.

Everything else in this spec exists to serve those two jobs. No deadlines, no nagging, no forced structure on the personal side. The client-work side is a deliberately separate world with its own rules (deadlines, billing, reminders).

---

## 2. Core Concept: One Record, One Pipeline

An "Idea" and a "Project" are **the same database record** — a project doesn't get recreated when it graduates, it just moves through a status pipeline in place, so its full history survives the transition.

```
Spark  →  Pending  →  Building  →  Working  →  Archived / Obsolete
(raw     (vetted,     (actively     (MVP/system   (parked — done,
 idea)    decided      in           is ready,      obsolete, or
          to do        development)  works         set aside)
          later)                     as-is)
```

- **Spark**: just a name, a one-line description, an optional tag, and — since you specifically asked for this — an optional screenshot/sketch. Zero friction otherwise; this is the whiteboard replacement, and a rough sketch attached to a raw idea is part of that, not a "rich field" gated behind Building.
- **Pending**: same lightweight fields, plus it's been consciously vetted ("yes, I'll build this"). Still lightweight.
- **Building**: actively/currently in development — the rich fields unlock here (where-I-left-off, hurdles checklist, changelog, links, screenshots). Entered via an explicit manual "start building" action from Pending, not automatically.
- **Working**: the MVP or system is ready and functions as-is, per your own definition — still carries all the rich fields, just past the "still being built" phase.
- **Archived/Obsolete**: frozen. Lives in a separate archive view with a live/offline status indicator.

**Status changes are fully manual and flexible** — any status can move to any other status at any time (e.g. Working back to Building if more work surfaces). There's no forced linear progression except that Building's rich fields, once filled in, stay attached even if a project moves back to Pending.

**Reviving** an archived project doesn't assume Building or Working — it asks each time which one fits.

Tags stay optional at every stage, including Building/Working — never a required field, always easy to add more (§4.4).

Personal projects and client projects share this same pipeline and record shape — they're distinguished by a single `type` field, which is what drives the separate dashboards in Section 5.

---

## 3. The Canvas — Boundless Brain-Dump Space

Your own words: *"a full blackboard boundless notebook... instead of paper on my desk, just a brain dump... write or draw anywhere on it... full canvas with auto save capability realtime."*

This is deliberately separate from the Sparks/Projects list — literal digital paper, not a form. Nothing needs a name or a category here; it's where a thought lands before it's even a Spark. Given how central this is to "never lose an idea," it's pulled forward to Phase 2 of the build (§12) — right after the core app exists, well before any polish work.

### 3.1 What it is
- One continuous, boundless canvas — pannable and zoomable, not a fixed page, with **no cap** — never auto-trimmed
- Freehand drawing/writing anywhere on it (pen tool, ink strokes) — **desktop only**; drawing on a touchscreen without a stylus is unreliable enough that it's not worth building for v1
- On mobile: pan/zoom + add, move, and edit draggable colored sticky notes — no pen tool
- Sticky notes come from a **fixed palette of conventional sticky-note colors** (yellow, pink, green, blue, etc.) — not a full color picker
- Text and drawing only — no dropping screenshots/images onto the Canvas; images stay on the Project Detail page (§5.4)
- Real-time autosave — no save button, ever
- Later, optional: select a note or region and **"Promote to Spark"** to turn a doodle into a tracked project record (§4.1). The original note **stays on the Canvas, visually marked "promoted"** — nothing disappears or duplicates silently.

### 3.2 Data model
See `canvas_elements` in §4.11 — client-generated UUIDs so offline-created notes and strokes are addressable before they ever reach the server (§4.0).

### 3.3 Realtime autosave
Every discrete action — a stroke finished, a note added, moved, or edited — fires an AJAX save immediately, debounced during continuous motion (like dragging) so it writes once you pause rather than on every pixel of movement. There is never a manual save step.

### 3.4 Offline-first capture
Your words: *"if connectivity was lost but canvas was on, catch up and save on the database as soon as net is available."* Every change writes first to a local IndexedDB queue — this works with zero connectivity — and is simultaneously attempted against the server. If that attempt fails, it stays queued; a listener on the browser's "online" event, plus a periodic retry, flushes the queue the moment a connection returns. A small **"N unsynced changes" badge** stays visible whenever the queue isn't empty, so you know not to clear browser data or switch devices mid-queue. Shared with the Sparks quick-add modal (§5.5) — same promise, same mechanism.

### 3.5 Recommended build approach
Rather than build canvas rendering from scratch, use **Fabric.js** — a mature, vanilla-JS canvas library (no React needed, stays consistent with the htmx/Alpine stack chosen in §8) with built-in freehand drawing mode, movable/resizable objects, and a JSON serialization format that maps directly onto `canvas_elements`. Boundless panning/zooming is implemented via Fabric's viewport transform. On mobile, the drawing tool is simply not offered — pan/zoom and note-dragging use standard touch gestures with no draw-mode conflict to resolve.

**One scaling detail worth deciding now rather than after years of use:** since the Canvas is explicitly unlimited and never auto-trimmed (§3.1), it shouldn't load every element that's ever been drawn on it every time you open it — that gets slower every year, by design, if built naively. Load only the elements near the current viewport, and fetch more as you pan out to unexplored areas (a bounding-box query against `canvas_elements.x/y`, §4.11). Cheap to build in from the start, awkward to retrofit once "load everything" is the established pattern.

---

## 4.0 Foundational Rules — read before building anything

These aren't features, they're constraints every table and every phase has to respect, because retrofitting them later is expensive:

- **Every user-owned table carries a `user_id`.** `projects`, `tags`, `canvas_elements`, and `telegram_captures` (matched via `telegram_chat_id` at ingestion) all get a `user_id` foreign key, enforced in every single query — no query reads or writes across a `projects`/`tags`/`canvas_elements`/`telegram_captures` row without filtering by the requesting user's id. Child tables scoped through a project (`hurdles`, `links`, `screenshots`, `changelogs`, `tasks`, `payments`, `project_history_log`) don't need their own `user_id` — they inherit isolation by joining through `project_id`. This is what actually makes §13's "fully separate private vaults" true, rather than just stated policy.
- **IDs are UUIDs generated by whichever side creates the record.** For anything created offline — a Canvas note/stroke, a Spark from the quick-add modal — the **client** generates the UUID before the network call even fires, so the item is fully addressable and editable with zero connectivity. The server accepts the client-supplied ID as canonical on sync rather than reissuing one. Server-created records (via the Telegram bot, for instance) get a server-generated UUID the same way.
- **All timestamps are stored in UTC.** Conversion to Shamsi or Gregorian, and to the user's timezone, happens only in the display layer (§14) — never in storage. Getting this backwards now means a data migration later.
- **Schema changes go through versioned migrations from day one** — Wrangler's built-in `wrangler d1 migrations` tooling, numbered SQL files checked into the repo, applied the same way in dev and production. No ad-hoc `ALTER TABLE` run by hand against the live database.
- **Separate dev and production D1 databases**, configured as named environments in `wrangler.toml`. Every phase gets built and tested against dev first; production is only touched by a deliberate deploy. Given you can't independently debug a bad migration, this is what keeps a mistake from touching your real data at all.
- **Index `user_id`, `status`, and `project_id` columns from the start.** Every list/filter/Kanban view filters by these; adding the indexes now costs nothing, and query performance staying snappy as years of data accumulate depends on it being there from the first migration, not bolted on once a table's already large.
- **Every credential is a Workers secret, no exceptions** — GitHub token (§8), Brevo API key, Telegram bot token, session-signing key. One rule stated once, not re-derived per integration as each one gets built.
- **API input gets validated at the edge, once, consistently** — Hono pairs naturally with a schema-validation library (e.g. Zod) so every endpoint rejects malformed input the same way, rather than each feature built in a separate phase inventing its own ad-hoc checks.

---

### A note for future coding sessions
This spec is long, and any coding agent starting a fresh session on this project won't have read it. The rules above are compact enough to belong in a **`CLAUDE.md` file at the repo root** — Claude Code reads it automatically at the start of every session, so these constraints get followed even in a session that's never seen this document. Worth creating as the very first file in Phase 0, before any table exists.

---

## 4. Data Model

### 4.1 `projects` (core table)

| Field | Type | Notes |
|---|---|---|
| id | uuid | client-generated if created offline, server-generated otherwise (§4.0) |
| user_id | uuid | owner — every query filters on this (§4.0) |
| title | text | |
| description | text | short, one-liner |
| type | enum | `personal` \| `client` |
| status | enum | `spark` \| `pending` \| `building` \| `working` \| `archived` |
| sort_order | int | manual drag-reorder position within its status group |
| latest_note | text | pinned "where I left off" — always shows the newest |
| progress_percent | int, nullable | manual override; if null, computed from hurdles (personal) or tasks (client) — see §6.1 |
| archived_state | enum, nullable | `online` \| `offline` — only set once archived |
| client_name | text, nullable | client-type only — simple text field, not a linked record (§4.15) |
| due_date | date, nullable | client-type only |
| created_at / updated_at | timestamp | |

### 4.2 `project_history_log`
Timestamped entries — the running "where I left off" log beneath the pinned latest note. `id, project_id, note, created_at`.

### 4.3 `hurdles`
The problems/blockers checklist. `id, project_id, text, status (open|solved), sort_order, created_at, solved_at`. Solved items render struck-through and muted; open items are manually drag-reorderable so the top of the list is always "what to tackle next." Drives the progress bar on personal projects.

### 4.4 `tags` + `project_tags`
Freeform tags with a global `tags` table — **scoped per `user_id`** (§4.0), so tag suggestions never leak across accounts — tracking usage count so the app can suggest previously-used tags, and a `project_tags` join table. Doubles as the "category" concept (Lifestyle, Productivity, AI, WordPress, Writing, Business, etc.) — one field, not two. Always optional, never required at any stage; your words were *"the more the better"* — the UI keeps a persistent lightweight "+ tag" affordance on the project header, not buried in a menu, since new tags tend to surface as you think about a project more, not just at creation.

### 4.5 `links`
Multiple named links per project. `id, project_id, label (e.g. "Repo", "Live Site", "Docs"), url`.

### 4.6 `screenshots`
`id, project_id, github_path, mime_type, caption, created_at`. File bytes live in the GitHub assets repo (§8); this row just points to them. Supports both drag-drop/paste and file-picker upload.

### 4.7 `changelogs`
`id, project_id, github_path, filename, content_text, uploaded_at`. The canonical file lives in the assets repo (§8) for viewing/download; `content_text` is a plain-text mirror kept in D1 purely so FTS5 search (§5.3) can index it. Stored raw, not summarized — you use changelogs to hand context to agentic coders, not to read yourself, so the point is fidelity for the next AI session, not brevity for you. UI always shows the latest version only — older versions stay recoverable through GitHub's own file history if you ever need them, no separate version-history UI in v1.

### 4.8 `tasks` — client-work only
Due-dated to-dos driving client task-time progress (§6.1). `id, project_id, title, done (bool), due_date, created_at, completed_at`. The personal side doesn't need a separate to-do list beyond the `hurdles` checklist and the Canvas.

### 4.9 `payments` — client-type only
Milestone/partial-payment tracking. `id, project_id, label (e.g. "Deposit", "Final payment"), amount, currency, status (pending|paid), paid_at`.

### 4.10 `telegram_captures`
The bot's inbox. `id, user_id (matched from telegram_chat_id at ingestion, §4.0), raw_text, telegram_user_id, received_at, promoted (bool)`. Unpromoted entries show a "New" badge in the Sparks shelf until reviewed. The bot's own reply echoes the captured text back plus a direct link to open it in the app — more useful confirmation than a bare checkmark.

### 4.11 `canvas_elements`
`id (client-generated, §4.0), user_id, type (note|stroke), x, y, width, height (nullable for strokes), color, content (text for notes; point-path JSON for strokes), promoted_project_id (nullable, FK to projects), z_index, created_at, updated_at`. One boundless canvas per account — a general thinking surface, not tied to any single project until you deliberately promote something out of it.

### 4.12 `users`
`id, email, password_hash, role (owner|member), telegram_chat_id (nullable), language_pref (en|fa), calendar_pref (gregorian|shamsi), timezone, created_at`. Single owner account to start; `role` and invite-only registration mean this can open to others later without a schema change — each additional user gets a **fully separate, private vault**, never a shared workspace. `telegram_chat_id` links an account to Telegram once the bot exists, enabling it as a secondary password-reset path. `language_pref`/`calendar_pref`/`timezone` drive the UI personalization in §14.

### 4.13 `sessions`
Workers is stateless, so a logged-in session has to live somewhere. `id (random token), user_id, created_at, expires_at`. The session token goes in the httpOnly cookie referenced in §8; each request looks it up here.

### 4.14 `invites`
Backs the invite-only registration flow. `id, code, created_by (user_id), created_at, used_at, used_by (nullable)`. You generate a one-time code from Settings; it's consumed on first use.

### 4.15 Delete vs. archive
Hard delete is allowed for **Sparks and Pending only** — enough to clear out junk captures (e.g. an accidental Telegram message) before real work has gone into them. Once a project reaches **Building or later, it can only be archived, never deleted** — that's where the "safe for my ideas" guarantee actually kicks in.

---

## 5. Screens

### 5.1 Dashboard (default landing)
- Stat strip: counts by status (Sparks / Pending / Building / Working / **Archived**), hurdles/tasks completed this week
- Recent Activity feed: the **last 5-10 touched projects, regardless of how long ago** (not a fixed date window) — status badge + latest-note snippet + relative time
- Sparks shelf preview (most recent few, "view all →")
- Prominent **Open Canvas** entry point (nav item + floating action), alongside the quick-add Spark button

### 5.2 Canvas
See §3. Full-bleed, boundless, autosaving, offline-safe, with the unsynced-changes badge (§3.4) visible whenever relevant.

### 5.3 Project List — four interchangeable views
- **Cards** — pastel tag-accent color, status badge, thumbnail if a screenshot exists
- **List** — compact, sortable rows (title / status / tags / last updated)
- **Sticky Notes** — a corkboard-style grid of colored notes (title + one-liner only) for browsing your *structured* records — distinct from the freeform Canvas, but a lighter echo of the same aesthetic
- **Kanban** — columns = Spark / Pending / Building / Working / Archived, drag-and-drop between columns to change status, AJAX (no reload)
- Within any status group, projects are in **manual drag-reorder** order (`sort_order`), not auto-sorted by recency
- Creating a project with a title close to an existing one shows a **soft warning**, not a hard block — easy to ignore if it's genuinely a new idea
- Shared filter bar: tag, status, search — all refresh-less, backed by SQLite FTS5 (D1's built-in full-text search, confirmed supported), **exact-match** rather than fuzzy. Needs SQL triggers keeping the FTS index in sync on insert/update/delete of the source tables.

### 5.4 Project Detail
- Header: title (inline-editable), status dropdown, tag chips (first tag doubles as the category chip)
- Pinned "where I left off" note (large, editable) + collapsible dated history log
- Hurdles checklist (add inline, drag-reorder, strike-through on solve) — drives progress on personal projects
- Progress bar (auto from hurdles or tasks depending on type, manual override toggle)
- Changelog panel — upload/replace, view raw, download
- Links list — add/edit multiple named links
- Screenshot gallery — drag-drop/paste or file picker, lightbox view

### 5.5 Sparks / Ideas Shelf
- Minimal-card grid: name, one-liner, tag, optional screenshot/sketch thumbnail, "Promote to Project" button, delete option (Sparks/Pending only, §4.15)
- Quick-add modal (name + description + tag + optional screenshot) — same modal used by the floating +, by reviewing Telegram captures, and by "Promote to Spark" from the Canvas
- Same offline queue and unsynced-changes badge as the Canvas (§3.4)
- Telegram-sourced sparks carry a "New" badge until reviewed

### 5.6 Archive
- Card or List view, filtered to Archived/Obsolete, with the online/offline indicator per project
- "Revive" prompts each time: restore to Building or Working?

### 5.7 Reports
- Snapshot chart: project/idea counts by status
- Activity-over-time chart: hurdles/tasks completed, viewable by day/week/month/year — you specifically asked for all four granularities, not just week/month
- One screen, filterable by personal vs. client and date range

### 5.8 Settings
- Theme: light / dark / follow-system, with selectable dark variants (slate grey, navy, etc.)
- Language: English / Farsi toggle (§14)
- Calendar: Gregorian / Shamsi toggle (§14)
- Timezone: set once, applied to all dates/timestamps
- Tag management (rename/merge/delete)
- Account (email, password change, linked Telegram)
- Invite management — generate one-time invite codes (§4.14)
- Integrations panel (Telegram bot linking code, GitHub, Obsidian import tool)
- **Export everything** — one-click JSON/Markdown download of all data

### 5.9 Client Dashboard (separate top-level section from personal)
Same visual language, different data: client name, due date, task-time progress (§6.1), payment milestones, opt-in reminder toggle per project.

---

## 6. Client-Work Module

Deliberately a separate section, not a filter on the personal list.

### 6.1 Task-time progress
Progress = tasks completed ÷ tasks total, evaluated against the due-date window. Your example: 10 tasks due in 2 days, 5 done on day one = 50% progress. Uses the client-only `tasks` table (§4.8).

### 6.2 Billing/payments
Each client project can carry multiple `payments` rows — e.g. "Deposit: paid," "Final payment: pending" — rather than a single paid/unpaid flag, so partial-payment contracts are representable.

### 6.3 Reminders
Client projects can opt in to deadline reminders (personal projects never get them). **Trigger logic is progress-based, not just date-based**: a reminder fires when actual task-time progress (§6.1) falls behind the expected pace given the due date — e.g. if you're 30% done with only 20% of the time window left, that's a trigger; being on pace never nags you regardless of how close the date is. Delivered by email initially (same provider as password reset, §8); Telegram becomes an additional channel once Phase 5's bot exists.

---

## 7. Visual Design System

- Minimal, generous white space, rounded corners throughout
- Pastel palette for tag/category accents; status conveyed via a small badge, not the whole card color
- Light / dark / system-follow, with 2-3 selectable dark variants (e.g., slate grey, navy)
- The Canvas (§3) uses a more playful palette with conventional sticky-note colors; the Sticky-Notes list view (§5.3) echoes that same feel at a lighter touch for browsing structured records
- RTL layout (§14) mirrors the whole interface, not just text direction — nav, cards, and icons flip logically when Farsi is active

**Three small conventions worth fixing once rather than reinventing per feature:**
- **Errors and confirmations use one consistent toast/banner component**, everywhere — not a different pattern per screen built in a different phase.
- **Destructive actions (hard delete, §4.15) use an undo-toast, not a blocking confirm dialog** — "Deleted. Undo?" for a few seconds fits the low-friction philosophy behind this whole app better than a modal asking "are you sure?"
- **Every list/board screen needs a defined empty state** (a brand-new Dashboard with zero projects, an empty Canvas) and a loading state for AJAX calls — small, but worth designing once rather than discovering blank-white-screen moments during Phase 0/1 testing.

---

## 8. Tech Stack & Hosting

Everything below runs on **free tiers only**, and nothing requires a credit card — confirmed current limits:

| Service | Free tier | Fits your scale? |
|---|---|---|
| Cloudflare Pages | 500 builds/month, unlimited static requests | Yes |
| Cloudflare Workers | 100,000 requests/day | Yes — trivial for a personal-scale API + Telegram webhook |
| Cloudflare D1 | 500 MB per database / 5 GB per account, 5M reads+writes per month | Yes — structured records only, kept small on purpose (§3, file storage below) |

**File storage:** a private **GitHub repo** (e.g. `pm-app-assets`) holds screenshots and changelog files via the GitHub API; D1 keeps only the path. Reason: Cloudflare R2 would otherwise be the natural choice, but it requires a card on file to activate even on its free tier, and D1 itself hard-caps rows at 2MB — too risky for image uploads. GitHub sidesteps both problems, needs no card, and comes with version history for free. As with backups (§10), Dropbox or Google Drive is an acceptable fallback here too if the GitHub Contents API integration proves more troublesome than expected — not a parallel system, just the same fallback logic applied consistently. **Two implementation details worth getting right the first time:** uploads work fine up to 100MB via the standard Contents API, but *retrieving* a file back over 1MB requires requesting it with the `application/vnd.github.v3.raw` Accept header — without it, larger screenshots come back empty rather than erroring loudly. And the GitHub API token the Worker uses to write files must be stored as a Cloudflare Workers **secret** (`wrangler secret put`), never hardcoded.

**Frontend:** Static HTML served from Pages, using **htmx** (for refresh-less AJAX page updates) paired with **Alpine.js** (small client-side interactions: modals, drag state, toggles) and **Fabric.js** for the Canvas (§3.5). No build step, no heavy framework. RTL/LTR (§14) is handled with CSS logical properties rather than duplicated stylesheets.

**Backend:** Cloudflare Workers, routed with **Hono** (a lightweight router built for Workers) exposing a JSON API.

**Database:** Cloudflare D1 (serverless SQLite), two separate databases — `pm-app-dev` and `pm-app-prod` — as named environments in `wrangler.toml` (§4.0). Every phase builds and tests against dev first. Schema changes go through versioned files via `wrangler d1 migrations`, never a hand-run `ALTER TABLE` against production.

**Auth:** Email/password, httpOnly session cookie (§4.13). **Password hashing: PBKDF2 via the Workers-native Web Crypto API** (`crypto.subtle`, 100,000+ iterations, SHA-256) — confirmed the standard `bcrypt`/`argon2` npm packages don't run on Workers at all, since they need native OS bindings the runtime doesn't provide; PBKDF2 through Web Crypto is the documented, dependency-free alternative that actually works here. Password reset primary path: email via **Brevo** (confirmed free tier, no credit card required). Once the Telegram bot exists (Phase 5) and you've linked your account (`users.telegram_chat_id`), Telegram becomes the secondary reset path.

**Domain:** A subdomain off sedanama.com (e.g. `pm.sedanama.com`) via Cloudflare DNS — free.

**Mobile:** A PWA (manifest + service worker) built from the same frontend — installable, feels native, zero separate codebase. If you later want a true native Android build, the same PWA wraps with **Capacitor** and compiles to an APK in **Android Studio** without a rewrite.

---

## 9. Integrations

- **Telegram bot** — a Cloudflare Worker acting as the bot's webhook, validating Telegram's secret-token header so spoofed requests can't inject fake Sparks. Messages land in `telegram_captures`, auto-create a Spark, and reply with the captured text plus a link to open it in the app. Once linked to your account, it also becomes a delivery channel for client-work reminders (§6.3) and a secondary password-reset path (§8).
- **GitHub** — doubles as your file store (§8) via the API, plus a manual repo-URL field on project records for linking real code repos. Live commit/README pulling is a natural v2 upgrade, not needed for v1.
- **Obsidian** — a one-time bulk-import screen: point it at your exported `.md` files (or a zip of your ideas folder), it parses titles/content into Spark records. Not an ongoing sync.

---

## 10. Backup Strategy

Screenshots and changelogs already live in GitHub (§8), which gives them version history for free. What still needs backing up is the structured data in D1. A scheduled Cloudflare Worker (Cron Trigger — included free) periodically exports the D1 database as a JSON snapshot and commits it into the same assets repo. **Explicitly excluded from the export: `users.password_hash` and the entire `sessions` table** — those are credentials, not idea data, and committing them into git history on a recurring schedule (even hashed, even in a private repo) is a real exposure to just not create. Everything else — projects, tags, hurdles, canvas elements, and so on — is fine to back up as-is. GitHub is primary; Dropbox or Google Drive is a fallback only if the GitHub piece proves harder than expected. No self-service restore UI is needed for v1 — if disaster ever strikes, pulling the latest snapshot back into D1 manually is an acceptable, infrequent operation rather than something worth building a dedicated screen for.

---

## 11. Testing Strategy

Given you can't read or independently debug the code, your actual verification method is clicking through each phase's "Done when" checklist (§12) — real, but it only confirms what's newly built, not that a later phase didn't quietly break something earlier one already got right. Rather than asking for full test coverage (overkill, and a burden on build speed for a personal-scale app), scope automated tests narrowly to the things that are **invisible in normal use but load-bearing**:

- **User isolation** — a test that user A's queries can never return user B's rows, for every table listed in §4.0. This is the one that would be hardest to notice by clicking around, and the most damaging if it silently regressed.
- **Offline sync correctness** — a queued offline change (Canvas or Spark) reliably lands in the database once connectivity returns, without duplication or loss.
- **Progress calculations** — both formulas (hurdles-based for personal, task-time-based for client work, §6.1) return the right percentage against known inputs.
- **Auth** — password hash/verify round-trips correctly, sessions expire when they should.

Everything else — how a screen looks, whether a button is in the right place — stays covered by your own manual pass through each phase's "Done when" list. Ask your agentic coders to run this test set before each phase is considered complete, not just at the very end.

---

## 12. Build Phases — The Action Plan

Ordered by priority, not just sequence: Phase 0 de-risks everything, Phases 1–2 together deliver both core goals from §1 before anything else gets touched, Phase 3 is quality-of-life (including locale support, since it's real work but not blocking), Phase 4 is the genuinely separate "other world" that can wait until personal is solid, and Phase 5 is convenience layered on once everything underneath is stable.

### Phase 0 — Walking Skeleton
**Goal:** prove the whole pipeline works on your real accounts before building anything useful — and lock in the foundations from §4.0 while there's zero real data at stake.
- Two D1 databases (`pm-app-dev`, `pm-app-prod`) as named Wrangler environments, with the migration workflow set up from the very first table
- Cloudflare Pages project live at `pm.sedanama.com`
- One Worker route responding
- One D1 table (with `user_id` on it from the start) with a row you can read back
- A single hardcoded login using PBKDF2/Web Crypto password hashing, authenticating via session cookie
- One test file successfully pushed to the GitHub assets repo via the API, using a Workers secret for the token

**Done when:** you can visit the real subdomain, log in, see one piece of real data pulled from the dev database, and confirm a test file landed in GitHub — with prod completely untouched.

### Phase 1 — Personal Core
**Goal:** the structured half of "never lose your place" — full project/Spark tracking, usable daily.
- Real auth (password hashing, sessions, invite-only registration via one-time codes)
- `projects`, `tags`, `hurdles`, `links`, `screenshots`, `changelogs` tables + APIs
- Manual status changes (any → any), manual "start building" action, delete for Sparks/Pending only
- Dashboard (stats + recent activity + Canvas entry point)
- Project List: Card + List views, manual drag-reorder (Sticky Notes/Kanban arrive in Phase 3)
- Project Detail page, fully functional, hurdles drag-reorderable
- Sparks shelf + quick-add modal
- Basic search (FTS5, exact-match)

**Done when:** you can add a Spark, promote it to Building, log where-you-left-off, check off a hurdle, upload a screenshot and a changelog, reorder two projects by hand, and find something by search — all without a page reload.

### Phase 2 — The Canvas
**Goal:** the other half of "never lose an idea" — your paper replacement, live.
- Fabric.js-based boundless canvas (pan/zoom), desktop drawing + mobile pan/notes
- Draggable sticky notes in the fixed color palette
- Real-time autosave
- Offline queue + reconnect sync + unsynced-changes badge, shared with Spark quick-add
- "Promote to Spark" action, original note stays and gets marked promoted

**Done when:** you can open the canvas, draw or jot something, lose your connection mid-thought, get it back, and see the note still there and saved — and promoting a note to a Spark doesn't make it disappear.

### Phase 3 — Personal Polish
**Goal:** the browsing experience catches up to how you actually think.
- Sticky Notes + Kanban views for the Project List
- Dark mode + variants
- **Locale support**: English/Farsi toggle with RTL/LTR layout, Gregorian/Shamsi calendar toggle
- Reports/graphs screen
- Export-everything button
- Archive view with live/offline indicator and revive-with-prompt
- Duplicate-title soft warning

**Done when:** all four list views work, the language/calendar toggles both function correctly, and a full data export is one click away.

### Phase 4 — Client-Work Module
**Goal:** the "other world" — deadline-bound, billable work, fully separate from personal.
- Client dashboard (separate section)
- Due dates + task-time progress calculation
- Payment/milestone tracking
- Progress-based reminder logic (§6.3) — behind-pace, not just date-based (email)

**Done when:** a real client project can be entered with tasks, dates, and payment milestones, its progress % updates as tasks complete, and a reminder actually fires when it falls behind pace.

### Phase 5 — Integrations & Mobile
**Goal:** the convenience layer — none of it blocking, all of it makes the daily habit easier.
- Telegram bot (capture inbox with rich confirmation + reminder delivery + secondary password reset)
- Obsidian one-time bulk import
- PWA packaging (installable)
- Scheduled D1 backups to GitHub (Drive/Dropbox as fallback only if needed)
- Optional: Capacitor + Android Studio native wrapper

**Done when:** you can text an idea to the bot, get a confirmation with a working link back to it in the app, and a scheduled backup has run at least once successfully.

---

## 13. Multi-User Model

When registration opens beyond you, each invited person gets a **fully separate, private vault** — their own projects, Sparks, Canvas, and client work, invisible to everyone else including you, not a shared workspace. This falls out of the existing per-user `user_id` scoping already implicit in the schema (§4), so it doesn't require new tables, just consistent filtering in every query — worth stating explicitly so it's not accidentally built as shared-by-default.

---

## 14. Locale: Language & Calendar

Two independent toggles in Settings (§5.8), both stored on the user record (§4.12):

- **Language:** English or Farsi, switching all UI text and layout direction (RTL for Farsi, LTR for English) — full mirroring, not just text alignment.
- **Calendar:** Gregorian or Shamsi (Persian), applied to every date shown or entered anywhere in the app (due dates, timestamps, "updated 3 days ago" style text). Everything is stored in UTC internally (§4.0) regardless of this setting — conversion happens only when rendering. Recommended library: **jalaali-js**, a small, dependency-free Gregorian↔Jalali conversion utility that fits the vanilla-JS stack without pulling in a framework.

Both land in Phase 3 — real, scoped work, not a first-week necessity, since Phases 0-2 are fully usable in English/Gregorian in the meantime.

---

## 15. Decisions Locked

Everything from this round and the prior review round is now resolved. The two small implementation defaults still standing, since neither is structural — flag either if you'd rather decide:
- Password-reset email provider: **Brevo** (confirmed free, no card, generous volume) over Postmark/others
- Canvas rendering library: **Fabric.js** (vanilla JS, no new framework, mature drawing + object support)
- Calendar conversion library: **jalaali-js** (§14)

Three smaller foundational notes worth locking in alongside §4.0, lower-stakes but still cheaper to decide now than mid-build:
- **GitHub asset paths** are namespaced by owner from day one — `/{user_id}/{project_id}/screenshots/...` and `/{user_id}/{project_id}/changelogs/...` — so multi-user support (§13) never risks one account's files being guessable from another's.
- **Basic rate limiting** on login, password reset, and the Telegram webhook, since the app is genuinely internet-facing once it's live on your subdomain — Cloudflare's free-tier rate limiting rules cover this without custom code.
- **The "export everything" file (§5.8) carries a `schema_version` field**, so a backup downloaded before a future schema change stays interpretable after one.

Nothing left blocking. **Phase 0 is the next step.**
