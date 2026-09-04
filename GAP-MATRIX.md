# Hibana — Feature Gap Matrix (vs. conventional PM/task/note/life/idea tools)

Generated 2026-09-09. Baseline: deployed v0.1.6 (hibana.ir, dev v240 / prod v266). Source
verified in `/home/z/my-project/hibana-work`. Recovery source-of-truth: `RECOVERED.md`.
Backlog audit baseline: `BACKLOG-AUDIT.md` (~95 of ~98 backlog items shipped).

**Hibana's two jobs:** *never lose an idea · never lose your place.* Solo-owner (not
enterprise). Ali is a UI/UX designer who directs AI coding agents, doesn't read code
himself. Per `vision.md`, he rejected: rigid task management, forced daily planning,
nagging reminders, automatic idea→project promotion, and friction on raw idea capture.

---

## Executive summary

- **Hibana is already wider than the typical "PM + notes" pairing** — it covers projects,
  sparks (ideas), a 7-stage pipeline, two boundless canvases, a sadhana quadrant board,
  client-work billing, sprint timeline, calendar, reports, Telegram capture, PWA, and
  admin. Most conventional tools force you to combine 3-4 apps to get this surface.
  The audit's headline finding is that the gaps are mostly **narrowing existing surfaces**
  (search depth, Telegram project-update commands, quick-note newest-first), not new
  surface area.

- **The single highest-leverage gap is search depth.** FTS5 today only indexes
  `projects` (`src/routes/search.ts:23-29`); `quick_notes`, `backlog_docs`, `sadhana_tasks`,
  and `canvas_elements` text are all unsearchable. Ali's mental model is keyword-driven
  ("a keyword or short phrase is enough, because the rest stays in his head until later" —
  `vision.md`), so this is the gap that most directly serves *never lose an idea / never
  lose your place*.

- **Three explicit Ali asks were never built** (carried straight from `BACKLOG-AUDIT.md`
  to this matrix): (1) latest quick note at top — `quicknotes.ts:285,334` still appends
  to the bottom; (2) Telegram bot project-update commands — `integrations.ts` only has
  capture-new (no `/update`, no `/append <project>`); (3) feature-usage analytics — admin
  has no per-feature endpoint.

- **The "Reject" pile is more important than the "Missing" pile.** Ali's vision
  explicitly rejects ~6 categories of conventional features (Gantt dependencies, subtasks,
  milestones, OKRs, nagging reminders, push notifications, backlinks/wiki-graph,
  quantitative maturity scoring). These are not gaps — they are non-goals. Building
  them would fight his workflow. See the Reject pile at the bottom.

- **What's Hibana-better 🏆 vs. every comparison tool** (worth keeping and amplifying,
  not copying): multi-channel idea capture (FAB + Ctrl+N + Telegram + voice + canvas +
  command palette), offline-first boundless canvas with LWW sync, the 7-stage project
  pipeline, spark folders as conscious filing (not auto-promotion), and the sadhana
  quadrant board (Eisenhower + recurrence + per-task journal). No comparison tool has
  all of these in one app, and most have none of them at this fidelity.

---

## How to read this matrix

- **Hibana state**: Exists ✅ / Partial ⚠️ / Missing ❌ / Hibana-better 🏆 (explicitly do NOT
  copy the conventional pattern here — Hibana's design is superior for Ali's flow).
- **Verdict**: a one-line strategic call (build it / skip it / reject it / Hibana-better).
- **Priority** (for Hibana specifically, not generic): High / Med / Low / Reject.
- **Effort**: S (≤1 day) / M (1-3 days) / L (>3 days).
- **Jobs served**: 💡 (never lose an idea) / 📍 (never lose your place) / — (neither —
  usually admin/infra).

All file:line evidence points to the working tree at `/home/z/my-project/hibana-work/`.

---

## Category 1 — Project management

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Stages / kanban (pipeline) | 🏆 7 stages `spark + unreviewed/investigating/awaiting/doing/halted/operational`, kanban drag-drop, glance 2×3 grid (`types.ts:68`, `projects.ts`, `migrations/0031`) | Linear (3+ custom), Trello (free lists), Asana (sections), ClickUp (custom) | Hibana-better | — | — | 📍 | The 7-stage taxonomy maps Ali's real pipeline (he calls it "mature enough to set aside"); generic 3-stage (todo/doing/done) loses the doing/halted/operational distinction Ali explicitly named in `vision.md` |
| Milestones | ❌ No milestone object (`types.ts` has none; closest is `SprintRow` with `started_at/ended_at`) | Linear (milestones), Asana, ClickUp | Reject | Reject | M | — | Ali's maturity is *qualitative* (`vision.md`: "satisfies my urgent and immediate needs — the rest is luxury"), not date-bound milestones. Client projects have `due_date` + `payments` rows which already model contract milestones without forcing the "milestone" mental model |
| Gantt / timeline | ⚠️ Per-project sprint timeline only (`sprint.html`, `devboard.ts`): categories × dates, sprint ◆ markers, drag clip edges (`dev_tasks.start_at/end_at`, `0030`), zoom ladder d/w1/m1/m3/m6/y1 | Asana, ClickUp (full Gantt); Linear (none); Todoist (none) | Partial — Hibana-better scoped | Low | — | 📍 | Cross-project Gantt is enterprise coordination — Hibana is one person. Per-project timeline (the devboard sprint view) covers what Ali actually needs: "where did this project's work land on the calendar?" |
| Dependencies / blocked-by | ❌ No `blocked_by` / `depend_on` columns anywhere in `migrations/` or `types.ts` | Linear (blocks/blocked-by), Asana, ClickUp | Reject | Reject | M | — | Solo owner — there's no other worker to coordinate with. Ali's blocking dependencies live in his head and surface as hurdles (the open-problem checklist), which is the right abstraction for "what's blocking me right now" |
| Project templates | ❌ No project/note templates (only email/HTML templates in `services/email.ts`) | Notion, Trello (board templates), Todoist | Reject | Reject | M | — | Ali's projects are unique per idea; nothing repeats. Templates would add a setup step before the idea is captured — the opposite of "fast as a note on a whiteboard" |
| Project pages / tabs | ✅ 6 tabs: `notes, problems, backlog, links, media, activity` (`projects.ts` tab sequence per `BACKLOG-AUDIT.md` Part 1) | Linear (issues), Notion (free-form), Asana (tabs) | Exists | — | — | 📍 | Right-sized. Adding tabs would add friction; the spec deliberately removed the changelog tab ("he doesn't read them himself") |
| Archive | ✅ `archive.html` + `projects.archived_state` (online/offline) + revive-with-prompt + soft delete + 7-day purge (`admin.ts:324-356`) | Linear (archive project), Asana, Things | Hibana-better | — | — | 💡 | `vision.md`: "a SAFE for my ideas" → archived-never-deleted once a project reaches Building or later. Conventional tools allow permanent deletion, which is the failure mode Ali explicitly rejected |
| Spark folders (idea shelves) | ✅ `spark_folders` table (`0037`), folder kanban with drag-to-file on Ideas board (`sparks.html:35-103`); delete folder returns sparks to shelf (`ON DELETE SET NULL`) | Notion (databases), Apple Notes (folders) | Hibana-better | — | — | 💡 | Ali explicitly asked for these mid-build; they model his "shelves of ideas" without forcing categorization at capture time |

### Category 1 — narrative

Hibana's project surface is the strongest part of the app — the 7-stage pipeline is the
clearest expression of how Ali actually moves work forward (the spec's `Building → Working`
split is *his* distinction, not a generic PM status). The only real gap in this category
is **none of high priority**: cross-project Gantt, milestones, dependencies, and templates
all fight his flow. The single highest-leverage move is to *not* add structure here —
instead, tighten the existing surface (see Phase A: the on-hold color fix, the sparks
empty-state icon — both pre-existing deviations from `BACKLOG-AUDIT.md`).

---

## Category 2 — Task management

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Recurring tasks | ⚠️ Sadhana only — `sadhana_tasks.recurring + recur_type (daily/weekly/ndays/monthly) + recur_config + recur_last` (`0018`, `services/sadhana.ts:103-141`). NOT on client tasks (`tasks` table — no recur column), dev_tasks, or hurdles | Todoist (every X), TickTick, Things 3 | Partial | Low | M | 📍 | Sadhana covers personal habits. Extending recurrence to client tasks would add structure Ali explicitly rejected; dev_tasks have a timeline bar instead |
| Subtasks | ❌ No `parent_task_id` anywhere. Closest is the Quick Note "list" kind — items are JSON `[{id,t,d}]` in `content` (`quicknotes.ts`) | Todoist, Asana, ClickUp, Linear (sub-issues) | Reject | Reject | M | — | Vision: "Rigid task management or forced daily planning — he's not that kind of worker, by his own description." Subtasks are the canonical rigid structure |
| Priorities | ⚠️ Dev_tasks only: `low/medium/high/urgent` (`types.ts:123`, `0029`). NOT on hurdles, sadhana tasks, or client tasks | P1-P5 everywhere | Partial | Low | S | 📍 | Ali's "what to work on next" comes from the 7-stage pipeline + sadhana quadrants, not P1/P2. The dev-task priorities are inherited from the user design conversation ("untitled scribbles" 2026-08-29) — they match how Ali actually talks about backlog items |
| Time tracking | ❌ No timer, no duration, no `time_logged` column | Toggl, TickTick, Linear (estimate), ClickUp (timetrack) | Reject | Reject | L | — | Ali doesn't bill by hour (he bills by milestone, modeled in `payments`). Sadhana asks for *progress state* (untouched/in_progress/on_hold), not minutes — that's his actual unit of "where am I on this" |
| Reminders | 🏆 Client-work reminders (opt-in per project, progress-based, email + Telegram — `services/reminders.ts`, `module.ts:176`); Sadhana reminders (every-30-min cron, 7d/3d/1d/0d/2h — `services/sadhana.ts`). NO reminders on personal projects (per vision) | Todoist, TickTick, Things (every-task reminders) | Hibana-better | — | — | 📍 | `vision.md`: "He rejected reminders repeatedly... not an absence of information, but an absence of nagging." Hibana's *progress-based* reminder (fires only when actual progress < expected pace given the deadline) is the one design that doesn't nag — and it only fires for client work, where Ali has a real third-party deadline. Personal work never nags. This is the right answer; copy no more |
| Natural-language input | ⚠️ Voice quick-add via Web Speech API on the quick-add modal (per CHANGELOG 2026-08-28); Telegram free-text → idea (`integrations.ts:235-250,338`). NO NLP parsing of "next Tuesday at 3pm" | Todoist ("tomorrow at 3pm"), TickTick, Things (quick entry) | Hibana-better scoped | Reject | L | 💡 | Ali's pattern is "keyword or short phrase is enough, because the rest stays in his head until later" (`vision.md`). NLP date parsing would imply he's scheduling when he's actually just capturing — adding friction to the capture step |
| Due dates | ⚠️ Client tasks (`tasks.due_date` — `0006`), Sadhana (`due_date + due_time + 7 fuzzy options`, `0018`), Projects client-type (`projects.due_date`). NOT on hurdles, NOT on dev_tasks (those use the timeline bar `created_at → done_at`) | everywhere | Partial | — | — | 📍 | Personal projects deliberately have no due dates (`spec §1`: "no deadlines, because there's no third party waiting on him"). Hurdles and dev_tasks are by-design without deadlines; their "what to do next" comes from manual order + Ali's attention, not the clock |
| Task notes | ⚠️ Sadhana: `note` field + `sadhana_updates` journal (`0018`, `routes/sadhana.ts:748-797`). NOT on client tasks, NOT on dev_tasks, NOT on hurdles (hurdles have only `text` — the project has the pinned `latest_note`) | everywhere | Partial | Med | M | 📍 | Adding a per-task note on dev_tasks (one paragraph) would be the highest-leverage extension — the devboard is where "what does this task mean" gets lost. Client tasks have the project-level `latest_note` as fallback |

### Category 2 — narrative

The "task management" surface in Hibana is split across *four* task-like objects by
design — hurdles (blockers on a project), dev_tasks (serious backlog items with
timeline), sadhana tasks (personal quadrant to-dos), and client tasks (deadline-bound
billing). That split is *Ali's* mental model, not a generic one, and it is the right
answer. The gap is not "add a unified task model" (that would be the enterprise pattern
Ali rejected) but "tighten the existing four" — specifically, add a `note` column to
`dev_tasks` (one-line schema change, one paragraph in the UI) so the devboard's "untitled
scribbles" can carry a sentence of context without becoming a hurdles-style item.

---

## Category 3 — Note-taking / knowledge management

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Backlinks (bidirectional wiki) | ❌ Only one-way "promoted from canvas" panel (`projects.ts:628`); no `[[wiki]]` syntax, no backlink index | Obsidian, Logseq, Roam, Notion | Reject | Reject | L | — | Ali's mental model is "short keywords or phrases... because the rest stays in his head until later" — he is not a graph thinker. Wiki backlinks work for people who think in cross-references; Ali thinks in capture-then-forget. Forcing bidirectional links would add a categorization step at capture time |
| Daily notes | ⚠️ Closest is the `note_date` + `sticky` flag on quick_notes (`0028`) — a sticky note can be pinned to a calendar day. No dedicated "today's journal" page (Logseq journals, Obsidian daily notes) | Logseq (journals), Obsidian (daily notes), Roam (DNP), Notion (daily) | Partial | Low | M | 💡 | A "today" surface already kind of exists — the dashboard shows the to-do + quick notebook. A dedicated daily journal page would duplicate this. If built, the right shape is a single auto-created `note_date=today` quick-note entry on dashboard mount, not a new page type |
| Templates (note/project) | ❌ Only email/HTML templates (`services/email.ts`) | Notion, Obsidian (templater) | Reject | Reject | M | — | Ali's projects are unique per idea; nothing repeats. A "new client project" template could save 30 seconds once, but the friction of selecting a template at capture time violates the "fast as a note on a whiteboard" promise |
| Search depth (FTS5) | ⚠️ FTS5 on `projects` only (`search.ts:23-29`, `projects_fts` virtual table per `0004`). Changelog FTS was removed when the feature was removed (`search.ts:30-32`). NOT on `quick_notes`, `backlog_docs`, `sadhana_tasks`, `canvas_elements` | Notion (Cmd+K all), Obsidian (Cmd+Shift+F), Linear (global search) | Partial — **highest-leverage gap** | **High** | M | 💡📍 | Ali is keyword-driven by his own description. He has thousands of ideas captured over months; "what did I think about X" must work across quick notes, backlog docs, and canvas content, not just project titles. The fix is mechanical: mirror the `projects_fts` trigger pattern (`0004`) onto `quick_notes`, `backlog_docs`, and `canvas_elements(content)`, then extend `search.ts` to UNION the indexes |
| Tags hierarchy / nesting | ❌ Flat tags — `tags` table has `user_id, name, color, usage_count` only (`0003`); no `parent_id`, no nesting. Per-user scoping + merge endpoint (`tags.ts:73-85`) | Notion (nested), Obsidian (nested tags) | Hibana-better | Reject | — | 💡 | Ali's spec §4.4: "the more the better" — free-form tags, always optional, persistent lightweight "+ tag" affordance on the project header. Nesting adds a categorization decision at every tag-add, which is exactly the friction Ali rejected. Hibana's flat + merge is the right design |
| Quick notes | 🏆 Two kinds (note + list), 4-color palette (yellow/green/pink/blue — `quicknotes.ts:36-39`), pinnable to calendar day (`sticky` flag), `done` flag for project-linked notes (`0038`), attachable to projects (paperclip, `0017`) | Apple Notes, Notion quick capture, Superlist | Hibana-better | — | — | 💡 | The dashboard Quick Notebook is the *daily* capture surface (the whiteboard-replacement echo). 4 colors + sticky + project-link covers what Ali needs without a "note database" mental model |
| Notebook / whiteboard | 🏆 Boundless `whiteboard.html` with sticky notes, drawing, "convert to quick note" (`canvas.js:2907`), offline sync (`queue.js`), separate from `canvas.html` | Notion (free-form blocks), Miro, Apple Notes | Hibana-better | — | — | 💡 | Two boundless boards (Canvas = idea-space, Notebook = note-space) is a richer surface than any comparison tool's free-form mode. The vision's "paper on my desk" replacement is here |
| Markdown rendering | ✅ `renderMarkdown` in `quicknotes.ts` (imported from `lib/markdown.ts`) | Notion, Obsidian | Exists | — | — | 💡 | Quick notes render markdown — needed because Telegram captures and Obsidian imports land as markdown |

### Category 3 — narrative

Hibana is a *note-capture* tool, not a *knowledge-base* tool — and that's the right call
for Ali. The category's strategic read: the gap is **search depth, not structure**.
Building backlinks, daily notes, nested tags, or templates would all add a categorization
step at the moment of capture, which is the exact friction `vision.md` says to avoid. The
one high-leverage move is to make the existing FTS5 surface *deeper* (extend it to quick
notes, backlog docs, and canvas note text) so the "what did I think about X" question
works across the whole vault — without forcing Ali to remember *where* he wrote it.

---

## Category 4 — Life management

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Calendar integration | ⚠️ Internal calendar view (`calendar.html`, `calendar.ts`): month grid in Jalali/Gregorian, items keyed by `due_date` from projects/tasks/sadhana/notes, Iranian holiday detection (`jalali-holidays.js`). NO two-way sync to Google/Apple/Outlook/CalDAV | Google Calendar, Apple Reminders, Todoist, TickTick, Sunsama | Partial — Hibana-better scoped | **High** | L | 📍 | Ali lives 12-16 hour days across multiple self-directed projects + a real business (Sedanama). Seeing Hibana deadlines alongside client meetings in his existing calendar is the single most missing piece for "never lose your place." A one-way ICS export (Phase B) is the cheap step; full Google Calendar two-way sync (Phase C) is the bigger ask |
| Habits | ⚠️ Sadhana recurrence is closest — `recur_type: daily/weekly/ndays/monthly` + Monday Asia/Tehran reset sweep (`services/sadhana.ts:132-160`). No streaks, no habit-grid, no "longest streak" metric | Habitica, Streaks, Loop, TickTick (habits) | Hibana-better scoped | Reject | M | 📍 | Ali explicitly rejected "nagging" reminders (`vision.md`). Streaks are a gamified nag — they exist to make you feel bad for missing. Sadhana's recurrence model resets silently on completion and on Monday sweep, which is the right design. Adding streaks would import the failure mode Ali rejected |
| Goals / OKRs | ❌ No goals table, no OKR object, no quarterly target tracking | Weekdone, Lattice, ClickUp (goals) | Reject | Reject | L | — | Vision: "satisfies my urgent and immediate needs — the rest is luxury." OKRs imply quantitative targets, quarterly cycles, and progress scoring — none of which fit Ali's "free-flowing, no deadlines" personal-work pattern. Sadhana quadrants (Q1 Today / Q2 Strategic / Q3 Urgent / Q4 Personal) are an Eisenhower-matrix style priority placement, *not* OKRs |
| Journaling | ⚠️ Per-task journal on Sadhana — `sadhana_updates` table (`0018`, `routes/sadhana.ts:797`), a dated log of updates per task. No daily diary page | Day One, Apple Notes, Notion (journal), Obsidian (daily) | Partial | Low | M | 💡 | The per-task journal is the right scope for Ali — it answers "what did I last do on this task" without forcing a daily entry. A daily journal page would duplicate the dashboard Quick Notebook + the sadhana updates feed |
| Mood / energy tracking | ❌ Not anywhere — no `mood`, no `energy`, no daily self-rating | Bearable, Daylio | Reject | Reject | M | — | Ali never asked; vision never implied it. This is a feature from a different product category (self-quantification) that would dilute the two-jobs focus |
| Sadhana module (Hibana-specific) | 🏆 2×2 quadrant board: Q1 Today · Q2 Strategic · Q3 Urgent · Q4 Personal (`0018`, `routes/sadhana.ts`). Per-task: emoji, fuzzy + exact deadlines (`due_date + due_time + 7 fuzzy labels`), recurrence (4 types), notes + updates journal, 3-state progress (untouched/in_progress/on_hold), pin, focus/zen mode, drag-and-drop reorder + cross-quadrant move, tag filter chips (5 fixed tags: w/p/sg/so/h), recurring completion log, Monday Asia/Tehran sweep, Telegram reminders, archive with per-quadrant stats, EN/FA full RTL | Sunsama (daily planning), Routine (calendar + tasks), Things 3 (anytime), TickTick | Hibana-better | — | — | 💡📍 | Sadhana is Hibana's *habit + priority + flow* layer. It is not a generic "habits" or "OKR" feature — it's a standalone board that replaces the original Sadhana reference app Ali was using, ported into the Hibana shell with extras (server-side language sync, Hibana's bot, 7d/3d/1d/0d/2h reminder cadence). Don't compare it to "habits" — compare it to "Ali's actual daily flow surface" |

### Category 4 — narrative

The category's biggest gap is **calendar sync**, full stop. Ali's calendar is where he
already lives (client meetings, Sedanama operations, family), and right now Hibana
deadlines live only inside Hibana — so the "where am I supposed to be" question splits
across two surfaces. Everything else in life-management (habits as streaks, OKRs, mood,
daily journals) is either already covered by sadhana in a better shape or rejected by the
vision. The sadhana module itself is the strongest example of "build around how Ali works"
in the whole codebase — it should be left alone, not generalized into a "habits/OKRs"
module.

---

## Category 5 — Idea management

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Capture speed (multi-channel) | 🏆 FAB with 3 options + Ctrl+N shortcut (`app.js:556+` per CHANGELOG 2026-08-28); Telegram `/idea`, `/note`, `/list` (`integrations.ts:258-293`); quick-add modal (name + desc + tag + screenshot); voice quick-add (Web Speech API per CHANGELOG); command palette Ctrl+K (`command-palette.js`); canvas "promote to Spark" (`core.ts:418`); Obsidian `.md`/`.zip` import (`integrations.ts:380-462`) | Apple Notes, Notion quick capture, Things (quick entry), Superlist | Hibana-better | — | — | 💡 | Hibana has *more* capture channels than any comparison tool. The missing one is a web clipper (Phase B) — Ali is online a lot for Sedanama + coding research, and a "send this URL to Hibana as a spark" path would add a high-value channel |
| Idea→project promotion | 🏆 Manual, conscious decision: spark → any of 6 project stages; sparks live on Ideas shelf in folders; promotion is an explicit status change (`projects.ts` PATCH stage) | Linear (issue), Todoist (project), Things (anytime) | Hibana-better | — | — | 💡 | `vision.md`: "promoting an idea into an active project is a conscious decision tied to his needs and lifestyle — never automatic." Hibana's manual flow is the vision's exact ask. Copying auto-promotion (e.g. Linear's "ready → in progress on assignment") would fight Ali's flow |
| Idea maturity scoring | ❌ No scoring, no funnels, no quantitative dimensions. The 7-stage pipeline is an ordinal progression (spark → unreviewed → investigating → …) | Aporia (idea funnels), Notion (custom properties), Linear (labels) | Reject | Reject | M | — | Ali doesn't think in maturity scores — `vision.md` says a project is "mature enough to set aside once it satisfies my urgent and immediate needs." That's a yes/no, not a 0-100. Adding scoring implies measuring ideas against a rubric Ali doesn't have |
| Spark folders | ✅ `spark_folders` (`0037`); Ideas shelf renders per-folder kanban with drag-to-file (`sparks.html:109-115`); delete folder returns sparks to shelf (`ON DELETE SET NULL`); view dropdown (cards/list/sticky/kanban) (`sparks.html:35-40`) | Notion (databases), Apple Notes (folders) | Exists — Hibana-better | — | — | 💡 | This is Hibana's answer to "where do I file this idea" without forcing categories at capture time. The `(folder_id IS NULL / folder_id = ?)` pattern means unfiled sparks are always visible on the All shelf, and filing is a later, deliberate drag |

### Category 5 — narrative

Idea management is Hibana's *primary* job and the part of the app most aligned with Ali's
explicit reasoning. The capture speed is already wider than any comparison tool (six
channels), the promotion flow is the vision's exact ask (manual, conscious), and the
spark folders handle filing without forcing categories. The only category-relevant gap
is **web clipper** — a Phase-B item — and the only "missing" maturity scoring is an
explicit reject. Don't touch this category except to extend search depth (Category 3).

---

## Category 6 — Canvas / visual

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Whiteboard depth | 🏆 Boundless (`canvas.html` + `whiteboard.html`), pan/zoom, viewport chunk loading via bounding-box query (`core.ts:337-356`), real-time autosave, offline-first sync (`queue.js`) | Miro, Excalidraw, Notion canvas (free-form) | Hibana-better | — | — | 💡 | Spec §3.5: load only elements near the current viewport, fetch more on pan. Most comparison tools either load-everything (slow over years) or paginate awkwardly. Hibana's bounding-box query (`x < ? AND x + COALESCE(width,0) > ?`) is the right long-term design |
| Mind maps | ⚠️ No automatic mind-map layout. Manual: frames + sticky notes + shapes + comments can be arranged as a freeform mind map. No connectors / no auto-routing | MindNode, XMind, Notion canvas | Partial | Reject | L | — | Ali's mental model is "short keywords or phrases... because the rest stays in his head until later" — auto-layout mindmaps impose a graph structure on capture. Manual arrangement on the canvas is the right scope |
| Flowcharts | ⚠️ No formal flowchart primitives (no auto-routing connectors, no decision diamonds). Could use shapes + arrows manually | Lucidchart, Excalidraw | Partial | Low | M | — | Hibana's canvas supports `shape` (rect/oval/circle) + `comment` pins + `block` (lo-fi wireframe groups) per `0032`. Adding one connector primitive (a line that re-routes when endpoints move) would unblock flowchart use without the enterprise-grade Lucidchart feature set |
| Sticky notes | 🏆 4-color fixed palette (yellow/green/pink/blue — `quicknotes.ts:36-39`), on both Canvas + Notebook, sticky→QuickNote conversion (`canvas.js:2907` per CHANGELOG Phase 7 item 9) | Miro, Apple Notes, Notion | Hibana-better | — | — | 💡 | Spec §3.1 explicitly chose a *fixed palette* over a full color picker — "conventional sticky-note colors... not a full color picker." That keeps the surface fast and removes a decision at capture time |
| Element types | ✅ 8 types: `note, stroke, image, frame, shape, comment, block, sticky` (`core.ts:317`); per-element lock (`0024`); deleted tombstone + 7-day purge (`core.ts:410`) | Miro (dozens), Excalidraw (~20), Notion (blocks) | Exists | — | — | 💡 | 8 is right-sized. Miro's ~30 element types are an enterprise pattern (diagram libraries, Jira cards, embedded apps). Hibana's set covers what a solo idea-space needs. Note: spec §3.1 said "no dropping screenshots/images onto the Canvas" but `image` type exists — slight spec drift, intentional per the deployed canvas allowing URL-based images (not uploads) |
| Offline sync | 🏆 IndexedDB queue (`queue.js`), LWW on `updated_at` (`core.ts:393`), unsynced-changes badge, `sendBeacon` on `pagehide` for the canvas batch (`queue.js:201-212`), 401/403 never drops items (`queue.js:125-138`), periodic 15s retry | Miro (partial offline), Notion (no offline canvas), Excalidraw (local-only) | Hibana-better | — | — | 💡 | Spec §3.4 promise made literal. The 2026-08-28 hardening ("offline queue no longer drops data on auth loss") is the kind of fix you only see in production-grade offline systems. Copy nothing from competitors here |

### Category 6 — narrative

The canvas surface is the *vision's central example* ("the clearest, most direct
expression of his core goal — never lose an idea") and it is the most production-grade
part of the codebase. The only honest gap is one optional primitive (auto-routing
connector for flowcharts); everything else is either already Hibana-better or rejected
by the "graph thinker" objection. Leave this category alone except for the optional
connector — and only if Ali asks.

---

## Category 7 — Integrations

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Telegram bot | 🏆 Bot `@Hibana_PM_bot` with: `/start <code>` (link, 1h-expiring codes), `/help` (linked/unlinked-aware), `/idea <text>` (capture as spark + deep link), `/note <text>` (Quick Note on dashboard), `/list` + `/done` + `/cancel` (50-item checklist session, 2h TTL), `/status` (linked account + open deadlines count), `/pause` + `/resume` (suspend reminders), `/reset` (secondary password reset via linked chat), plus free-text → idea (`integrations.ts:102-340`) | Todoist bot, Notion bot, TickTick bot | Hibana-better | — | — | 💡 | The command surface is the widest of any personal-app Telegram bot in the comparison set. The one explicit ask never built: **project-update commands** (Phase 7-second item 2 in `BACKLOG-AUDIT.md`) — no way to append to or update an *existing* project from Telegram, only capture-new |
| Calendar sync (Google/Apple/Outlook/CalDAV/ICS) | ❌ Internal calendar only. No ICS export, no two-way sync | Todoist, TickTick, Things (Apple), Google Calendar, Sunsama | Missing | **High** | L | 📍 | See Category 4. The cheap first step is one-way ICS export (Hibana publishes a feed URL the user adds to Google Calendar); the bigger step is Google Calendar API two-way |
| Email-in (inbound email → spark) | ❌ No inbound email. Resend is outbound only (`services/email.ts`) | Notion (email-in), some Obsidian setups | Missing | Med | L | 💡 | Ali could forward an email to `ali@hibana.ir` (or a per-user inbox address) and have it land as a spark. Cloudflare Email Workers is the obvious plumbing (already on Workers). Would add a 7th capture channel |
| Web clipper | ❌ No browser extension, no bookmarklet | Notion web clipper, Obsidian clipper, Raindrop | Missing | Med | M | 💡 | A bookmarklet that POSTs the current page's URL + title + selection to `/api/projects` as a spark is the smallest version. A full extension is Phase C |
| Import / export | 🏆 Obsidian `.md`/`.zip` import (one-time, idempotent, 100MB cap — `integrations.ts:380-462`); full JSON export + Markdown rollup export + tasks.csv export (`export.ts`); backup snapshot (`services/backup.ts`) | Notion, Obsidian, Todoist (templates import) | Hibana-better | — | — | 💡 | The Obsidian import path explicitly acknowledges Ali's prior tool (`vision.md`: "he tried Obsidian and Notion first"). Idempotent re-imports (per-user title dedupe) is the right design — running it twice is a no-op |
| Backups | 🏆 4× daily GitHub repo cron (`17 3,9,15,21 * * *`), retention 60, `buildSnapshot()` excludes `password_hash` + `sessions` (rule 8), restore drill via `npm run drill`, owner-email alert on failure (`admin.ts:363-398`) | Notion (no), Obsidian (git/manual) | Hibana-better | — | — | 💡 | The backup design is one of the load-bearing pieces of the "safe for my ideas" promise (`vision.md`). 4× daily + retention 60 ≈ 15 days of both envs; GitHub history provides the long tail. Manual restore via `scripts/restore.mjs` is the right scope (no UI needed for v1) |

### Category 7 — narrative

Integrations are the second-strongest category after canvas. The Telegram bot is wider
than any comparison tool's, and the Obsidian import + JSON/MD/CSV export pair closes the
portability loop. The two real gaps are **calendar sync** (one-way ICS first, two-way
Google later — High priority, L effort) and **email-in** (Cloudflare Email Workers — Med,
L). The one *Ali ask* never built (Telegram project-update commands) is the highest-leverage
small fix in this category — see Phase A. Don't add Slack, Discord, GitHub issues, Jira —
those are team integrations and Hibana is one person.

---

## Category 8 — Mobile / PWA

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Offline | 🏆 Service worker `hibana-v213` (`sw.js`): network-first navigations, network-first assets (2026-08-26 fix), cache-first shell, API always network, cross-origin pass-through (`sw.js:97-148`); IndexedDB offline queue for canvas + spark quick-add (`queue.js`); 401/403 never drops items; `sendBeacon` on `pagehide` for canvas batch | Notion (limited offline), Linear (no offline), Todoist (offline), Things (offline native) | Hibana-better | — | — | 💡📍 | The SW strategy is the right one for Hibana — fresh data on every navigation, instant shell on offline, never lose the canvas edit. Network-first for assets is the post-2026-08-26 fix that prevents stale CSS after deploys |
| Installability | ✅ `manifest.webmanifest` (name, theme, 192/512 PNG icons, standalone display); install-prompt.js captures `beforeinstallprompt`, dashboard toast, Settings button (per CHANGELOG Phase B2.16) | Notion, Linear, Things (native) | Exists | — | — | — | Already shippable. Spec §8 mentions optional Capacitor+Android Studio APK wrapper for true native — Hibana-better path (one PWA, no separate codebase) |
| Push notifications | ❌ No server push. `/api/notifications` is a *derived* view (`notifications.ts`) — overdue tasks, unreviewed sparks >7d, upcoming deadlines, stale projects — fetched on page load, not pushed | Todoist, Things, Linear (push) | Reject | Reject | L | — | Vision: "He rejected reminders repeatedly... not an absence of information, but an absence of nagging. He does not want the app telling him 'your project is overdue, work on it.'" Push notifications are the canonical nag. Hibana's pull-based notification center is the right design — Ali opens the page when he's ready, the badges surface then |
| Service worker | ✅ `sw.js` (above) | Notion, Linear, Things | Exists | — | — | — | The version bump discipline (currently `hibana-v213`) is the operational hygiene that makes the SW approach work — every deploy flips the cache, one hard refresh recovers |
| Mobile nav | 🏆 Bottom tab nav (`mobile-nav.js`): 5 primary tabs (Dashboard, To-do, Projects, Ideas, +More) + "More" bottom sheet with Canvas, Notebook, Calendar, Notifications, Reports, Archive, Settings, Admin (owner-only), Language, Theme, Sign out; 44px touch targets, safe-area-inset, sticky (`app.css`); topbar hidden ≤1024px; touch-drag fallback (long-press → synthetic DnD, `touch-drag.js`) | Notion (mobile app), Things, TickTick (native) | Hibana-better | — | — | 📍 | Hibana's mobile surface is a PWA-shaped equivalent of Things/Notion's native apps without a separate codebase. The 5-tab + More-sheet split is the right shape — primary surfaces one tap, secondary surfaces two taps |

### Category 8 — narrative

Hibana's PWA is production-grade and the only honest gap (push notifications) is an
explicit reject per vision. The "More" sheet carrying Admin + Language + Theme + Sign
out is the right design — those are settings-class, not navigation-class. Don't add a
native iOS/Android app unless Ali asks (the Capacitor path in spec §8 is available if
he does). Copy nothing from competitors here.

---

## Category 9 — Admin / analytics

| Feature | Hibana state | Conventional tools | Verdict | Priority | Effort | Jobs | Notes |
|---|---|---|---|---|---|---|---|
| Feature-usage analytics | ❌ No per-feature endpoint, no admin section. Ali explicitly asked in `BACKLOG-AUDIT.md` Part 3 ("which part of Hibana is most active/popular"). Admin overview has KPIs (signups, etc.) but no "how much is each feature used" breakdown | Mixpanel, PostHog, Linear admin | Missing | **Med** | M | — | Ali's actual question: which of the 9 surfaces does he live in? An endpoint counting rows per user across `projects`, `quick_notes`, `sadhana_tasks`, `dev_tasks`, `canvas_elements`, plus `last_seen_at` per surface (a 5-min stamp like the user one), would let the admin overview answer "what is Ali actually using." Directly informs the next-investment decision |
| Time-tracking reports | ❌ No time tracking exists (Category 2) | Toggl reports, Clockify | Reject | Reject | L | — | Reject for the same reason as time tracking itself: Ali doesn't bill by hour |
| User management | ✅ Full — user list with presence (online = seen < 5 min — `admin.ts:68-83`), ban presets + custom date, role mgmt (owner/member, last-owner guard), delete user with username-typed confirmation, send-reset email (`admin.ts:53-185`) | Linear, Notion admin | Exists — Hibana-better | — | — | — | Hibana's ban-until + last_seen_at + role design is the right shape for a small team owner. The `requireOwner` middleware (`admin.ts:36-40`) is the 2026-08-28 hardening that means no admin route added later can forget the check |
| Ban / presence | ✅ `banned_until` (forever sentinel or ISO expiry) + `ban_reason` + `last_seen_at` (5-min presence window) + isBanned gate on auth (`auth/ban.ts`) + session kill on ban (`admin.ts:118-121`) | Linear, Notion | Exists | — | — | — | The presence stamp on every authed request (`requireAuth` stamps `last_seen_at`) is the right way to compute "online now" without a separate websocket |
| Broadcast email | ✅ `POST /admin/email/broadcast` with paging (40/request), verified-only, Resend quota guard, daily limit, owner-only (`admin.ts:227-272`) | Linear (broadcasts) | Exists | — | — | — | The paged design is right — one Worker request sends ≤40 emails, the client pages until `done`. The Resend quota guard (`assertQuota`) means the daily limit is enforced per send, not after the fact |
| Backup status | ✅ `GET /admin/backup/status` (configured, count, newest, retention — `admin.ts:274-292`) + on-demand `POST /admin/backup` + download (`admin.ts:294-301`) | Notion (no), Obsidian (git) | Exists | — | — | — | The 4× daily cron + retention 60 + on-demand backup + download gives Ali everything he needs. The "backup failed" owner-email alert (`admin.ts:380-398`) is the 2026-08-28 hardening that closes the silent-failure gap |

### Category 9 — narrative

Admin is the third-strongest category. The user/ban/email/backup surfaces are
production-grade. The only real gap is the one Ali explicitly asked for: **feature-usage
analytics** (Phase B). Without it, the next-investment decision (where to spend Ali's
limited build time) is blind — Ali is guessing. A simple per-feature counter (rows +
recent activity per surface, shown in admin overview) closes the gap in a half-day and
directly informs Phase A/B/C prioritization.

---

## Cross-cutting recommendations — phased

### Phase A (quick wins, this session) — S items, High priority

These are the items where the value/effort ratio is highest and where most are *already
filed as deviations from the audit* — small, mechanical fixes that close explicit Ali
asks.

1. **Latest quick note at top** (Phase 7-second item 3 in `BACKLOG-AUDIT.md`) — flip
   `ORDER BY sort_order ASC` to `DESC` (or `pos = -COUNT(*)`) at `quicknotes.ts:285,334`.
   Effort: S. Jobs: 💡📍. (The audit calls this "a one-line class of fix" — it isn't quite
   one line, but the SQL change is mechanical and the existing tests cover the reorder
   contract.)

2. **Telegram `/append <project> <text>` command** (Phase 7-second item 2 in
   `BACKLOG-AUDIT.md`) — add a new webhook branch in `integrations.ts` that takes a
   project id (or a fuzzy title match) + text, appends to `project_history_log` and
   updates `latest_note`. Effort: S. Jobs: 💡📍. (Ali's real workflow: "I just had a
   thought on the X project" — currently he has to open the app and type it; this lets
   him do it from Telegram.)

3. **On-hold color: violet → yellow** (Phase 6 deviation #5 in `BACKLOG-AUDIT.md`) — one
   CSS variable change in `app.css:1182-1184`. Effort: S. Jobs: 📍.

4. **Sparks empty-state bulb icon** (Phase 6 deviation #6 in `BACKLOG-AUDIT.md`) — add
   the bulb SVG to the empty-state CTA in `projects.ts:214-216`. Effort: S. Jobs: 💡.

5. **Notebook dark-mode ink filter inverts photos** (pre-existing ROADMAP known issue +
   `BACKLOG-AUDIT.md` section C) — exclude `<img>` elements from the `--nb-ink` invert
   at `app.css:2320`. Effort: S. Jobs: 💡 (vision's central canvas promise — the
   Notebook must not silently break the thing Ali most relies on).

### Phase B (next sprint) — M items

1. **FTS5 on `quick_notes`** (extends the `projects_fts` pattern from `0004`) — new
   virtual table + triggers mirroring `0004`, extend `search.ts:23-29` to UNION the
   indexes. Effort: M. Jobs: 💡📍. (The single highest-leverage gap in the whole matrix.)

2. **FTS5 on `backlog_docs` + `canvas_elements` (note + sticky text content)** — same
   pattern as above. Effort: M. Jobs: 💡.

3. **Telegram `/update <project> <stage>` command** — set the project stage from
   Telegram (sister to `/append`). Effort: M. Jobs: 💡📍.

4. **Feature-usage analytics** — one read-only endpoint `GET /admin/feature-usage`
   returning per-surface row counts + a `last_seen_at`-style stamp per surface (or
   simpler: top `updated_at` per table), rendered in the admin overview. Effort: M.
   Jobs: — (informs decisions).

5. **Top-10 most-active users ranking** (Part 3 deviation in `BACKLOG-AUDIT.md`) — the
   data exists in `admin.ts:53-83`; add a `?sort=activity` query + a ranking tab in the
   admin users view. Effort: M. Jobs: —.

6. **One-way ICS calendar export** — `GET /api/calendar.ics` returning the user's
   deadlines (projects due_date, sadhana due_date, client task due_date) as a VCALENDAR
   feed URL the user pastes into Google/Apple Calendar. Effort: M. Jobs: 📍. (The cheap
   first step on calendar sync — Phase C is full two-way Google Calendar API.)

7. **Web clipper bookmarklet** — a `javascript:` URL on the Settings → Integrations page
   that POSTs `window.location.href + document.title + window.getSelection().toString()`
   to `/api/projects` as a spark. Effort: M. Jobs: 💡.

8. **Per-task `note` column on `dev_tasks`** — one schema column + UI input on the
   devboard; closes the "what does this untitled scribble mean" gap. Effort: M. Jobs: 📍.

### Phase C (later) — L items

1. **Google Calendar two-way sync** — OAuth + Google Calendar API; read external events
   into Hibana calendar view, write Hibana deadlines out. Effort: L. Jobs: 📍.
   (Only attempt if the Phase-B ICS export proves insufficient for Ali's real workflow.)

2. **Email-in inbound capture** — Cloudflare Email Workers route → spark. Effort: L.
   Jobs: 💡.

3. **Canvas connector primitive** (auto-routing line between two endpoints, for
   flowchart use). Effort: L. Jobs: 💡. (Optional — only if Ali asks.)

4. **Browser extension web clipper** (full, not just a bookmarklet). Effort: L. Jobs: 💡.

5. **Multi-canvas / per-project canvas** — currently two boards total (`canvas` +
   `notebook`); allowing N canvases (one per project, or named workspaces) would
   scale across years of accumulated canvas content. Effort: L. Jobs: 💡📍.

### Reject pile (explicit non-goals — features that serve neither job or fight Ali's workflow)

These features are explicitly or implicitly rejected per `vision.md` and `CLAUDE.md`.
Adding them would *fight* Ali's flow, not serve it. Each reject is justified with the
vision's own reasoning.

1. **Rigid task management — subtasks, parent/child task hierarchy, forced task
   breakdowns.** Vision: *"Rigid task management or forced daily planning — he's not that
   kind of worker, by his own description."* Hibana's four task surfaces (hurdles,
   dev_tasks, sadhana, client tasks) are intentionally flat per surface, each modeling
   a different question Ali asks of work. Subtasks would impose a structure Ali doesn't
   have.

2. **Nagging reminders, push notifications, overdue alerts, "your project is overdue"
   toasts.** Vision: *"He rejected reminders repeatedly and had to clarify what he
   actually meant: not an absence of information, but an absence of nagging. He does
   not want the app telling me 'your project is overdue, work on it.'"* Hibana's
   notification center is pull-based (open the page → see badges) and the only push
   channel is Telegram, which Ali can `/pause`. Adding server push would import the
   exact failure mode Ali rejected.

3. **Milestones, OKRs, quantitative goal-tracking, idea maturity scoring.** Vision:
   *"A project is mature enough to set aside once it 'satisfies my urgent and immediate
   needs' — the rest, in his words, is 'luxury.'"* Ali's maturity is *qualitative* —
   yes/no, not 0-100. Milestones imply date-bound targets; OKRs imply quarterly cycles;
   maturity scoring implies a rubric. None of those fit Ali's "free-flowing, no
   deadlines" personal-work pattern. Client-work billing is handled by `payments`
   rows, not milestone objects.

4. **Gantt dependencies across projects, blocked-by / blocks relationships, resource
   leveling.** Solo owner — there's no other worker to coordinate with, no shared
   timeline to level against. Hibana's per-project sprint timeline (`devboard.ts`)
   covers "where did this project's work land on the calendar?" which is the actual
   question. Cross-project Gantt is enterprise coordination — Hibana is one person.

5. **Backlinks / bidirectional wiki / `[[link]]` syntax / graph view.** Vision:
   *"Short keywords or phrases... because the rest stays in his head until later."* Ali
   is not a graph thinker — he's a capture-then-forget thinker. Wiki backlinks work for
   people who think in cross-references; Ali thinks in keywords. Forcing bidirectional
   links would add a categorization step at capture time, which is the friction the
   vision says to avoid.

6. **Daily notes / daily journal page / "today's note" auto-created page.** Already
   covered by the dashboard (to-do + quick notebook + activity) and the `note_date`
   sticky flag on quick notes. A separate daily journal page would duplicate this and
   force a "did you journal today?" ritual Ali didn't ask for.

7. **Mood / energy / self-quantification tracking.** Not in the vision, not in the spec,
   not in the backlog. Different product category (self-quantification) — would dilute
   the two-jobs focus.

8. **Tag nesting / hierarchy / categories vs. tags as separate fields.** Spec §4.4:
   *"the more the better"* — free-form, always optional, persistent lightweight "+ tag"
   affordance. Hibana's flat + merge (`tags.ts:73-85`) is the right design. Nesting adds
   a categorization decision at every tag-add.

9. **Project / note templates.** Ali's projects are unique per idea; nothing repeats.
   Templates would add a setup step before the idea is captured — opposite of the
   whiteboard-speed capture promise.

10. **Team features — assignments to others, @mentions of colleagues, shared boards,
    approval workflows, comment threads with multiple authors.** Hibana is one person
    (`vision.md`: solo UI/UX designer who directs AI coders, doesn't read code himself).
    Every `user_id` filter (rule 1 in `CLAUDE.md`) exists to enforce *separate private
    vaults*, not shared workspaces. Team features would break the data model on purpose.

11. **Native iOS / Android app (separate codebase).** The PWA + Capacitor path (spec §8)
    gives Ali native wrapping *without* a separate codebase if he ever asks. Building
    a separate native app now would double the maintenance surface for zero user value.

12. **Time tracking (start/stop timer, duration fields, time-tracking reports).** Ali
    bills by milestone (modeled in `payments`), not by hour. Sadhana's 3-state progress
    (untouched/in_progress/on_hold) is his actual unit of "where am I on this," not
    minutes. Adding a timer would import a feature from a category Ali doesn't work in.
