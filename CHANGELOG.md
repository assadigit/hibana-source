# Hibana — Changelog (compacted)

Full spec: `pm-app-spec.md` · Rules (non-negotiable): `CLAUDE.md` · Reasoning: `vision.md` ·
Deploy: `DEPLOY.md` · What's next: `ROADMAP.md` · Session handoff: `NEW_SESSION.md`
Verification: `npm test` (203) · `npm run typecheck` · `npm run smoke` · `npm run drill` · `npm run drill:planb`

## 2026-09-11 — v0.2.0: Plan B Telegram backup channel + performance pass — migration 0044
Data-safety + performance session (design record: `docs/perf-and-data-safety.md`). Deployed dev + prod.
- **Plan B backup channel (the headline)** — a SECOND, independent disaster-recovery path so
  D1 destruction = zero data loss even if GitHub is also unavailable. On the same 4×/day
  backup tick, the worker pushes the **same `buildSnapshot()` output, encrypted with the same
  `BACKUP_ENCRYPTION_KEY` (same HIBENC1 AES-256-GCM format)**, as a silent Telegram document
  (`hibana-backup-<ISO>.bin`, base64 blob — byte-identical to a GitHub snapshot file) to every
  opted-in OWNER's linked chat. Telegram = a 4th independent provider; 50 MB Bot API cap vs
  ~100 KB snapshots; indefinite retention. Gates: prod-only, encryption-mandatory (never
  plaintext to Telegram), owner-scoped opt-in (`users.telegram_backup`, migration `0044`),
  separate failure domain from the GitHub channel. New table `planb_backups` (message_id,
  file_id, sha256, sent_at) powers the drill + retention (keep 60/owner ≈ 15 days, matches
  the GitHub window). The caption carries the sha256 so the **manual** restore path works
  with zero D1/Cloudflare access: download the .bin in any Telegram client → `sha256sum` →
  `restore.mjs`. Newest document is pinned; sends are silent (`disable_notification`).
  Rejected alternatives (reasoning in the design doc): B2/R2/S3 (new account+secret surface,
  deferred), second GitHub org (correlated provider), email-to-self (deliverability), R2
  (same provider as D1), WebDAV (new infra to babysit).
- **Plan B opt-in + control surface** — bot ⚙️ Settings gains a bilingual 🗄 Backup-to-this-chat
  toggle (owner-only: the whole-DB snapshot must never be deliverable to a member chat; the
  `bak` callback is a no-op for members). Manual trigger: `POST /api/admin/backup/planb`
  (owner-only, Zod-validated, rule 10) + `GET /api/admin/backup/planb/status`. Cron wiring in
  `src/index.ts` (backupTick → `scheduledPlanBBackup`, own try/catch + email alert).
- **FIXED (found during E2E verification): the primary GitHub restore path was broken for
  encrypted backups.** The GitHub Contents API decodes the base64 PUT payload before
  storing, so the repo file is the **raw-binary HIBENC1 blob** — but `restore.mjs`'s
  auto-detection only knew the base64-TEXT shape, so the runbook's documented download
  path (`curl download_url -o snapshot.json`) fed binary into `JSON.parse` and crashed.
  Every encrypted GitHub backup since C3 (2026-09-10) was unrestorable via that path.
  Fixed by extracting `scripts/lib-backup.mjs` (shared format detection + decryption)
  and rewiring `restore.mjs`, `restore-safe.mjs`, `restore-drill.mjs`, and
  `restore-drill-planb.mjs` through it: all three file shapes (raw-binary, base64-text,
  legacy plaintext JSON) are now auto-detected. Verified live against the actual prod
  GitHub backup (binary → "encrypted, set key" — was: JSON.parse crash). The primary
  drill (`npm run drill`) was also broken against encrypted backups (it JSON.parsed the
  raw download) — now decrypts Part A with `BACKUP_ENCRYPTION_KEY` (env or .secrets.env)
  and exercises the raw-binary restore path deliberately. 5 new tests pin both shapes
  (`src/tests/backup-formats.test.ts`).
- **Plan B restore drill** — `npm run drill:planb` (scripts/restore-drill-planb.mjs): reads the
  newest `planb_backups` row from prod D1 (Cloudflare REST API), downloads the document via
  Bot API `getFile`, verifies sha256 + HIBENC1 magic, decrypts, checks rule 8 (no
  password_hash/sessions), then round-trips through the REAL `restore.mjs` into a scratch
  SQLite DB with per-table count comparison. Runbook §2b documents the manual + automated
  restore paths and the "Plan B vs primary" decision tree.
- **Performance: service-worker strategy split** (sw `hibana-v226`→`v227`) — versioned app
  assets (`/js/*.js?v=N`, `/css/*.css?v=N`) are now **cache-first** (the URL is the cache
  key; check-cache-bust + SW SHELL discipline make a hit byte-identical to origin — removes
  ~15-25 network round-trips from every repeat visit; hard-refresh still bypasses). Vendor/
  fonts/images/manifest → stale-while-revalidate (instant from cache, background refresh).
  Navigations/API/unversioned URLs keep their existing network-first policies (the
  2026-08-26 stale-pin lesson stays respected). No `public/js` or `public/css` changes, so no
  `?v=` rotations were needed.
- **Performance: HTTP cache headers** — `/` now explicitly `no-store` (matches `*.html`);
  `/dist/*.js|css` → `public, max-age=31536000, immutable` (safe now that `build.mjs` no
  longer copies UNHASHED vendor files into `dist/` — every remaining dist file is
  content-hashed); `/dist/manifest.json` → `no-cache` (rewrites every build). Verified with
  `curl -I` post-deploy.
- **Performance: D1 hot-path measurement (no index additions)** — new
  `npm run perf:explain` (scripts/explain-hotpaths.mjs) runs EXPLAIN QUERY PLAN + timing on
  the dashboard/project/sadhana/canvas/backup queries at busy-solo synthetic scale (500
  projects / 5k notes / 2k tasks / 10k journal / 40k canvas — 25-100× real usage). Every hot
  query is a covered SEARCH via rule 9's existing composite indexes: worst interactive query
  4.91 ms (todo board), journal feed 15.1 ms @10k rows, canvas bbox 29 ms @40k elements
  (~0.3 ms at the real 377). **Verdict: no missing predicates at any realistic scale; D1's
  ~10-40 ms RTT dwarfs query time.** Thresholds documented for future action (journal index
  at >100k rows, canvas partial index at >50k elements). KV/Durable-Objects for hot reads and
  htmx fragment edge-caching evaluated and REJECTED (reasoning in the design doc §2.3).
- **Deferred (documented in the design doc)** — wiring HTML to the content-hashed `/dist/`
  bundles (the biggest future perf lever; needs an HTML rewrite pass + SW SHELL rework);
  admin-console UI button for the Plan B trigger; snapshot chunking (only relevant past
  ~45 MB).
- Cache rotations: sw `hibana-v226`→`v227` (SHELL list unchanged). typecheck clean · 203/203
  tests (11 new: 6 Plan B + 5 backup-format) · smoke ALL PASS · cache-bust PASS. Security:
  GitHub/Cloudflare/Telegram tokens for this session were pasted in chat — rotate per
  runbook §1 (BACKUP_ENCRYPTION_KEY must NOT be rotated: it would orphan every existing
  encrypted backup).

## 2026-09-10 — Telegram bot inline-keyboard redesign + security-audit arc (commits `d46b159`, `165b7b0`, `0c40a09`, `c57c881`, `421f313`)
Changelog catch-up for the previously-unlogged arc (deployed to prod at the time; details from
the commits + `docs/telegram-bot-flow.md` + `docs/runbook.md`).
- **Security audit (`d46b159`)** — CRITICAL: backups encrypted with AES-GCM (`HIBENC1` magic,
  `BACKUP_ENCRYPTION_KEY` secret; hibana-safe history rewritten, 61 plaintext backups purged);
  invite-only registration restored. HIGH: tag transaction race fixes, toast HTML-injection
  fixes, Telegram chat_id uniqueness, CI workflow (typecheck + cache-bust + tests + smoke),
  Telegram-direct backup-failure alerts, canary restore (`restore-safe.mjs`: DEV → verify →
  confirm → PROD). MEDIUM: PBKDF2 600k + lazy rehash, upload/broadcast rate limits, link-code
  GET→POST (CSRF), fabric v5→v6 (ESM shim), runbook + uptime docs.
- **Quick wins (`165b7b0`, `0c40a09`)** — animated loading spinner (rotating + pulsing glow +
  Farsi label); Telegram `/append <project> <text>` (id or fuzzy title match, appends to
  latest_note + history log + deep link); sparks CTA bulb icon.
- **Telegram bot inline-keyboard redesign (`c57c881` design, `421f313` implementation)** —
  home screen with 💡 Idea / 📋 To-do / 📝 Note / ⚙️ Settings / ❓ Help inline keyboards;
  to-do flow renders the user's 4 quadrants (custom names + order) with 8/page numbered
  lists, ✅ mark-done + ↩️ Undo; quick notes with optional 🔗 connect-to-project
  (`quick_notes.project_id`, migration 0017 — zero new schema); bot locale =
  `users.language_pref` (single source of truth, `/language` updates the web locale too);
  state machine in `telegram_bot_sessions` (migration 0043, JSON state, NO TTL — "not
  finite" per design §7); dispatch order callback_query → slash → await_text →
  await_list_item → default idea capture; new commands `/menu` `/language` `/todo`;
  webhook re-registered with `allowed_updates=['message','callback_query']`. Verified
  end-to-end against prod via simulated webhook calls (linking, idea capture, note+connect,
  quadrant grid, task add, mark-done+undo, language switch, pause/resume); test data cleaned
  + account unlinked after. 192/192 tests at the time.

## 2026-09-09 — v0.1.7: search depth + dashboard refinements
Four changes shipped to dev + prod. The gap matrix (`GAP-MATRIX.md`) drove this iteration.
- **FTS5 search depth (migration 0040)** — the single highest-leverage gap. Search now
  covers `quick_notes`, `backlog_docs` (برنامه آتی), `sadhana_tasks` (title + note field),
  and `canvas_elements` (text-bearing types: note/comment/block) — not just `projects`.
  4 new external-content FTS5 tables + ai/ad/au triggers + idempotent backfill. Each query
  respects CLAUDE.md rule 1 (user_id filter) and the base table's soft-delete/tombstone.
  Prod backfill indexed 45 notes · 1 backlog doc · 94 sadhana tasks · 377 canvas elements.
  The command palette (Ctrl+K) renders 5 result groups (Projects / Notes / Upcoming Plan /
  To-Do / Canvas) with distinct icons + localized headers + sublabels; deep links route
  to the right surface (canvas vs whiteboard).
- **Dashboard quick-note widget collapse** — the view/size segmented controls now hide
  behind a single ⚙ `<details>` toggle on the dashboard widget (collapsed by default,
  opens as an absolute dropdown panel); the composer drops from 2 rows to 1 (auto-expands
  on focus). The full Notebook page keeps always-visible controls. The `dashboard` flag
  is threaded via `?dashboard=1` so htmx re-renders preserve the layout.
- **Dashboard kanban signals → 2nd line** — the lighter chips (ideas/backlog/hurdles)
  moved out of the title row into a dedicated 2nd line (`.skc-signals`); the bug bubble
  stays on the title row. A 14rem-min card no longer crowds.
- **Dark-mode notebook paper lift** — `--nb-paper` `#322E2A → #38332E` in both the
  `prefers-color-scheme: dark` block and the `html[data-theme='dark']` block, for clearer
  canvas-vs-bg distinction.
Cache rotations: app.css v192→v193 · i18n.js v27→v28 · command-palette.js (unversioned)→v1 ·
SW hibana-v213→v214. typecheck 0 errors · 191/191 tests green. Deployed dev + prod (live on
hibana.ir). Security: rotate GitHub + Cloudflare + Telegram tokens (pasted in chat during
the session).

## 2026-09-02 — Post-audit hotfixes: project signals + UI refinements — v0.1.6, commits `07338a4`→`37a96bd`
After the audit backlog (Phases 0-5) was complete, the user requested new features + UI
refinements in an iterative session. All deployed as hotfixes (dev + prod) + pushed to GitHub.
- **Project-state signals** (new feature, commit `07338a4`) — notification-style icon+count chips
  on project rows showing what's actionable per project: bugs (🐛 red), ideas (💡 orange),
  backlog (📋 teal), hurdles (⚠️ amber). Batched query (3 queries for all visible projects).
  Shown on dashboard kanban + projects page (cards/list/kanban).
- **Signals layout fix** (commit `9921cb8`) — bigger chips, on the same row as the project name
  (was below it). List view: replaced the `%` progress column with a Signals column.
- **Bug notification bubble** (commit `c41bcef`) — bug count now appears as a standalone solid
  red circle (#dc2626 light / #ef4444 dark) right next to the project name — strong visual
  weight, instant scannability. Other signals stay as lighter chips. Also added: latest backlog
  update time metadata ('Backlog: 2h ago' / 'برنامه: ۲ ساعت پیش').
- **Quick notes compact** (commit `980e96e`) — container padding halved, compose input height
  4.25rem → 2.5rem, note-card padding/gap tightened, delete button smaller. ~40% less vertical
  space per card; fits ~2× as many notes in the same viewport.
- **Quick notes header + attach + gap** (commit `37a96bd`) — controls (view/size toggles) now
  appear FIRST, heading SECOND (near each other, not spread). Attach (اتصال) button smaller
  (padding/font/icon reduced). Content→meta gap tightened (grid gap 0.06rem + p:last-child
  margin zero).
Cache rotations: app.css v186→v192 · app.js v158→v159 · i18n.js v26→v27 · whiteboard.js v7→v8 ·
SW hibana-v207→v213 (6 rotations across the hotfix series).
Source pushed to `github.com/assadigit/hibana-source` (tags `v0.1.5.1` + `v0.1.6`); zip
`Hibana-Alpha-V0.1.6.zip`. Deploy: dev → prod (live on hibana.ir).

## 2026-09-02 — Phase 5: performance/scale + final closeout — v0.1.5, commits `f298570`→`84e297f`
The final backlog phase (deferred until now per "defer until observed need" — executed on user request).
- **P5.1 (F-M1)** — dashboard over-fetch. activeProjects query LIMIT 48 (8 per stage × 6 stages);
  notes query LIMIT 20 + ORDER BY sort_order DESC (was ASC — inconsistent with P1.2's notebook
  page). recentBox() slices to 8 per stage box (the "View all" link already exists). Moved
  resetDueRecurring off the dashboard GET (was a write on every read) to the daily cron —
  iterates all users at the 03:17 UTC tick. Idempotent; daily is frequent enough.
- **P5.2 (F-M2)** — notebook activeNotes LIMIT 100. Every mutation (create/patch/delete/reorder)
  re-renders the full notebook widget; without a cap the re-render grew unbounded. 100 is ample
  for a solo owner; the full notebook lives at /whiteboard.html. The incremental-swap optimization
  (return only the affected card on create/patch) is deferred — requires frontend htmx restructuring;
  the backlog itself says "deferred until observed need." The LIMIT 100 is the safety net.
- **P4.13 (F-L18)** — Vazir variable font: SKIPPED. The variable font file exists (41K vs 129K
  for 3 fixed weights — a ~88K saving), but the backlog warns "verify rendering parity first —
  Vazir's variable build sometimes has hinting differences." Can't reliably verify FA font hinting
  parity in this environment; P4.14 already precaches the 3 used fixed-weight woff2s. Keeping the
  fixed-weight approach — lower risk, already working.
The full audit backlog is now COMPLETE: **39 findings → 37 shipped + 1 skipped (P4.13) + 1
partial (P5.2 incremental swap deferred).** Phases 0-5 all executed.
Source pushed to `github.com/assadigit/hibana-source` (tag `v0.1.5`); zip `Hibana-Alpha-V0.1.5.zip`.

## 2026-09-02 — Phase 4: frontend bundle: #0 photo fix + bilingual/RTL/dark/offline — v0.1.4, commits `d2111ae`→`00142ce`
The big UI phase. All CSS/JS/HTML changes staged, then one atomic SW cache rotation
(`hibana-v207 → v208`). 14 items (P4.13 optional variable font deferred).
- **P4.1 (F-H2, anchor #0)** — dark-mode ink filter no longer inverts placed photos. Counter-filter
  (HueRotation(π) + Invert) at the Fabric-object level in whiteboard.js; MutationObserver +
  matchMedia re-apply on theme toggle. VLM-verified true-to-color in dark + light.
- **P4.2 (F-H3)** `[HIGH]` — auth pages (login/signup/confirm/reset) English-only → i18n.js +
  navigator.language fallback. 46 auth.* keys (EN+FA); i18n.js apply() falls back to
  `/^fa/i.test(navigator.language)` when /api/auth/me returns 401.
- **P4.3 (F-M17)** — notebook image-from-link `prompt()` → styled popover (ported from canvas page).
- **P4.4 (F-M15)** — mobile `theme-color` meta tracks the theme (#1E1A15 dark / #FAF9F6 light).
- **P4.5 (F-M16)** — `:not([data-theme='light'])` guards on 2 unguarded dark blocks.
- **P4.6 (F-M18)** — Persian "On hold" متوقف → معلق (paused, not halted).
- **P4.7 (F-M19)** — sprint time-paging ‹/› → inline SVG chevrons + RTL mirror.
- **P4.8 (F-M20)** — verify-code input accepts Persian digits (pattern + server-side normalize).
- **P4.9 (F-L22)** — jalaali.min.js defer on sprint.html + board.html.
- **P4.10 (F-L23)** — index.html bilingual `<noscript>`.
- **P4.11 (F-L24)** — unified 3 undo-toast builders to the canonical `actions` API.
- **P4.12 (F-L25)** — 404.html lang + mobile-nav label wrap (390px) + manifest lang.
- **P4.14 (F-M5)** — Vazir Regular/Medium/Bold woff2 in SW precache (offline FA font).
- **P4.15 (F-L27)** — task-controls.css in SW SHELL.
- **P4.13 (F-L18)** — Vazir variable font: DEFERRED (optional; rendering parity risk).
Cache rotation (one commit): `app.css v186→v187 · app.js v158→v159 · i18n.js v26→v27 ·
whiteboard.js v7→v8 · SW hibana-v207→v208`.
Source pushed to `github.com/assadigit/hibana-source` (tag `v0.1.4`); zip `Hibana-Alpha-V0.1.4.zip`.

## 2026-09-02 — Phase 3: reliability & observability + /app 404 hotfix — v0.1.3, commits `465ccd1`→`ac21265`
- **HOTFIX** (commit `465ccd1`): `/app` (and `/register`, `/signup`, `/to-do-list`, `/timeline`)
  returned 404 on Cloudflare. Root cause: `wrangler.toml` had `not_found_handling = "404-page"`
  which made the assets binding serve `/404.html` for ANY unresolved path — including Worker-
  served routes with no corresponding `.html` file. Those routes never reached the Worker. Fix:
  `not_found_handling` → `"none"` (assets binding passes unresolved paths to the Worker, whose
  `app.get('*')` serves the branded 404 itself). Live-verified on dev + prod.
- **P3.1 (F-M12)** `[the multiplier]` — structured logging + request id. New `src/lib/log.ts`
  emits JSON lines `{ ts, level, event, reqId, ...fields }`. Per-request middleware generates
  `reqId = crypto.randomUUID()` first; `onError` logs `api_error`/`unhandled_error` with the
  reqId, path, code/detail or message/stack. `ratelimit.ts` + `admin.ts` console calls →
  structured logs. Added owner-email alert on backup failure (pairs with P3.5).
- **P3.2 (F-M3)** — multi-line hurdle create + Obsidian import wrapped in transactions. The
  hurdle composer loop (up to 50 INSERTs) + the Obsidian import loop (~200 iterations) were
  sequential non-atomic round trips; now batched in one `cfg.db.transaction` each.
- **P3.3 (F-L1)** — session + user lookup joined in one query. Was 2-3 D1 round trips per
  authed request (validateSession SELECT + maybe DELETE/UPDATE, then SELECT * FROM users);
  now a single JOIN. Extend-on-activity + expired-session-cleanup are fire-and-forget via
  waitUntil (same pattern as P1.3's presence stamp).
- **P3.4 (F-L2)** — rate limiter single UPSERT. Was SELECT + INSERT/UPDATE (2 round trips);
  now `INSERT ... ON CONFLICT(key) DO UPDATE ... RETURNING (count > limit) AS over` (1 round
  trip, atomic).
- **P3.5 (F-M4)** — backup OOM, tiered. (c) alert-on-throw (structured log + owner email —
  shipped in P3.1). (b) release transient json/bytes/bin references as the base64 builds so
  the peak doesn't hold all four. (a) Git Data API (the real OOM fix) deferred until (b)+(c)
  prove insufficient at the solo-owner DB size. P2.5's table drops already shrank the snapshot.
Source pushed to `github.com/assadigit/hibana-source` (tag `v0.1.3`); zip `Hibana-Alpha-V0.1.3.zip`.
Deploy: dev → prod. `wrangler tail --format json` now shows structured logs with reqId.

## 2026-09-02 — Phase 2: security hardening (audit execution) — v0.1.2, commits `f347d6e`→`3b64d85`
Execution of the Phase 2 backlog: 7 server/docs-only findings on the auth/captcha/crypto
surface. Each one commit through the full ladder (typecheck 0 errors · 191/191 tests ·
E2E :8787). No cache bump, no SW rotation.
- **P2.1 (F-M6)** `[MEDIUM — anchor]` — captcha token leaked operands. Was `a.b.op.expS.sig`
  (split by `.` → a/b/op recovered). Now `question.expS.sig` — HMAC-signs the question
  string; operands visible in the question but no longer pre-split for bots. Live-confirmed
  during the audit; now closed.
- **P2.2 (F-L28)** — extracted `timingSafeEqual` (byte) + `timingSafeEqualStr` (string) to
  `src/lib/crypto.ts`. Replaced 3 duplicates (password.ts, captcha.ts, integrations.ts).
- **P2.3 (F-L12)** — `verifyEmailCode` hash compare `!==` → `timingSafeEqualStr`. All three
  crypto-compares (PBKDF2, HMAC sig, email-code hash) now constant-time.
- **P2.4 (F-L13)** — email-code `b % 10` modulo bias → rejection sampling (accept < 250 for
  uniform 0-9). Digits now uniformly distributed.
- **P2.5 (F-L14+F-L15)** — dropped `password_resets` (transient) + `changelogs` (dead table)
  from `SNAPSHOT_TABLES`; `schema_version` 20260909 → 20260910. Removed the dead
  `changelogs_fts` query from `/api/search` (was a wasted DB round trip returning nothing).
- **P2.6 (F-L10)** — documented `x-forwarded-for` spoofability on the Node path in DEPLOY.md
  (run behind a trusted proxy; Cloudflare Workers path unaffected).
- **P2.7 (F-L11)** — documented the rate-limiter fail-open tradeoff (deliberate: keeps the
  app usable during D1 hiccups; CF WAF rule is the primary defense).
Source pushed to `github.com/assadigit/hibana-source` (tag `v0.1.2`); zip
`Hibana-Alpha-V0.1.2.zip`. Deploy: dev → prod.

## 2026-09-02 — Phase 1: critical safety + reliability (audit execution) — v0.1.1, commits `199cc6e`→`736e187`
Execution of the Phase 1 backlog (`TECHNICAL-BACKLOG.md`): 8 server/docs-only findings,
each one commit through the full verification ladder (typecheck 0 errors · 191/191 tests ·
E2E :8787 FA/RTL + EN/LTR). No cache bump, no SW rotation (Phase 1 is server-only).
- **P1.1 (F-H1)** `[HIGH]` — screenshot upload cap 140 MB → 5 MB + Content-Length guard (413
  before buffering). Defused the single highest-severity finding (Worker OOM). The 140 MB
  Zod cap falsely claimed "well under GitHub's 100MB cap" — it exceeded it.
- **P1.2 (F-M8, pre-seeded #2)** — newest quick note at the top. `ORDER BY sort_order ASC`
  → `DESC` (new notes, pos = COUNT(*) = highest, now render first) + drag-reorder iterates
  `[...ids].reverse()` so DESC stays consistent after a manual drag. 2-line server-only fix.
- **P1.3 (F-L9)** — presence-stamp `UPDATE users SET last_seen_at` wrapped in `ctx.waitUntil`
  (try/catch-guarded: Hono's `c.executionCtx` throws outside Workers). Stops the admin "online"
  dot from reading stale on Workers.
- **P1.4 (F-L3)** — scheduled handler: `Promise.all([backup, purge, sweep, reminders])` →
  sequential `await`. Backup + reminders no longer contend for the Worker's subrequest budget.
- **P1.5 (F-L4)** — `GET /api/canvas?maxX=abc` NaN guard. `Number('abc')` → NaN → silent
  empty canvas; now finite-guarded to fall back to the open default (1e9).
- **P1.6 (F-M13)** — documented the D1 transaction footgun: reads inside `transaction(fn)`
  see PRE-batch state; convention codified (write-only batches; atomic RMW → single
  `INSERT...ON CONFLICT...DO UPDATE...RETURNING`). Doc-only.
- **P1.7 (F-L6)** — `tech-stack.md` refresh: 27→38 migrations / schema 0027→0039; cron
  daily→4×/day; +12 frontend JS modules; Turnstile→CAPTCHA_SECRET_KEY (math captcha);
  tests 181→191.
- **P1.8 (F-L7)** — `CHANGELOG.md` header test count 189→191.
- **P1.9 (F-L17)** — `d1_migrations` bookkeeping backfill on live D1 (dev+prod). ⚠️
  APPROVAL-GATED live-DB write — **deferred**, not run this phase. The live DBs are already
  at schema 0039; the backfill only makes `wrangler d1 migrations apply` a no-op. Will run
  only on Ali's explicit written approval.
Source pushed to `github.com/assadigit/hibana-source` (tag `v0.1.1`); zip
`Hibana-Alpha-V0.1.1.zip`. Deploy: dev (`hibana.aliassadi.workers.dev`) → prod (`hibana.ir`).

## 2026-09-05 — Calendar v2 + project stage editing (Task 24) — commit `ddb3aa4`, DEPLOY PENDING (no migration)
- Calendar `/calendar.html`: «هفته بعد»/«ماه بعد» now land on the EXACT focused day (same
  weekday +7d; same day-number next Jalali/Gregorian month, clamped; chains from the selected
  day — 7 شهریور → 14 شهریور → ۱۴ مهر), highlight it, open its panel. «امروز» resets. Heading
  shows the displayed month («شهریور ۱۴۰۵») instead of «تقویم». Day pins ALWAYS all render:
  ≤4 → 24px, 5–8 → 16px, 9+ → 11px («+N more» badge removed).
- شمسی|میلادی segmented switch (`localStorage hibana.calSys`, default follows language):
  view re-anchors on the selected date; weekend striping per system (جمعه vs Sat+Sun, localized
  DOW headers + legend); REAL Jalali holidays stay visible in Gregorian mode via an ISO-keyed
  flags map; weekday names follow UI language, not calendar system.
- Legend dots (project/task/to-do/note) are draggable onto any day → opens that day's panel with
  the matching composer: NEW project composer (title + stage → POST /api/projects), NEW client
  task composer (project picker → POST /api/projects/:id/tasks), note/sadhana reuse existing
  forms. Mobile via long-press (touch-drag.js already covers `[draggable=true]`).
- Projects + Sparks edit dialogs gained the missing stage (status) select — the idea →
  in-progress path — PATCHed with history logging; promoting a spark off «ایده» removes it from
  the shelf (live-verified).
- Real pre-existing bugs fixed: htmx 2.0.4 fires the `load` trigger exactly once at init →
  sparks `reloadShelf()` and settings invite-list `htmx.trigger(el,'load')` were silent no-ops
  (switched to explicit `htmx.ajax` refetch); shelf-loading indicator lived INSIDE the swap
  target («hx-indicator returned no matches» spam). Open (documented): project.html #shots
  gallery doesn't auto-refresh after upload (needs a GET fragment endpoint).
- css v163 (20 pages), i18n v14 (15 pages), sw `hibana-v178`. 189/189 + typecheck + browser E2E
  (FA/RTL, EN/LTR, dark, 390px) green. NOT deployed — Cloudflare token absent that session;
  exact deploy commands in `NEW_SESSION.md`.

## 2026-09-04 — Sprint board v2: video-editor timeline (Task 23) — commit `49bd6d9`, DEPLOY PENDING + D1 migration 0030
- Server: migration `0030` adds `dev_tasks.start_at/end_at` (NULL = automatic created→done|today
  bar; a value pins that edge). POST/PATCH accept ISO clip edges (end>start when both sent;
  one-edge PATCH; explicit null clears back to automatic). New tasks AUTO-ASSIGN to the
  project's open sprint (explicit null opt-out). Creating a sprint closes the open one
  (start−1d, or AT the new start if it opened today — sprints touch, never share a day).
  `PATCH /api/sprints/:id` full boundary editing with day-granularity non-overlap vs siblings
  (open sprint = +∞) + single-open-sprint + reopen-only-latest guards. NEW
  `POST /api/projects/:id/categories/reorder`. All invariants verified by a 49-point live-route
  harness over the real app + migrations.
- Client `sprint.html` rewrite: draggable dashed sprint boundary rails with grips (drag line =
  move boundary, incl. dragging out an end for the open sprint; drag band body = slide both
  edges), trim handles on BOTH clip edges (clear-at-today / clear-at-creation restores auto),
  zoomable real calendar — 1W day cells · 1M week columns · 3M/6M/12M month columns, Jalali
  month names (FA) / Gregorian (EN) + ISO/Jalali week numbers, every zoom centers today, free
  panning. Flat minimal restyle (hairline grid, zebra sprint bands, zero shadows, solid pastel
  bars). Sidebar drag-reorder: category order → lane order, item order → bar stacking;
  per-category eye/✎/✕ tools (rename + 8 pastel swatches; delete → items fall to Uncategorized),
  quick-add composer.
- E2E-caught real bugs: `.sp-bound` inherited `pointer-events:none` from `.sp-bg` (rails
  ungrabbable); `.sp-bg z-index:0` trapped z-4 rails below z-1 lanes; zoom change didn't
  recompute the range; server auto-close could invert a future-started open sprint's range;
  sw SHELL carried stale asset versions (devboard v3/i18n v11/canvas v5 → aligned).
- css v162, i18n v13, devboard v5, sw `hibana-v177` (superseded by Task 24's v178 same repo).
  FA/RTL + EN/LTR + dark + 390px E2E green. Deploy = migration 0030 to BOTH remote D1s first,
  then both workers — exact commands in `NEW_SESSION.md`.

## 2026-09-03 — Batch 22: 4-block refinement wave — deployed dev `38b8265c` / prod `36d0598e`, sw v176
- Calendar: REAL off-by-one-YEAR Jalali bug in the page's inline jalaali port (`_d2g` divisor
  `div(10−gm,6)` vs `div(8−gm,6)`) — every Gregorian March/April conversion returned a year
  late (Farvardin/Esfand grids fetched AND stored against wrong years); fixed + 8-year sweep
  (976 → 0 mismatches). Plus deletable day items, 24px pin restyle (ring+gloss+shadow),
  Friday weekend stripes (holidays keep red), right-click day menu (note/task/sticky), nav
  jump buttons, kind·date·text tooltips.
- Sadhana: hover ✎ pen on quadrant titles, editable subtitle everywhere (board + dashboard),
  progress-state task tints (untouched grey / in-progress orange / hold yellow) on neutral
  quadrants, crisp themed 1px edges, zero shadows, load-time black strip fixed (private
  `.sadhana-loading` — app.css class collision).
- Canvas/Notebook: sticky dblclick REAL inline editing (top-level fabric twin — group
  enterEditing is broken by design), × deletes on first click in any tool (capture phase),
  7-swatch recolor palette (persists, undoable), nameable frames, dot grid painted on the
  fabric lower canvas (the twice-reported solid-grey board is structurally impossible),
  Figma click=select/dblclick=edit + Ctrl+Z/X/C/V/A semantics audited end-to-end.
- Project page: create → detail redirect + Save button, pastel transparent «پیشرفت پروژه»
  columns, priority dots recolored (grey/amber/red — was all blue), cross-box drag & drop
  (optimistic PATCH + rollback + same-box reorder), compact placeholder-less composer,
  Jalali + clock meta line (done frozen at done_at ✓), unified pale-red delete button.
- Sprint: full-bleed board, ✎ category color popover, timeline scale-mismatch ROOT CAUSE (two
  independent px scales — the «task lands beyond September» report). Misc: mic removed from
  quick-add, hint lines removed, RTL-safe quick-note placeholders, smaller FAB/meta/placeholders.
- css v160, app.js v146, i18n v12, canvas v6, devboard v4.

## 2026-09-03 — Project card redesigned to the wireframe (Task 21) — deployed, css v159, sw v175
- Projects grid card + Ideas shelf match the user's sketch: [Updated: n minutes ago] + stage
  pill head row, centered large title + smaller description, tag-colored HATCHED corner
  triangle clipped to the 20px radius (RTL-mirrored); chips/progress/hurdles row dropped from
  the card face. 390px sideways-scroll eliminated via header wrap.

## 2026-09-02 — 14-point polish batch (Task 20) — deployed, sw v174
- Airy dashboard (2.9rem section rhythm, 20/14px radii, small title-aligned «تعداد فعال»
  counter, 40-emoji symbol picker, no Ctrl+N hints); minimal board heroes (no fill/border/
  badges/pill-counts), transparent filter tags, no hover lift; notes fully add/delete/EDITABLE
  inline (two real bugs: unquoted id in Enter handler + missing text/ts in POST response);
  drag & drop sorting actually works for the first time on the board (unquoted handler ids,
  pinned block locked top, long-press touch); FAB adds appear on the board in realtime;
  calendar pins + legend +30%. css v158, app.js v145, task-controls v3.

## 2026-08-29 — Self-healing board + inline quick-add + deleted-project 404 UX (Tasks 18–19) — deployed, sw v173
- board.html/sprint.html self-heal a missing devboard.js whatever nav.js/SW version the user's
  browser runs; only after a real 9s timeout do they report failure (FA) with a retry button —
  the «Couldn't load the board» dead-end is structurally gone. Quick-add moved INTO the
  project page's four boxes (per-column inline composer, Enter creates, counts/chips/progress
  update instantly, no navigation). Deleted projects explain «این پروژه وجود ندارد یا حذف
  شده است» + back link (retry reserved for transient failures). devboard v3
  (status-carrying errors), i18n v11.

## 2026-08-29 — Project detail redesign + kanban + sprint roadmap (Tasks 16–17) — migration 0029, deployed, sw v170/171
- New dev-task entity (separate from hurdles): stages New Ideas → Planned → In Progress →
  Implemented, priorities Low/Medium/High/Urgent, free user tags, categories, open-ended
  sprints. Project page redesigned to the user's sketch (stage badge, hover-edit title,
  autosaving description, editable pastel tag chips, 4-column board preview, sketch tab
  order). New pages: fullscreen kanban `/board.html` (drag between stages, editor with
  priority/category/sprint/tags) + `/sprint.html` roadmap (Jalali/Gregorian timeline, auto
  bars created→done(today), open-ended sprints, task drag between sprints, day/week/month
  zoom, full RTL). Everything date-automatic — no date pickers.
- Follow-ups (17): soft navigation transports external scripts in order (the stuck-«در حال
  بارگذاری…» class of bug is structurally gone), popovers honor `[hidden]` again, the four
  boxes always render (empty projects too, hint+CTA above), Jalali board cards, 390px RTL fit.

## 2026-08-29 — UI/UX passes (Tasks 11–15) — deployed across sw v162–v169
- 11: today-ring + active chip removed, near-white bg, Sadhana Telegram → Settings, instant
  archive + in-app restore (Monday sweep = legacy fallback), canvas free text tool, فعالیت
  merged into گزارش‌ها as a full activity box (standalone page + nav gone, 301s).
- 12: calendar day creators (sticky note / quadrant task / day note — migration 0028
  `quick_notes.note_date` + `sticky`, applied to all three DBs), FAB New Task + New Project at
  the physical bottom-right, canvas dot grid matching the reference screenshot.
- 13: quadrant rename pen + emoji picker (board + dashboard), Jalali task dates fixed at the
  source (user record, not a defaulting localStorage getter), calendar task delete, brand-teal
  design-system colors, RTL placeholders, Figma text-tool semantics, REALTIME sticky text
  (fabric group cache was eating keystrokes), Ctrl+Z/X/C/V/A, visible dot grid, quadrant edges.
- 14: sticky ×-delete works in all modes + in-place downward-only overflow growth (fabric
  `_calcBounds` frame-math fix), calendar system fully automatic by locale (toggle removed),
  progression-colored task cards on neutral quadrants, editable quadrant SUBheadings, pin-style
  14px day markers.
- 15: project card headings show EVERY character (wrap over lines; ⋯/badge/time locked to the
  first title line, all surfaces, both locales).

## 2026-08-28→29 — Audit hardening + Sadhana replica + mobile/i18n + design system (Tasks 2–10) — deployed
- Phase 1 (critical, from the 4-agent audit): `/api/export` user scoping (was an unscoped
  snapshot leak), purge owner check, stored XSS in Quick Find highlight (fragment build, no
  innerHTML), dev github-ping owner gate, security headers, zip-bomb guard, dead duplicate
  route files deleted, offline queue no longer drops data on 401/403, i18n quick wins.
- Phase 2 (read-path): sadhana journal bounded by task lifecycle, ETags on every polled read
  surface, 30-min reminder cron in ONE query (was N+1 per user).
- `/to-do-list` rebuilt as a faithful replica of the original Sadhana app
  (sadhana.pythonanywhere.com — logged in as a real user, screenshotted, replicated + upgraded)
  on Hibana's Hono/TS stack with zero schema changes, then integrated: unified header (no
  separate Sadhana heading) and the ENTIRE app restyled to the Sadhana design system (warm
  sand, cream cards, teal accent, 16px radii, soft shadows).
- Mobile + i18n pass: header-less mobile ≤1024px with translated 5-tab bottom bar + More
  sheet; to-do list shows only Q1 Today + Q3 Urgent side-by-side on phones (show-all escape
  hatch); every mixed-translation gap closed (calendar Jalali race root-caused to a
  boot/alpine/i18n load-order bug → the `hibana:i18n` event now solves it generically); login
  errors distinguish network failure (bilingual) from server rejection. Long-standing deploy
  blocker cleared mid-session (user-supplied Cloudflare token) — Tasks 6–9 went live.

## 2026-08-25 — Sadhana: standalone quadrant task board (spec full reverse-engineering, deployed DEV + PROD)
- New top-level feature at `/sadhana.html` (nav link added): a personal 2×2 quadrant
  board per the Sadhana spec — Q1 Today / Q2 Strategic / Q3 Urgent & High Value /
  Q4 Personal & Sentimental, with **renamable quadrants** (§5.19, migration 0018
  `sadhana_quadrant_names`; empty/>60 rejected, null resets, per-user).
- Tasks (migration 0018 tables): emoji, fuzzy deadline presets (tom/48h/week/mon/3mo/
  6mo/ny — labels only, never overdue §6.10), exact deadline + time with overdue ⚠,
  fixed five tags (w/p/sg/so/h), notes, progress track, pin, manual order, soft delete
  with 5s undo toast + Ctrl/Cmd+Z, per-task update journal, recurrence
  (daily/weekly Mon=0/ndays/monthly) with completion history + board-load auto-reset,
  Monday sweep (recurring tasks excluded — spec §8 Q1 resolved), archive page with
  stats + completion log, focus (zen) view, drag move/reorder, client-side tag
  filtering with live counters. EN/FA via trL + `[data-date]` dual-calendar display.
- Reminders: daily cron pass → linked Telegram chat, kinds 7d/3d/1d/0d/2h, one per
  (task, kind) ever (§6.19; 30-min cadence documented as optional follow-up).
- All in `src/routes/sadhana.ts` + `src/services/sadhana.ts` (pure date/recurrence/sweep
  logic, date-injectable for tests). 163 vitest (+13), typecheck + smoke PASS. SW
  `v73 → v74`; D1s dev+prod on 0018; deployed dev `fe0bcec4`, prod `4d9c7ae5` (commit
  `250441d`). Live probes: `data/sadhana-live.mjs` (auth round — requires valid creds).

## 2026-08-25 — Login CAPTCHA removed; Turnstile stays on signup only (deployed DEV + PROD)
- Ali's ask: drop the Cloudflare Turnstile widget from sign-in. The login token was
  already presentational (never server-verified — deliberate so login can never be
  locked out by a captcha outage; the 30 req/60s/IP rate limiter is the real login
  guard), so this is a pure frontend removal: `public/login.html` loses the config
  script, the `api.js` script tag, and the widget div; the form submits immediately.
  Signup keeps the full CAPTCHA (widget + fail-closed server verification). Server
  unchanged; tests unchanged (login never touched Turnstile). SW `v72 → v73`.

## 2026-08-25 — Telegram bot commands + quick-note ↔ project attachment (deployed DEV + PROD)
- **Bot is now a real capture tool, not just an idea pipe** (commit `3890bb2`):
  `/note <text>` adds a Quick Note to the dashboard notebook; `/list` opens a
  conversational list mode (items one per message, `/done` saves a checkable list
  note, `/cancel` discards); `/idea <text>` is the explicit alias of the plain-text
  capture; `/help`/bare `/start` greet with the command list (linked- or
  unlinked-aware); unknown commands get a help pointer instead of a junk capture;
  bare `/note`/`/idea` reply with usage. List sessions persist in migration `0016`
  (`telegram_note_sessions`), expire after 2h of silence (stale sessions never
  swallow an idea), max 50 items. Unlinked chats: commands get link-first
  instructions, only free text is captured.
- **Quick notes attach to Ideas/projects** (commit `e245117`): migration `0017` adds
  `quick_notes.project_id` (no FK cascade by design — a project purge must never
  delete notes; orphans render as unattached). Every notebook card gains an
  Attach button (paperclip → picker of the user's live projects → chip linking to
  the project page; ✕ detaches). The project page gained a “Related notes (n)”
  section (rule 1: only the owner's notes, both views server-rendered htmx).
  New endpoints: `GET /api/notes/attach-picker`, `GET /api/notes/attach` (widget),
  create/PATCH accept `project_id` (foreign targets → 400 `project_not_found`).
  150 vitest (+15: 10 bot commands + 5 attach) + typecheck + smoke PASS. SW
  `v71 → v72`; D1s dev+prod on 0017; deployed dev `6dc645db`, prod `ce00bb07`.

## 2026-08-25 — Telegram account linking: OPEN to every user (deployed DEV + PROD)
- Any signed-in user can now link their own Telegram chat from Settings → Telegram
  (was owner-only: non-owners got 403). Settings now shows link state (Linked/Not
  linked yet badge), the bot handle as a t.me link, the two steps
  (open @Hibana_PM_bot → send `/start <code>`), a Generate-link-code button (auto-
  copies, one active code per account) and an Unlink button. Codes expire after 1h
  (webhook rejects expired rows; generation sweeps them globally); unlinking clears
  the chat mapping + codes but keeps captures already assigned (rule 1).
  New endpoints: `GET /api/telegram/link-code` (any authed user),
  `GET /api/telegram/status` (bot handle + linked state),
  `DELETE /api/telegram/link` (unlink). i18n EN/FA complete. 135 vitest (+7),
  typecheck + smoke PASS. SW `v70 → v71`; deployed dev `b7269da6`, prod `1d9633a5`
  (commit `f9245b9`). Live-verified: status 401 anonymous on both workers, settings
  page serves the new card on hibana.ir, SW v71 served.

## 2026-08-24 — Signup email UNBLOCKED: verified domain sender (deployed DEV + PROD)
- Ali verified `hibana.ir` in Resend (auto-configured via Cloudflare). The email service
  now sends from `Hibana <noreply@hibana.ir>` (commit `732d1ea`), and the owner
  test-email endpoint accepts `?to=` to prove non-owner sends. **Proof**: dev + prod
  workers both 200 on the real signup template to a non-owner address
  (data/email-verify-probe2.mjs). The full signup chain is now live and Ali's real
  signup is the final human check. Deployed: dev `88b62c91`, prod `3aecd8e2`.

## 2026-08-24 — Signup email root cause: Resend shared-sender restriction + 4-box verification modal
- **The confirmation email could never reach a new signup**: Ali signed up with an email
  other than the owner address and got “We couldn't send the confirmation email”.
  Resend's shared sender `onboarding@resend.dev` only allows sends to the account owner's
  own address — the API returns 403 with exactly that explanation: “You can only send
  testing emails to your own email address… verify a domain at resend.com/domains”. My
  probes always mailed the owner address, so they always passed; the register path sends
  to the signup's address → 403. **Fix (Ali-held, ~4 min)**: add `mail.hibana.ir` as a
  domain in Resend (resend.com/domains → Add domain), paste the shown DNS records into
  Cloudflare (hibana.ir zone → DNS → Add record; they must be DNS-only, not proxied),
  click Verify in Resend. Then the agent flips `email.ts` `from` to
  `Hibana <noreply@mail.hibana.ir>` and redeploys. Resend key is send-only (domain
  creation needs the dashboard); the wrangler token can't write the zone's DNS (401).
- **Ali's UI spec (deployed, `2b4e86d`)**: after signup the page now opens a **modal with
  four code boxes** (`[ ] [ ] [ ] [ ]`); the emailed code is **4 digits**; entering it
  verifies (JSON → `/api/auth/verify`) and redirects straight to the dashboard; a Resend
  button sits in the modal (60s cooldown messages). Backend codes 6→4 digits (schema,
  generation, tests, confirm.html fallback updated). Register htmx redirect now carries
  `?verify=1&email=…`. 128 vitest + typecheck + smoke PASS. SW `v69 → v70`; deployed dev
  `d244614c`, prod `b3e7b06c`.

## 2026-08-24 — Signup submit no longer silent: htmx-visible errors + token field name fix (deployed DEV + PROD)
- Ali: “Create account is lit, but when clicked it does nothing.” Root cause (reproduced
  locally with a real browser): two compounding bugs. (1) htmx only swaps 2xx/3xx
  responses, so every JSON 4xx/5xx — expired captcha token, missing field, rate limit —
  was silently dropped: the exact “nothing happens”. (2) The real form sent the token as
  the widget's native field name `cf-turnstile-response`, but the API schema required
  `captcha` — so every real submission failed validation. Fixes: every register/login/
  reset error path returns a swappable htmx fragment (incl. a dedicated “tick the box
  again” for expired tokens), the schema accepts both field names (empty strings =
  absent), and signup.html mirrors the token into its own `captcha` input + gives instant
  client-side feedback pre-round-trip. Reproduced end-to-end locally: POST → 200 +
  visible error. 128 vitest (2 new), typecheck + smoke clean. SW `v67 → v69`; commits
  `d1b1cf7`. Live: dev `2664bcb0`, prod `fc083ab5`; prod form-encoded POST returns the
  fragment (not silent). NOTE: the login page's Turnstile widget stays presentational
  (token not server-verified there — deliberate, so Ali can never be locked out of login;
  the rate limiter is the real login guard).

## 2026-08-24 — Signup button-enable race fixed (deployed DEV + PROD)
- Ali: captcha now shows + ticks, but “Create account” stayed off. Root cause: Turnstile's
  success callback can fire while the page is still parsing — before the submit button
  exists — so the old callback threw on a missing node and nothing ever re-enabled it
  (same race family as the render fix). Now: null-safe callback (direct function, not a
  name string), the widget id is captured, and a DOM-ready re-check enables the button
  when the token already landed. Verified locally in headless Chrome against all three
  paths (rest-disabled, token-present→enabled, callback-before-button→no-throw); 126
  vitest + typecheck + smoke PASS. SW `v66 → v67`; commits `0e3de38` (+ docs `f35fdb9`).
  Live: dev `1dcc19ad`, prod `75d074ff`, /signup serves the new code.

## 2026-08-24 — Signup saga closed: malformed-comment root cause + fresh page URLs (deployed DEV + PROD)
- **Root cause of every signup failure today**: `public/register.html` carried a malformed
  HTML comment ending in `--/>` (introduced with the Turnstile render-race fix, commit
  `408bd14`). The parser treats it as an unclosed comment, so the rest of the document —
  including the `<body>` element and its `public-page` class — was swallowed/derailed in
  the DOM: the widget zone misbehaved (“no captcha, button lit-off”) and the app.js auth
  guard found no `public-page` class and bounced guests to `/login` (the login page,
  whose comment was well-formed, never broke). Fixed to `-->` (commit `0d0d488`).
  Verified in headless Chrome: body class now intact at every load timing, scripts on AND
  off; local click-through login → signup stays put.
- **Fresh page URLs (cache hygiene + defense in depth)**: the assets binding had also
  cached broken variants under `/register` + `/verify` (a 9-byte body, attribute-stripped
  pages), so the pages now live at **`/signup` + `/confirm`** (renamed files); the old
  URLs 301 there; explicit worker routes cover extensionless access on the Node path;
  the app.js guard now also exempts public paths by URL; links + htmx HX-Redirect targets
  updated; SW `v65 → v66`. Live-verified on prod: `/signup` 200 with the class intact,
  `/register` → 301 → `/signup`, `/verify` → 301 → `/confirm`, headless click-through
  ends on `/signup` with the correct title + class.

## 2026-08-24 — Registration + Turnstile CAPTCHA + email-code verification (spec §4.14 extension)
- Ali's ask: a registration form (username / email / password + CAPTCHA), password reset
  (ALREADY existed — email reset link + Telegram secondary shipped earlier), and account
  confirmation via an emailed code. Decisions (his answers): **temporarily OPEN signup**
  (flip back to invite-only by removing `OPEN_REGISTRATION` from wrangler.toml),
  **login blocked until verified**, Turnstile on register AND login (best practice),
  username required.
- **Migration `0015`**: `users.email_verified_at` + `email_verifications` table (hashed
  6-digit code — never raw, 15-min TTL, 5-attempt cap then invalidate, 60s resend
  cooldown, rule 9 index). Existing accounts are marked verified at `created_at` — the
  migration runs BEFORE the code deploy so nobody gets locked out.
- **API**: `POST /api/auth/register` — CAPTCHA first (fail-closed: 503 `captcha_unconfigured`
  while the secret key is unset), precise duplicate errors (`email_taken`/`username_taken`),
  invite gate enforced only in closed mode, creates an UNVERIFIED account, emails the code,
  **rolls the account back if the email send fails** (no stranded users behind 409s); no
  session until verified. `POST /api/auth/verify` (email + code → session → /app; an
  already-verified account is REFUSED here — the idempotent shortcut would have been a
  passwordless login, caught in review). `POST /api/auth/verify/resend` (cooldown, no
  existence leak — same policy as reset/request). Login returns 403 `email_unverified`
  (htmx redirects to `/verify.html?email=`). All three share the spec §15 auth limiter
  (30 req/60s/IP). htmx error branches return friendly fragments (200), same as login.
- **Pages**: `register.html` (split layout like login; Turnstile rendered explicitly so the
  page degrades until keys exist; submit stays disabled until a token is issued) +
  `verify.html` (code entry, resend button, error states, auto-filled email from `?email=`);
  login.html gained the widget + “Create an account” link. SW `v61 → v62`, SHELL += both.
- **Tests**: +13 (126 total): open signup → unverified + no session; code unlock + replay
  refusal; wrong-code counting + cap invalidation; expiry; resend cooldown; duplicates;
  rollback on send failure; nonexistent-email no-leak; cross-user code rejection; htmx
  fragments + HX-Redirect. Smoke updated (register is now unverified, external fetches
  stubbed in-process). Typecheck clean.
- **PENDING (Ali-held, ~5 min) — the CAPTCHA keys**: Cloudflare dashboard → Turnstile →
  Add site (appearance “Interaction only”; domains: `hibana.aliassadi.workers.dev`,
  `hibana-prod.aliassadi.workers.dev`, `hibana.ir`) → paste the **site key** (PUBLIC —
  replace `YOUR_TURNSTILE_SITE_KEY` in `public/register.html` + `public/login.html`) and
  add the **TURNSTILE_SECRET_KEY** to `.secrets.env` → `npm run secrets:set` + `:prod` →
  redeploy. Until then: register = 503 `captcha_unconfigured` (fail-closed), login skips
  the human check (rate limiter still guards it).
- **UPDATE (same day, later) — CAPTCHA keys WIRED, registration fully armed**: the widget
  was created via the Cloudflare API (`challenges/widgets`, name “Hibana”, modes managed,
  domains incl. the 3 live ones + localhost/127.0.0.1) — the wrangler OAuth token has the
  `challenge-widgets.write` scope, so no dashboard clicking was needed. Site key
  `0x4AAAAAAEaVFxXSWS7C3bZc` (public, in the two pages), secret key as a worker secret on
  dev + prod. Commits `b2aef3e` (also fixed a duplicated widget div in register.html — one
  stray container sat before the form, one stale placeholder inside it) + SW `v63 → v64`.
  Verified live: register returns 400 `captcha_failed` for bad tokens (secret + siteverify
  active), pages carry the real key. **One human step remains**: the widget withholds
  tokens from headless bots by design, so the final proof is Ali signing up once in his
  browser (a confirm email must land).
- **UPDATE (same day, final) — render race fixed (`408bd14`, SW v65)**: Ali's first real
  attempt showed NO widget (button stayed disabled). Root cause: api.js loaded before the
  end-of-body script defined `onTurnstileLoad`, so the callback fired into nothing — the
  race only shows on fast connections (`async defer` head script vs. end-of-body inline
  script). Fix: config script moved into the head BEFORE api.js + render retried on
  DOMContentLoaded (idempotent guard), appearance switched to `always` (visible managed
  checkbox). Verified live on dev + prod pages. Ali retests with a hard refresh.

## 2026-08-24 — Dark-mode text whites softened (deployed DEV + PROD)
- Ali: “inverted color texts are pure white… it strains the eye.” Three whites softened:
  1. **Notebook canvas** — the dark-mode `--nb-ink` invert now carries a
     `brightness(0.9)` tail, so black ink/text (sticky notes, text boxes, pens)
     lands at ~`#e6e6e6` instead of pure `#fff`. Both dark blocks (media query +
     `html[data-theme='dark']`) updated together. Side effect: everything on the
     board dims 10% (photos included — the pre-existing photo-invert caveat now
     also applies a mild dim).
  2. **General text** — dark `--text: #f2f2f1` → `#e8e8e6` (~13.6:1 on `#191919`,
     still AAA; the roast contrast checks stay green).
  3. **Login brand** — `.auth-brand` `#fff` → `#e9e9e7` under dark mode only
     (the photo + scrim stays dark in both themes).
- Verified: `data/dark-soft-check.mjs` (new, gitignored) — headless Chrome with
  emulated `prefers-color-scheme: dark`: 12/12 local AND 12/12 against live
  `https://hibana.ir` (both the media-query path and the explicit-toggle path,
  computed colors + served CSS asserts). 113 vitest + typecheck clean.
  SW `v60 → v61`.

## 2026-08-24 — Site-down report investigated: site was UP; found + fixed a real /reports.html crash (deployed DEV + PROD)
- Ali reported “the website is down”. Verified from this box: `/api/health` 200 on dev,
  prod and `hibana.ir`; every page + asset 200 (dashboard, canvas, whiteboard, projects,
  reports, login, reset, settings, project, sparks, archive, clients, manifest, fabric);
  bad-creds login → 401 (auth + rate limiter healthy); deployments current
  (dev `c734c246` → now `5e68b076`, prod `178db90e` → now `2a2f76c8`). The earlier `fetch`
  tool failures were box-level network grants, not the site.
- **Real bug found** (headless Chrome on live prod, `data/live-check.mjs` — new, gitignored):
  `/reports.html` Alpine threw `TypeError: Cannot read properties of undefined (reading
  'spark')` — the logged-out `fetch('/api/reports/summary')` returns a truthy 401 `{error}`
  object, so `x-if="summary"` rendered and `summary.status.spark` crashed before the login
  redirect. Logged-in users were unaffected (the endpoint always zero-fills counts).
- **Fix 1 (`2320dac`)**: optional-chaining + `?? 0` on every summary expression
  (`summary.status?.spark`, `summary.recents?.[s]`, …) and `load()` now only assigns
  well-formed responses (`s.ok`, `rows ?? []`). SW `v59 → v60`. **But fix 1 introduced a
  regression the probe caught**: lines using `a.rows` kept reading the Response object
  (now that `a` is the fetch Response, not the parsed JSON) → `.map` threw on EVERY load.
- **Fix 2 (`f0e8c88`)**: activity bars read `this.rows` (already guarded + assigned).
  Verified authed in headless Chrome (`data/reports-check.mjs`, new): session honored,
  snapshot renders, badge counts correct, zero exceptions. Live re-probe: **41/41 checks
  clean on prod** — all 8 pages, no console errors/exceptions/failed loads, SW activated.

## 2026-08-24 — Bugfix: deleted canvas objects were resurrected by the viewport refetch (deployed DEV + PROD)
- **Reported**: draw a shape → select → Delete → it vanished briefly, then reappeared;
  the unsynced counter incremented but the item never stayed deleted (100% repro).
- **Root cause** (canvas board): every render fires `after:render → loadChunk()`, and the
  delete's own removal render triggered a bbox refetch ~300ms later. The offline queue's
  tombstone flush is debounced 1.5s, so the refetch still saw the element `deleted = 0`
  on the server — and `loadChunk` re-added it unconditionally (`elems.set` + `putObject`
  with no deleted check and no client-side LWW), also clobbering the local tombstone.
  The tombstone flushed fine afterwards (hence the counter), but the object was already back.
- **Fixes** (defense in depth, both boards):
  1. `loadChunk` / notebook `load()` skip `deleted` records AND a newer local record
     wins over an older server snapshot (client-side LWW — a stale read can never
     overwrite a queued tombstone or edit).
  2. `putObject` ignores `deleted` records outright (guard for every caller).
  3. Delete ops now call `queue.flush()` immediately (fire-and-forget) so the tombstone
     lands server-side without waiting for the 1.5s debounce — closes the stale-read
     window entirely (incl. other tabs / reloads).
- Verified with `data/delete-fix.mjs` (gitignored): real draw → select → Delete in
  headless Chrome — object removed instantly, **stayed gone across 20 polls/4s**
  (pre-fix it returned in ~0.3–1s), server soft-deleted, queue drained, full reload
  clean; notebook soft-delete guard also verified. 113 vitest + typecheck + smoke PASS.
  SW `v58 → v59`.

## 2026-08-24 — Roast plan Phase 7: dashboard audit — all 21 items (deployed DEV + PROD)
- **Quick-capture family (audit #3, #11)**: every capture control is now one filled
  circle in the CTA color with a + glyph — per-box quick-add, notebook composer and
  list-add (`.qa-btn`); the FABs already matched. Hit areas ≥44px (measured 48.8px).
- **FAB labels (#2, #18)**: each floating button carries a visible pill label
  (“New idea” + “New project”, i18n) — no guessing — and a `Ctrl+N` kbd hint sits
  in the idea label on hover-capable devices. The shortcut is real: Ctrl/Cmd+N
  opens quick capture and focuses the title from any page (inputs exempt).
- **Sign out demoted (#1)**: moved inside the profile menu as the last quiet,
  low-emphasis row (danger only on hover); the topbar keeps just the theme toggle.
- **Language picker (#13)**: one row per language (English / فارسی) with an active-row
  highlight + amber check mark, painted by i18n.js from the saved preference.
- **Tag accent as a second color signal (#4)**: dashboard rows show a small
  tag-colored chip (first tag, tinted) next to the status dot; project cards keep
  their tag-colored top border and chips. Tags join via the existing user-scoped
  `project_tags`/`tags` tables (rule 1 respected).
- **“View all activity →” (#16)**: the Recent activity card links to all projects;
  box “view all →” links wrap instead of truncating Farsi labels (#14).
- **Icon treatment standardized (#17)**: box status glyphs sit in status-tinted
  circles; menu icons in accent-soft circles; FABs in the CTA circle — one
  icon-in-colored-circle system at three prominence levels.
- **Brand identity (#20)**: the spark amber now colors the active nav underline,
  nav hover, and box/activity link hovers (`--brand`: #a84a08 light / #fbbf24 dark,
  AA-verified 5.8:1 / 11.9:1). CTA fills stay monochrome per the Q1.C decision
  (flip `--cta` to `--brand` in one line if Ali ever wants amber buttons).
- **Bug found by the audit probe**: hard page loads never marked the active nav link
  — the hard-load mark used `.topbar > a`, but the links live in the
  `display:contents` `.nav-links` wrapper, so only soft navigations got the
  underline. Now `.topbar .nav-links a` in both app.js and nav.js.
- **Notebook label (#6)**: persistent “Quick note” / «یادداشت جدید» label above the
  composer; the composer + stays a form-submit button (Enter records, + commits
  drafts — untouched contracts). `data-i18n` never wraps child elements again
  (its textContent write wiped the kbd child — labels now nest a span).
- **No-change items (verified, documented)**: contrast (#10) — muted tokens already
  5.05:1 light / 6.07:1 dark (roast P1); Persian glyphs (#12) — Vazir self-hosted
  and confirmed loading on the fa switch; logical properties (#15) — zero physical
  left/right padding/margins in app.css (audited), JS clean.
- Verified: 19-check headless-Chrome probe (`data/audit21.mjs`, gitignored) +
  113 vitest + typecheck + smoke. SW `v57 → v58`.

## 2026-08-24 — Save-status badge: unsynced → Saving… → Saved (Canvas + Notebook)
- The bottom-left sync badge is now a real save-status indicator with three states:
  **“N unsynced changes”** while writes wait in the IndexedDB queue, **“Saving…” with a
  spinning ring** for the full duration of the flush request(s), and a static **“Saved”**
  confirmation (~2.2s) once the server confirms, then the badge goes quiet. A new edit
  immediately drops back to the count state. `queue.js` state machine (idle/saving/
  saved) + `.sync-spin` spinner (currentColor ring — readable in both themes) +
  `queue.saving`/`queue.saved` i18n keys (EN + FA). The board pages' duplicate badge
  spans were removed (nav.html's badge is the one painted). Verified in headless Chrome
  with a 1.5s-latency sync: Saving… held ~1.4s (request duration), Saved ~2s, then hidden.
  SW `v56 → v57`.

## 2026-08-24 — Spec §15 rate limiting shipped in-app (deployed DEV + PROD)
- The Cloudflare free-tier rules remain the preferred edge layer, but the wrangler
  OAuth token cannot edit zone WAF config (403, verified), so the app now enforces
  the same limits itself — D1-backed fixed 60s windows per client IP (migration
  `0014_rate_limits.sql`, table `rate_limits`, purged daily by the cron):
  `/api/auth/login` + `/api/auth/reset/*` at **30 req/60s**, `/api/telegram/webhook`
  at **300 req/60s** (webhook limiter runs BEFORE the secret check so flood traffic
  is counted). 429 + `rate_limited` past the limit; DB hiccups never block the app;
  `CF-Connecting-IP` is the key on the Worker. +4 vitest; live-verified on the dev
  worker (31 bad logins → 30× 401 then 429). If a Zone>WAF token ever appears,
  `scripts/rate-limit.mjs --apply` still adds the edge rules on top.

## 2026-08-24 — Roast plan Phase 6 + touch DnD + Telegram reminders (deployed DEV + PROD)
- **P6 empty/loading states**: kanban columns with no projects now show a dashed
  “Drop here” / «اینجا رها کن» drop zone instead of a bare dash (the zone doubles as
  the cross-column drop target); Reports gets a loading placeholder + an empty-chart
  state, and its activity **bars are now data-driven** (they were hardcoded --v: 0.7/1
  stubs — heights scale to the max bucket, ticks scale by projects created; legend
  corrected); the Canvas + Notebook show a small loading pill while the first fetch
  is in flight (they are blank by design but must not read as stalled).
- **P6 touch targets**: canvas zoom −/＋ get the padded-`::after` hit area
  (measured 44px, was 38px).
- **Touch-drag fallback** (P6 open item): HTML5 DnD never fires from a touchscreen,
  so dashboard boxes / kanban / card-grid reorder / sparks shelf / hurdles were
  mouse-only. `app.js` now arms a 250ms long-press drag on touch/pen pointers and
  drives synthetic dragstart/dragover/drop events with a real DataTransfer, so every
  existing delegated handler works unchanged; quick taps keep their normal behavior
  (a stray click after a drag is swallowed). Verified end-to-end on the dashboard at
  390px touch: row spark→pending→restored via the real PATCH + strip refresh.
- **Client reminders now push to Telegram too (spec §6.3, second channel)**: the
  daily cron sends the behind-pace warning to the owner's email AND their linked bot
  chat (HTML message + deep link) when `telegram_chat_id` is set. New shared
  `src/services/telegram.ts` (webhook replies refactored onto it); per-project
  opt-in toggle now rendered on the client dashboard (§5.9 — it existed as an API
  only); fixed the stale `pm.sedanama.com` link in reminder emails → `hibana.ir`.
  +4 vitest (reminders channels, HX-Redirect toggle, kanban drop zone).
- SW `v55 → v56`; audit sweep at 1440/390 EN+FA: 0 overflow, 0 clipped, 0 htmx
  syntax errors; 700/900 EN+FA sweep: 0 overflow, nav on one row.

## 2026-08-24 — Roast plan Phase 5: audit-derived UI polish (deployed DEV + PROD)
- **sparks.html `hx-trigger` fixed**: `"load every 30s"` → `"load, every 30s"` — the
  space form fired 3 `htmx:syntax:error` on every Ideas page load (verified via CDP
  console sweep; now zero).
- **Client payments toggle `hx-vals` fixed** (`src/routes/module.ts`): the misplaced
  quote produced `{"status":"pending'}` → htmx sent an unparseable JSON payload and
  the toggle 400'd. Now emits valid `{"status":"…"}`.
- **Dark-mode canvas swatches**: the palette buttons are pastel fills on a dark
  toolbar; the near-white selection ring measured 1.04:1 on the yellow swatch (and
  the computed text color sat at ~1.2:1 on every pastel). Swatches now get a
  luminance-aware glyph color (dark glyphs on pale fills, near-white on the black
  swatch — 12.9–15.9:1 everywhere) and a dark-mode active ring of dark-inset +
  light-hairline so selection reads on every swatch incl. black. Light mode keeps
  the near-black border; the black swatch gains a visible active border (`line-strong`).
- **Blue-pen toolbar icon (Notebook)**: `#2f6fd1` read 3.39:1 on the dark toolbar;
  dark mode now uses `#7fb5f0` (7.67:1) via a `.pen-blue` class (drawn ink
  unchanged — the sheet's ink filter still handles dark paper).
- **≤480px nav**: the 5th link wrapped onto its own third row at 390px; links now
  drop to the sm step (0.8rem) + tighter gaps at ≤480px so all five share one
  second row — verified at 390px in EN + FA, 0 overflow.
- **Touch targets ≥40px** (dashboard compact rows): `.stat-recent a`, the stat-box
  “view all” link and the mini-add buttons get the padded-`::after` hit-area pattern
  (visual layout unchanged; hit height measured 40.3–40.4px).
- **Type scale consolidated to 5 tokens**: `--fs-xs .72rem / sm .8 / md .85 / lg .95 /
  xl 1.12` replace ~12 fractional rem steps (0.7/0.72/0.78/0.8/0.84/0.85/0.9/0.92/
  0.95/1.02/1.1/1.12) across app.css; headings keep their own ramp (h1 1.5, h2 1.35,
  h3 = fs-xl). Rendered font-size set on pages: 11.52/12.8/13.6/15.2/16/17.92 px +
  display steps.
- SW `v54 → v55`. Audit sweep rerun: 0 overflow, 0 clipped, canvas/whiteboard
  contrast fails 6→0 / 1→0 (dashboard keeps only the two decorative 5px `.list-dot`
  markers — no text, accepted).

## 2026-08-24 — Placed images fit their frame (object-fit: contain) on Canvas + Notebook
- Both boards now render placed pictures **contain-fit inside the frame box** (the
  width×height the handles wrap): the whole image is always visible and centered,
  whatever the frame's aspect vs the picture's. The contain math runs at draw time off
  the live `width/height × scale`, so **resizing the frame re-fits the picture
  immediately** — uniform or side handles never stretch or crop it.
- Root cause: whiteboard.js built images with width/height **without** scale and its
  clipPath was anchored at (0,0) — Fabric rendered the element at natural size with a
  corner-box clip (the “only part of the picture visible” bug); canvas.js stretched
  via unequal scaleX/scaleY (distorted pictures on aspect mismatch). Fix in both files:
  the object keeps its frame dims and gets an instance `_renderFill` override
  (this build draws via `_renderFill` — stretching source → box); clipPath is now the
  centered rounded frame rect. Placement geometry, persistence (stored dims = frame)
  and the sync path are unchanged; old broken rows re-render correctly on load.
- Pixel-verified in headless Chrome on both boards (red 300x200 test image): placed
  extent == frame exactly; resize to 600x300 (2x/1.5x) shows the 450x300 contain band
  centered with 75px letterbox each side. SW `v53 → v54`.

## 2026-08-24 — Roast plan Phase 4: mobile topbar + fa-safe badges (deployed DEV + PROD)
- Topbar becomes two rows at ≤720px: brand + account cluster on top, the five nav
  links evenly spread on a full-width second row (links moved into a `.nav-links`
  wrapper that is `display: contents` on desktop — identical layout >720px — and a
  `flex-basis: 100%` row at ≤720px, which reliably forces the line break in RTL too;
  order-based-only wrapping leaked links into row 1's leftover space, verified in
  headless Chrome at 390/700/900px). `markNav` updated to `.nav-links a`; the
  username label hides on small screens.
- Badges drop `white-space: nowrap` (word-level wrap): Farsi labels like «در حال
  ساخت» wrap instead of clipping; single-word pills unchanged. Verified: 0 clipped
  badges on a real Farsi dashboard render.
- SW `v52 → v53`.

## 2026-08-24 — Manrope self-hosted (roast plan Phase 3; deployed DEV + PROD)
- Manrope woff2 (400/500/600/700) now lives in `/vendor/manrope/` with its own font-face.css
  loaded statically in every page head; the Google Fonts CDN link is removed from app.js.
  Zero runtime CDN dependency left; no Iran-network font flash on load (pre-auth pages too).
- SW `v51 → v52`.

## 2026-08-24 — Canvas/Notebook text boxes: fixed size, wrap, clip (deployed DEV + PROD)
- Text boxes no longer auto-size with content: width and height are fixed at the drawn size
  (a plain click creates a default 240×60 box; legacy click-to-type records load the same).
- Text wraps at the box edge (`breakWords` = overflow-wrap: break-word) and overflow past
  the fixed height clips at the box edge (Fabric 5 has no Textbox `overflow` property, so
  the clip is a clipPath rect kept in sync on every re-measure). Sticky notes unaffected.
- SW `v51 → v52`.

## 2026-08-24 — Roast plan P2: typography & hierarchy (deployed DEV + PROD)
- Dashboard got a real server-rendered `<h1>`: the floating "N solved this week" corner
  text is folded into it as a muted right-aligned count (single h1 per page, a11y; the
  shell had none).
- Type scale: h2 `1.25 → 1.35rem`, h3 `1.05 → 1.12rem` (h3 no longer reads as body text);
  metadata captions (`activity-sub`, dashboard box detail lines) `0.6 → 0.7rem`.
- SW `v50 → v51`. Dashboard test updated for the h1.

## 2026-08-24 — Header logo vertical alignment fix (deployed DEV + PROD)
- The topbar already centered boxes; the offset was in the asset: the wordmark's ink mass
  sits at 60.3% of the canvas height (measured with `scripts/probe-png.mjs`, kept in repo),
  so the rendered logo read ~2.3px low against the nav links.
- Fix: `.brand` is now a flex chain (deterministic box centering) + `translate: 0 -2px` on
  `.brand-logo` compensates the ink offset at 1.4rem. Topbar-only; auth-page logos untouched.
- SW `v49 → v50`.

## 2026-08-24 — Roast plan P1: WCAG contrast & monochrome CTA (deployed DEV + PROD)
- **Monochrome CTA in both themes** (Ali Q1.C): dark-mode buttons are now near-white
  (`--cta: #ececea`, hover `#d6d6d2`) with dark text (`--btn-text: #191919`, 14.7:1 verified) —
  same identity as the light theme's black button. The old blue CTA (`#3978d6` + white text)
  failed AA at 4.35:1. Bonus fix: the dark avatar initial was white-on-white (1.12:1,
  invisible) — now dark-on-light.
- **Light `--ok` darkened** `#2f9e44 → #1f7a34` (was 3.45:1 on white / 3.02:1 on accent-soft;
  now 5.40 / 4.73 / 5.03 verified for white, accent-soft, bg-soft).
- **Light `--err` darkened** `#cf2e2e → #c02626` (was a fragile 4.51:1 on accent-soft; now
  5.92 / 5.19 / 5.52 verified).
- All ratios computed with the uiux-roast skill's `contrast_ratio.py` against live tokens;
  badge/status pairs were already AA everywhere and are untouched. SW `v48 → v49`.

## 2026-08-24 — Session: Figma shortcuts + image-fit/Bebas, dashboard & settings batch (deployed DEV + PROD)
- **Figma-style shortcuts on Canvas + Notebook** (user request): Space+drag pans (Canvas only;
  Notebook is fixed-size); `V` move/select, `H` pan, `T` text, `B`/`P` pen, `E` eraser, arrows
  nudge 1px (Shift = 10px), `Ctrl/⌘+D` duplicate, `Ctrl/⌘+[`/`]` layer reorder (Shift = to
  back/front, persists via renumbered `z_index`), `Ctrl/⌘+0`/`=`/`-` zoom, `Shift+1`
  zoom-to-selection, `Shift+2` reset view (Canvas). No `⌘+A` select-all on purpose (boundless
  canvas — footgun). Space cursor via a capture-phase mousedown flag read by Fabric.
- **Canvas image placement fixed** (bug): Fabric rendered the full natural image at 1:1 while
  the hit-box was the requested size — a 1200×800 pic placed at 480×320 showed ~20% (cropped
  corner). Now scaled via `scaleX/scaleY` with the clipPath in natural-pixel space; the whole
  picture fits its box on both Canvas (max 480) and Notebook (max 400).
- **Bebas lighter**: boards default to the Light face (300) instead of bold (Classic stays 400);
  applies live and on reload.
- **Dashboard**: empty Idea/Pending/Building boxes render plain "Nothing here yet" text (phantom
  bullet removed); status dots get deeper dark-mode tints (`--dot-*`) so they stop glaring.
- **Hurdles composer → Quick-Notebook style**: Enter adds a hurdle per line, Shift+Enter
  newlines, pastes split per line; schema max 5000 with per-line slicing; +3 vitest cases.
- **Where-I-left-off autosave**: project-note textarea saves 800 ms after typing + on blur,
  deduped against the last saved value, with a "…/✓ saved" status line; survives htmx re-renders.
- **Settings import UX**: raw file input replaced with a styled "Choose files" label-button,
  chosen-file summary, empty-submit guard; relabeled to just "Import" (EN/FA i18n).
- **Saves land on the dashboard** (user request): quick-add, new-project dialog, and project
  edit all redirect to `/app`; a dedicated "New project" button was added to the Projects header.
- Verified: 105 vitest / typecheck / smoke all pass. Headless-Chrome CDP endpoint never became
  reachable on this Windows box, so frontend pieces rest on code review + the battery; server
  behavior fully covered by vitest. SW `v47 → v48`. Versions: dev `6f4cd226`, prod `e361cabc`.

## 2026-08-21 — Sticky notes keep text inside; canvas sync batch-LWW fix (deployed DEV + PROD)
- **Sticky notes contain their text** (bug fix): the paper auto-grows with the text — the
  minimum size is kept, but typing more lines expands the note so content never spills out the
  bottom (Google-Keep style). Works live while editing, fixes legacy overflowed notes on load,
  and the grown size round-trips through sync/reload.
- **Real data-loss bug fixed in `/api/canvas/sync`**: a flush batch can contain two edits of the
  same element (create + edit never flushed separately), and IndexedDB returns queue rows by
  uuid key — not insertion time. The server compared LWW only against the pre-batch DB state,
  so an older edit could apply after a newer one and win. The sync handler now dedupes the
  batch per id keeping the newest `updated_at` (+1 vitest case, 102 total).
- Verified: sticky probe 9 checks ×2 (creation, live typing grow, containment, wrap,
  persistence, reload, legacy self-fix, minimum size), all other probes green, 102 tests,
  typecheck, smoke. SW cache `v46 → v47`. Versions: dev `3a1db22d`, prod `d224130e`.

## 2026-08-21 — Text-box area fix + queue hardening (deployed DEV + PROD)
- **Dragged text boxes keep their drawn area** (bug fix): the height a user drags is now a
  minimum the box never falls below (Fabric auto-fits height to text, so a 200×80 area
  collapsed to a one-line strip; it also stored `height: null`). Every re-measure — typing,
  width reflow, font change, corner scale — clamps back to the minimum; corner scale bakes
  the area like the font; height round-trips through sync and reload. Both boards.
- **Offline queue hardening**: `flush()` no longer returns early while another flush is in
  flight — it waits, so an awaited flush always drains everything enqueued (no lost writes
  on the boards). Verified: 11/11 whiteboard text-box checks ×3, all other probes
  (shortcuts 17, canvas text tool, notebook, dashboard) green, 101 tests, typecheck, smoke.
  SW cache `v45 → v46`. Versions: dev `cdb77b2e`, prod `8460a878`.

## 2026-08-21 — Notebook gets the Figma-style drag text box (deployed DEV + PROD)
- The Notebook's text tool now matches the Canvas (user request): click-drag draws a rectangular
  text container with a dashed preview (release → box at exactly the dragged width, cursor
  already in edit mode); typed text wraps to the width; all 8 corner + side handles stay
  visible while selected and side handles re-wrap; corner scaling bakes into the font size on
  save; double-click re-opens the editor; Escape cancels an in-progress drag; plain click still
  auto-sizes. Width + content + font round-trip through sync and reload (saved records now load
  as wrapping Textboxes). Verified headless: 11/11 checks (drag 220px → wraps 2 lines → reflow
  at 120px → 3 lines → move+scale-bake 27px font → reload restores 420,330/120px → dblclick →
  click-autosize → undo → escape-cancel); shortcuts 17/17 and canvas text-tool checks re-ran
  green. SW cache `v44 → v45`. Versions: dev `40bdfccf`, prod `fc80155e`.

## 2026-08-21 — Quick Notebook follow-up: bounds + phantom scrollbar (deployed DEV + PROD)
- One-line notes never show a phantom scrollbar again: the autosizer rounds up with a 1px
  safety so fractional font metrics can't leave a hair of overflow (Chrome paints a scrollbar
  the moment scrollHeight > clientHeight); the 60vh cap still scrolls naturally. Verified
  dynamically: add short notes (no scrollbar), add a 4000-char note (caps at 60vh, scrolls),
  delete it (remaining re-fit).
- Compose textarea is resizable within bounds: `resize: vertical` clamped to 4.25rem minimum
  (placeholder always visible) and 40vh maximum. SW cache `v43 → v44`. Versions: dev
  `687a7e7e`, prod `19b878d8`.

## 2026-08-21 — Session: dark notebook + board shortcuts, quicknote/dashboard polish (deployed DEV + PROD)
- **Notebook goes dark in dark mode**: paper + grid are theme tokens (`--nb-paper`/`--nb-grid`/
  `--nb-ink` in all 4 theme blocks); black/blue pens stay legible on the dark sheet via an
  invert+hue-rotate ink filter on `#nb-board`.
- **Conventional shortcuts on BOTH boards** (user request): Delete/Backspace, Escape (exits the
  Fabric text editor AND drops the selection — capture-phase so Fabric's own handler can't
  swallow it), Ctrl/⌘+Z/Y (redo also Shift+Z) undo/redo, Ctrl/⌘+C/X/V copy/cut/paste, typing
  guard for inputs. Fixed a canvas redo bug: redo of an erase tombstoned instead of restoring.
- **Dashboard metadata is smaller** (user request): box detail lines 0.72→0.6rem, activity feed
  sub-line 0.85→0.6rem.
- **Quicknote fixes** (user request): one-line notes no longer show a useless scrollbar (the
  autosizer now adds the border-box borders back to scrollHeight), and the composer can't
  collapse below two rows (`resize: none` + `min-height` — placeholder always visible).
- **Dashboard boxes: 3 Ideas / 3 Pending / ALL Building** (user request); rows are draggable and
  drop onto another box PATCHes the status with a partial htmx refresh — no page reload.
- Verified: headless-Chrome probes (17 shortcut + 9 dashboard/quicknote checks, all PASS),
  `npm test` 101, typecheck, smoke. SW cache `v41 → v43`. Versions: dev `00691ee8`+`77a79c5e`,
  prod `a7344594`+`592757bf`.

## 2026-08-21 — Session: Figma-style text boxes + dashboard list bullets (deployed DEV + PROD)
- **Canvas text tool is now Figma/Photoshop-style** (user request): click-drag draws a rectangular
  text container of any width/height (`fabric.Textbox`) — all 8 corner + side handles stay visible
  while selected, the side handles re-wrap the text to the new width, and the text stays fully
  editable (font picker, double-click edit, per-style properties). A plain click still creates the
  auto-sizing quick text. The box width round-trips through serialization: resizes persist via the
  offline queue and reloads restore the same wrapping box. `getCanvas()` exposed for the CDP
  probes. Verified end-to-end in headless Chrome: drag → type → wrap (3 lines @ 200px) → sync →
  reload → box restored.
- **Dashboard boxes read as compact bulleted lists** (user request): Idea/Pending/Building items
  are smaller (0.84rem titles, 0.72rem detail line) with a status-colored bullet dot per row —
  real spans sharing the badge tint tokens, so light pastels flip to the muted dark fills exactly
  like the badges. One list per box, every project listed once. Verified in headless Chrome
  across both themes.
- SW cache `v40 → v41` (one hard refresh). Deployed DEV (`f36e2127` + `fcddc142`) + PROD
  (`e5bce5b7` + `934f164e`).

## 2026-08-21 — Session: status badge icons + dark tints, delete-button fix (deployed DEV + PROD)
- **Per-status SVG icons in badges** (user request): every status badge now carries its own glyph —
  idea bulb, pending clock, building gear, working rocket, archived box — replacing the abstract
  pastel dot (`STATUS_ICON` + new icon() bodies in `src/lib/html.ts`); the dashboard boxes show the
  icon next to the label too. Same stroke system as the rest of the UI.
- **Badge tints are now theme tokens**: light keeps the soft pastels; dark mode uses muted,
  low-luminance fills (#3f3510 spark / #40281a pending / #16294d building / …) so the bright
  pastels no longer glare. Declared in all four theme blocks (baseline, OS-dark, explicit light,
  explicit dark) like every other variable.
- **Fix: the project-detail “Delete…” button overflowed its label** — it used `.ghost.danger`,
  which is the 1.75rem icon square. New `.btn.danger` (same danger palette, padded `.btn` shape) +
  the button now uses it; the icon-only ghost-danger buttons (changelog ✕, note ✕) are untouched.
- Verified in headless Chrome (dark/light badge tints, SVG in badge, “Delete…” label fits:
  scrollWidth == clientWidth) and live on prod via the owner session. SW cache `v38 → v39` (one
  hard refresh). Deployed DEV (`59f4ea06`) + PROD (`db3cd324`).

## 2026-08-21 — Session: dashboard — stat boxes + mini-kanban merged into one box per status (deployed DEV + PROD)
- **One merged box per active status** (user request): each Idea/Pending/Building box now carries the
  count badge, recent projects (with time-ago + latest-note place-marker), the per-status quick-add
  button and “view all” — the old mini-kanban duplicated every project below the stat strip, so it
  was removed (those dashboard columns never had drag/drop; the real kanban on the Projects page is
  untouched). Dead `.mini-kanban*`/`.mini-card` CSS removed; `.mini-add` kept for the + buttons.
- +1 vitest (100 → 101): merge contract — exactly one box per status, each project listed once, no
  kanban markup, quick-add + view-all present per box. Verified over a real socket
  (`data/dash-check.mjs`) and live on prod against Ali's real data (3 boxes, mini-kanban absent,
  quick-add/view-all ok).
- SW cache bumped `v37 → v38` (one hard refresh for stale clients). Deployed DEV (`ff4ef5f9`) +
  PROD (`d517cdba`).

## 2026-08-21 — Session: CSRF hardening (deployed DEV + PROD)
- **Origin/Referer CSRF guard on every state-changing request** (`src/app.ts` middleware, runs
  before auth): browsers always attach `Origin` (fallback `Referer`) to cross-site
  POST/PUT/PATCH/DELETE, so a mismatched header is rejected 403 before any route runs — closing
  the form-encoded htmx surface that the JSON-content-type argument couldn't. SameSite=Lax
  remains the first line (cookie dropped cross-site); this is defense in depth. GET reads are
  exempt (they never mutate); callers with neither header are allowed (internal automation + the
  Telegram webhook, which rule 11 authenticates itself).
- +6 vitest (94 → 100) in `src/tests/csrf.test.ts`. Verified live on prod over real HTTP:
  evil-Origin POST → 403 pre-auth; same/no-Origin POST → falls through to auth; owner login +
  `telegram-status` unaffected (`points_here: true`, 0 pending, no errors).
- Deployed DEV (`9118cd45`) + PROD (`560bbb89`) — server-side only, no SW bump.

## 2026-08-21 — Session: Telegram secondary password reset + backup-cron confirmation + rate-limit tooling (deployed DEV + PROD)
- **Telegram secondary password reset (spec §9)** — the bot now answers `/reset` from the linked
  chat with a **one-time, hashed** reset token + the app's deep link (same guarantees as email:
  1-hr expiry, token never stored raw). Unlinked chats get a “link first” reply, no token. Token
  issuance shared via a new `src/services/reset.ts` used by the email route *and* the webhook; the
  reset deep link uses `requestOrigin(c)`. +3 vitest (91 → 94): unlinked-no-token, linked-hashed-
  token + link, and a full redeem (confirm → new password logs in).
- **Scheduled D1 backup cron CONFIRMED RUNNING** — both workers (`hibana` dev + `hibana-prod`) carry
  `17 3 * * *` (verified via the CF API schedules endpoint), and the GitHub assets repo shows nightly
  snapshots `snapshot-2026-08-20T03-17-36Z` + `snapshot-2026-08-21T03-17-15Z` (the 08-19 ones were
  that session's manual test pushes), sizes growing 38 KB → 118 KB as real data landed. Reusable
  check: `data/verify-backups.mjs` (gitignored; prints names/status only, never tokens).
- **Rate limiting (spec §15)** — `scripts/rate-limit.mjs` added: Cloudflare zone ruleset
  (`http_ratelimit`) guards for `/api/auth/login`, `/api/auth/reset/*` and `/api/telegram/webhook`.
  NOT applied live: the wrangler OAuth token cannot touch the rulesets phase (401) or zone settings
  (403), and no CF API token exists in `.secrets.env` — the script prints the exact expressions for a
  ~2-minute manual dashboard setup (Security → WAF → Rate limiting rules) or a future scoped token.
- **Deployed DEV (`fe6b82cf`) + PROD (`174d80a2`)** — this also ships the earlier deep-link origin
  fix + `migrate:node` data-dir fix. Verified live on both: `/api/health` 200 with schema 12/12 (the
  repo has 12 migration files — `0007` was never created, so “12” is correct and up to date, both
  D1s report “No migrations to apply”), prod owner login 200, and `GET /api/dev/telegram-status` →
  `points_here: true`, 0 pending, no errors. The Telegram webhook needed no re-registration (same
  handler).

## 2026-08-21 — Session: Node/self-host checkout smoke + deep-link origin fix
- **Full Node/self-host checkout verified end-to-end** (ROADMAP P2 “worth doing once”, now closed). Simulated a fresh clone (tracked tree only, no `node_modules`/`data`/`git`) → `npm ci` from the lockfile (92 pkgs, no build scripts) → `.secrets.env` → `npm run migrate:node` → `seed:admin:node` → real `start:node` server → **61/61 HTTP walk on `127.0.0.1:8787` over a real socket**: every static page + all css/js/vendor assets (incl. Vazir woff2) + `/api/health` + auth boundary (401 unauth `/app`, login 200, wrong password 401) + 16 authed GET endpoints + a full mutation round-trip (create project → detail → hurdles create/get → soft delete → restore). Portability confirmed. Reusable local walk kept at `data/walk.sh` (gitignored, creds via env).
- **Fix: `npm run migrate:node` now creates the `data/` dir.** A fresh checkout has none, so the script died with `ERR_SQLITE_ERROR: unable to open database file` (server.ts created it; the script didn't). Mirrors server.ts, so the documented “migrate then start” order works on a fresh clone (rule 4).
- **Fix: deep links derive from the request origin instead of hardcoding `http://localhost:8787`** — resolves the “dev-only cosmetic” known-minor from the Telegram session. New `requestOrigin(c)` helper (`src/lib/http.ts`); used by the Telegram 📎 deep link (`integrations.ts`) and the password-reset email link (`reset.ts`). Correct on any deployment — Worker prod/dev, local Node on any port, self-hosted VPS.
- Verification: `npm test` 91/91 · `npm run typecheck` clean · `npm run smoke` all pass · fresh-checkout HTTP walk 61/61.

## 2026-08-21 — Session: Telegram Phase-5 gate CLOSED + status endpoint (deployed DEV + PROD)
- **Full Telegram flow now verified end-to-end on PROD, user-confirmed.** Drove the real webhook
  from Ali's actual chat with his own link code (`349d1423`, found in prod `telegram_links`) → owner
  account linked to chat `92788333`; a test idea landed as a Spark (verified via `/api/projects?status=spark`
  and the prod D1); the bot replied in Ali's real Telegram with the ✅ Linked + 📎 deep-link
  confirmations. Ali confirmed: “It worked!”. Old junk card `sdfsdf` soft-deleted (undo-toast style),
  the new Telegram card kept.
- **New owner-only `GET /api/dev/telegram-status`** — the browser-openable answer to “the webhook URL
  opens blank” (it is POST-only; a browser GET 401s by design). It asks Telegram directly (getMe +
  getWebhookInfo) from the Worker, the only host that can reach api.telegram.org from this sandbox, and
  reports bot username, registered webhook URL, `points_here`, pending updates and the last delivery
  error. Live: bot `@Hibana_PM_bot`, webhook → `https://hibana.ir/api/telegram/webhook`, 0 pending, no
  errors. Known minor: the linked-path deep link defaults to `http://localhost:8787` when not prod
  (dev-only cosmetic; prod is correct).
- Rule-11 secret-token validation verified live on dev + prod (200 / wrong-secret 403). +2 vitest
  (89 → 91).
- **Deployed to DEV (`c95ef03a`) and PROD (`c33a8b90`, go-ahead given)** — both also ship the pending
  Obsidian zip-import work; the zip import is now LIVE everywhere.

## 2026-08-21 — Session: Obsidian zip import (local HEAD — deploy pending go-ahead)
- **Obsidian import now accepts a `.zip` of the whole vault** (Settings file input is now `.md,.zip`).
  Entries are read recursively with `fflate` (pure JS — runs on the Worker *and* Node), skipping
  the `.obsidian/` app-config folder, `.trash/`, any hidden path segment and non-markdown files;
  the same frontmatter-strip + H1-or-filename title logic as flat `.md` files, tagged “Imported”.
- **Re-imports are idempotent**: a title already owned by the same account (per-user, rule 1) is
  skipped and reported in `duplicates`; flat `.md` files share the same guard. Corrupt archives
  → 400 `invalid_zip`, nothing inserted.
- SW cache bumped `v36 → v37` (hard refresh needed). I18n hint updated EN + FA.
- +4 vitest (85 → 89): nested-folder zip import, idempotent re-import, invalid-zip rejection,
  per-user dedupe (isolation, rule 1).

## 2026-08-21 — Session: rename, dashboard redesign, kanban, bug batch (dev + prod @ HEAD)
- **“Spark” → “Idea”** everywhere visible (EN+FA labels, badges, modals, toasts, hints);
  DB status value stays `spark` — no migration, no API break.
- **Dashboard**: 3 stat boxes (Idea / Pending / Building) each listing recent projects with
  links + “view all →”; “N solved this week” as small corner text; a **mini kanban of all
  active projects** (per-column quick-add +, per-status preset) sits above the Quick
  Notebook; Working/Archived boxes moved to **Reports** (recents with links); Ideas shelf
  removed. Cards/List/Sticky/Kanban switcher is real separated pill buttons.
- **Project cards**: ⋯ quick menu (top-right) → Edit (title/description dialog) + Delete
  (soft + undo toast). Same menu on the Ideas page.
- **Bug fixes shipped this session**: quick-add buttons dead after topbar navigation
  (delegated wiring); page mounts crashed on hard loads (boot.js now passes the ctx object,
  nav.js unmounts the boot-mounted page — card menus/drag had silently died on refresh);
  **binary corruption root-caused** — GitHub raw reads used text decoding, mangling every
  PNG/JPEG (broken avatars + screenshots); fixed with `readBinary()` (arrayBuffer) + real
  mime types, existing images display with no re-upload; **“N unsynced changes” badge**
  stranded by replaying a quick-add whose response was lost — project POST is idempotent
  (200 duplicate) and the queue drops 4xx items; **Delete/Backspace removes selected
  objects** on Canvas + Notebook (typing/dialog guards) + Notebook trash button; **filter
  bar fixed** — empty `status=`/`tag=` params failed Zod so every list request silently
  ignored all filters (dead view switcher, dead search/status/tag filters).
- **Health endpoint**: public `GET /api/health` (app + DB liveness, per-runtime
  `schema_version`, no-store) — the P2 monitoring item; test helper now runs the real
  `applyMigrations` runner.
- **Dark mode**: CTA buttons are now blue `#3978d6` (light stays near-black).
- +10 vitest (75 → 85). SW cache `v31 → v36` (hard refresh needed).

## Essentials — what exists (condensed)
### Foundations
- One Hono app, two runtimes: Cloudflare Workers/D1 (`src/index.ts`) and plain Node +
  better-sqlite3 (`src/server.ts`); everything lives in `createApp()` (`src/app.ts`); all
  routes root-mounted in `src/routes/core.ts` (single-origin, HX-Request branching);
  `canvas.ts`/`media.ts` are dead code — never touch them.
- Non-negotiables (CLAUDE.md): `user_id` on every user-owned row & query (rule 1),
  client-generated UUIDs for offline creation, UTC storage, numbered SQL migrations only
  (0013 now), secrets via wrangler secrets (PBKDF2, 100k+ iterations), Zod on every route,
  GitHub raw header for >1MB reads, `readBinary()` for images, backups never contain
  `users.password_hash`/`sessions`.
- Backups: daily 03:17 UTC cron → JSON snapshot → `assadigit/hibana-safe/backups/`; retention
  prunes to the newest 60; restore via `npm run restore`, drill via `npm run drill`.
- Auth: email-or-username login, httpOnly SameSite=Lax session cookie (30-day rolling),
  invite-only registration, password reset (Resend), change-password kills other sessions,
  profile-picture upload (Settings→Account, GitHub-stored, byte-exact serving).
- Frontend: vanilla + htmx + Alpine + Fabric 5.3.0 (self-hosted). Zero runtime CDNs. PWA
  (manifest + SW, PNG icons). Everything-ajax nav (nav.js) with adopted `<main>` swaps;
  boot.js mounts pages with a full ctx on hard loads. i18n EN/FA + Vazir + Shamsi
  (jalaali-js). Theme tokens in 4 places; `--cta` = solid buttons (blue in dark mode).

### Product surface
- Pipeline: Idea → Pending → Building → Working → Archived; any→any; soft delete + 7-day
  purge + undo toasts; hard delete only Ideas/Pending past the purge window (force=1).
- Dashboard: 3 stat boxes (Idea/Pending/Building) + mini kanban of active projects (per
  column + quick-add) above the Quick Notebook, then Recent activity; solved-this-week as
  a corner note; Working/Archived boxes live on Reports with recent links.
- Project list: cards / list / sticky / kanban views (real pill switcher), drag-reorder,
  FTS5 search, duplicate-title soft warning, ⋯ quick menu (Edit/Delete) on every card,
  `?status=`/`?view=` URL params adopted by the filter bar. Project detail: hurdles,
  links, screenshots, changelogs, where-I-left-off, pinned note, undo-history.
- Canvas + Notebook: boundless board / notebook sheet, viewport chunk loading, pen, sticky
  notes (pastel), arrows, images via URL, eraser/undo/redo, promote→Idea (note stays),
  offline IndexedDB queue + unsynced badge, **Delete/Backspace on selected objects**,
  auto-size text with corner-resize (`font_size`), Bebas/Classic font picker; Notebook has
  a trash button too.
- Quick Notebook (dashboard): Note mode (Enter records) / List mode (Enter drafts, +
  commits); empty-note guard — “Write a note first” (client + API 400).
- Client-work module: tasks + payments + progress-based reminders (email), separate
  dashboard.
- Others: photo 60/40 login, black favicon, theme-aware logo header, profile-picture
  upload, public health endpoint, backups pruned to 60.

### Ops / gotchas
- SW cache versions bump on every deploy (`hibana-v37`); stale clients need one hard refresh.
- CF `*.html` assets 307-redirect to extensionless; prod edge propagates in ~20–25s.
- The editor's TS language server can miss freshly installed modules; `npm run typecheck`
  is authoritative.
- Frontend-only fixes aren't covered by vitest (no jsdom) — verify with headless-Chrome/CDP
  probes against live dev (throwaway scripts under `data/`, gitignored, delete after).
- Pending user-held actions: Cloudflare “Always Use HTTPS” on `hibana.ir`, rotate GitHub
  fine-grained token → `npm run secrets:set` (+`:prod`) → `npm run drill`, confirm backups
  + Resend test emails, PWA installability check.
## 2026-08-28 — UI/UX overhaul + new features + Sadhana card redesign (deployed DEV + PROD)

### Phase 0 — Safety/correctness foundation
- **Typed HTML builder** (`src/lib/htmlx.ts`): `html` tagged template escapes by default;
  `raw()` opts out. Migrated `dashboard.ts` as proof-of-concept. Prevents XSS via
  missed `esc()` calls.
- **Structured errors** (`src/lib/errors.ts`): `ApiError` class + `ErrorCode` registry;
  `app.onError` serializes structured errors, preserves legacy `{error:'internal_error'}`.
- **SQL whitelist**: `ownedProjectId` in `core.ts` validates table name against a `Set`;
  unknown tables throw. Kills the query-injection-shaped pattern.
- **ETag + Cache-Control** on read endpoints: dashboard, projects list, project detail —
  weak ETag (FNV-1a hash), `Cache-Control: private, no-cache`, 304 on match.

### B1-B4 — UI/UX Overhaul (all DB-free, zero schema changes)
- **Command palette** (`Ctrl+K` / `Cmd+K`): search projects via FTS5 + quick actions +
  recent items (localStorage) + tag jump + fuzzy scoring. `?` opens shortcuts overlay.
- **Skeleton shimmer loaders** on dashboard, projects, project detail.
- **Toast upgrade**: action buttons (undo/retry/dismiss), persistent errors, slide-in.
- **Illustrated empty states** with icon + headline + helper + CTA.
- **Mobile bottom-tab nav** (44px touch targets, safe-area, sticky).
- **Subtle motion**: FAB spring, card hover lift, drag ghost, toast slide — all
  `prefers-reduced-motion` guarded.
- **Dashboard today-ring**: conic-gradient progress ring (on-time %), solved-this-week chip.
- **Projects page**: keyboard `f` Quick Find, saved filters (localStorage chips),
  bulk actions (select mode + archive/delete), search highlight (`<mark>`), sticky
  table header.
- **Project detail tabs**: Overview / Hurdles / Media / Links / Activity — keyboard
  navigable (←/→), htmx-safe.
- **Settings tabs**: sticky scroll-spy (IntersectionObserver).
- **Reports calendar heatmap**: 13-week GitHub-style grid, new `/api/reports/heatmap`.
- **Calendar view** (`/calendar`): month grid of tasks + sadhana by `due_date`.
  Locale-aware: Hijri-Shamsi (Jalali) for Farsi users (Sat-first, Persian month names,
  Persian digits, RTL grid, green Shamsi aesthetic), Gregorian for English. Iranian
  holidays: Friday = تعطیل (holiday-style red), fixed Jalali holidays (Nowruz, etc.),
  Islamic Hijri holidays detected dynamically via `Intl.DateTimeFormat('islamic-umalqura')`.
  Inlined the Jalali conversion math (eliminated a script-load race condition that
  showed the wrong month). Day detail panel + "Add a task for this day" link + legend.
- **Activity timeline** (`/timeline`): unified feed across projects + sadhana + notes,
  cursor pagination. "On this day" nostalgia section (1 week / 1 month / 3 months /
  1 year ago).
- **Notification center** (`/notifications`): derived from existing data — overdue
  tasks, unreviewed sparks, upcoming deadlines, stale projects. Severity chips.
- **Backlinks panel** on project detail: "Promoted from canvas" + tags in Activity tab.
- **CSV export** of tasks (`/api/export/tasks.csv`): spreadsheet-friendly, RFC-4180.
- **Global Focus/Zen Mode** (`Ctrl+.`): hides nav + chrome, expands content.
- **Onboarding tour**: 4-step coachmark overlay, localStorage-gated, "Show tour again"
  button in Settings.
- **Voice quick-add**: Web Speech API mic button on the quick-add modal (Chrome/Edge).
- **Vim-style go-to** (`g` then letter): 12 destinations (dashboard, projects, etc.).
- **PWA install prompt**: `beforeinstallprompt` capture + dashboard toast + Settings button.
- **Animated dashboard stat counters** (count-up, FA-digit-aware).
- **Micro-interactions**: task-complete pop animation, avatar skeleton.
- **Tooltip component** (`[data-tooltip]`): CSS-only, theme-aware, RTL-aware.

### Sadhana card complete redesign
- Tap-to-expand interaction model (desktop + touch): collapsed row → tap → expanded
  with left actions panel (Edit/Add Note/Change State/Delete) + right notes panel
  (numbered notes from `sadhana_updates` journal with add/update/delete).
- Always-visible color-coded progress circles (untouched=neutral, in_progress=amber,
  on_hold=red). Click a circle or "Current State" to change state.
- Inline title editing. All existing features preserved (emoji, deadlines, recurrence,
  tags, pin, focus mode, quadrant rename, drag-and-drop, quick-add).
- New `PATCH /api/sadhana/updates/:id` endpoint for editing note text.

### Canvas/Notebook text box vertical expansion
- Text boxes now grow vertically to fit content (width stays fixed, text wraps at
  the box edge). Height never shrinks below the drawn boundary but expands when
  content exceeds it. Fixed in both `canvas.js` and `whiteboard.js`.

### Nav reorganization
- Activity + Notifications moved from top nav into the user-chip sliding panel
  (next to Reports, Archive, Settings, Sign out).

### Stats
- 181/181 vitest tests green throughout (unchanged — all new routes are additive).
- Zero DB migrations, zero DB writes, schema stayed at 26 on both DBs.
- 11 new files (JS + HTML + TS routes), 22 modified files.
- CSS grew from 2,537 → 4,501 lines.
- 16 prod deploys this session.
- SW cache bumped v132 → v156.

## 2026-08-28 (later) — Phase 1 frontend hardening + Phase 2 hygiene/perf (deployed DEV + PROD)
- **XSS in Quick Find highlight fixed** (`projects.html`): the old
  `el.innerHTML = txt.replace(re, '<mark>$1</mark>')` re-parsed decoded text as HTML —
  a crafted project title executed on search. Rewritten to build a DocumentFragment of
  text nodes + `<mark>` elements (no string→HTML reparse), with restore-on-clear via a
  WeakMap; also fixes a latent stateful-regex false-negative. Audited every other
  `innerHTML =` site under `public/` — no other instance of the pattern.
- **Offline queue no longer drops data on auth loss** (`queue.js`): 401/403 now KEEP all
  items and the badge switches to "Sign in to sync" (EN+FA, `queue.auth`); only
  400/404/409/422 drop as permanently invalid. `app.js` gained a shared
  `hibana.handle401(res)` wired into the 12 user-initiated fetch checks (background
  sync never redirects).
- **i18n completion batch** (25 new keys EN+FA; 424=424 dict parity): toast Undo/Dismiss
  localized server-side (`toastHtml` takes `lang`, 15 call sites), settings tabs,
  sadhana recurrence copy, command-palette status labels, timeline load-more kinds +
  'just now', 5 dashboard/notes error keys. SW `v156 → v157`.
- **Cron hygiene** (`admin.ts` route + `scheduledPurge`): soft-deleted `sadhana_tasks`
  older than 7 days are now hard-deleted — 0018's FK cascades clean their update
  journal, tags, reminder logs and recurrence history (previously unbounded). Expired
  `email_verifications` rows swept too. Toast/JSON extended EN+FA (`purgedTodos`).
- **ETag + `private, no-cache`** on the 9 remaining read GETs (notifications, timeline
  ×2, calendar, search, tags, reports ×3) — every polled surface now revalidates cheaply.
- **Sadhana reminder sweep N+1 removed** (`services/sadhana.ts`): the every-30-min cron
  pass JOINs users up front instead of running one users query per task.
- 189 vitest (181 at session start), typecheck + smoke PASS. Zero migrations — schema
  stays at 26. Phase 1 batch: dev `b197e081` / prod `2e6ad848`; Phase 2 batch: dev
  `1adf9f14` / prod `57ca77d4`. Commits `10343c1` + `689cdf0`.

## 2026-08-28 (night) — Sadhana board: faithful replica of the original app (deployed DEV + PROD)
- **The /to-do-list page is now a visual + behavioral replica of the original
  Sadhana app** (Ali's reference implementation), rebuilt as a standalone page on
  Hibana's own JSON API — same techstack (Hono/TS backend, vanilla JS frontend),
  zero Python, zero CDN. Logged into the live original as a real user (add task,
  fuzzy deadline, recurrence, 3-state progress, updates journal, dark mode, FA/RTL,
  Jalali, zen mode, archive) and ported the whole experience; 21 reference
  screenshots captured during exploration.
- **What the replica carries over**: full-viewport 2×2 matrix (Q1 Today / Q3
  Urgent · deadline / Q2 Strategic / Q4 Personal), warm sandy palette + teal
  accent, quadrant heroes (big emoji, title/sub/badge, count pill, zen 🎯),
  compact task cards (emoji picker, check, 3-dot progress track with pulse, fuzzy
  + exact deadlines with overdue shake + ⚠️, tag emoji chips, recurring badge,
  note preview, updates journal panel, hover pin/edit/delete, done section),
  per-quadrant add forms + header Quick Add modal, emoji picker with search +
  categories, deadline popup (fuzzy 7 options + step-by-step year→month→day→time
  picker in Jalali OR Gregorian), recurring configurator (daily/weekly day-grid/
  every-N-days/monthly), filter chips with live counts, drag & drop reorder +
  cross-quadrant move with above/below indicators, undo toast + Ctrl+Z, zen
  focus overlay with its own add form, dark mode, EN/FA with full RTL flip,
  dual-calendar date pill (جمعه، ۶ شهریور، ۱۴۰۵), mobile single-column layout.
- **"Even better" on top of the original**: language persists server-side on the
  user record (multi-device sync, wired to PATCH /api/settings); theme shares
  Hibana's app-wide key; Telegram modal runs on Hibana's bot (@Hibana_PM_bot,
  /start code, live status polling, unlink) with the richer 7d/3d/1d/0d/2h
  reminder set; archive is an in-page overlay with per-quadrant stats + recurring
  completion log; quadrant names/subtitles honor the user's server-side renames;
  a11y extras (focus-visible, prefers-reduced-motion, Escape closes surfaces).
- **Backend (additive JSON only — htmx routes + all 189 tests untouched)**:
  GET /api/sadhana JSON now returns the full task set (grouped by quadrant with
  journals + tags), bilingual `quads` (name/subtitle × en/fa), `subtitles`,
  `order`, `lang/cal/tz`; GET /api/sadhana/archive gained a JSON branch with
  tags + recurring completion history.
- **Bug fixed found during live verify**: the Phase-1 security-headers middleware
  crashed with "Can't modify immutable headers" on responses proxied from the
  Workers ASSETS binding — 500 on /to-do-list (and would have 500'd authed /app).
  Now clones immutable responses once before decorating. Caught via
  `wrangler tail` on live dev.
- nav.js: /to-do-list + /sadhana.html are HARD_PAGES (standalone document, like
  canvas/whiteboard). SW `v157 → v158`. Typecheck clean, 189/189 green, smoke
  PASS. Authed experience verified end-to-end on the local Node server with a
  real browser (create → deadline → recurrence → progress → journal → done →
  undo → zen → archive → dark → FA/Jalali all persist). Deployed: dev `5f7baf5e`,
  prod `068a10d5`. Commits `40a3cc5` + `b18d309`.
