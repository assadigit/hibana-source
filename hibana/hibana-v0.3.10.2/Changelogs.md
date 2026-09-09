# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.11.2 — Session 20: AA contrast sweep + mobile overflow fixes + backup coverage gaps fixed + stale smoke expectation)
- v0.3.11.2 = **Session 20 polish release** — systematic UI audit (129 sweep rows: 20
  pages × EN/FA × light/dark × desktop/390px; 0 console errors) + fixes:
  - **AA contrast (22 unique offenders fixed)**: every white-text-on-#4A9FA3 fill moved to
    `--cta` per the design system's own rule (avatar, skip-link, sadhana add/save/undo/
    step/pick/recur buttons, calendar toggle, detail-tab count); every teal-as-text use
    moved to `--link` (resume-card label, pd-task-add, adm-self, selected/today day
    numbers incl. the RTL rule, 14 sadhana text rules); pd-col-title light inks darkened
    to ≥5.7:1 (in_progress/done/bug); dark sticky-note metadata → #EDE8DE (was #B0A79C at
    2.5:1); dark bug-bubble #ef4444→#c81e1e; zen Add button quadrant-tint + theme-flipping
    ink (was white-on-quadrant, all 4 failed); note-meta 0.48→0.6rem (was ~7.7px).
  - **Mobile overflows fixed (390px)**: project.html stage-action cluster (inner row now
    wraps ≤480px); clients.html payment form (wraps + shrinkable inputs).
  - **Backup coverage (CRITICAL, silent-data-loss)**: `project_archives` (0046) +
    `dev_task_tags` (0029) were missing from SNAPSHOT_TABLES — restores dropped archived
    tasks + tag links; restore.mjs tableOrder was frozen 2026-08-28 (missing the whole
    Phase-5 spark/dev cluster); restore-safe.mjs ordered tables alphabetically (FK-unsafe);
    personal JSON export lacked the dev-board cluster + archives. All fixed FK-safe,
    snapshot + export schema_version → 20260920, +4 regression tests (289→293), local
    snapshot→restore drill PASS.
  - **Smoke test fixed**: stale htmx ?status=spark expectation (pre-session-20 failure at
    HEAD) updated for the session-18 ideas-folder-grid — smoke ALL PASS.
  - Verified by design (no change): reports bar-chart scroll strip, stat-strip carousel,
    sadhana subbar chip carousel, closed ⋯ menu pops, theme-floater ::after hit area.
  - Perf/SW review (no changes warranted, honest): D1 EXPLAIN all-indexed at busy-solo
    scale (worst interactive 31.85ms canvas bbox @40k elements — under threshold);
    SW class split sound; sw.js unversioned-URL risk covered by updateViaCache=imports
    default + boot.js reg.update() polling.
  - Assets: app.css ?v=259 (was 258), SW stays hibana-v279 (no sw.js logic change).
- v0.3.11.1 = **Session 19 hotfix release** — all v0.3.11.0 features + fixes from Ali's
  direct feedback: stat-carousel arrows flank the strip (HTML restructure), sticky-note
  shadow spread reduced, dark mode flat card fills (no gradient), muted dark-mode kanban/
  pd-col/sticky-note colors, button hover text white (primary) / dark (ghost/btn), board
  shows 5 items per column (was 3), "بیشتر" expands inline (no board.html redirect), task
  cards click-to-edit inline (no navigation), project logo delete, note-clear persistence
  fix, unlimited task titles (300→2000) with read-more, Farsi numerals on typing (all text
  fields + Fabric canvas/whiteboard text:changed), text width resize now reflows.
- v0.3.11.0 = **Session 19 release** — 3 of 4 Changelogs §6 open items shipped (ICS calendar
  export, Telegram /update, web-clipper bookmarklet). Plus: "Resume work" dashboard card
  (Mission #2), segmented 4-digit OTP input on email-confirm, password visibility toggle on
  all auth pages, Farsi numerals on typing, canvas empty-state affordance, board "Add" button
  redesign, project logo delete, per-column colored task borders, 50% larger taskadd modal,
  unlimited task titles (300→2000) with read-more clamp, and a comprehensive UI polish pass
  across every surface (tour, cmdk, calendar, settings, dashboard, project-detail, board,
  sadhana, clients, admin, canvas, whiteboard, notifications, reports, archive, clip). Bug
  fixed: note-clear didn't persist (noteSchema.min(1) rejected empty strings). Bug fixed:
  github.deleteFile silent failure on logo replace/remove (auto SHA lookup). Cache-bust
  unified (app.css 215/234→249, i18n.js 45→52, app.js 165→168, canvas.js 16→17, admin.js 2→3).
- v0.3.10.2 = **Mistral Small 3.1 24B Instruct as default** (was qwen3-30b). Pure instruct
  (no reasoning pass) → fast (~1-2s) + cheap (~3-5 neurons/call vs qwen3's ~10-32). Good FA
  polish quality verified live. qwen3-30b kept as an option for complex rewrites. Also fixes
  3 bugs found by testing the real CF API: response_format:{type:'text'} rejected by qwen3
  (removed), "Polish" in prompt made Llama translate to Polish the language (reworded),
  reasoning models need 2048 max_tokens + both response shapes parsed.
- v0.3.10.1 = model picker (Settings): GET /api/ai/models, POST /api/ai/text accepts model,
  resolveModel whitelist (paid-only → default).
- v0.3.10.0 = **Magic Button (idea §1, green-lit)** — on-demand AI wand (polish/rewrite/
  translate) next to editable text. Cloudflare Workers AI binding ([ai] → env.AI), model
  @cf/mistralai/mistral-small-3.1-24b-instruct (default), temperature 0.2, non-streaming.
  Free-tier only; no paid overage. Route POST /api/ai/text (auth + CSRF + 4000-char guard).
  Original never modified until Apply; Discard/Esc/error = zero writes (Mission #1). Node
  self-host path degrades to a 503 "Workers-only" notice. No schema change, no cron, no KV.
  Also: experimental auto-polish (off by default, save-first safety) + custom AI system
  prompt (Settings textarea, max 2000 chars, COMMON_RULES always appended).
- **Session 18 (2026-09) — 45 commits, deployed dev+prod:**
  - Magic Button: hover-triggered wand on project titles, task titles, note textareas.
  - Free-tier model picker (Settings): Mistral Small 3.1 24B Instruct (default), Qwen3 30B
    (reasoning), Llama 3.1 8B Fast. resolveModel whitelist.
  - Experimental auto-polish: capture-first, polish-after, Undo toast. Off by default.
  - Custom AI system prompt (Settings textarea, max 2000 chars).
  - Hover ⋯ menus on cards: .pd-task (project) + .db-card (board) + .note-card (dashboard).
    Edit opens inline modal. Delete shows confirm dialog. .pd-task-wrap wrapper.
  - Note modal editor + Sadhana (to-do) task edit as modal.
  - Project archives: migration 0046 (project_archives table). Archive/restore/delete.
  - Project logos: migration 0047 (projects.logo_path). Upload/serve/display.
  - Priority color coding: prio-dot shows priority color. Left-border accent. Urgent: red.
  - Sprint timeline redesign: circles instead of text bars (in_progress + done only).
  - VazirFA: unicode-range @font-face for all FA text everywhere.
  - Dark mode fixes: --muted #B0A79C (6.26:1), --line rgba(126,116,98,.45) (3.22:1).
  - i18n flash fix: boot.js critical FA dict before paint.
  - Sync badge fix: FTS5 rebuild + queue retry cap (MAX_RETRIES=5).
  - Dashboard audit (Phase 1-3): scrollbar, equal cards, nav active, note hover, icons,
    View All hide, FAB tooltip, collapsible sections, empty states.
  - Ideas folder grid: file-manager view. Telegram deep link connect.
  - Settings UI fixes: tab underline, label alignment, helper text, input styling.
- Tests **289/289** (was 265; +11 ICS export, +7 Telegram /update, +3 dashboard resume-card, +6 other); typecheck green.
- Schema **46** — migrations 0001–0047 (46 files; 0007 never existed).
- Assets: SW hibana-v278 (SHELL list + clip.html); app.css ?v=249, app.js ?v=168, i18n.js ?v=52, magic-wand.js ?v=8,
  canvas.js ?v=17, whiteboard.js ?v=11, admin.js ?v=3; content-hashed bundles in public/dist/.
- Repos: source assadigit/hibana-source; encrypted backups assadigit/hibana-safe.
- D1: pm-app-dev 80e02ce2..., pm-app-prod d842fcb5...; CF account 6ff25b58...
- Deployed: dev (hibana.aliassadi.workers.dev) + prod (hibana.ir); env.AI live on both.


## 2. Session index
| Session | Date | Outcome |
|---|---|---|
| 7 | 2026-08-28→09-05 | Audit hardening, Sadhana replica, mobile/i18n, dev-board+sprints (0029), sprint/calendar v2 (0030); ended `ddb3aa4` |
| 8 | 09-07→08 | = session 7 file + Tasks 28–32: v0.3.1–v0.3.4 ops era (file is a byte-identical superset; counted once) |
| 9 | 09-14 | v0.3.5 — 23-page UI/UX audit + critical screenshot-upload fix |
| 10 | 09-14 | v0.3.6 — 4 owner-report fixes |
| 11 | — | v0.3.7 — `#dash` duplicate-id root cause, notebook gear |
| 15 | 09-18 | v0.3.9 candidate — Obsidian export + neutral stage cards |
| 16 | 09-18 | v0.3.9 release — push `2a8a83c`, deploy dev+prod |
| 17 | 09-18 | v0.3.9.1 — the ONE sticky style, deploy `d98adea` |
| 18 | 2026-09 | v0.3.10.0–v0.3.10.2 — Magic Button + model picker + auto-polish + custom prompt + hover menus + archives + logos + priority colors + sprint redesign + VazirFA + dark mode fixes + i18n flash fix + sync badge fix + dashboard audit + ideas folder grid + Telegram deep link. 45 commits, 265/265 tests, schema 46 |
| 18 | 2026-09 | v0.3.10.0 — Magic Button (idea §1): Workers AI `[ai]` binding, `POST /api/ai/text`, `magic-wand.js` focus-triggered wand (polish/rewrite/translate, preview+Apply/Discard). 259/259 tests, typecheck green |
| 19 | 2026-09 | v0.3.10.1 — free-tier model picker (Settings): `GET /api/ai/models`, `POST /api/ai/text` accepts `model`, `resolveModel` whitelist (paid-only → default). 265/265 tests |
| 19 | 2026-09 | v0.3.11.0 — Session 19: ICS calendar export (`/api/export/calendar.ics`), Telegram `/update <project> <stage>`, web-clipper bookmarklet (`clip.html`), "Resume work" dashboard card (Mission #2), segmented OTP input, password visibility toggle, Farsi numerals on typing, canvas empty-state, board Add-button redesign, logo delete, per-column colored task borders, 50% larger taskadd modal, unlimited task titles (read-more clamp), github.deleteFile SHA auto-lookup, note-clear bug fix, comprehensive UI polish pass. 289/289 tests, typecheck green, SW v278 |
| 20 | 2026-09 | v0.3.11.2 — Session 20: systematic UI/UX audit (129-row sweep, 0 console errors), 22 AA-contrast offenders fixed (white-on-accent fills → --cta; teal-as-text → --link; pd-col inks darkened; dark sticky metadata + bug-bubble), 2 mobile overflows fixed (project header, clients payments form), CRITICAL backup coverage gaps fixed (project_archives + dev_task_tags in snapshot; restore.mjs stale tableOrder; restore-safe FK-safe ordering; personal export cluster), stale smoke expectation fixed. 293/293 tests, typecheck green, smoke ALL PASS, local restore drill PASS, app.css v259, SW v279 |

## 3. Timeline by era
### Foundation — 2026-08-21→25 (migrations 0014–0018; tests 75→163)
- Telegram webhook live (@Hibana_PM_bot): `/note` `/list` capture (0016), quick-note↔project
  attach (0017, no FK cascade by design), `/reset` hashed one-time token.
- Signup saga: registration + Turnstile + emailed codes (0015); fixed in series — malformed
  `--/>` comment swallowed register.html body; Turnstile render races; `cf-turnstile-response`
  vs `captcha` field name; Resend shared-sender 403 → verified domain `noreply@hibana.ir`.
  Login CAPTCHA then removed deliberately (rate limiter is the real guard).
- In-app D1 rate limiting (0014) — wrangler token can't edit WAF.
- Sadhana quadrant board (0018): renamable quadrants, fuzzy+exact Jalali deadlines, recurrence
  + Monday sweep, archive, zen, 7d/3d/1d/0d/2h Telegram reminders; roast P1–P7 design pass.
- Root-cause lessons: GitHub raw reads corrupted every image (text decoding → `readBinary()`);
  canvas batch sync dedupes by newest `updated_at` (LWW vs pre-batch state = data loss);
  deleted canvas objects resurrected (tombstone debounce race → skip `deleted` +
  flush-on-delete); htmx swaps only 2xx/3xx → silent JSON errors; CSRF Origin/Referer guard
  on all mutations.

### UI/UX overhaul + recovery — 2026-08-28→09-01 (SW v132→v178; 181→189 tests)
- Overhaul: typed HTML builder, ApiError registry, SQL table whitelist, ETags, command palette
  (Ctrl+K), skeletons/toasts/empty states, mobile bottom tabs, calendar (Jalali⇄Gregorian +
  Iranian holidays), timeline, notifications, heatmap, CSV export, zen/tour/Vim-go-to.
  CSS 2537→4501 lines; 16 prod deploys.
- Security: Quick-Find XSS (DocumentFragment); offline queue keeps items on 401/403; export
  user-scoping leak; security-headers middleware must clone immutable ASSETS responses.
- `/to-do-list` rebuilt as faithful Sadhana replica; whole app restyled to its design system.
- **Recovery (RECOVERED.md)**: ~50–60 hotfixes (2026-08-31→09-01) were lost from source; tree
  reconstructed from the live deployment (Worker bundle via CF API + frontend mirror + D1
  dumps), machine-verified (rebuild ≡ deployed bundle, 52/52 modules). Recovery carried:
  7-stage taxonomy (0031), spark folders (0037), «برنامه آتی» backlog docs (0033), problems
  tab (0034), changelog feature removed (table intentionally left in DB — do not drop),
  Turnstile → self-hosted HMAC math captcha, admin console (0035), email pipeline +
  `email_log`, ban gate, quick-note `done` (0038), sprint drafts (0039), dashboard redesign,
  canvas types (0032/0036), backup cron 4×/day, CSP `img-src https:`.
- Era lessons: duplicate `<main id>` (second id dropped at parse → all `#dash` selectors dead);
  jalaali port `_d2g` off-by-one-YEAR (Mar/Apr grids wrong years; 976 mismatches over
  2024–2031 sweep); sprint timeline needs one shared px/day scale; fabric group-child editing
  impossible → top-level "editing twin"; probe prod D1 before coding ("board broken" =
  soft-deleted project).

### v0.1.x audit + task wave — 2026-09-02→09-10 (191 tests; 0040)
- 39-finding audit backlog (37 shipped): screenshot cap 140→5 MB (Worker OOM);
  newest-note-first; sequential cron; captcha operand leak → HMAC question; timing-safe
  compares; `/app` 404 root cause `not_found_handling="404-page"` starved Worker routes →
  `"none"`; structured logging + reqId; perf caps (dashboard LIMIT 48, notebook LIMIT 100).
- Sprint board v2 (0030, video-editor timeline) + calendar v2 (exact-day jumps, شمسی/میلادی
  switch, drag-to-plan legend). v0.1.7 (09-09): FTS5 depth (0040: quick_notes, backlog_docs,
  sadhana_tasks, canvas text; prod backfilled).
- **2026-09-10 security arc (CRITICAL)**: backups AES-GCM `HIBENC1`; hibana-safe history
  rewritten, 61 plaintext snapshots purged; PBKDF2 → 600k; invite link GET→POST; fabric v5→v6
  plan; CI workflow; canary restore; Telegram inline-keyboard redesign (0043
  `telegram_bot_sessions`, JSON state, no TTL).

### v0.2.0 — 2026-09-11 (0044; tests 203)
- Plan B Telegram backup: encrypted snapshot to owner chats, retention 60, sha256 in caption,
  D1-independent manual restore (`drill:planb`).
- **Fixed: GitHub restore path broken for every encrypted backup since 09-10** — Contents API
  stores raw-binary; restore knew only base64. `lib-backup.mjs` 3-shape detection (test-pinned).
- SW strategy split (cache-first versioned assets, SWR vendor); D1 EXPLAIN: worst interactive
  4.91 ms — no new indexes needed.

### v0.3.0–v0.3.4 ops era — 2026-09-07→08 (0045; tests 224→233)
- v0.3.0: healthchecks.io dead-man's switch + D1 Time Travel restore channel + pre-migration
  bookmark ritual (§5) + `error_log` (0045) + admin Errors tab + HTML→`/dist/` wiring + deploy
  gate. **Day-one real catch:** transient D1 `SQLITE_CORRUPT_VTAB` killed the cron backup
  while BOTH in-band alerts (email+Telegram, both query D1) failed silently — the out-of-band
  healthcheck was the only surviving signal.
- v0.3.1: healthchecks wired to owner (6h/6h); hibana.ir NS incident — IRNIC delegation
  silently moved to ArvanCloud (~08-31, DKIM dead); owner restored CF nameservers; zero data
  impact.
- v0.3.2: jitter-proof cron classification (keyed on `controller.cron`, not wall clock — a :31
  tick was misread as backup tick, masking the watchdog); `MIRROR_ORIGIN` CSRF allow-list.
- v0.3.3/0.3.4: mirror moved to sadhana.ir, then DEFERRED — Arvan API keys live in a different
  account than the zone. Frozen safely (resume = correct key + ~4 calls).

### v0.3.5–v0.3.9.1 — 2026-09-14→18 (tests 233→244)
- **v0.3.5**: CRITICAL — screenshot uploads had NEVER worked (leading-slash `assetPath()` →
  Contents API 422; prod screenshots table 0 rows ever); offline boot stays on-page (guard
  misread SW 503 as logged-out); AA contrast pass (--cta #3D8D91→#2E7B7F); 77 unversioned refs
  versioned; quadrant carousel ≤740px; calendar "today" in profile TZ; dead to-do-list.html
  deleted. Lesson: Playwright set-offline doesn't block SW fetches — honest offline test =
  stop the server.
- **v0.3.6**: owner-report fixes — view controls always visible, board gap 12→20px, prog-track
  :focus-within, status-box counts neutral.
- **v0.3.7**: all 3 reports traced to duplicate `id` on `<main>` → `shell-dash` + 4 selector
  fixes; notebook gear + toggle-state persistence (capture-phase — toggle doesn't bubble).
  Lesson: "rule never applies" → computed-style probe, not stylesheet grep.
- **v0.3.8**: flat kanban cards + phase chroma (~90% L, AA), phone 2-up sticky grid, native
  `<dialog>` task composer (300-char Zod).
- **v0.3.9** (`2a8a83c`): Obsidian vault export `GET /api/export/obsidian.zip` (fflate, YAML
  frontmatter, round-trip dedup by title); neutral stage cards (status color only in
  inline-start pill, sr-only labels); Plan B Telegram on-demand only (cron +
  `telegram_backup` toggle removed; column retired but kept in schema for rollback safety).
- **v0.3.9.1** (`d98adea`, dot-release): the ONE sticky-note style — true square, 2px corners,
  layered shadow `1px 3px 4px rgba(0,0,0,.10)` + `4px 12px 20px rgba(0,0,0,.12)` across
  quick-notes, fabric stickies, corkboard, calendar chips. Fabric twin-rect shadow
  (`__shadowPaper` — fabric holds ONE Shadow per object; never shadow the group); `fitPaper`
  square growth via binary search (linear growth overshot ~8×); deliberately reverses
  Phase-7 auto-height caps.

### v0.3.10.0 — 2026-09 (Magic Button / Workers AI; tests 244→259)
- **Green-lit scope (idea §1) only.** One on-demand AI wand (inline SVG) next to editable
  text — notes (`.note-text`), the quick-note composer (`#quicknote-text`), the project
  description (`#pd-desc`), plus a `data-magic` opt-in for any future textarea/
  contenteditable. Never background, never auto-run, never blocks capture (whiteboard rule).
- Actions: **Polish** (grammar/spelling/clarity, same language, similar length) · **Rewrite**
  (clean technical/developer register, same language) · **Translate** (auto-detect, EN↔FA).
  System prompt enforces output-discipline: ONLY the transformed text, no preamble/quotes/
  fences, names/numbers/dates/URLs/code identifiers verbatim, never add or drop meaning.
- Backend: `wrangler.toml` `[ai]` binding → `AI: Ai` in `Env` → `cfg.ai` (a structural slice
  of the binding). Route `POST /api/ai/text` (`src/routes/ai.ts`) under `requireAuth` + the
  global CSRF gate; Zod `{text:1..4000, action:polish|rewrite|translate}`; model
  `@cf/qwen/qwen3-30b-a3b-fp8`, temperature 0.2, non-streaming, `response_format:text`.
  Pure service `src/services/ai.ts` (buildMessages / runAiTransform / withinCharBudget /
  stripAccidentalWrappers) — testable with a mock binding, no network. Char guard counts
  code points (FA combining marks not double-counted). Node self-host path: `cfg.ai`
  undefined → 503 `unavailable` with a localized “Workers-only” notice (portability contract).
- UX (`public/js/magic-wand.js` + `magic-wand.css?v=1`): focus-triggered floating wand (zero
  DOM restructuring → no risk to htmx swap targets); popover with the 3 actions; on success a
  side-by-side Original vs Suggestion preview with **Apply / Discard**. Apply sets the field
  value and dispatches `input`+`change` so the surface’s OWN autosave persists (the wand never
  writes). Discard / Esc / outside-click / error / timeout / daily-cap = toast, original
  byte-for-byte intact (Mission #1). Spinner on the wand while running; repeated clicks
  disabled during a run. RTL-aware (wand anchors to the end corner; popover flips on-screen);
  EN/FA localized; `prefers-reduced-motion` honored. Re-arms on `htmx:afterSwap`.
- Cost: ~5–8 neurons/call → thousands/day inside the 10k/day free budget; no paid overage
  possible on Workers Free. **No schema change, no migration, no cron, no KV, no secret.**
- Acceptance: `npm run typecheck` green · `npm test` 259/259 (15 new in `src/tests/ai.test.ts`)
  · `node --check` on `magic-wand.js`/`i18n.js` green · i18n parity +15 EN/+15 FA. FA-quality
  review (Ali, 5 real FA notes) + idea §6 model spike deferred to deploy-time per the idea doc.
- Wired onto `dashboard.html`, `project.html`, `sparks.html`; `i18n.js` cache-bust 36→37 on
  all 21 pages (SW `hibana-v238` unchanged — SW logic untouched, new files runtime-SWR cached).

## 4. Ops & DR state (condensed runbook)
- **Backups**: 4×/day cron `17 3,9,15,21 * * *` → AES-256-GCM `HIBENC1` (~100 KB) →
  `assadigit/hibana-safe` `backups/`; retention 120 (~15 days). `*/30` cron = Sadhana
  reminders; daily-only jobs (purge, weekly sweep, client reminders) gated to the 03:17 slot;
  sequential (subrequest budget).
- **Restore (recommended)**: `BACKUP_ENCRYPTION_KEY=<key> npm run restore:safe -- --file
  snapshot.json [--dry-run]` → sacrificial `pm-app-dev`, Check A (vs backup) + Check B (vs
  prod), typed "yes" for prod. Direct: `node scripts/restore.mjs --file <snap> --d1
  pm-app-prod` (wipes, unverified). Restores never include `password_hash`/`sessions`; lost
  admin → `npm run seed:admin:prod`. Drills quarterly: `npm run drill`, `npm run drill:planb`;
  decrypt failure = P1.
- **Pre-migration ritual (mandatory)**: `npm run bookmark:prod` (appends one row to §9
  below) → `npx wrangler d1 migrations apply pm-app-prod --remote`. Undo: `npx wrangler d1
  time-travel restore pm-app-prod --bookmark <id>` (in-place, destructive, 30-day window,
  minute granularity). Post-restore: verify `/api/health` schema_version, fresh bookmark,
  `curl -X POST https://hibana.ir/api/admin/backup`.
- **Monitoring**: healthchecks.io check `Hibana` / slug `hibana`, 6h period + 6h grace (alert
  = 12h silence), email channel independent of CF/Resend/Telegram/GitHub. Ping URL in
  `HEALTHCHECK_PING_URL`: success → GET, backup fail/skip → append `/fail`. Manual backups +
  dev worker never ping (anti-masking). Ticks classified by trigger (`src/lib/cron.ts`).
- **Plan B**: on-demand only — bot Settings 🗄 (owner-only) or `POST /api/admin/backup/planb`;
  files `hibana-backup-<UTC>.bin`, caption = schema/time/rows/sha256; failure →
  `planb_failed` + Resend email (deliberately not Telegram).
- **Key custody**: `BACKUP_ENCRYPTION_KEY` — two independent offline copies (print + password
  manager, non-repo device). **NEVER rotate** (orphans all encrypted backups; keep old key
  until 15-day retention ages out). Lost-key path: Worker alive → app export + new key (old
  backups forfeited). Key-custody drill not yet run (agent never sees the key by design).
- **Telegram bot**: commands `/start <code>` (1h TTL) `/help /idea /note /list /done /cancel
  /append <project> <text> /status /pause /resume /reset` (+proposed `/menu /language
  /todo`). Webhook `https://hibana.ir/api/telegram/webhook`, secret-token validated. State:
  `telegram_bot_sessions` (JSON, no TTL). **Add-only by design** — edit/delete → "Open in
  Hibana →" deep link; sole exception to-do mark-done+Undo. `telegram_paused` mutes reminders
  only, never Plan B.
- **Edge mirror (Iran) — DEFERRED**: frozen at sadhana.ir; needs zone-account Arvan key + ~4
  calls (origin `hibana.ir:443`, host_header, free SSL, `/api/*` BYPASS). Invariants:
  hibana.ir NS stay Cloudflare (isabel/patryk); sadhana.ir apex-only; `MIRROR_ORIGIN`
  allow-list. Rollback: remove NS at IRNIC.
- **Fabric v6**: plan = esbuild shim `src/vendor/fabric-shim.ts` → `window.fabric`
  (canvas.js / whiteboard.js unchanged); v6 ESM-only, `charWidthsCache` removed,
  `Image.fromURL` Promise-based. Currently deferred (v5.3.0 UMD in use, no known CVEs).
- **Perf**: no new indexes (rule-9 composites + 0042 cover hot paths; D1 RTT dominates).
  Re-run `npm run perf:explain` after schema/query changes; thresholds: `sadhana_updates`
  >~100k rows → index `(created_at)`; canvas >~50k elements → partial bbox index. Rejected:
  KV/DO hot reads, htmx fragment caching, HTML s-maxage. Caching contract: HTML + `/api/*`
  no-store; `?v=` 1h+SWR; vendor 1d; `/dist/*` immutable 1y; SW bumps only on sw.js logic
  changes.
- **Deploy**: `npm run deploy[:prod]` = build `--prod --wire-html` → `check-dist-wiring`
  gate → `wrangler deploy [--env prod]` → `--restore-html`. Committed HTML keeps human `?v=`
  refs; `.build-backup/` canonical-only invariant. Rollback: `git checkout <good> && npm run
  deploy:prod`. Node self-host: Node 24+ (`node:sqlite`; better-sqlite3 REMOVED), PORT 3000,
  `DB_PATH=data/hibana.db`; trusted-proxy requirement on Node (X-Forwarded-For spoofing
  dodges rate limits; Workers unaffected — CF-Connecting-IP authoritative).

## 5. Migrations — live-DB warning
Live D1s run 0001–0045 (schema 44). The reconstructed 0031–0039 exist for fresh environments;
their `d1_migrations` bookkeeping rows were never backfilled — **never blindly `wrangler d1
migrations apply` against live DBs** (it would re-run table rebuilds). Backfill once to make
future applies a clean no-op:
```sql
INSERT INTO d1_migrations (name, applied_at) VALUES
  ('0031_project_status_stages.sql', datetime('now')),
  ('0032_canvas_squig_types.sql',    datetime('now')),
  ('0033_backlog_docs.sql',          datetime('now')),
  ('0034_dev_task_bug.sql',          datetime('now')),
  ('0035_admin_user_mgmt.sql',       datetime('now')),
  ('0036_canvas_sticky.sql',         datetime('now')),
  ('0037_spark_folders.sql',         datetime('now')),
  ('0038_quick_note_done.sql',       datetime('now')),
  ('0039_sprint_drafts.sql',         datetime('now'));
```

## 6. Open items (verified against the v0.3.11.2 tree)
**Code — verified absent:** admin feature-usage analytics + top-10 activity ranking · ~~Telegram
`/update <project> <stage>`~~ ✅ shipped v0.3.11.0 · ~~one-way ICS calendar export (High)~~ ✅ shipped
v0.3.11.0 · ~~web-clipper bookmarklet / extension~~ ✅ shipped v0.3.11.0 · `dev_tasks` note
column · email-in (Email Workers) · Google Calendar 2-way sync · canvas auto-routing
connectors · multi-canvas. Deferred by design: incremental notebook swap.
**Owner-held:** rotate GitHub token (classic, `repo` scope — chat-exposed) · close
`OPEN_REGISTRATION` · CF "Always Use HTTPS" toggle · PWA installability re-check ·
key-custody drill · Resend delivery confirmation.
**Watch:** one non-repro vitest failure seen once (149/150, then 3× 150/150) · deep links
hardcode hibana.ir · mirror rate-limit keys share Arvan POP IPs. Session 20 note: the
smoke test's htmx spark-fragment expectation was stale (failed at v0.3.11.1 HEAD) —
fixed to match the ideas-folder-grid; if a future smoke failure appears, check whether
the expectation or the product changed first.

**Shipped this session (v0.3.11.0):** ICS calendar export (`/api/export/calendar.ics`),
Telegram `/update <project> <stage>`, web-clipper bookmarklet (`clip.html`), "Resume work"
dashboard card, segmented OTP input, password visibility toggle, Farsi numerals on typing,
canvas empty-state, board Add-button redesign, logo delete, per-column colored task borders,
50% larger taskadd modal, unlimited task titles (read-more clamp), github.deleteFile SHA
auto-lookup, note-clear bug fix, comprehensive UI polish pass (tour, cmdk, calendar,
settings, dashboard, project-detail, board, sadhana, clients, admin, canvas, whiteboard,
notifications, reports, archive, clip). 289/289 tests, typecheck green, SW v278. The idea
doc's Tier-1 deferred items (Telegram voice→spark, back-to-work recap, semantic find
stages 1–2) remain not built. FA-output quality review (Ali, 5 real FA notes) is a deploy-
time gate.

## 7. Consciously rejected (do NOT propose — vision.md)
Subtasks/rigid hierarchy · nagging reminders/push/overdue toasts · milestones/OKRs/maturity
scores · cross-project Gantt/dependencies · backlinks/wiki-graph · daily-notes/diary ·
mood/energy tracking · tag nesting · templates · team features (@mentions, shared boards,
assignments) · native app (Capacitor path reserved) · time tracking. Scoped: Gantt →
per-project sprint timeline; canvas images via URL; journaling → per-task sadhana_updates;
fixed 4-color sticky palette; recurrence sadhana-only.

## 8. Verified-implemented digest (backlog audits, ~98 items; pm-app-spec is fully implemented)
Parts 1–3 + Phases 4–7 (both blocks): all ✅ (tab order/backlog docs/renames · 7-stage
pipeline · admin console · stat carousel · spark folders · canvas circle/rect · notebook
stickies · sprint overhaul · notebook save hardening · emoji library · rename-pop ·
canvas→note · FAB modal · skeletons). Crown surfaces: 7-stage pipeline · 4 task surfaces
(hurdles/dev_tasks/sadhana/client) · 6-channel idea capture · manual promotion · spark
folders · two boundless canvases + LWW offline sync · 8 canvas element types · non-nagging
client reminders · Telegram bot · Obsidian import + JSON/MD/CSV export · PWA bottom-tab nav.
Roadmap DONE: prod rollout, P1/P2 all, roast P1–P7, signup+verification, Telegram linking,
rate limiting, HTTPS 301, CSRF, backup retention, `/api/health`, PWA icons, zero CDN deps,
Node self-host.
**Stale "open" items since fixed (do NOT carry):** quick-note newest-first ✅ · Telegram
`/append` ✅ · notebook photo inversion ✅ (counter-filter) · FTS depth ✅ (0040) · on-hold
violet = deliberate owner decision · sparks bulb ✅ · `#shots` auto-refresh ✅.

## 9. D1 Time-Travel bookmark log (operational — newest last; KEEP THIS SECTION LAST)
Created by `npm run bookmark:prod` before each prod migration (`scripts/
pre-migrate-bookmark.mjs` appends rows at the end of this file — that is why this section
must stay last). Restore is in-place and destructive: `npx wrangler d1 time-travel restore
<db> --bookmark <id>`.

| UTC timestamp | database | schema | bookmark id | reason |
|---|---|---|---|---|
| 2026-09-07T02:17:02.947Z | pm-app-prod | 43 | 000005ff-00000000-000050df-1931618c922f41a76b7c7562ca95765e | pre-migration bookmark (prod) |
| 2026-09-07T03:39:19.075Z | pm-app-prod | 44 | 00000607-00000002-000050df-b85cfafbd13f7bfecd16248d882d092b | post-0045 healthy state, after transient D1 SQLITE_CORRUPT_VTAB incident |
