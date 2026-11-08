# Hibana — Projects-Section Audit & Phased Remediation Spec

**Created:** 2026-11-07 (session S251) · **Owner approval:** "Ok you have all approval of me to do this in
phases. (multiple sessions)" — the full audit (backend / frontend / database / desktop-parity) was delivered
in chat and approved for phased implementation. This file is the durable, self-contained execution plan.
**Every execution session starts by reading this file top to bottom.**

**Scope audited:** the whole Projects section and everything that belongs to it — kanban (`/board.html`),
sprints (`/sprint.html`), strategies (S250), projects list/detail (`/projects.html`, `/project.html`), the
devboard/projects backend, the D1 schema, and the hibana-desktop parity surface.

**Repos:** `assadigit/hibana-source` (web; this repo) + `assadigit/hibana-desktop` (desktop). **The law:**
every web change is applied to desktop in the same phase for a consistent experience.

---

## §0 RED LINES & STANDING RULES (non-negotiable, every session)

1. **THE DB IS A SAFE — never lose it.** Before ANY migration or destructive-adjacent change, run the
   full backup ritual (§12.1). Sensitive real user data lives in these DBs. Backups are verified, not
   assumed. If any step of the ritual cannot run, STOP and report — do not proceed.
2. **Periodic commit + push.** Commit+push after EVERY finding-level fix (never one mega-commit per
   session). Format `<area>: <change> — <one-line why>`. Before EVERY push: `git status` must show no
   staged secrets (`credentials.md`, `.secrets.env`, `.dev.vars`, `.admin.secrets`, `*.sql` dumps) —
   unstage if found. CI runs on push; CD auto-deploys dev+prod on green.
3. **Additive-only API contract.** Existing payload keys / endpoint paths / status-code meanings are
   NEVER removed, renamed, or re-scoped. New things are additive (new keys, new endpoints, opt-in
   params). The desktop Go client + `src/tests/api-surface-s241.test.ts` pin this.
4. **Additive-only migrations.** Next number = **0067** (65 files on disk, schema 65 live, the `0007`
   gap is original). Never ad-hoc `ALTER`. Schema changes carry the owner's written approval — the
   approval quote at the top of this file covers THIS spec's listed migrations; cite it in the
   migration header.
5. **Desktop parity in the same phase** (re-pin + probes + release) — or an explicit, written
   deferral with reason in the phase's close-out note.
6. **No secrets in this file, in commits, or in zips.** Live credentials: `credentials.md`
   (gitignored, local-only) or the owner's session message. Deploy needs `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` in env.
7. **English with the owner, always.** App copy stays EN+FA together (i18n parity gate).
8. **Verification ladder before "done"** (§12.2). No phase closes on a red gate.
9. **Session close ritual** (§12.4): worklog entry, Changelogs row, THIS file's §14 status table
   updated, commit+push, and the next-session prompt handed to the owner in chat (§13 template).
10. **Zip rule** (Agents.md): per-version `hibana.<version>.zip` to the owner's upload/download
    folders when they exist in the sandbox; otherwise note the skip.

---

## §1 Current-state snapshot (verified 2026-11-07, pre-remediation)

- Web `v0.4.1.44` @ `71808075`; S250 strategies tier LIVE (migration 0066 applied to both D1s, schema
  64→65; 8-key payload; sprint-page strategies section). Tests **969/969**, i18n parity **1707/1707**,
  SW `v460`, precache budget 2,360 KB (measured ~2,341 KB — **~19 KB headroom**).
- Desktop `v0.1.40` @ `a077f1d`; island pin `6dd40c0` (web v0.4.1.44); mirror schema v4; 14 probes.
- Prod D1 (`pm-app-prod`) real data: users 6 · projects 36 · sprints 2 (both completed) · strategies 0
  (S250 probe data was cleaned up) · dev_tasks 57 · project_archives 147 · screenshots 20 ·
  sessions 122. Dev D1 (`pm-app-dev`) is the test bed.
- **Honest scale framing (from the DB audit):** at this size every query is <1 ms of SQLite work; the
  thing users can feel is **D1 round-trip COUNT** and **frontend render/refetch behavior** — those are
  the levers this plan pulls. Index micro-optimization beyond the one verified scan is explicitly
  out of scope (§15).

**Phase 0 — safety baseline (DONE, this session S251, 2026-11-07):**
- Fresh full SQL dumps of BOTH D1s via `scripts/d1-dump-tables.mjs` → `/home/z/hibana-backups/
  pre-audit-{dev,prod}-20261108.sql` (+ manifests). **Restore verified:** loads clean with
  `PRAGMA foreign_keys=OFF` (the dump's table order does not respect the new `sprints.strategy_id`
  FK dependency — always load raw dumps with FKs off), `PRAGMA integrity_check` = ok, row counts
  verified. NOTE: raw dumps contain `sessions` + password hashes — local-only, never commit.
- Automated encrypted backup lane verified fresh: `assadigit/hibana-safe` `backups/` holds 122
  snapshots, latest `snapshot-2026-11-07T21-23-24-880Z.json` (prod, ~1.5 h before this check).
- Data-cleanliness checks for Phase 2's unique indexes: **zero** sprint name case-twins, **zero**
  multi-draft projects, **zero** strategy name twins, **zero** tag case-twins. 1 archive row has
  `sprint_id` set; **1 orphan archive row already exists** (its project is gone — evidence for DB-3).

---

## §2 FINDINGS CATALOG (the audit, compact — IDs are referenced by phases)

Severity: P1 = must fix (correctness/data risk) · P2 = should fix (perf/health) · P3 = nice.
Effort: S <1 h · M 1–4 h · L >4 h. Evidence refs were verified against `71808075`; **re-verify
anchors before editing** (line numbers drift).

### Backend (BE) — `devboard.ts` 1,337 ln / `devboard-helpers.ts` 505 / `projects/index.ts` 944 / `projects/helpers.ts` 1,037 / `projects/detail-helpers.ts` 1,134

| ID | Sev | Finding | Evidence | Fix | Eff |
|----|-----|---------|----------|-----|-----|
| BE-1 | P2 | `setTaskTags` N+1 chain — up to ~30 sequential round trips per tagged-task save | `devboard-helpers.ts:379-413` (per-name SELECT, per-tag INSERT, per-row DELETE/INSERT) | batch find (`IN`), one palette query, chunked link sync; response shape unchanged | M |
| BE-2 | P2 | Sprint auto-name collision bump = up to 51 sequential queries | `devboard.ts:726-728` loop × `devboard-helpers.ts:91-94` | one sibling-names query, compute bump in JS | S |
| BE-3 | P2 | Board payload ships every sprint's full `description` (up to 100 k chars each) | `devboard.ts:248` (`SELECT * FROM sprints`) | additive `GET /api/sprints/:id/doc` + `?lean=1` opt-in on board GET; default payload unchanged (desktop-safe) | M |
| BE-5 | P3 | `archive-done` fold is O(n²); archives GET unbounded | `devboard.ts:494`; `devboard.ts:544` | Set-based fold (part of BE-10); `LIMIT 200` + `?offset=` gated | S |
| BE-6 | **P1** | Tag find-or-create races → 500 on `UNIQUE(user_id,name)` (double-click / queue replay) | `devboard.ts:631-637`, `devboard.ts:1305-1311`; fix recipe already in-repo at `projects/index.ts:434-450` (`ON CONFLICT … DO UPDATE … RETURNING`) | one shared `findOrCreateTag()` (NOCASE + ON CONFLICT) used by all three sites — also fixes BE-12's case-twin inconsistency | S |
| BE-7 | **P1** | `POST /sprints` closes the active sprint BEFORE validating the new window — a failed request leaves the active sprint permanently closed | `devboard.ts:757-780` (close at 769-771, `assertSprintWindowOk` at 779) | validate window first (start is known upfront), close only on the success path | S |
| BE-8 | P2 | Check-then-insert TOCTOU: one-draft-per-project + sprint/strategy name uniqueness have no backing indexes | `devboard.ts:733-737`; `devboard-helpers.ts:90-96,477-483` | partial/expression unique indexes in 0067 (data verified clean §1) + catch-and-map to existing 409 codes | M |
| BE-9 | P2 | `PATCH /api/sprints/:id` fetches the sibling set twice | `devboard.ts:934` + `assertSprintWindowOk` re-query (`devboard-helpers.ts:129-132`) | pass pre-fetched siblings | S |
| BE-10 | P2 | `archive-done` is non-transactional (INSERT loop + chunked DELETE + post-hoc refresh) — failure between them duplicates archive rows; `/finish` does the same flow atomically | `devboard.ts:504-513` vs `devboard.ts:1023-1034` | wrap in `cfg.db.transaction`, mirror finish's shape; SQL-side link filter | S-M |
| BE-11 | P2 | Categories payload SQL byte-identical in two files | `devboard.ts:255-265` = `projects/detail-helpers.ts:86-96` | lift to `categoriesForProject()` in `lib/categories.ts` | S |
| BE-12 | P2 | Tag find-or-create triplicated with inconsistent case semantics (NOCASE vs exact — creates "ui/ux" next to "UI/UX") | `devboard-helpers.ts:385` vs `devboard.ts:631,1305` | solved by BE-6's shared helper | S |
| BE-13 | P3 | Two different `reorderSchema`s (different grammar, same name, two homes) | `devboard.ts:148` vs `validation/schemas.ts:83-86` | consolidate as `devtaskReorderSchema`/`projectReorderSchema` in `schemas.ts` | S |
| BE-14 | P3 | SET-builder `push` closure written 4× | `devboard.ts:921,964,1153` + `projects/index.ts:706-711` | `buildUpdate(entries)` helper | S |
| BE-15 | P3 | One-active 409 guard ×4, isLatest ×2 (verbatim) | `devboard.ts:827-828,879-880,950-951,1072-1073`; `947-949` vs `1063-1069` | `assertNoActiveSibling()` / `assertLatestSprint()` | S |
| BE-17 | P3 | ~150 ln of devboard schemas live route-file-local instead of `validation/schemas.ts` | `devboard.ts:33-185` | moves with the Phase-6 split | S |
| BE-20 | P3 | `detailHtml` ≈ 1,020 lines — invisible to the fn gate (nesting blind spot) | `projects/detail-helpers.ts:113-1132` | carve into fragment builders (backlog; only if a session has budget) | L |
| BE-25 | P2 | `etag()` hashes the FULL assembled body per request — "the DB cost is the same" | `lib/http.ts:106-131`; board GET `devboard.ts:221-299` | cheap version-stamp weak ETag checked BEFORE the 7-query assembly (one `MAX(updated_at)` probe) → real 304s | M |
| BE-26 | P3 | No caching of the user's tag library (re-queried every board GET) | `devboard.ts:249` | prefer BE-25 first; per-isolate TTL is cosmetic on Workers | — |

### Frontend (FE) — `project-page.js` 6,169 ln / `devboard.js` 3,046 / `sprint-page.js` 2,243 / `board-page.js` 1,770 / `projects-page.js` 589 · CSS: `devboard.css` 2,413 ln, `project-header.css` 1,982

| ID | Sev | Finding | Evidence | Fix | Eff |
|----|-----|---------|----------|-----|-----|
| FE-1 | **P1** | Every mutation = full refetch + full `innerHTML` rebuild + 4 listeners/card re-injection | `board-page.js:837,657,1052-1105`; `sprint-page.js:518-519` (`reload()` after every mutation) | delegate card menus (`ctx.on` + `closest()`), per-column repaint for patchTask/createTask (pattern exists: `project-page.js:3409`) | M |
| FE-2 | **P1** | Drag-over layout thrash on all three DnD surfaces (unthrottled `elementFromPoint` + `insertBefore` per event; touch fires per pointermove ~60 Hz) | `board-page.js:1506-1525`; `project-page.js:5603-5630`; `sprint-page.js:2036-2086`; `touch-drag.js:59` | rAF-batch the dragover work; cache target rects | S-M |
| FE-3 | **P1** | Mobile scroll BLOCKED when a touch starts on any draggable card (`touch-action:none` at pointerdown, before long-press arm) | `touch-drag.js:42` (arm timer `:43-48`, move-cancel `:54`) | set `touch-action:none` only when the 250 ms arm fires | S |
| FE-4 | **P1** | Column repaint on `/project.html` refetches the ENTIRE 13-query detail payload (all screenshots, history…) to re-render ≤2 columns | `project-page.js:3409-3416` → `detail-helpers.ts:49-109` | repaint from the devboard payload (already loaded there) or `?part=board` | M |
| FE-5 | P2 | ~950 KB render-blocking CSS per page, mostly page-irrelevant (quicknotes 105 KB, dashboard 72+60 KB, canvas 38 KB…); JS 1.0–1.3 MB raw per page | board/sprint/projects/project `<link>` sets; `scripts/check-precache-size.mjs` | per-page concatenated CSS bundles through the existing esbuild step (exact current order); buys precache headroom back | M-L |
| FE-6 | P2 | No focus trap in the custom modals; `hibana.confirm` restores focus to `<body>` | `devboard.js:1132-1152`; `board-page.js:321-338,205-228`; `sprint-page.js:776-811`; `app.js:389` | one shared trap helper (Tab wrap on overlay) + `activeElement` restore | S-M |
| FE-7 | P2 | Sprint timeline renders every task twice (hidden duplicate bars for drag targets) | `sprint-page.js:456-487` | on-demand bars / `content-visibility` | S |
| FE-8 | P2 | Serial boot waterfall: i18n ready (awaits `/api/auth/me` + FA dict) BEFORE board load starts | `board-page.js:1755`; `sprint-page.js:2241`; `i18n.js:69-91` | start `B().load()` immediately, await together | S |
| FE-9 | P2 | Strategy focus filter silently hides sprint-less tasks; no explanatory state; weak reset discoverability | `sprint-page.js:443,748-749` | one-line "Filtered by X — tasks without sprints are hidden · Clear" strip (existing `db-filter-shown` grammar) | S |
| FE-10 | P2 | Filter-chip clicks rebuild the toolbar and drop keyboard focus | `board-page.js:1213-1226` (search restores `:1596-1601`; chips don't) | restore focus to `[data-fp]`/`[data-ft]` after render, or toggle classes in place (`pdFilterApply` pattern `project-page.js:1736-1743`) | S |
| FE-11 | P2 | No undo on task delete; "Clear done" fans out N DELETEs | `board-page.js:1183-1196,1439-1445`; undo pattern exists (`projects-page.js:448-466`) | THIS PLAN: bulk `POST …/devtasks/clear-done` endpoint + island use. Full delete-undo = backlog (needs server soft-delete design) | M |
| FE-12 | P2 | 3 s GET abort + retry adds double latency on genuinely slow networks | `devboard.js:35-52` | raise first deadline to ~8 s (keep the signal-wrapped dispatch — that's the actual edge-bug mitigation) | S |
| FE-13 | P3 | Duplication across islands: `esc` ×10, `faDig` ×5, `G_MONTHS` ×3, priority labels ×3, `placeInList` twins, `I_TRASH` ×2 | see audit refs | consolidate into `chip-render.js` (the shared home), byte-equal twins | M |
| FE-14 | P3 | Dead code: `TITLE_CLAMP` unused | `board-page.js:588` | delete + `?v=` bump | XS |
| FE-15 | P3 | i18n fallback leaks raw keys on dictionary-load failure (`t()` returns the key — truthy) | `devboard.js:77`; `chip-render.js:30`; `due-control.js:52` vs the correct guard `board-page.js:15-18` | adopt the `s !== k` guard | S |
| FE-16 | P3 | `task_tags` payload key unused by web islands — but LOAD-BEARING for desktop (`BoardPayload` 8 keys) | `devboard.ts:294`; `api/types.go` | DO NOT remove. Document in `API-AND-SYNC-CONTRACT.md` | S |
| FE-17 | P3 | Sprint sidebar inputs/collapse state wiped by concurrent mutations' full re-render | `sprint-page.js:186,210` | preserve `data-open` + quick-add values across renders | S |
| FE-18 | P3 | No keyboard path for reordering / cross-lane moves | `board-page.js:790,1639-1646` | "Move to →" action in the card ⋯ menu | M |
| FE-19 | P3 | `ensureLib` polls 1.2 s before self-injecting on soft-nav edge cases | `board-page.js:1656-1679` | inject on script `error` event; keep the 9 s ceiling | S |
| FE-20 | P2 | `check-cache-bust.mjs` scans only HTML — injector literals inside island JS can drift (documented double-cache bug class) | `board-page.js:1669-1672` | extend the checker to `public/js` injector literals | S |

### Database (DB) — migrations 0001–0066 audited in full; final schema EQP-verified on a fresh migrated DB

| ID | Sev | Finding | Evidence | Fix | Eff |
|----|-----|---------|----------|-----|-----|
| DB-1 | P2 | The only EQP-verified full SCAN: `UPDATE project_archives … WHERE sprint_id=?` (sprint delete) — on the one monotonically-growing table | `devboard.ts:1098`; no index on `sprint_id` | `CREATE INDEX IF NOT EXISTS idx_project_archives_sprint` in 0067 | S |
| DB-2 | P2 | One-draft-per-project + name uniqueness are app-level only (TOCTOU) | `devboard.ts:733-737`; partial-unique precedent `idx_sprints_one_active` (0065:56-60) | partial unique `idx_sprints_one_draft` + expression uniques on `lower(trim(name))` (per project, sprints + strategies) — data verified clean (§1) + catch-and-map to 409s | M |
| DB-3 | **P2** | `project_archives` has NO FKs — orphan rows survive project hard-delete/purge (1 orphan ALREADY exists in prod) | 0046:6-17; purge sites `projects/index.ts:749`, `admin.ts:689`, `settings.ts:316` | add `DELETE FROM project_archives WHERE project_id IN (…)` to the 3 purge sites (CASCADE-consistent; loudly documented) + purge-parity test + clean the 1 existing orphan | S |
| DB-4 | P3 | 0060's rebuild silently dropped `projects.folder_id`'s FK (app-level cleanup makes it latent) | 0037:17 vs 0060:47 | DEBT.md note (a future rebuild restores it) | S |
| DB-5 | — | **Healthy:** one-active invariant 3-layer enforced + test-pinned; timestamps uniformly ISO-8601 UTC TEXT; sort_order dense integers; `tags.usage_count`/`search_tags` denormalizations maintained on every mutation path | 0065:56-60; `sprint-deadline-deps-domain.test.ts:215,251` | nothing to do | — |

### Desktop (DT) — `hibana-desktop` @ `a077f1d`, v0.1.40, pin `6dd40c0`

| ID | Sev | Finding | Evidence | Fix | Eff |
|----|-----|---------|----------|-----|-----|
| DT-1 | **P2** | `WEB_VERSION` workflow env drifted: says `0.4.1.43`, pin is `6dd40c0`/`v0.4.1.44` — every release note since v0.1.38 claims the wrong embedded web version | `.github/workflows/desktop.yml:25` vs `sync-island.mjs:178-179` | one-line fix + comment that the twins move together (same class as the `16a864e` bug) | S |
| DT-2 | Med | The 14-probe sweep is manual-only — a re-pin can merge CI-green with broken browser flows | `desktop.yml:80-84` | process note: probes are MANDATORY in every re-pin phase of this plan (§12.3) | — |
| DT-3 | Med | Session at rest plaintext (`session.bin`) — DPAPI is an open M5 TODO | `internal/auth/auth.go:63` | out of scope here; recorded for the backlog | — |
| DT-4 | Low | Offline creates not idempotent after ambiguous landing (M0 §7c pending) | `internal/api/types.go:239-241` | out of scope; backlog | — |
| DT-5 | Info | `sync-island.mjs` KNOWN-REMAINS block is stale (items 1/3/4 closed) + v104/v105 comment drift | `sync-island.mjs:288-310,254` | prune on the next re-pin | S |

**Desktop parity cost summary (from the audit):** pure island JS/CSS change = scripted re-pin
(`sync-island.mjs` PIN_REF bump → re-record drifted anchors → `desktop.yml` WEB_REF+WEB_VERSION →
14 probes → commit dist+checksums → push, autorelease cuts the patch). Additive payload key = decode-
safe at runtime, Go mirror half optional. New API endpoint riding the `api()` choke point = zero
transport cost (bridge allow-lists any `/api/`), but new fetch sites must ride `HibanaBoard.api()`
(seam-count gates) and offline outbox entities need a `pathFor` case. Shape changes = the dangerous
class — forbidden by red line §0.3 anyway.

---

## §3 PHASE PLAN (priority × impact ordering; one session per phase)

| Phase | Session | Name | Fixes | User impact | Desktop cost |
|-------|---------|------|-------|-------------|--------------|
| 0 | S251 | Safety baseline + this spec | backups, restore drill-lite, data checks | none (safety) | none | **DONE** |
| 1 | S252 | Correctness & safety pack | BE-6, BE-7, BE-10(+5a), BE-9, BE-2, DT-1 | stops data-loss-class bugs | DT-1 one-liner (no re-pin) |
| 2 | S253 | Database health (migration 0067) | DB-1, DB-2(=BE-8), DB-3, DB-4, BE-1, BE-5b | round-trip diet on write paths | none (no island change) |
| 3 | S254 | Interaction performance | FE-2, FE-3, FE-8, FE-1, FE-10, FE-12, FE-14, FE-15, FE-19, FE-20 | the "feel" of board/sprint | re-pin + release |
| 4 | S255 | Payload & network diet | BE-3, BE-25, FE-4, FE-7, FE-16(doc) | load time on every board/sprint/project view | re-pin + release |
| 5 | S256 | CSS/asset diet | FE-5, FE-13 | LCP + precache headroom | heaviest re-pin (HTML link sets) |
| 6 | S257 | Backend modularization | devboard split + BE-11/13/14/15/16/17, FN-ALLOWLIST re-pins | none (maintainability; de-risks everything after) | none (paths unchanged) |
| 7 | S258 | UI/UX polish | FE-6, FE-9, FE-11(scoped), FE-17, FE-18 | a11y + feedback quality | re-pin + release |
| 8 | S259 | Close-out & full verification | cross-phase regression, restore drill, docs, final backups | confidence | verification only |

Rationale: correctness first (things that can close/lose data outrank everything), then DB health
(small, safe, unblocks nothing else but hardens everything), then the three user-felt performance
phases (interaction → payload → assets), the invisible-but-de-risking backend split, UX polish, and
a dedicated verification close-out. The modularization phase deliberately sits AFTER the perf phases
so it moves final, settled code.

---

## §4 PHASE 1 — Correctness & safety pack (S252)

**Goal:** kill the two P1 correctness bugs + the transactional gap + the cheap perf embarrassments.
**Zero schema change, zero payload change, zero island change** → desktop needs only DT-1.

**Steps (commit+push after each):**
1. **BE-6 + BE-12** — add `findOrCreateTag(cfg, userId, name)` to `devboard-helpers.ts` using the
   in-repo H1 recipe (`INSERT … ON CONFLICT(user_id, name) DO UPDATE SET usage_count = tags.usage_count
   RETURNING id`, `projects/index.ts:434-450`) with NOCASE find-first (`ORDER BY created_at LIMIT 1`).
   Use it at `devboard.ts:631-637` (task tags add) and `devboard.ts:1305-1311` (project tags add);
   refactor `setTaskTags`' create arm (`devboard-helpers.ts:385-394`) onto it. Response shapes
   unchanged (`{ok:true,id}`, 201).
2. **BE-7** — in `POST /api/projects/:projectId/sprints` (`devboard.ts:710-798`): hoist
   `assertSprintWindowOk` ABOVE the close-active-sprint UPDATE (the new sprint's start is known
   upfront). Success path byte-identical.
3. **BE-10 + BE-5a** — `POST …/devtasks/archive-done` (`devboard.ts:477-519`): wrap snapshot+delete
   in `cfg.db.transaction` mirroring `/finish` (`devboard.ts:1023-1034`); replace the `tasks.find`
   fold with a `Map`/`Set` (`devboard.ts:494`); filter task-tag links SQL-side by the done-task ids
   instead of over-fetching `taskTagsForProject`.
4. **BE-9** — `assertSprintWindowOk` accepts optional pre-fetched siblings; `PATCH /api/sprints/:id`
   passes them (`devboard.ts:934` → `devboard-helpers.ts:129-132`).
5. **BE-2** — replace the bump loop (`devboard.ts:726-728`) with one sibling-names query + JS bump.
6. **Tests:** add focused regressions — (a) concurrent-ish tag create resolves to one id (ON CONFLICT
   path); (b) a failing window on sprint create leaves the active sprint OPEN; (c) archive-done is
   atomic (failure mid-flow leaves no partial archive rows, if feasible in the test harness).
7. **Full ladder** (§12.2) → deploy dev → live probe → deploy prod → live probe (test account:
   exercise tag add ×2 same name, sprint create with bad window while one is active, archive-done).
8. **Desktop DT-1:** `.github/workflows/desktop.yml:25` `WEB_VERSION: "0.4.1.43"` → `"0.4.1.44"`
   (+comment: the WEB_REF/WEB_VERSION twins move together). Commit to desktop main; autorelease cuts
   v0.1.41 — verify the release notes now carry the right web version.
9. §12.4 session close (worklog S252, Changelogs row, §14 table, next-session prompt).

**Definition of done:** all three P1/P2 correctness findings fixed with regression tests; ladder
green; live-verified on hibana.ir; desktop WEB_VERSION corrected + released; spec §14 updated.

---

## §5 PHASE 2 — Database health (S253) · CONTAINS MIGRATION 0067

**Goal:** the additive index/constraint belt + write-path batching + purge consistency.

**Step 0 — backup ritual (§12.1), NO exceptions** (fresh dumps + `bookmark:prod` + `bookmark:dev` +
automated-lane freshness check). Owner approval for 0067 = this spec's header quote + the audit it
approves; cite both in the migration header.

**Migration `0067_projects_audit_indexes.sql` (additive only, `IF NOT EXISTS`-guarded):**
```sql
-- DB-1: the only EQP-verified full scan (sprint delete re-points archives)
CREATE INDEX IF NOT EXISTS idx_project_archives_sprint ON project_archives(sprint_id);
-- DB-2 / BE-8: TOCTOU belts (data verified clean 2026-11-07: zero twins, zero multi-drafts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_one_draft ON sprints(project_id) WHERE is_draft = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sprints_project_name ON sprints(project_id, lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategies_project_name ON strategies(project_id, lower(trim(name)));
```
Belt-first: before creating, run the defensive normalization probes (0065 pattern, `devboard.ts`-side
SELECTs); if ANY twin/multi-draft is found in live data, park it (rename with a ` (2)` suffix / flip
extra drafts to non-draft) in the SAME migration with a written count — do not blind-create.

**Code steps (commit+push each):**
1. Apply 0067 to **dev D1 first** (`scripts/d1-migrate.mjs`, one at a time per Changelogs §5), verify
   schema 65→66 + row-count parity, then **prod D1** with the same ritual + `bookmark:prod` FIRST.
2. **Catch-and-map:** sprint/strategy create + rename paths catch the new unique violations and map
   to the EXISTING 409 codes (`sprint_name_taken` / `strategy_name_taken`) — never a raw 500.
3. **DB-3:** add `DELETE FROM project_archives WHERE project_id IN (…)` to the three purge sites
   (`projects/index.ts:749`, `admin.ts:689`, `settings.ts:316`) — CASCADE-consistent with every other
   child table; extend `purge-parity.test.ts` row-count assertions to include `project_archives`;
   clean the 1 existing orphan row (post-bookmark, with the count recorded in Changelogs §9).
   **This is the plan's only destructive-semantics change — flag it in the Changelogs row.**
4. **DB-4:** DEBT.md entry for the 0060 `folder_id` FK loss.
5. **BE-1:** batch `setTaskTags` (find via `IN`, one palette query, chunked link sync via
   `executeIn`) — response shape unchanged. **BE-5b:** archives GET `LIMIT 200` + additive
   `?offset=` (client treats absence as before).
6. Tests: unique-index violation → 409 mapping; purge-parity includes archives; setTaskTags batching
   equivalence (same final tag set + same response shape).
7. Full ladder → deploy dev → probe → deploy prod → probe (sprint/strategy create + rename + delete
   on the test account; verify `schema_version` 66 in the health probe).
8. Desktop: **zero changes** (web-D1 indexes don't touch the Go mirror; no island change). Note the
   no-op explicitly in the close-out.
9. §12.4 session close.

**Definition of done:** 0067 live on both D1s (bookmarks in §9), zero row loss (counts recorded),
TOCTOU belts + 409 mapping tested, archives purge-consistent, ladder green, live-verified.

---

## §6 PHASE 3 — Interaction performance (S254) · island round → desktop re-pin

**Goal:** make the board/sprint FEEL fast — kill the jank, the scroll-block, the boot waterfall, and
the full-reload reflex. **Markup-stable changes only** (e2e pins + desktop parity).

**Steps (commit+push each numbered group):**
1. **FE-2** — rAF-batch the dragover handlers + cache target rects until the dragged card changes
   lists: `board-page.js:1506-1525`, `project-page.js:5603-5630`, `sprint-page.js:2036-2086`.
2. **FE-3** — `touch-drag.js:42`: move `touch-action:none` into the 250 ms arm callback; verify
   `e2e/s197-touch-floor.spec.ts` + a manual mobile pass (board card scroll, sprint sidebar scroll).
3. **FE-8** — parallel boot on `board-page.js:1755` + `sprint-page.js:2241`: start `B().load()`
   immediately; `boot()` awaits data + `hibanaI18n.ready` together.
4. **FE-1** — (a) convert `injectDbCardMenus` (`board-page.js:1052-1105`) to event delegation on the
   board root (`closest('[data-db-copy-card]')` etc.) — zero per-card listeners; (b) per-column
   repaint for `patchTask`/`createTask`/`reorder` successes (merge into `B().state`, render only the
   affected column — the `renderColumn(status)` helper; full `reload()` stays for structural changes
   like project switch). Sprint page: same treatment for `patchTask` (the big one — every checkbox
   today refetches everything).
5. **FE-10** — chip/select focus restore after board re-render (mirror the search's `:1596-1601`).
6. **FE-12** — GET first-deadline 3 s → 8 s (keep signal wrapper + one retry).
7. **FE-14 + FE-15 + FE-19** — delete `TITLE_CLAMP`; adopt the `s !== k` i18n guard in
   `devboard.js:77`, `chip-render.js:30`, `due-control.js:52`; `ensureLib` injects on script `error`.
8. **FE-20** — extend `scripts/check-cache-bust.mjs` to scan injector literals in `public/js`
   (CI-hardening; catches the documented double-cache bug class).
9. **Cache-bust choreography:** bump `?v=` on every touched file across every referencing HTML +
   the injector literals + SW `VERSION` (v460 → v461) + SHELL re-fetch; `check-cache-bust` +
   `check-precache-size` green.
10. **e2e re-pins:** specs asserting the old listener/repaint mechanics get re-pinned to the new
    behavior (s206-kanban-edge, s230-kanban-redesign, board-filters, s209-kanban-parity, sprint
    family). FA/RTL + EN/LTR, light/dark, desktop/390 px per the ladder.
11. Full ladder → deploy dev → live probe (feel test: drag, quick-add, checkbox on a done task) →
    deploy prod → live probe.
12. **Desktop half (§12.3):** full re-pin (PIN_REF → the new web SHA; re-record drifted anchors;
    desktop.yml WEB_REF + WEB_VERSION together), all 14 probes green, push → autorelease → verify.
13. §12.4 session close.

**Definition of done:** no per-card listener rebinding; single-column repaint on task mutations;
drag is rAF-smooth; mobile scroll works from cards; boot parallel; ladder + e2e green; desktop
released on the new pin with 14/14 probes.

---

## §7 PHASE 4 — Payload & network diet (S255) · island round → desktop re-pin

**Goal:** stop shipping bytes nobody renders; make repeat loads 304.

**Steps (commit+push each):**
1. **BE-3** — new additive endpoint `GET /api/sprints/:id/doc` (full description row, owner-gated);
   board GET gains opt-in `?lean=1` that omits `sprints[].description`; **default payload unchanged**
   (desktop + s241 contract untouched). Sprint page: editor fetches the doc on open; board/sprint
   chrome rides `lean=1` via the `api()` choke point (new `HibanaBoard` method — devboard.js seam
   count 7→8, gate update).
2. **BE-25** — version-stamp weak ETag on the board GET: one cheap `MAX(updated_at)`-style probe
   across the project's dev_tasks/sprints/strategies/tags BEFORE the 7-query assembly; match → 304
   without assembly. Verify the web offline queue + desktop `RequestFresh` treat an *expected* 304
   correctly (audit note: client.go:224 errors only on UNEXPECTED 304).
3. **FE-4** — `/project.html` `pdRepaintColumns` repaints from the devboard payload (map
   `devTaskTags` → `tagsBy`, `shot_count` semantics) instead of the full 13-query detail refetch;
   `e2e/s209-kanban-parity.spec.ts` must stay green.
4. **FE-7** — timeline hidden-bar duplication: bars on demand (drag targets created when a sidebar
   drag starts) or `content-visibility` — visible behavior pinned by sprint specs stays identical.
5. **FE-16** — document `task_tags` as desktop-load-bearing in
   `docs/project-kanban/API-AND-SYNC-CONTRACT.md` (+ the new endpoints + `lean=1`).
6. Tests: lean payload shape (description absent ONLY under `lean=1`); doc endpoint ownership +
   404s; ETag 304 path (incl. after a mutation the stamp changes).
7. Cache-bust + ladder + deploy + live probes (measure: board GET bytes default vs lean on the test
   account's project; record before/after in the worklog).
8. **Desktop half:** re-pin + probes + release (runtime decode-safe; keep desktop on the DEFAULT
   payload this phase — adopting `lean=1` client-side is a later optional round, note it).
9. §12.4 session close.

**Definition of done:** lean board payload live + used by web islands; doc endpoint live; board GET
304s on unchanged data; project page repaint stops refetching the world; contract doc updated;
desktop re-pinned + released.

---

## §8 PHASE 5 — CSS/asset diet (S256) · heaviest desktop re-pin

**Goal:** cut ~950 KB/page of render-blocking, mostly-irrelevant CSS; buy precache headroom back
(2,341/2,360 KB → expect a large drop; the ratchet only goes DOWN after this).

**Steps (commit+push each):**
1. **FE-5** — per-page CSS bundles via the existing esbuild step (`scripts/build.mjs`): one
   concatenated, minified bundle per page in the EXACT current `<link>` order (cascade order is the
   risk — concatenation in order is the safe transform; `rtl.css` stays LAST — it's a desktop
   contract). HTML heads swap the 19–20 links for the one hashed `/dist` bundle; `check-cache-bust`
   + `check-precache-size` re-baselined DOWN with the written reason.
2. **FE-13 (partial)** — consolidate the byte-equal twins (`esc`, `faDig`, `G_MONTHS`, priority
   labels) into `chip-render.js` with the existing `window.HibanaChips ? … : fallback` gating; the
   e2e meta-parity pins must stay green.
3. Lighthouse before/after (`lighthouserc.json` + mobile config) — record LCP/FCP deltas in the
   worklog; `bundle-size` gate re-baselined with reason.
4. Full ladder + FA/RTL + dark + 390 px passes (CSS is where RTL/dark regressions hide).
5. Deploy dev → visual probe on every Projects-section page (board/sprint/projects/project, light+
   dark, EN+FA) → deploy prod → same probe.
6. **Desktop half:** the heaviest re-pin — the island manifest's CSS set + `HTML_STRIP_LINES` anchors
   change wholesale; re-record per `sync-island.mjs`'s loud failures; ALL 14 probes; push → release.
   Prune the stale KNOWN-REMAINS block + the v104/105 comment drift while inside the script (DT-5).
7. §12.4 session close.

**Definition of done:** per-page bundles live; measured CSS bytes/page + LCP improvement recorded;
precache + bundle budgets re-baselined DOWN; visual parity proven on both themes/languages; desktop
re-pinned + released.

---

## §9 PHASE 6 — Backend modularization (S257) · zero route-path changes

**Goal:** split the 1,337-line `devboard.ts` monolith; dissolve the FN-ALLOWLIST pins; dedupe the
domain helpers. **Behavior-neutral** — every existing behavioral test must pass UNTOUCHED.

**Target layout (all paths byte-identical, mounted at `/` via `app.route('/', x(cfg))`):**
```
src/routes/devboard/
  index.ts      (~30)  devboardRoutes(cfg): requireAuth + mounts the six sub-routers
  schemas.ts    (~160) everything from devboard.ts:33-185 (moves verbatim; = BE-17)
  board.ts      (~90)  GET /api/projects/:projectId/devboard
  tasks.ts      (~330) devtasks CRUD + reorder + archive-done + tags + deps
  sprints.ts    (~400) sprints CRUD + lifecycle (start/pause/resume/finish/reopen)
  strategies.ts (~75)  strategies CRUD
  archives.ts   (~105) archives GET/restore/delete (owns the shared snapshot builder)
  misc.ts       (~75)  categories + backlog + project tags + ping
```
`devboard-helpers.ts` stays the shared domain layer (3 importers) — or moves to
`src/routes/devboard/helpers.ts` with a re-export barrel at the old path.

**Atomic same-change obligations:**
1. `docs/autopilot/FN-ALLOWLIST.md` — re-key the four devboard pins to the new modules; extract
   BE-15's guards so the PATCH-sprint pin (104 ln) dissolves under 60.
2. `src/tests/acceptance-s247.test.ts:556-576` reads `src/routes/devboard.ts` directly — update the
   read targets (route strings + import-comment assertions).
3. Dedup during the move: BE-11 (`categoriesForProject` in `lib/categories.ts`), BE-13 (reorder
   schemas consolidate), BE-14 (`buildUpdate`), BE-15 (`assertNoActiveSibling`/`assertLatestSprint`),
   BE-16 misc (touchProject helper ×18, rate-limit body ×2, glance query ×2).
4. `scripts/check-import-boundaries.mjs` / `docs/autopilot/FILE-ALLOWLIST.md` — add the new paths.
5. `node --check`-style sanity on every moved file; `npm run verify` fully green; the fn-shape gate
   count for these files should DROP (record before/after pin counts).
6. Deploy dev → probe (kanban + sprint + strategies smoke on the test account) → deploy prod → probe.
7. Desktop: **zero changes** (bridge is path-based; ETags per-path unchanged). Note the no-op.
8. §12.4 session close. (BE-20 `detailHtml` carve-up = explicit backlog, not this phase.)

**Definition of done:** devboard.ts gone (split live), all 31 endpoint paths byte-identical, full
suite green with zero behavioral-test edits (except the two documented read-target updates), FN pins
reduced, helpers deduped.

---

## §10 PHASE 7 — UI/UX polish (S258) · island round → desktop re-pin

**Goal:** close the a11y and feedback gaps the audit found.

**Steps (commit+push each):**
1. **FE-6** — one shared focus-trap + focus-restore helper (Tab wrap on the overlay; store/restore
   `document.activeElement`): `devboard.js` `buildModal`, board task-view + enlarge sheet, sprint
   strategy modal, `app.js` `hibana.confirm` (replaces the `body.focus()` restore). Extend
   `e2e/s247-a11y.spec.ts` to assert containment, not just Tab-walks.
2. **FE-9** — strategy focus-filter explainer strip on the sprint page ("Filtered by {name} — tasks
   without sprints are hidden · Clear"), i18n EN+FA (`st.*` keys ride the parity gate).
3. **FE-11 (scoped)** — bulk `POST /api/projects/:id/devtasks/clear-done` (transactional, reuses
   archive-done's path) + board island uses it for "Clear done"; desktop outbox gains the
   `pathFor` case IF the island call can fire offline (verify against the seam gates; if it can't
   queue, document why). Full delete-undo stays backlog (needs server soft-delete design).
4. **FE-17** — sprint sidebar state preservation across re-renders (`data-open` + quick-add values).
5. **FE-18** — "Move to →" submenu in the card ⋯ menu (keyboard-reachable lane change; no DnD
   required); re-pin the menu-census specs.
6. Cache-bust + i18n parity + full ladder + FA/RTL + dark + 390 px + deploy both + live probes.
7. **Desktop half:** re-pin + 14 probes + release.
8. §12.4 session close.

**Definition of done:** focus trapped + restored across the overlay family; filter strip live EN+FA;
clear-done is one request; sidebar survives re-renders; keyboard lane-move works; desktop released.

---

## §11 PHASE 8 — Close-out & full verification (S259)

**Goal:** prove the whole chain end-to-end after seven phases of change.

1. **Backup ritual (§12.1) one final time** — fresh dumps of both D1s + bookmarks; verify the
   automated lane is still flowing.
2. **Restore drill:** `npm run drill` + `npm run drill:planb` — prove the restore chain actually
   restores (this is the red-line insurance policy; record the outcome).
3. **Full-system regression on the test account (live, hibana.ir):** login → projects list →
   project detail → kanban (create/move/tag/archive) → sprint page (strategy create → sprint with
   strategy → start → task done → finish → complete strategy → delete) → the Phase-3/4/5 behaviors
   (fast repaint, 304s, lean payload) → desktop app: update to latest, login, sync round, sprint
   page with strategies. Console 0 / page-errors 0 everywhere.
4. **Docs sweep:** Changelogs rows for every phase (§1 counts current: tests/parity/sw/migrations);
   `worklog.md` rotation if over ~4 sessions (`scripts/rotate/rotate.mjs --worklog`); DEBT.md
   current; API-AND-SYNC-CONTRACT.md current; this spec's §14 complete.
5. Healthcheck ping + Telegram notify per the existing process; final report to the owner in chat.
6. §12.4 session close — mark the plan COMPLETE in §14.

---

## §12 STANDING PROCEDURES

### 12.1 Backup ritual (BEFORE any migration / destructive-adjacent change)
```bash
# 1. Fresh full dumps (creds in env; NEVER commit these files — they contain sessions + hashes)
export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…
node scripts/d1-dump-tables.mjs --db pm-app-dev  --output /home/z/hibana-backups/<label>-dev-<date>.sql
node scripts/d1-dump-tables.mjs --db pm-app-prod --output /home/z/hibana-backups/<label>-prod-<date>.sql --prod-ok
# 2. Restore-verify the prod dump loads (PRAGMA foreign_keys=OFF — dump order ≠ FK order) + integrity_check + row counts
# 3. Time-travel bookmarks (writes Changelogs §9):
npm run bookmark:prod && npm run bookmark:dev
# 4. Automated lane freshness: list assadigit/hibana-safe contents/backups — latest snapshot < 7 h old
# 5. ONLY THEN migrate: node scripts/d1-migrate.mjs (dev first, verify, then prod — one at a time)
# 6. After: verify schema_version in the health probe + row-count parity (users/projects/sprints/dev_tasks/archives)
```
Rollback = D1 time-travel to the bookmark (in-place, destructive, 30-day window — Changelogs §4).

### 12.2 Verification ladder (per phase, before "done")
`npm run verify` (tsc strict → eslint 0 → vitest → prod build → portability → fn-shape → …) +
`check-cache-bust` + `check:i18n-parity` + `check:precache-size` + `check:bundle-size` + `node --check`
on touched JS + browser e2e on the local Node server (FA/RTL AND EN/LTR, light AND dark, desktop AND
390 px) → deploy dev → live probe → deploy prod → live probe (console 0 / page errors 0) → purge probe
users. Current counts live in Changelogs §1 — keep them current.

### 12.3 Desktop re-pin ritual (any phase that touches public/js, public/css, or HTML)
1. Bump `PIN_REF` + `PIN_PACKAGE_VERSION` (`scripts/sync-island.mjs:178-179`) to the new web SHA/version.
2. `node scripts/sync-island.mjs` — re-record EVERY anchor it fails loudly on (HTML_STRIP_LINES `?v=`
   tokens, insert anchors, SEAM_PATCHES find-strings, verify needles; seam counts: devboard.js 7→N
   `hibanaFetch`, board-page.js 4, 0 bare `fetch`).
3. `.github/workflows/desktop.yml`: `WEB_REF` AND `WEB_VERSION` move TOGETHER (DT-1 lesson).
4. Run ALL 14 probes (`node scripts/probe-*.mjs --src ../hibana-source`) — 14/14 green, no exceptions
   (DT-2: they are the only browser-level gate).
5. Commit regenerated `frontend/dist` + `island.checksums.json` + `web-ref.json`; push → autorelease
   cuts the patch (5 version files bump in lockstep) → verify release + auto-update path.

### 12.4 Session-close ritual (every phase)
1. worklog.md entry (session number, what shipped, honest record incl. any red-CI rounds).
2. Changelogs.md row (+ §1 counts, §9 bookmarks if migrated).
3. THIS file: §14 status row updated (commit SHA, desktop release, notes).
4. Commit+push both repos; zip per Agents.md if the folders exist.
5. Healthcheck ping (`https://hc-ping.com/<slug>/hibana`) + Telegram notify per the existing process.
6. Hand the owner the NEXT session prompt in chat (§13 template, filled for the next phase).

---

## §13 NEXT-SESSION PROMPT TEMPLATE

> **SESSION S25x — PHASE n: <name>** (Hibana audit remediation — spec:
> `docs/project-kanban/AUDIT-REMEDIATION-SPEC.md` in assadigit/hibana-source)
>
> You are a fresh agent continuing the owner-approved phased remediation of the Projects-section
> audit. FIRST act: read `Agents.md`, then the WHOLE spec file — especially §0 RED LINES and your
> phase's section (§<n>). Re-verify the spec's file:line anchors against current HEAD before editing.
> Repos: `/home/z/hibana-source` (web) + `/home/z/hibana-desktop` (desktop; clone if absent:
> https://github.com/assadigit/hibana-desktop). Credentials arrive with this message from the owner —
> never commit them. Execute Phase n EXACTLY: commit+push after every finding-level fix, run the
> verification ladder (§12.2), do the desktop half (§12.3) if the phase touches islands, close the
> session per §12.4, and end by handing me the next session prompt per §13. If a red line blocks
> you, STOP and report — do not improvise.
>
> (Owner pastes the credential block here.)

---

## §14 STATUS TRACKING (updated at every session close)

| Phase | Session | Status | Web commit | Desktop release | Notes |
|-------|---------|--------|-----------|-----------------|-------|
| 0 — safety baseline + spec | S251 | **DONE** 2026-11-07 | (this commit) | — | dumps both D1s + restore verified; automated lane fresh; data checks clean; 1 orphan archive found (→ Phase 2) |
| 1 — correctness & safety pack | S252 | **DONE** 2026-11-08 | da005ee5→aeb1e625 (released v0.4.1.45 @ 6984429c; live) | v0.1.41 (DT-1 only) | BE-6/7/10/9/2 fixed + 7 regression tests; 976/976; e2e 510/510 (one pre-existing overnight flake de-flaked, proven on 8118e608); live-probed dev+prod 17/17 each (test account on prod, seeded+purged probe user on dev); no schema/payload/island change |
| 2 — database health (0067) | S253 | **DONE** 2026-11-08 | 3572a9ca→40eb971e (released v0.4.1.46; live) | — zero changes (no-op by design) | 0067 live on BOTH D1s (schema 65→66, row-count parity, zero loss; bookmarks §9); belt-first probes clean (zero twins/multi-drafts); catch-and-map ×6 sites → existing 409s; DB-3 purge sweep ×3 sites + orphan cleanup (prod 1, dev 2 — the s252 probe's own residue); BE-1 batched setTaskTags (~30→~6-9 round trips); BE-5b LIMIT 200 + ?offset=; 990/990 vitest (one honest re-pin: the twin-seeding S240 pin now asserts the belt's refusal); e2e 510/510; live probes 24/24 dev+prod (schema_version 66 verified); prod error_log clean |
| 3 — interaction performance | S254 | **DONE** 2026-11-08 | ad663a0a→77456857 (released v0.4.1.47) | v0.1.45 (full re-pin) | FE-2/3/8/1/10/12/14/15/19/20 all landed (markup-stable, zero API/payload change); SW v460→v461 + the full cache-bust choreography; e2e re-pins (s206/s230/board-filters/s209/sprint family); ladder green (990/990 vitest, 510/510 e2e — one honestly-recorded env flake on the untouched todo-panel scrollbar test, CI-green on the commit; i18n 1707/1707; precache +12 KB headroom); live feel probe 40/40 dev+prod (drag/quick-add/done round-trip, zero refetch, zero page errors; dev probe user purged 0/0); prod error_log 0; FE-20's cross-check proved itself catching the v38/v14 literals; release-notes path bug fixed (the workflow grepped a nonexistent docs/project-kanban/Changelogs.md — every prior release silently rode the commit-range fallback) |
| 4 — payload & network diet | S255 | PENDING | | | BE-3/25 + FE-4/7/16; re-pin |
| 5 — CSS/asset diet | S256 | PENDING | | | FE-5/13; heaviest re-pin |
| 6 — backend modularization | S257 | PENDING | | | devboard split; desktop no-op |
| 7 — UI/UX polish | S258 | PENDING | | | FE-6/9/11/17/18; re-pin |
| 8 — close-out & verification | S259 | PENDING | | | restore drill + full regression + docs |

---

## §15 EXPLICITLY OUT OF SCOPE (do NOT do these — recorded with reasons)

- Composite `dev_tasks(project_id,status)` / `sprints(project_id,status)` indexes — current indexes
  already plan as SEARCH (rule 9 satisfied); saves a row-filter on ≤57 rows. Speculative.
- Any index for the `CASE priority` ORDER BYs / `started_at` sorts — temp-b-tree on tiny sets.
- Adding a CHECK to `sprints.status` — needs the full 0031-style rebuild of a service-mediated,
  test-pinned column. Not worth the rebuild risk.
- `user_id` on child tables, TEXT→INTEGER timestamps, dropping `task_categories` (restore scripts
  read it) or the orphaned `changelogs_fts` shadows (harmless; any drop is a 0048-style documented
  owner-approved round, never silent cleanup).
- Removing/renaming ANY existing payload key (incl. `task_tags` — desktop-load-bearing, FE-16).
- Full task-delete UNDO (needs server soft-delete design — backlog after this plan).
- Desktop DT-3 (DPAPI session encryption) + DT-4 (idempotent offline creates) — separate M5/M0
  tracks, recorded here so they stop being rediscovered.
- `detailHtml` carve-up (BE-20) — backlog; only inside a session that finishes its phase with budget
  left, never at the cost of the ladder.
