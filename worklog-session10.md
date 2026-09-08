# Hibana Session 10 Worklog — four owner-reported UI fixes

Session start 2026-09-14 (sandbox clock 2026-09-08), continuing the same sandbox
conversation right after the v0.3.5 release shipped. Owner reported four issues
against v0.3.5; all fixed, verified, deployed, released as v0.3.6.

---
Task ID: 0
Agent: principal (session lead)
Task: Fix the four owner reports: (1) quick-notebook view modes missing ("only shows
as list"), (2) cramped section white space on to-do-list + projects, (3) prog-track
should show only on hover, (4) projects status boxes too heavily color-coded
(owner proposal: color ~10% of each container).

Work Log:
- (1) ROOT CAUSE: the view-mode machinery (List/Sticky/Grid + size radios, pure-CSS
  sibling selectors) was fully intact in v0.3.4+ — what changed was the 2026-09-09
  dashboard variant collapsing the controls behind a ⚙ <details>
  (.note-controls-toggle): closed by default, so the widget read as list-only.
  DOM-verified on the local server (controls display:none, toggle closed, labels
  present). FIX = revert the collapse: quicknotes.ts always renders the visible
  segmented controls (dashboard included); the .note-controls-toggle CSS block
  removed from app.css. Kept: the 1-row dashboard composer + ?dashboard=1 echo
  (separate 2026-09-09 request, unrelated to discoverability). Browser-verified:
  controls render flex, no gear; Sticky → .note-list display:flex + overflow-x:auto;
  Grid → display:grid. Tests only pinned the `class="card notebook` prefix — no
  test changes needed.
- (2) Measured before: board desktop quadrant gap 12px, mat-outer 16px 22px 14px,
  subbar→quadrant 16px visual air; projects glance-grid gap 0.75rem, boxes
  1.5rem 0.6rem 1.2rem, strip→list margin 1rem. FIX: board gap 12→20px, mat-outer
  22px 22px 18px (subbar→quadrant now 22px, measured), mobile carousel gap 10→12px
  + outer 14px 10px 10px; projects glance-grid gap 1.25rem (0.9rem ≤560px), box
  padding 1.5rem 0.75rem 1.3rem, .pglance margin-block-end 1→1.25rem. After:
  gap 20px / 22px measured in the browser.
- (3) .dash-todo-task .prog-track (the 3-dot state switch + label) is now
  hover-only: at rest max-block-size:0 / visibility:hidden / opacity:0 (same reveal
  pattern the dashboard already uses for the note-preview + ⋯ menu); revealed by
  row :hover, row :focus-within (keyboard + touch taps — focusing the checkbox
  counts), and while a dot itself holds focus. State at rest is still carried by
  the row tint + 3px start crescent (st-* rules). Verified: real-mouse hover
  (agent-browser hover; synthetic mouseover does NOT trigger CSS :hover — lesson
  re-learned) → visibility:visible, 22px tall, label «شروع نشده»; dot click still
  PATCHes (task + track classes → st-inprog, label → «در حال انجام»), then reset
  the probe task back to untouched.
- (4) Projects status boxes (pglance): the per-status color previously painted the
  ICON (3.8rem in grid view) AND the big COUNT (--pg-ink = badge-*-fg). Per the
  owner's "color only ~10%" proposal: count → var(--text) (neutral), label stays
  muted, icon keeps the per-status color (the single small accent ≈ 10% of the
  box). Dead --pg-ink declarations removed (base + 6 status rules). Verified
  computed: all six counts rgb(38,33,24); icons still per-status; boxes white.
  Hover/active tints unchanged (functional selection state).
- Cache discipline: app.css v204→v205 (22 pages, sed-verified), SW hibana-v230→v231
  (+ header history note; sadhana.html's unversioned content change rides the
  full-tree bump). No app.js/i18n.js changes (all CSS + one server route).
  Dev-loop note: one dead-var cleanup landed after the v205 bump — v205 was never
  deployed before that edit, so the shipped v205 = final content (no re-bump
  needed; the worklog-session9 lesson only bites when a DEPLOYED version is
  edited in place).
- Gates: vitest 235/235 · tsc --noEmit clean · check-cache-bust PASS (app.css) ·
  fresh-load console clean (one 503 seen during the deliberate server restart
  window — the F8 offline handler territory, not a code issue) · 390px + 1280px:
  zero horizontal scroll on board/projects/dashboard.
- Deploy: npm run deploy:prod → Version ID 34df10aa-0ed1-4206-b05b-62bb0b99c2cc;
  no D1 migration (no schema changes). Live-probed: /api/health ok/schema 44,
  sw.js = hibana-v231, wired /dist/app.1d89a62a.css carries every change
  (.pglance-count color:var(--text), the prog-track hover-reveal rules, zero
  note-controls-toggle, zero --pg-ink) — signatures grepped from the MINIFIED
  live CSS (comments are stripped in dist — grep code, not comments).
- Evidence: audit-results/shots/session10-{board-fa-desktop,projects-fa,
  dash-notebook-fa}.png.

Stage Summary:
- All four reports fixed and browser-verified; v0.3.6 deployed to prod and
  live-verified; released as hibana.0.3.6.zip. No schema changes; tests 235/235.
- Remainders queue unchanged (out-of-batch contrast marginals, notebook photo
  inversion, etc. — see NEW_SESSION_PROMPT).
