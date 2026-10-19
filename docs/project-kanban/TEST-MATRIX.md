# Hibana Project/Kanban — Test Matrix

> Maps core project/board behaviors to the automated + manual checks that verify them,
> with gaps stated honestly. Current suite at **S209 / v0.4.1.35** (the kanban 1:1 parity
> round — uncommitted working tree; sw `hibana-v444`): **646 unit tests** (vitest,
> `src/tests/` — S208's 643 + the 3 new `kanban-parity.test.ts` tests; full-suite run
> verified 646/646) + **456 e2e tests** (Playwright, `e2e/`, run as 2 CI shards or 4
> local quarter-shards — S208's 449 + the 7 new `s209-kanban-parity.spec.ts` tests,
> counted in the spec). Gates at this tree: **i18n parity 1584/1584** · **escape-lint
> 220** (51 files). Run commands: `bun run test`, `bun x eslint . --max-warnings 0`,
> `bun run typecheck`, `bun x playwright test`, `node scripts/check-escape-lint.mjs`,
> `node scripts/check-cache-bust.mjs`, `node scripts/check-i18n-parity.mjs`.
> Companion: the pack index `README.md`; the port's acceptance criteria live in
> `UI-UX-REPLICATION-SPEC.md` §8.

## 1. The kanban rounds' new coverage (S205 entry + S209 parity)

**S205 — the /kanban entry round:**

| Behavior | Check | Where |
|---|---|---|
| `/kanban` serves board.html auth-gated | 7 unit tests: authed serve, unauth 302 + `?next=` (fresh + expired session), 401 JSON for non-doc callers, `/kanban.html` 301, assets-middleware fallthrough, no-store stamp, deep-link passthrough | `src/tests/kanban-route.test.ts` |
| Login round-trip preserves the entry URL | e2e: unauth goto → login → returns to /kanban | `e2e/s205-kanban-entry.spec.ts` #1 |
| Direct board + deep links + aria + doc title | e2e #2 | s205 spec |
| Last-used default + URL canonicalization | e2e #3 | s205 spec |
| Most-recent fallback (no last-used) | e2e #4 | s205 spec |
| No-projects empty state + CTA | e2e #5 | s205 spec |
| Switcher: open/search/keyboard/in-place switch/URL/back/refresh | e2e #6 (window-marker proves no navigation; pushState + popstate round-trip) | s205 spec |
| `/board.html` bare redirect + `/kanban.html` 301 | e2e #7 | s205 spec |
| Deleted project → gone state (no data leak) | e2e #8 | s205 spec |
| FA/RTL switcher (FA dictionary, rtl dir) | e2e #9 | s205 spec |
| Rail: 8 destinations, Kanban below Projects, compact rhythm keeps account chip on-screen at 720p + 44px floor | e2e | `e2e/rail-panel.spec.ts` (updated) |
| Rail icons-collapse on /kanban | pinned since S206: the edge rail on /kanban + the classic icons-rail on /board.html | `e2e/s206-kanban-edge.spec.ts` |
| Performance (cold load, switch latency, payload) | `qa/s205-kanban-perf.mjs` — reproducible local harness (5-run medians) | run on demand, not CI |

**S209 — the 1:1 parity round (the seven e2e tests, `e2e/s209-kanban-parity.spec.ts`):**

| Behavior pinned | Check | Where |
|---|---|---|
| `/board.html?project=` ≡ `/kanban` — same contracts; ONLY the Back link + rail mode differ (the documented entry-contextual exceptions) | e2e #1 | `:115` |
| The shared task editor carries the FULL formatting toolbar (the original editor's 10-op markdown-lite vocabulary, written raw into the single textarea) | e2e #2 | `:169` |
| The FULLSCREEN WRITING mode — Esc exits focus mode FIRST, never the modal | e2e #3 | `:212` |
| The EMBEDDED board (project.html) wears the mother container — `.db-frame`, hairline header row, NO viewport floor + the LABEL MANAGER | e2e #4 | `:252` |
| The ◆ SPRINT BADGE renders on BOTH surfaces' cards; the PIN BADGE survives the embedded board's +N expand repaint | e2e #5 | `:297` |
| ARCHIVE-DONE on the embedded board refreshes IN PLACE — no `location.reload` | e2e #6 | `:348` |
| sprint.html's Board link targets the CANONICAL `/kanban` entry | e2e #7 | `:371` |

**S209 unit tests (`src/tests/kanban-parity.test.ts` ×3):** the `#pd-board` server
fragment wears `.pd-board.db-frame` + the `.db-toolbar` header row + the Labels button
(`:56`); a sprinted task carries the ◆ sprint badge + `data-pd-sprint` — the /kanban
card contract (`:88`); the pin badge keeps rendering on the embedded cards (the server
path — `pinsByTask`) (`:115`).

## 2. Pre-existing board coverage (the regression net)

| Area | Specs / tests |
|---|---|
| Kanban entry ergonomics + the S206 edge rail (off-canvas until the pointer nears the start edge; keyboard reveal; /board.html's Back link + icons-rail twin; no edge zone below the desktop breakpoint) | `e2e/s206-kanban-edge.spec.ts` (5) |
| Board frame geometry (S207): the mother container, true full width under the 'standard' page-width, the height floor, the /board.html twin, mobile inset | `e2e/s207-kanban-frame.spec.ts` (5) — note S209 SCOPED the 100dvh floor to `main.board-shell` (`devboard.css:35-41`) so the embedded board doesn't balloon; the s207 tests still pin the floor on /kanban + /board.html (the page-owning surfaces) |
| Editor uploads/pins/tags (S208): the Upload File button in both modal modes, staged→save→pin, cancel-deletes, pinned grid + lightbox-Esc-precedence, tags-on-create, the badge dialog + unpin | `e2e/s208-kanban-shots.spec.ts` (6) + `src/tests/devboard-shots.test.ts` (shot_count explicit-0/counts/unpin-drops) |
| Sprint S206 fixes: UTC-midnight parse, the real 0-items count, draft-reuse on 409, sidebar→timeline DnD, the client never touches the HTTP cache, lane z-order | `e2e/s206-sprint-fixes.spec.ts` (7) |
| Board filter bar (priority × label × search), priority cycling, exports | `e2e/board-filters.spec.ts` |
| Card title clamp/read-more/code blocks/alignment | `e2e/s156-card-overflow.spec.ts`, `e2e/s176-codeblock.spec.ts` |
| Column fold + deep-link unfold + drop-on-folded | `e2e/s175-board-fold.spec.ts` |
| Priority banner + detail slide-over | `e2e/s144-prio-banner.spec.ts`, `e2e/s149-priority-detail.spec.ts` |
| Categories (S152) + label manager | `e2e/s152-categories.spec.ts`, `e2e/label-manager.spec.ts` |
| Touch drag floors | `e2e/s197-touch-floor.spec.ts` |
| Project detail board + project page flows | `e2e/project-progress.spec.ts`, `e2e/projects-home.spec.ts`, `e2e/s137-projects-redesign.spec.ts` |
| Sprints (timeline, UX, doc editor) | `e2e/sprint-timeline.spec.ts`, `e2e/sprint-ux.spec.ts`, `e2e/sprint-doc.spec.ts` |
| Backlog, overview tasks, rail trees, palette | `e2e/s106-backlog-slice.spec.ts`, `e2e/s140-ov-tasks.spec.ts`, `e2e/s148-rail-projects.spec.ts`, `e2e/s185-project-palette.spec.ts` |
| API contracts (devtasks, sprints, tags, categories, CSRF, auth, archive search, scoping) | `src/tests/board.test.ts`, `devtask-*.test.ts`, `csrf.test.ts`, `auth.test.ts`, `categories-scoping.test.ts`, `isolation.test.ts`, … |
| Visual baselines (login/404/dashboard/projects) | `e2e/screenshots.spec.ts` (maxDiffPixelRatio 0.01) |
| a11y audit + contrast | `e2e/fixtures/audit-fn.js` + `contrast-fn.js` wired through viewport/audit specs |
| Extensionless page identity (both URL forms) | `e2e/s158-extensionless-pages.spec.ts` |

## 3. Route / auth / deployment verification

| Check | Method |
|---|---|
| Page routes + login redirects | unit (`assets.test.ts`, `kanban-route.test.ts`) + e2e login bounces |
| Live health after deploy | CD workflow probes `https://hibana.ir/api/health` (+ dev) automatically |
| Live release verifier | `qa/sNNN-live-verify.mjs` per session (S205: probe `/kanban` on prod; latest in-tree: `qa/s208-live-verify.mjs`; the S209 verifier lands with the round's release) |
| Cache-bust / dist wiring / i18n parity / escape lint / bundle + precache sizes | CI gates (`ci.yml`) — all run locally too |

## 4. Manual checks required for this round (not automatable here)

1. **The S209 parity round, live on both hosts** — `hibana.ir` and
   `projects.hibana.ir` (one Worker serves both, including `/kanban`): /kanban and the
   embedded `/project.html` board read 1:1 (the `.db-frame` outline + Labels dialog,
   the ◆ sprint + pin badges — the pin badge surviving the "+N more" expand,
   archive-done refreshing in place); sprint.html's Board link lands on `/kanban`; the
   10-op toolbar + fullscreen writing behave identically in both editors — after the
   S209 release deploys (the round is in the working tree, not yet released).
2. The mobile bottom-tab More sheet's Kanban row (visual + navigation).
3. Real-touch long-press drag on a phone (the S151 path — emulated only in e2e).
4. FA/RTL on a real RTL locale OS (Jalali digits in the switcher counts).

## 5. Gaps (honest)

- **No e2e for the mobile More-sheet Kanban row** (manual only) — `mobile-nav.js` sheet
  links are rendered from `SHEET_LINKS` (`mobile-nav.js:29`, Kanban row `:33`); a spec
  would need the ≤1024px viewport + sheet open.
- **SW precache of /kanban offline** — the offline shell path is covered generically
  (dashboard fallback), not pinned for /kanban specifically.
- **`qa/s205-kanban-perf.mjs` is not in CI** (deliberate: perf numbers are
  hardware-dependent; the spec asked for reproducible local measurements instead).
- **The M0 desktop-contract additions** (`API-AND-SYNC-CONTRACT.md` §7a-7e — the
  setTaskTags `updated_at` bump, dev_tasks tombstones, idempotent creates, `?since=`)
  are **untestable until implemented** — they are desktop-phase prerequisites, not
  current features.
- **The S209 parity round's live verification on both hosts is pending the session's
  release** (see §4.1) — the code is in the working tree, not yet deployed.
- Closed since the S205 doc (removed): the rail-icons-on-/kanban coverage gap —
  `e2e/s206-kanban-edge.spec.ts` now pins the edge rail on /kanban and the classic
  icons-rail on /board.html directly; the custom-domain blocker —
  `projects.hibana.ir` is attached and serving `/kanban` (both hosts, one Worker).
