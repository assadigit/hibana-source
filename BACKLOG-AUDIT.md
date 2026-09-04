# Hibana — Backlog Audit (Alpha 0.01, 2026-09-01)

Two sources audited against the recovered deployed code (dev v240 / prod v266 — the state
this tree machine-verified reproduces; evidence cites file:line in this tree):

1. **`Hibana-backlog-check.md`** — Ali's own hotfix-window request document (Parts 1–3,
   Phases 4–7) — the authoritative list of what the ~50–60 hotfixes were meant to ship.
2. **`ROADMAP.md` / `NEW_SESSION.md`** — the project's recorded backlogs.

Legend: ✅ implemented & verified · ⚠️ partial/deviation · ❌ not implemented ·
👤 user-held (not code).

---

## A. The `Hibana-backlog-check.md` audit — verdict per part

### Part 1 — project-page tabs, backlog, problems → **ALL ✅**
| Request | Verdict | Evidence |
|---|---|---|
| Tab order: یادداشت‌ها › مشکلات › بک‌لاگ › پیوندها › اسکرین‌شات › آخرین تغییرات | ✅ exact | `src/routes/projects.ts` tab sequence: `notes, problems, backlog, links, media, activity` |
| Remove the تغییرات (changelog) tab + its feature | ✅ | changelog routes/tab/writes gone; table intentionally left in DB |
| Backlog tab, input model A (list items → auto-appear in the box) | ✅ | `bl-item-form` quick-add (`projects.ts:486`) + `pd-quick-add` per column (`:391`) |
| Backlog tab, input model B (full document, title + content) | ✅ | backlog docs + `data-bl-newdoc` «سند جدید برنامه» (`projects.ts:495`) |
| Backlog history (know the latest change) | ✅ | revision history + «آخرین تغییرات برنامه» + `timeAgo(latestAt)` (`projects.ts:506`) |
| Term بک‌لاگ برنامه‌ریزی‌شده → **برنامه آتی** everywhere | ✅ | `Upcoming Plan / برنامه آتی` labels throughout |
| Term باگ → **مشکلات / Problems** everywhere | ✅ | `{ key: 'bug', en: 'Problems', fa: 'مشکلات' }` (`projects.ts:334`) |
| New bug/problem auto-added to its box | ✅ | bug dev-tasks (`dev_tasks.bug`, migration 0034) rendered in the مشکل column |
| Fullscreen board full-width + same color coding | ✅ | `db-col` color-coded edges, transparent fill — «batch (s) ⑬ … drop the grey/green fill» (`app.css:6096–6121`) |
| Sparks ≠ upcoming plans (review/select philosophy) | ✅ | spark stage stays on the Ideas shelf; only promoted ideas enter the project pipeline (`unreviewed` first) |

### Part 2 — 6 project stages, compact boxes, spark/project split → **ALL ✅**
| Request | Verdict | Evidence |
|---|---|---|
| 6 types: بررسی نشده / در حال تحقیق / در انتظار اجرا / در حال انجام / توقف توسعه / عملیاتی | ✅ | `PROJECT_STAGES = [unreviewed, investigating, awaiting, doing, halted, operational]` (`src/types.ts:68`) + 0031 |
| Compact dashboard project boxes (button + heading + updated only, no wasted space) | ✅ | `skc-row/skc-title/skc-updated` compact cards — «batch (q) COMPACT dashboard cards» (`app.css:873+`) |
| More pastel colors | ✅ | pastel stage palette (`--st-*-bg` 14% alphas, `app.css:1182–1184`) |
| Differentiate sparks vs projects (A→B→C flow) | ✅ | spark shelf + 7-stage pipeline with legacy mapping |
| Projects-page card metadata spacing (two-line glitch) | ✅ | `pc-head spread` wire-card layout |
| Stage dropdown doesn't register the new value | ✅ | PATCH + in-place `#pd-stage-badge` swap fix (`projects.ts:407–413`) |

### Part 3 — super-admin console → **MOSTLY ✅, one ⚠️, one ❌**
| Request | Verdict | Evidence |
|---|---|---|
| Number of users | ✅ | `GET /api/admin/users` (`admin.ts:52`) |
| Latest activity time of all users | ✅ | `last_seen_at` per row + «Last activity» in UI (`admin.js:140`) |
| **Top 10 users by activity** | ⚠️ | the data (projects/notes counts, `last_seen_at`) is returned, but the users list renders chronologically — **no top-10 ranking view** |
| Emails + usernames per user | ✅ | `username, email` in every row |
| Ban / temporary ban / remove user | ✅ | ban presets + `/users/:id/unban`, `/purge` (`admin.ts:124,323`) |
| Custom email with Hibana logo | ✅ | `POST /admin/email` + branded HTML template with logo |
| Batch emails to all users | ✅ | `POST /admin/email/broadcast` (paged) (`admin.ts:226`) |
| **Which part of Hibana is most active/popular** | ❌ | **no feature-usage analytics** — no per-feature (quick note vs projects vs ideas vs to-do) usage endpoint or admin section exists |
| Current online users | ✅ | presence: online = seen < 5 min (`admin.ts:52–80`) |
| Manual DB backup + download | ✅ | `POST /admin/backup`, `GET /admin/backup/download` |
| GitHub private-repo backup | ✅ | 4× daily cron `17 3,9,15,21` + snapshots repo |
| Send reset-password email | ✅ | `POST /users/:id/send-reset` (`admin.ts:164`) |

### Phase 4 — **ALL ✅**
| # | Request | Verdict | Evidence |
|---|---|---|---|
| 1 | Carousel of project-state boxes, 3 default (تحقیق/انتظار/انجام), rest behind clicks | ✅ | `data-stat-carousel` + 3-visible track + arrows (`app.js:924–964`) |
| 2 | Today's date next to لیست کارها; minimal (no background); calendar + آرشیو + همه وظایف no bg | ✅ | `hdrDate` minimal date (`to-do-list.html:844,109–117`) |
| 3 | Delete a task even from archives | ✅ | `archDelete` 🗑 per archived row (`to-do-list.html:2492–2536`) |
| 4 | Folders for ideas | ✅ | `spark_folders` + folder kanban (0037) |
| 5 | Canvas: merge oval/circle (Shift = perfect circle), soft rounded rect | ✅ | Shift constraint (`canvas.js:1934–1994`); corner radius modernized («Phase 7 item 10», `canvas.js:600`) |
| 6 | Sticky notes on برگه یادداشت (copied from canvas) | ✅ | `whiteboard.js` sticky component (batch s) |
| 7 | Mobile header always visible | ✅ | `.topbar { position: sticky; inset-block-start: 0; z-index: 30 }` (`app.css:439–448`) |
| 8 | Projects page: 2×3 stage grid instead of raw project list | ✅ | `pglance-grid` as the page's main view (`projects.ts:200–208`) |
| 9 | پیاده‌سازی‌شده → **انجام شده** | ✅ | `{ key: 'done', fa: 'انجام‌شده' }` (`projects.ts:337`) |
| 10 | Move مشکل box between ایده‌های جدید and برنامه آتی | ✅ | column order `idea, bug, planned, in_progress, done` (`projects.ts:333–337`) |
| 11 | Remove «جایی که ماندم» heading + new placeholder | ✅ | heading gone; placeholder «یک یادداشت سریع بنویس تا بعدا پیگیری کنی.» (`projects.ts:464`) |
| 12 | Persian digits everywhere in FA | ✅ | `faDigits/toFa/dig()` across renders |
| 13 | Board boxes minimal, no grey/green fill, pd-style | ✅ | «batch (s) ⑬» comment (`app.css:6096`) |

### Phase 5 — **ALL ✅**
| # | Request | Verdict | Evidence |
|---|---|---|---|
| 1 | پیشخوان پروژه‌ها → **پروژه‌ها** | ✅ | «Phase 5 items 1+2» — `h2 «پروژه‌ها»` (`dashboard.ts:307–312`) |
| 2 | «رفتن به بخش پروژه‌ها» link | ✅ | same block |
| 3 | Compact quick notes + done-checkmark for project-linked notes | ✅ | 0038 done flag + check UI; strike-through |
| 4 | Persian numerals in counts (۰) | ✅ | `dig()` on every count |
| 5 | Tag-add button consistent fixed position | ✅ | rendered in a fixed DOM slot after the tag row (`projects.ts:430`) |
| 6 | Sprint overhaul (define, fill, start, finish) | ✅ | sprint drafts + `POST /sprints/:id/start` (0039) |
| 7 | No constant horizontal scroll; **buttons to go back in time** | ✅ | «Phase 5 item 8 … time PAGING — ‹ steps back, › forward (capped at today)» (`sprint.html:33–39`) |
| 8 | Taller glance boxes + relevant icons | ✅ | `pglance-icon` 2.2rem / 3.8rem grid (`app.css:6845–6851`) |
| 9 | Remember user view preferences | ✅ | `hibana-sparks-view` + `NOTE_VIEW_KEY` localStorage (`sparks.html:81–103`, `app.js:2326`) |
| 10 | Remove useless bulk-select button | ✅ | zero `bulk-toggle` occurrences |
| 11 | View modes → ONE «نمایش:» dropdown | ✅ | «Phase 5 item 12 … five views in ONE dropdown» (`projects.html:38`) |
| 12 | New-project CTA consistent | ✅ | `btn` class + i18n |
| 13 | Latin text in sticky notes −2 px | ✅ | `.lat-run { font-size: calc(1em - 2px) }` (`app.css:6826`) |
| 14 | Sticky meta −40% | ✅ | `.note-meta { font-size: 0.48rem }` (`app.css:2723`) |
| 15 | Progress circles appear below task on hover | ✅ | 3-dot `prog-track` on rows (replaced the hover dot — `app.css:1233`) |
| 16 | «افزودن» term + merge the two add buttons | ✅ | «Phase 5 item 16 … ONE merged button» (`project.html:655–663`) |
| 17 | Grey tags + «لیبل‌های پروژه» title | ✅ | «item 17: grey project labels» (`app.css:6876`, `projects.ts:428`) |
| 18 | Remove drop shadow from sticky text | ✅ | «Phase 5 item 18 … shadow belongs to the PAPER ONLY» (`whiteboard.js:132`) |

### Phase 6 — **ALL ✅ (one minor ⚠️)**
| # | Request | Verdict | Evidence |
|---|---|---|---|
| 1 | Notebook doesn't save content | ✅ | save-path hardening: (t) fix 2026-09-01, objectCaching 2026-09-02, CORS 2026-09-06 (`whiteboard.js:137,259,409`) |
| 2 | Full emoji library + search | ✅ | `emoji-picker.js` + `emoji-data.js`; wired to quadrant picker («Phase 6 item 2») |
| 3 | Ideas page view dropdown (kanban/sticky/list/cards) | ✅ | `sparks-view-sel` (`sparks.html:35`) + folder kanban DnD |
| 4 | Navbar: برگه یادداشت next to بوم | ✅ | «Phase 6 item 4» exact order پیشخوان·کارها·پروژه‌ها·ایده‌ها·بوم·برگه یادداشت·تقویم (`partials/nav.html:1–14`) |
| 5 | Theme-toggle hover label readable | ✅ | in-frame `data-tooltip` component replaces clipped native title |
| 6 | Quick notes clamp 2–3 lines + full-note modal | ✅ | «Phase 6 item 6» clamp + `data-note-open` reader modal |
| 7 | Precaution against data loss during iterations | ✅ | backups 4×/day, snapshot schema 20260909, retention 60, restore drill |
| 8 | لغو/ذخیره buttons unresponsive in to-do edit | ✅ | saveEdit/cancelEdit + handlers (`to-do-list.html:1152–1157`) |
| 9 | Progress color coding (در حال انجام orange, شروع نشده grey) | ⚠️ | coding live (orange #F59A4E / grey #9CA3AF) — but معلق is **violet #A78BFA**, the doc asked yellow (`app.css:1182–1184`) |
| 10 | Delete recurring tasks from archive too | ✅ | `archDelete` covers recurring rows (تکرارشونده badge) |
| 11 | Remove Q1–Q4 from archive stats | ✅ | «Phase 6 item 11: the Q1–Q4 prefixes are gone» (`to-do-list.html:2476`) |
| 12 | Same page width; Standard (1366px) / Full-width setting | ✅ | `page-width` CSS + 1366 (`app.css:7127–7134`, `app.js:1707`) |
| 13 | Label option in quick-add | ✅ | «▸ برچسب · مهلت · تکرار» more-options (`to-do-list.html:1161`) |
| 14 | Dashboard tasks follow progress color coding | ✅ | `.dash-todo-task.st-*` backgrounds + 3px crescent (`app.css:1201–1203`) |
| 15 | Sparks empty-state text + CTA + bulb icon | ⚠️ | text «هنوز ایده ای رو ثبت نکردی!» + «ثبت ایده جدید» CTA ✅ (`projects.ts:214–216`) — bulb icon on the CTA not found (text-only button) |
| 16 | در انتظار اجرا → **در انتظار اقدام** | ✅ | `status.awaiting: 'در انتظار اقدام'` (`i18n.js:583`) |

### Phase 7 (first block) — **ALL ✅**
| # | Request | Verdict | Evidence |
|---|---|---|---|
| 1 | Rename-pop redesign (نام / زیرعنوان / نماد + ذخیره-لغو) | ✅ | «Phase 7 item 1: the redesigned pop's لغو button …» (`app.js:1223–1230`) |
| 2 | Multiple notes per task (+ dead button) | ✅ | «Phase 7 item 2 — the '+' used to look DEAD …» fix (`to-do-list.html:1783+`) |
| 3 | ⋯ settings button top corner; no dead space under progress | ✅ | «Phase 7 item 3 … TOP inline-end corner … no wasted white space» (`app.css:1237–1246`) |
| 4 | Smaller dashboard task font | ✅ | «Phase 7 item 4: COMPACT rows» fs-sm/fs-xs (`app.css:1213–1223`) |
| 5 | Less rounded project containers | ✅ | «Phase 7 item 5 … 20px → standard modern 10px» (`app.css:865–872`) |
| 6 | Quick-note hover → pastel blue | ✅ | «Phase 7 item 6: hovering a quick-note card lights it up — pastel blue» (`app.css:2665`) |
| 7 | Smaller, less opaque label chips + margins | ✅ | fs-xs chips, 300 weight, 0.7 opacity (`app.css:6898`, `3136`) |
| 8 | Project-state icons 100% bigger | ✅ | 2.2rem / 3.8rem grid icons (`app.css:6847–6850`) |
| 9 | Canvas «تبدیل به یادداشت» (sticky → quick note) | ✅ | «Phase 7 item 9 — «تبدیل به یادداشت» … copied into the Quick Notes» (`canvas.js:2907`) |
| 10 | Less rounded rectangle tool | ✅ | «Phase 7 item 10: the 64px corners read "too round"» (`canvas.js:600`) |
| 11 | Note-card: entity decode, auto height, +2px font, teal #1F6B70, logical RTL, show-more | ✅ | `decodeEntities` (`quicknotes.ts:128`); «Phase 7 item 11» teal (`app.css:2737–2741`); «بیشتر…» chip + clamp comments |
| 12 | FAB third option «یادداشت سریع» modal (اتصال + ذخیره/لغو) | ✅ | «Phase 7 item 12: the FAB's «یادداشت سریع» modal» (`app.js:556+`) |
| 13 | Skeleton UI (matching grid, shared shimmer, reduced-motion) | ✅ | `sk-topbar` + `.skeleton`/`skel-shimmer` + `prefers-reduced-motion` (`dashboard.html:31–38`, `app.css:4094–4116`) |

### Phase 7 (second block — «Working it right now») → **2 ❌, rest ✅**
| # | Request | Verdict | Evidence |
|---|---|---|---|
| 1 | Idea folders/categories | ✅ | `spark_folders` (0037), folder kanban + drag-to-file |
| 2 | Telegram: new idea / new quick note / see to-do items | ✅ | `/idea`, `/note`, `/list` (+`/done`, `/cancel`, `/status`, `/pause`, `/resume`) (`integrations.ts`) |
| 2 | Telegram: **updating projects / adding new things to existing projects** | ❌ | **no such commands exist** — only capture-as-new-spark; nothing attaches to an existing project |
| 3 | **Latest quick note at top** (newest first) | ❌ | **not implemented** — `ORDER BY sort_order ASC, updated_at DESC` with `pos = COUNT(*)` puts every NEW note at the BOTTOM (`quicknotes.ts:285,334`); identical to the pre-hotfix backup SQL |
| 4 | Compact quick-note containers | ✅ | auto-height + tightened gaps (item 11 batch) |

---

## B. Bottom line for the whole document

**~95 of ~98 request items are implemented and verified in the deployed code** — most
carry literal `Phase N item M` / `batch (letter)` code comments citing this exact
document, so the mapping is self-documenting.

### The misses (what the deployed version does NOT have):

1. **❌ Latest quick note at top** (Phase 7-second, item 3) — new notes still append to
   the bottom of the notebook. One-line class of fix (flip the order: `sort_order DESC`
   + `pos` = min, or render-reverse), but it is NOT in the deployed code.
2. **❌ Telegram bot project-update commands** (Phase 7-second, item 2) — updating an
   existing project / adding items to an existing project from Telegram. Only
   `/idea`, `/note`, `/list` + status/pause commands exist.
3. **❌ Feature-popularity analytics** (Part 3) — "which part of Hibana is most active"
   has no endpoint/section in the admin console.

### The partials/deviations (implemented, but not exactly as written):

4. **⚠️ Top-10 most-active users** (Part 3) — the activity data exists per user, but the
   admin users view is chronological; no top-10 ranking.
5. **⚠️ On-hold progress color** (Phase 6.9) — live and color-coded, but معلق is violet
   `#A78BFA`, not the requested yellow.
6. **⚠️ Sparks empty-state bulb icon** (Phase 6.15) — text + CTA updated; the CTA carries
   no bulb icon.

Plus the pre-existing code item from the earlier ROADMAP audit, still open:
**Notebook dark-mode ink filter inverts placed photos** (`app.css:2320`).

---

## C. ROADMAP.md / NEW_SESSION.md audit (previous pass, still valid)

- `#shots` gallery auto-refresh — **fixed** in the hotfix window (`project.html:93–96`,
  «2026-09-05 repair»: real htmx fragment pull after upload).
- Tasks 23/24 (Sprint v2 + Calendar v2) — **landed** (10 deployments of the window).
- Rate limiting, HTTPS 301, CSRF origin gate, backup retention, Obsidian import, health
  endpoint, PWA icons, zero runtime CDNs, Node self-host path, email pipeline, ban gate +
  presence — **all verified** (`ratelimit.ts`, `app.ts:38–48,100–111`, `backup.ts:153`,
  `integrations.ts`, `health.ts`, `vendor/vazir/`, `email.ts`, `auth/ban.ts`).
- User-held: 6 secrets re-entry, `OPEN_REGISTRATION` close (wrangler.toml:31,47),
  optional Always-Use-HTTPS toggle, exposed-token rotation.
- Never shipped by design: `data/selftest-loop.mjs`, `data/sadhana-selftest.mjs`
  (gitignored, credentials-bound).
