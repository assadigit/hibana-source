# Hibana — Session 11 Worklog (v0.3.7)

Task: three owner follow-ups on v0.3.6 + the root-cause fix discovered under them.

## Task 1 — Investigation (all three reports)

- Report 1 (notebook controls behind a toggle): read quicknotes.ts + app.css +
  app.js. Found the session-10 revert left the controls always visible; the
  localStorage persistence for view/size ALREADY existed (app.js, 2026-08-26:
  applyNoteView/applyNoteSize + change handlers + afterSwap re-apply). The
  2026-09-09 v0.3.5 gear markup + CSS recovered from `git show v0.3.5:` in
  /tmp/hibana-src.
- Report 2 (sections cramped, "no distance"): the working tree ALREADY had
  `main#dash > section { margin-block-end: 2.9rem }` (2026-09-02 rule). Root
  cause found empirically in agent-browser on the local server:
  `document.getElementById('dash')` → null, computed section margin → 0px.
  dashboard.html line 61 carried `<main class="shell" id="main" … id="dash">`
  — duplicate attributes are dropped by the HTML parser (first wins), so
  EVERY #dash selector in the app was dead. Confirmed the live prod HTML has
  the same bug (curl /dashboard).
- Blast-radius audit of the dead selector: 2.9rem section spacing (never
  applied), 96rem dashboard shell width, aria-busy cleanup (screen readers
  stuck), page-width overrides for the dashboard, and — worst —
  refreshDashboard() (app.js, used by task complete/move/rename/FAB add)
  targeted '#dash': htmx fetched /api/dashboard 200 and swapped it NOWHERE.
  Demonstrated live: completing a task left the stale row in the DOM.
- Report 3 (full color bg on project states): the dashboard stage cards
  (.stat-kanban-card[data-status]) inherit the `.kanban-card[data-status]`
  pastel full-fill (2026-08-30 rules) — every card in a box tinted → the whole
  box reads "pale orange". Session 10 had only neutralized the count + icon.

## Task 2 — Implementation

- Fix 2 (root cause): dashboard.html main → `class="shell shell-dash"` with
  the single `id="main"` (skip-link anchor) + an explanatory comment; app.css
  `main#dash > section` → `main.shell-dash > section`, `main.shell#dash` →
  `main.shell-dash`, the two dead `main.shell#dash` entries dropped from the
  page-width lists (main.shell covers it); app.js — 4 selector fixes
  (querySelector, 2× htmx target, getElementById → main.shell-dash) + stale
  comments fixed in tour.js/app.js/dashboard.ts.
- Fix 1 (gear + persistence): quicknotes.ts controlsHtml → the ⚙
  `<details class="note-controls-toggle">` (always, not dashboard-only);
  app.css restores the v0.3.5 gear rules generalized to any notebook surface;
  app.js adds `hibana-note-controls-open` (capture-phase 'toggle' listener —
  toggle does not bubble — + applyNoteControlsOpen in both re-apply passes).
  View/size persistence: existing machinery, no change needed.
- Fix 3 (status labels): the pastel full-fill scoped to
  `.kanban-col .kanban-card[data-status=…]` (projects page board keeps the
  original design); dashboard cards get `.stat-kanban-card[data-status]::before`
  — a slim status-colored pill bar on the inline-start edge (badge-*-fg
  family, theme-aware) + padding-inline-start so it never touches content.
- Cache discipline: app.css ?v=205→207 (re-bumped once final after the label
  slim-down — the documented dev-loop stale-cache lesson), app.js ?v=161→162,
  SW hibana-v231→v232. tour.js rides its content-hashed dist URL (comment-only
  change → same minified hash).

## Task 3 — Verification (local :8787, agent-browser + VLM)

- Spacing: 46px measured between todo→projects and projects→notebook (desktop
  AND 390px); VLM on the full-page screenshot: "clear generous white space
  between the major sections", no defects.
- aria-busy clears after load (was stuck "true" before).
- Task completion: checkbox click → 1.3s later the row disappears in-place
  (5→4 tasks) — the refresh now actually swaps. aria-busy stays clear.
- Gear: hidden by default (0×0 controls), opens (197×53 panel), open state
  persists ('1'); view sticky → reload → still sticky (radio re-checked,
  .note-list display:flex); htmx swap path (note added) re-applies view AND
  keeps the panel open. Test note deleted; prefs reset to list/closed.
- Labels: computed per-status bars (doing teal #3F7E78, unreviewed slate…),
  cards neutral white / dark-neutral; VLM light + dark: "SUBTLE label-like",
  ~3–5% of card area, no clipped corners/touching text; projects.html
  ?view=kanban still gets full pastel tints (scoped rules verified).
- Mobile 390px: no horizontal scroll, gear 26×26, spacing intact.
- Console: clean on /app (the 3 stale page errors were from the earlier
  server-restart window on project.html, unrelated).
- Gates: tsc clean · vitest 235/235 · check-cache-bust PASS (app.js, tour.js,
  app.css).

## Task 4 — Release v0.3.7

- Version bump: package.json 0.3.7, CHANGELOG entry, NEW_SESSION_PROMPT
  rewritten as the session-12 starter.
- Deploy: npm run deploy:prod (owner credentials) — Version ID
  e9e1d880-28e9-4834-8028-02894e521a0b, 29 assets uploaded, canonical HTML
  restored.
- Live probes: /api/health ok/prod/schema 44 · sw.js = hibana-v232 ·
  /dashboard main tag = `<main class="shell shell-dash" id="main" …>` (single
  id) · /dist/app.cbc3bd7b.css + /dist/app.c0d168ca.js contain every new
  signature (shell-dash>section, note-controls-toggle[open],
  stat-kanban-card[data-status]:before, kanban-col scoping — minifier strips
  spaces and the :: colon) · zero `target: '#dash'` left in the live app.js.
- Git: rsync'd the tree into /tmp/hibana-src (same exclusion list), 31 files
  changed, commit 48732d8, tag v0.3.7, pushed main + tag, verified via GitHub
  API (compare ahead_by 1, tag listed), token scrubbed from the remote.
- Zip: hibana.0.3.7.zip (374 files, 3.6 MB, sha256
  60fec8e2a17fe4fc2c80ce38128f7ae00c6450ca0c3b5a4dd6e6795672185ec7) —
  public/sw.js inside = v232, package.json = 0.3.7, dist files byte-identical
  to live (md5 pairs match), 0 forbidden paths (the two .example templates are
  intentional repo files), 0 token-shaped strings. Delivered to download/ +
  upload/.

## Lessons

- Duplicate attributes on one element are silently dropped (first wins) —
  a second `id=` is not a second id. Any "rule never seems to apply" report
  deserves a computed-style probe, not just a grep of the stylesheet.
- The dev-loop stale-cache lesson repeated: after a ?v= bump, any further
  edits to that file need a fresh bump (or cache-busted fetch) before the
  local browser reflects them — re-bumped 206→207 once final.
