# Hibana Project/Kanban — Test Matrix

> Maps core project/board behaviors to the automated + manual checks that verify them,
> with gaps stated honestly. Current suite at **S205 / v0.4.1.28**: **642 unit tests**
> (vitest, `src/tests/`) + **426 e2e tests** (Playwright, `e2e/`, run as 2 CI shards or
> 4 local quarter-shards). Run commands: `bun run test`, `bun x eslint . --max-warnings 0`,
> `bun run typecheck`, `bun x playwright test`, `node scripts/check-escape-lint.mjs`,
`node scripts/check-cache-bust.mjs`, `node scripts/check-i18n-parity.mjs`.

## 1. The S205 Kanban entry round (new coverage)

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
| Rail icons-collapse on /kanban | covered by `RAIL_ICON_PAGES` logic (manual spot-check; see gaps §5) | — |
| Performance (cold load, switch latency, payload) | `qa/s205-kanban-perf.mjs` — reproducible local harness (5-run medians) | run on demand, not CI |

## 2. Pre-existing board coverage (the regression net)

| Area | Specs / tests |
|---|---|
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
| Live release verifier | `qa/sNNN-live-verify.mjs` per session (S205: probe `/kanban` on prod) |
| Cache-bust / dist wiring / i18n parity / escape lint / bundle + precache sizes | CI gates (`ci.yml`) — all run locally too |

## 4. Manual checks required for this round (not automatable here)

1. **`https://projects.hibana.ir/kanban` live**: TLS cert, first-visit login round-trip,
   board render, refresh, bookmark — after the custom domain attach + deploy.
2. The mobile bottom-tab More sheet's Kanban row (visual + navigation).
3. Real-touch long-press drag on a phone (the S151 path — emulated only in e2e).
4. FA/RTL on a real RTL locale OS (Jalali digits in the switcher counts).

## 5. Gaps (honest)

- **No e2e for the mobile More-sheet row** (manual only) — `mobile-nav` sheet links are
  rendered from `SHEET_LINKS`; a spec would need the ≤1024px viewport + sheet open.
- **The rail icons-only mode on /kanban** relies on `RAIL_ICON_PAGES` matching — covered
  by the s175/s158 family indirectly, not pinned for the /kanban path directly.
- **SW precache of /kanban offline** — the offline shell path is covered generically
  (dashboard fallback), not pinned for /kanban specifically.
- **`qa/s205-kanban-perf.mjs` is not in CI** (deliberate: perf numbers are
  hardware-dependent; the spec asked for reproducible local measurements instead).
- Deletion tombstones / delta sync — **untestable until the §6 API additions land** (they
  are desktop-phase prerequisites, not current features).
- Live production `/kanban` verification is blocked until the custom domain is attached
  (this session's remaining deployment step — see the release record).
