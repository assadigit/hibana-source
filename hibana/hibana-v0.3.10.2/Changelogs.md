# Hibana — Changelogs.md (consolidated changelog + worklogs)

> **Note for AI agents:** For exhaustive, granular commit-by-commit details, refer to the GitHub
> commit history (`assadigit/hibana-source`, tags `v0.x.y`). This file serves as a summarized
> context for AI efficiency.
> Consolidated in v0.3.9.2 from 33 deleted legacy docs (CHANGELOG.md, worklog-session7–17,
> RECOVERED.md, NEW_SESSION*.md, backlog/gap audits, ROADMAP.md, dr-bookmarks.md, docs/*,
> spec/vision/spark/instruction/tech-stack, DEPLOY.md, CLAUDE.md, rules.md); README.md was
> rewritten as a minimal pointer. Deleted files remain recoverable verbatim:
> `git show <sha>:<file>`.

## 1. Current state (v0.3.12.0 — Session 25: CSS architecture refactor — app.css split into 16 modular files)
- **Session 25 summary** — pure refactoring session (zero behavior change). Split the
  monolithic `public/css/app.css` (8,822 lines) into 16 modular CSS files by contiguous
  section. No schema changes, no new i18n keys, no JS/TS logic changes. 295/295 tests
  green throughout. The split is byte-identical concatenation — zero cascade risk.
- v0.3.12.0 = **Session 25 — app.css → 16 modular CSS files** (Option A: contiguous
  chunks). Minor version bump signals architecture change; `.0` patch signals zero
  behavior change.
  - **Why:** app.css had grown to 8,822 lines — unmaintainable. Single file contained
    EVERYTHING: reset, variables, layout, components, pages, themes, RTL, responsive.
    Every CSS edit required scrolling a 8.8K-line file; cache-bust on any change busted
    the entire 224KB bundle for all 23 pages.
  - **Strategy choice (Option A over Option B):** the file was organized
    chronologically (by session/feature), NOT by concern. Dark-theme rules (73
    selectors), RTL rules (20 selectors), and @media queries (93 blocks) were
    SCATTERED throughout — not in contiguous blocks. Option A (split at section
    boundaries, keep concerns inline in their feature chunk) was chosen because it
    guarantees zero cascade change structurally (concatenation == original). Option B
    (extract by concern into themes.css/rtl.css/responsive.css) is deferred to
    Phase 1.5 — requires specificity analysis to prove safety.
  - **The 16 files** (line ranges from original app.css, in source order):
    1. `variables.css` (1–260, 260 lines) — `:root` custom properties + `html[data-theme]`
       variable blocks + `@media (prefers-color-scheme)`.
    2. `base.css` (261–604, 344) — reset (`*{box-sizing}`), body/html/typography/links,
       auth page, forms & buttons (global element styles).
    3. `layout.css` (605–1108, 504) — app shell, status/chips, loading/empty, project
       lists, wireframe card, hurdles/lists, media, dashboard stats.
    4. `dashboard.css` (1109–1535, 427) — dashboard projects strip (carousel), at-a-glance
       strip, idea folders, dash-resume.
    5. `dashboard-todo.css` (1536–2175, 640) — dashboard to-do quadrants, collapse sections,
       smart empty states, FAB. (Split from dashboard.css at the .dash-resume/@media
       boundary — natural break before to-do section.)
    6. `components.css` (2176–2453, 278) — FAB, native dialog modal, toast, ping/status,
       spinner, theme toggle button.
    7. `canvas.css` (2454–3128, 675) — canvas/whiteboard UI, squig batch, notebook page,
       sticky kanban, drag&drop, reports chart, misc.
    8. `quicknotes.css` (3129–4010, 882) — dashboard quick notebook, quick-note↔project
       attach, FAB modal, sparks shelf, profile menu, auth split-screen, responsive topbar.
    9. `to-do-list.css` (4011–4824, 814) — Sadhana standalone board: collapsed row, progress
       dots, state selector, checkbox, expandable section, actions/notes panels, inline
       title editor, emoji badges, legacy hover, to-do polish. (Renamed from internal
       codename "sadhana" — owner request: no internal codenames in filenames.)
    10. `polish-ui.css` (4825–5472, 648) — shadcn-style polish, command palette, skeleton
        shimmer, toast upgrade, dashboard today strip, project detail tabs, Sadhana
        focus-mode, settings tabs, reports heatmap.
    11. `calendar.css` (5473–5884, 412) — calendar view, day creators, right-click day menu,
        activity timeline, on-this-day, print stylesheet.
    12. `notifications.css` (5885–6240, 356) — notification center, saved filters, search
        upgrades, avatar skeleton, command palette tag swatch.
    13. `polish-batch.css` (6241–6835, 595) — R4.3–R9.3 polish batch: styling polish,
        onboarding tour, counter animation, voice quick-add, sticky table header, reports
        dark-mode, settings help, go-to hint, tooltip wiring, done chip, reports bar-chart,
        weekend/holiday, calendar legend, Shamsi today, Task 24 month-heading.
    14. `project-header.css` (6836–7488, 653) — project logo (0047), redesigned project
        header, inline board preview, Session 23 code blocks, composer formatting toolbar,
        upcoming plan tab.
    15. `devboard.css` (7489–8081, 593) — board page (board.html), task editor modal, sprint
        page (sprint.html), sprint timeline circles.
    16. `misc.css` (8082–8822, 741) — 404 stage + embers, misc items (Latin runs in notes,
        DONE state, pglance boxes, view dropdown, grey labels, progress track, sprint
        lifecycle, emoji picker, quick notes clamp, page width).
  - **Build pipeline:** `CSS_ENTRY_POINTS` in `scripts/build.mjs` expanded from
    `['app.css', 'task-controls.css']` (2) to 17 entries. Each file → esbuild → own
    content-hashed `/dist/FILE.<hash>.css` → own manifest entry. Independent cache
    invalidation per file (a tweak to `components.css` no longer busts `variables.css`).
  - **HTML wiring:** all 23 HTML pages updated — single `<link href="/css/app.css?v=267">`
    replaced with 16 `<link href="/css/FILE.css?v=1">` tags in source order. Source order
    is load-bearing: the 16 files MUST load in the order listed above to reproduce
    app.css's original cascade (documented in build.mjs comment).
  - **Verification (3 levels of zero-behavior-change proof):**
    1. Structural — `cat variables.css base.css … misc.css | diff -q app.css` →
       BYTE-IDENTICAL (concatenation == original).
    2. Rendering — light mode screenshots (EN/LTR + FA/RTL) MD5-identical to baseline.
    3. Visual — VLM (vision model) confirmed dark mode screenshots: "IDENTICAL — zero
       visual difference."
  - **Cache-bust:** SW `hibana-v292`→`v293` (manifest grew 29→44 entries; existing PWA
    clients re-fetch manifest + precache new /dist/ files). All 16 new CSS files ship at
    `?v=1` (fresh version namespace — independent from the old app.css ?v=267 lineage).
  - **Pre-existing esbuild warnings:** 2 CSS-syntax warnings on a one-line `--st-none`
    custom property declaration (was `app.css:1695`, now correctly located in
    `dashboard-todo.css:160`). Pre-existing, not introduced by this refactor.
  - **Assets:** app.css ?v=267 (deleted) → 16 files at ?v=1 each, SW v292→v293, manifest
    29→44 entries, package.json 0.3.11.14→0.3.12.0.
  - **Follow-up (Phase 1.5):** Option B — extract dark-theme → `themes.css`, RTL →
    `rtl.css`, @media → `responsive.css` for true by-concern modularity. Requires
    specificity analysis to prove cascade safety before moving any rules.
- v0.3.11.14 = **Session 24h — project card redesign** (app.css + projects.ts):
  - Removed the hatched diagonal corner decoration (`.pc-corner` element) — looked like an
    unfinished placeholder, added visual clutter.
  - Left-aligned title + description (was centered) — conventional dashboard reading flow,
    auto-mirrors for RTL via logical `start` properties.
  - Title: 1.3rem→1.15rem, explicit `font-weight: 600` — clearer focal point.
  - Hover: flat bg swap → `translateY(-2px)` + soft warm shadow + stronger border (0.15s
    transition) — cards feel alive, not flat/static.
  - Gap: 0.6rem→0.5rem — tighter, more consistent vertical rhythm.
  - Assets: app.css ?v=266→267, SW v291→v292.
- v0.3.11.13 = **Session 24g — stage badge after title** (projects.ts + app.css):
  - Swapped header order: was `[logo][badge][title]`, now `[logo][title][badge]`.
  - `#pd-title` flex:1→flex:0 1 auto so the badge sits right next to the title, not pushed
    to the far end.
  - Assets: app.css ?v=265→266, SW v290→v291.
- v0.3.11.12 = **Session 24f — compact project header** (projects.ts + app.css):
  - Merged the old 2-row layout (logo+actions row AND badge+title row) into ONE main row.
  - Description: rows=2→1, tighter padding, smaller min-height.
  - Tags + meta merged into one spread row (tags left, meta+progress right).
  - Logo: min 64px→40px, max 128px→56px, radius 16px→12px.
  - Grid gap: 0.7rem→0.4rem. Progress boxes now appear ~210px higher on the page.
  - Assets: app.css ?v=264→265, SW v289→v290.
- v0.3.11.11 = **Session 24e — magic-wand dialog-mount + pastel purple** (magic-wand.js + magic-wand.css):
  - Root cause: wand was `position:fixed; z-index:60` on `document.body`. When a `<dialog>`
    modal opened (`showModal()`), the dialog rendered in the browser's top layer — above ALL
    z-indexes — trapping the wand under the modal backdrop → invisible.
  - Fix: `showWand(el)` now moves wand + backdrop + popover into the nearest open `<dialog>`
    (inherits top-layer positioning). Consistent appearance on page + inside modals.
  - Theme: `--mw-accent` brown `#6b4f3a` → pastel purple `#8B7AB8` (light) / `#C4B5E0`
    (dark). Popover bg → `#F5F0FA` (light) / `#2A2440` (dark).
  - Assets: magic-wand.css ?v=2→3, magic-wand.js ?v=9→10, SW v288→v289.
- v0.3.11.10 = **Session 24d — delete button class fix** (project.html):
  - `#pde-delete` was `class="ghost danger"` → CSS rule `.ghost.danger:not(.btn):not(.small)`
    forces 1.75rem (28px) square = looked like a pink circle.
  - Changed to `class="btn danger"` → proper padded text button with danger palette.
  - Assets: SW v287→v288.
- v0.3.11.9 = **Session 24c2 — line-by-line digit conversion** (canvas.js + whiteboard.js):
  - v0.3.11.8's script-detection checked the entire text element — mixed-script text
    (Farsi line + English line) converted ALL digits to Persian.
  - Fix: process LINE BY LINE. Each line independently checks for Farsi letters.
    `سلام 123\nHello 123` → `سلام ۱۲۳\nHello 123`.
  - Assets: canvas.js ?v=20→21, whiteboard.js ?v=14→15, SW v286→v287.
- v0.3.11.8 = **Session 24c — digit conversion restored with script-detection** (canvas.js + whiteboard.js):
  - v0.3.11.7 overcorrected (removed auto-conversion entirely → everything Latin).
  - Fix: digits match the SCRIPT of the text. Farsi letters → Persian digits; Latin-only →
    Latin digits. Same first-strong-character heuristic editors use for RTL/LTR.
  - Assets: canvas.js ?v=19→20, whiteboard.js ?v=13→14, SW v285→v286.
- v0.3.11.7 = **Session 24b hotfix release** — 4 fixes from Ali's live feedback on v0.3.11.6
  (project.html inline JS + app.css + projects.ts + canvas.js + whiteboard.js; no schema
  changes, no new i18n keys):
  - **Copy-all still truncated at "read more" (root cause, revised)**: the v0.3.11.6 fix
    had a DOM fast-path (read textContent when column expanded) + a DOM fallback (on fetch
    failure). textContent SHOULD include the hidden .pd-title-rest span, but Ali still saw
    truncation at the 150-char "read more" boundary. Now `pdColItems` ALWAYS fetches from
    `/api/projects/:id` and uses `t.title` (the FULL untruncated title from the database) —
    no DOM paths at all, bulletproof. If the fetch fails, returns empty (no silent DOM
    fallback that could truncate).
  - **Delete button "looks like a circle" (user report)**: the #pde-delete button had an
    SVG trash icon + text, but the icon was taking the button's space and the text was
    pushed out of view — rendering as an icon-only circle. Removed the SVG; the button is
    now text-only ("Delete" / "حذف"), matching Cancel and Save (which are also text-only).
  - **Logo radius too large + renders row-by-row (user report)**: 64px border-radius on a
    64px-square logo = 50% = perfect circle (not "soft rounded" as intended). Revised to
    16px — soft, modern, rounded corners that never circularize any logo size (64px or
    128px). Also fixed the performance issue ("renders row by row"): the logo endpoint had
    `Cache-Control: private, no-cache` → the browser re-fetched the logo from the GitHub
    assets repo (via the Worker) on EVERY page load. Changed to
    `public, max-age=3600, stale-while-revalidate=604800` (1h fresh, 1 week stale) — logos
    rarely change, and the browser now caches them. Added `loading="lazy"` +
    `decoding="async"` to the `<img>` tag for non-blocking decode.
  - **Canvas/whiteboard always Persian numerals (root cause)**: canvas.js:2363 +
    whiteboard.js:982 had a `text:changed` handler that auto-converted ALL Latin digits to
    Persian when the UI was FA — regardless of the user's active keyboard layout. So if
    Ali alt-shifted to English and typed numbers, they were force-converted to Persian.
    Ali's desired behavior: "ENGLISH → LATIN NUMERALS, FARSI → FARSI NUMERALS — if user
    alt-shift and changed language numerals will have to change as well." Fix: removed the
    auto-conversion entirely. Now the numerals match the KEYBOARD: English keyboard →
    Latin (0-9), Farsi keyboard → whatever the layout produces. The UI language no longer
    overrides the user's active keyboard layout.
  - Verified locally: typecheck green, 295/295 tests, node --check on sw.js + canvas.js +
    whiteboard.js OK, cache-bust PASS (3 files: app.css, canvas.js, whiteboard.js).
  - Assets: `app.css` ?v=263→264 (23 pages), `canvas.js` ?v=18→19, `whiteboard.js`
    ?v=12→13, SW `hibana-v284`→`v285`, `package.json` 0.3.11.6→0.3.11.7.
- v0.3.11.6 = **Session 24 hotfix release** — 4 fixes from Ali's live feedback (project.html
  inline JS + app.css; no schema changes, no new i18n keys):
  - **Progress-box copy truncates at 5 items (root cause)**: the server renders only
    MAX_VISIBLE=5 items per column into the DOM (Session 19). `pdColItems` read `.pd-task`
    from the DOM → copy/export only ever saw the first 5. Now `pdColItems` is async and
    fetches the full task list from `/api/projects/:id` (same endpoint the "more" button
    uses) when the column isn't fully expanded, so copy/export always see EVERY item.
    Fast path: if the column is expanded (`data-expanded="1"`), reads from the DOM directly.
  - **Magic wand only appears on first 5 items (root cause)**: `injectPdTaskMenus()` sets
    `data-magic` on `.pd-task-title` elements. It runs on page load + htmx swaps, but the
    "more" expand handler inserted new `.pd-task-wrap` elements WITHOUT calling
    `injectPdTaskMenus()` afterward → expanded items 6+ never got `data-magic` → wand
    never appeared. Fixed: `injectPdTaskMenus()` is now called after the expand loop
    inserts hidden items. Idempotent (`:not([data-menu-ok])` guard) — safe to re-run.
  - **Delete from inside the edit modal (user request)**: the inline task editor modal
    (`#pde-form`) had Title + toolbar + Status + Priority + Cancel + Save but NO delete.
    Delete only existed in the card's ⋯ hover menu. Now a red ghost Delete button sits on
    the left of the modal's button row (Cancel + Save stay on the right). Handler reuses
    the exact card-menu delete recipe: optimistic remove + decrement count + keep
    `data-pd-total` in sync + Undo toast → `DELETE /api/devtasks/:id`. No confirm dialog —
    matches the existing card-delete UX (Undo is the safety net).
  - **Project logo radius (user request: "need 64px radius… soft, modern, rounded")**:
    `.pd-logo` had `border-radius: 0` (hard square corners). Now `border-radius: 64px` —
    soft, modern, rounded edges on any uploaded logo (square logos become circular;
    rectangular logos get fully-rounded short edges). The placeholder keeps its
    `--radius-sm` (it's a dashed-border upload prompt, not a logo image).
  - Verified locally: typecheck green, 295/295 tests, `node --check sw.js` OK, cache-bust
    PASS. HTTP-based E2E on the local Node server (PORT=3001): login OK, htmx fragment
    renders 5 task cards + "+3 more" button (confirms MAX_VISIBLE root cause), API returns
    all 8 tasks (confirms copy-all fetches full list), inline JS serves all 3 fixes
    (`injectPdTaskMenus()` after expand, `#pde-delete` in modal, `pdColItems` async +
    fetch), `border-radius: 64px` on `.pd-logo`, SW `hibana-v284`, `app.css ?v=263` on 23
    HTML pages. Playwright browser E2E attempted but sandbox process-reaping prevented
    multi-step browser tests within a single bash call; static + HTTP verification covers
    all code paths.
  - Assets: `app.css` ?v=262→263 (23 pages), SW `hibana-v283`→`v284`, `package.json`
    0.3.11.5→0.3.11.6.
- v0.3.11.5 = **Session 23 hotfix release** — 5 fixes from Ali's live feedback (CSS + JS +
  i18n keys + one TS renderer; no schema changes):
  - **English dropdown items in FA locale (root cause)**: the inline task editor's
    Status/Priority selects used `_t('status.idea'|'prio.low'|…)` — those keys NEVER
    existed (the dicts only carry the 7-stage project taxonomy), so FA fell back to raw
    English "idea/planned/in_progress/done/bug" + "low/medium/high/urgent". Now the
    selects reuse the BOARD's translated keys (db.st.idea/planned/inprog/done/bug +
    db.pr.*) — the dropdown matches the column names the owner already sees
    (ایده‌های جدید / برنامه آتی / در حال انجام / انجام‌شده / مشکلات / کم / متوسط /
    زیاد / فوری). EN unchanged (New Ideas/Upcoming Plan/In Progress/Implemented/Problems).
  - **RTL text editors in FA (root cause)**: all three task editors hardcoded
    dir="auto" — the first-strong-char heuristic keeps the editor LTR whenever the
    first typed character is Latin/numeric, so Farsi writing read misaligned. All now
    follow the UI locale (fa → rtl, else auto — the recipe the description/note
    editors already used): #pd-taskadd-textarea, #pde-input, the board editor's
    textarea + modal card, plus the backlog composer + full-screen plan editor.
    Rendered CODE blocks stay LTR islands regardless (see below).
  - **Editor options + dedicated CODE container (owner: "many times my tasks have Codes
    in them, mostly html css")**: task titles now carry fenced ``` code blocks, **bold**
    and manual line breaks. A formatting toolbar (Code / Bold / Bullet — کد/پررنگ/بولت
    in FA, 6 new i18n keys) sits above the textarea in all three composers (add modal,
    inline edit dialog, board editor); Code wraps the selection in fences or drops an
    empty block at the caret. Newlines are PRESERVED on save everywhere (was collapsed
    to spaces; only \r\n normalized + outer trim; the problems-box line-splitting
    composer keeps its per-line behavior by design). Rendering — ONE renderer ported
    to three sites (routes/projects.ts renderTitle, project.html pdRenderTitle,
    board.html renderTitle): escape-first line-walk; fence lines open/close
    `<code class="t-code" dir="ltr">` — monospace, soft inset surface, pre + horizontal
    scroll, an optional data-lang label (```css → "CSS"), an LTR island inside RTL
    cards; prose lines get **pair** → <strong>; titles render multi-line
    (white-space: pre-line). The ``` fence LINES live in `<span hidden class="t-fence">`
    markers INSIDE the <code>, so the title's textContent still reads the RAW title
    EXACTLY — every textContent consumer (editors' prefill, magic wand, quick-copy,
    Markdown export, delete-undo) round-trips with zero changes; unclosed fences render
    as code till end (self-healing); the Session-22 150-char clamp + read-more work
    unchanged (both halves rendered through the same renderer). A specificity twin
    `html[lang='fa'] .t-code` keeps the container monospace against the
    `html[lang=fa] body *` Vazir rule (Vazir sits last in the stack so Farsi comments
    inside code still render).
  - **ذخیره green (owner: "must be green like other buttons of the system")**: the
    inline editor's #pde-save and the board editor's data-db-save carried class="btn"
    (the neutral card-bg style) while every primary action in the system is a plain
    <button> (the --cta green fill + white text). Both dropped the class → #2E7B7F +
    white, matching افزودن/Add and every other CTA.
  - **Vanished + FAB (root cause, verified live on hibana.ir before fixing)**: the
    onboarding tour (shipped v0.3.11.2) highlights the FAB at step 1 — but the FAB's
    z-index:81 was trapped inside .fab-stack's stacking context (z-index 40), BELOW
    the tour overlay (z-index 80, 62% black + blur): during the tour the FAB rendered
    INVISIBLE + unclickable under the veil (elementsFromPoint proved the overlay on
    top). Fresh browsers / cleared storage / a second device re-trigger the tour →
    "the + cta button … is vanished". Fixed with `.fab-stack:has(.tour-target)` and
    `.topbar:has(.tour-target)` → z-index 82 (same trap hit step 2's theme toggle in
    the z-30 sticky topbar). Verified: fresh browser now shows the FAB above the dim,
    ring + pulse visible, clickable; skip/end restores normally.
  - **Hover bug (owner: "in hover, buttons turn green, text becomes light — fix hover
    bug")**: `button:hover` (0,1,1) sets green bg + white text globally; any
    single-class button rule whose :hover only overrides color/border LEAKED the green
    fill under dark/brand text — mixed green+dark pills everywhere. 12 rules now carry
    the FULL green+light recipe explicitly (.fab-item, .db-seg button, .db-add,
    .pd-read-more, .pd-more-link, .stat-arrow, .zen-exit, .sp-sprint-chip, .sf-chip,
    .sf-more, .pd-tag-add, .spark-folder-new) and 2 content-surfaces got their intended
    neutral bg reset on hover (.spark-folder-card, .dash-collapse-btn). Verified with
    real mouse hovers: #276A6D + #fff on db-add, db-seg buttons, fab-item (transition
    mid-frames initially misread as muted — final states re-verified).
  - Verified locally: typecheck green, 295/295 tests, smoke ALL PASS, cache-bust PASS;
    browser E2E on the local Node server (PORT=3001) — FA + EN × light + dark ×
    1280/390: FA dropdown labels, RTL editors, toolbar flows (Code button inserts
    fences at the caret; caret lands inside the block), CSS+HTML code tasks round-trip
    add→card→edit-prefill→save→card on BOTH surfaces, textContent exact, mono font in
    FA, dark container colors, 0 hscroll at 390px (long code scrolls inside the block),
    0 console/page errors across projects/sparks/board/sprint/project. Local fixture
    project deleted after the run.
  - Assets: app.css ?v=261→262 (23 pages), i18n.js ?v=54→55 (all pages), devboard.js
    ?v=10→11 (board + sprint ×2), SW hibana-v282→v283 (precached HTML shells rotate —
    project/board markup changed), package.json 0.3.11.4→0.3.11.5.
- v0.3.11.4 = **Session 22 hotfix release** — 3 fixes from Ali's live feedback (CSS + JS +
  two Zod caps lifted; no schema changes):
  - **Task-composer modals actually open big now (root-cause fix)**: the v0.3.11.1 "50%
    larger taskadd modal" NEVER rendered — `.pd-taskadd-modal` (0,1,0) lost the cascade to
    `dialog.dialog`'s `max-inline-size: min(26rem, 92vw)` (0,1,1), so the composer (and the
    "full screen" pd-editor-modal, intended 60rem) were stuck at 416px. Fixed with
    `dialog.`-prefixed rules + an explicit `inline-size` (a native <dialog> is
    fit-content; a max only caps). New sizes: taskadd + inline task-edit dialogs
    min(78rem, 96vw) (≥50% over the 52rem Session 19 intended; ~3× what actually
    rendered), pd-editor-modal 60rem, board db-modal 34→52rem. Textareas: taskadd
    12→18rem min + `resize: vertical`, rows 4→8 (add) / 3→8 (edit); board editor title
    converted from a single-line `<input maxlength=300>` to a 9rem-min textarea.
  - **300-char limit halted — titles unlimited, cards clamp at 150 chars**: every FE cap
    removed (taskadd "۰ / ۳۰۰" counter element + taskAddCounter JS, edit-dialog
    maxlength=300, board-editor input maxlength=300, problems-tab inline-edit
    input.maxLength=300 — the last three silently truncated data despite the server
    accepting 2000 since v0.3.11.1). Server: devboard.ts title caps 2000 → 100k sanity
    guard (Zod stays, rule 10; 100k is beyond any real title + under the Workers body
    limit). Display: progress boxes + board show the first 150 CHARS — the rest lives in
    a hidden `.pd-title-rest` span INSIDE the title element, so `textContent` (magic
    wand, inline editors, copy/export, delete-undo, delete-confirm) keeps reading the
    FULL title; a real `[data-task-read-more]` button toggles it (was the 3-line CSS
    line-clamp + ::after hint, project page only). Wand writes re-clamp via a
    `hibana:title-written` event.
  - **Board↔progress-box color consistency (owner: "project page shows labels with
    different color codings, the full-screen board shows all of them orange")**: root
    cause — `.db-card:has(.prio-medium)` still hard-coded an ORANGE left border (the
    Session-19 column-color fix was only applied to the pd side; the "Same for db-card"
    comment was false) and most tasks are prio-medium, so every board column read
    orange. The board now uses the exact pd recipe: card left border = column color via
    `--db-c`, only low/high/urgent flag their own color, medium keeps the column color;
    urgent keeps the tint + bold title. Also fixed while unifying: board prio-dots were
    INVISIBLE (`background: inherit` at 0,2,0 beat the .prio-* classes at 0,1,0 →
    transparent, and the referenced `--prio-color` token was defined nowhere) — now the
    pd !important priority recipe; db-col light inks were pre-Session-20 values → AA set
    (in_progress #7d5a34, done #43704f, bug #87555f); db-col dark set was the
    pre-Session-19 bright values → pd muted set; column dot 0.95/0.6rem → 0.72/0.55rem;
    card padding + title size unified with .pd-task (fs-sm).
  - Also fixed (found during verification): client-rendered task cards (freshly added +
    "more"-expanded) were `<a href="/board.html">` while server cards were
    click-to-edit divs — now all divs with role=button (click opens the inline editor
    everywhere); the edit-dialog in-place update queried
    `.pd-task[data-pd-task=…]` which matched NOTHING (data-pd-task lives on the wrap)
    — cards silently stayed stale after edits, now updated + re-clamped; same
    wrap-selector fix in the problems-tab sync.
  - Verified locally: typecheck green, 295/295 tests, smoke ALL PASS, cache-bust PASS;
    browser E2E on the local Node server — modal 1229px@1280/374px@390 (was 416),
    textarea 288px, 223-char task via Enter → 201 + 150+72 clamp split + read-more
    toggle (project AND board), edit modal prefills the FULL 310-char title, medium
    cards carry the column color on both surfaces (planned grey rgba(209,212,216,.55),
    in_progress rgba(240,197,155,.55)), prio-dots visible, dark = muted set,
    5000-char POST → 201 / 100001-char → 400, FA/RTL strings (بیشتر بخوان، بدون
    محدودیت طول), 390px no hscroll, 0 console/page errors. One VLM claim (strikethrough
    "crossing" the read-more button) disproven by DOM geometry (5px gap, no overlap) —
    discarded as a screenshot-scale misread. Assets: app.css ?v=260→261, devboard.js
    ?v=9→10, magic-wand.js ?v=8→9, SW hibana-v281→v282 (precached HTML shells rotate —
    project.html/board.html markup changed).
- v0.3.11.3 = **Session 21 hotfix release** — 3 visual fixes from Ali's live feedback on
  the dashboard/projects pages (all CSS/markup-only, no backend or schema changes):
  - **Bug-bubble pastel + shadowless**: the red open-bugs badge next to project titles
    (dashboard stat cards, projects cards/list, kanban) was solid #dc2626 with a red drop
    shadow — read as too harsh. Now the sig-chip recipe: light 12% red tint + #b91c1c ink
    (≥5.1:1 everywhere it renders), dark 16% red tint + #f2a3a3 ink (≥6.2:1), box-shadow
    removed in all three theme rules.
  - **Pastel stage bars**: the whole `--stage-bar-*` set (the slim per-card status label
    on dashboard stat-kanban-cards) softened to one pastel register: spark #E9BC5F→#E8CFA0,
    unreviewed #A9BFD8→#C2CFDD, investigating #9DC7FF→#BCD5EF, awaiting #FFD658→#EFDEA5,
    doing #6FE983→#AEE0B8, halted #F2A08C→#EFC2B5, operational #8FD694→#B7DFBC. Same
    register both themes (unchanged design decision); bar is 45%-saturation pastel — on
    dark it reads luminous purely from light-on-dark contrast, not saturation.
  - **Skip-to-main-content link removed** (owner request: the focus pill covered the header
    avatar in RTL): `<a.skip-link>` deleted from all 17 pages, `.skip-link` CSS block +
    `main:focus` outline rule deleted, `a11y.skipToMain` FA key removed from boot.js
    CRITICAL_FA (i18n.js never carried it — no parity impact). `main id="main"` stays so
    bookmarked #main anchors keep working. A11y note: keyboard users lose the jump-to-
    content shortcut; Tab order still reaches main content normally. Owner's explicit call.
  - Verified: FA/EN × light/dark × 1440/390 — bubble+bar computed styles pastel+shadowless
    on dashboard AND projects Cards view, 0 skip-link anchors on every checked page, 0
    horizontal scroll, 0 console/page errors. typecheck green, 295/295 tests, smoke ALL
    PASS. Assets: app.css ?v=260 (was 259), SW hibana-v281 (was 280 — precached HTML shell
    rotates so every client drops the skip-link anchor).
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
    snapshot + export schema_version → 20260920, +4 regression tests, local
    snapshot→restore drill PASS. +2 SW-navigation auth tests (total 289→295).
  - **Smoke test fixed**: stale htmx ?status=spark expectation (pre-session-20 failure at
    HEAD) updated for the session-18 ideas-folder-grid — smoke ALL PASS.
  - **SW-navigation 401 fix (pre-existing at HEAD)**: a service worker's navigate-mode
    re-fetch loses Sec-Fetch-Dest: document at the origin, so an expired/absent session
    on an /app reload rendered the raw JSON 401 body (a JSON-viewer page — no JS, no
    login bounce). Fixed both layers: middleware treats Accept: text/html as a document
    request (redirect to /login.html; JSON clients unaffected — pinned by 2 tests) +
    sw.js v280 turns a 401 on any navigation into a login redirect (belt+ suspenders).
  - Verified by design (no change): reports bar-chart scroll strip, stat-strip carousel,
    sadhana subbar chip carousel, closed ⋯ menu pops, theme-floater ::after hit area.
  - Perf/SW review (no changes warranted, honest): D1 EXPLAIN all-indexed at busy-solo
    scale (worst interactive 31.85ms canvas bbox @40k elements — under threshold);
    SW class split sound; sw.js unversioned-URL risk covered by updateViaCache=imports
    default + boot.js reg.update() polling.
  - Assets: app.css ?v=259 (was 258), SW hibana-v279 → v280 (navigation-401 redirect
    logic).
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
| 20 | 2026-09 | v0.3.11.2 — Session 20: systematic UI/UX audit (129-row sweep, 0 console errors), 22 AA-contrast offenders fixed (white-on-accent fills → --cta; teal-as-text → --link; pd-col inks darkened; dark sticky metadata + bug-bubble), 2 mobile overflows fixed (project header, clients payments form), CRITICAL backup coverage gaps fixed (project_archives + dev_task_tags in snapshot; restore.mjs stale tableOrder; restore-safe FK-safe ordering; personal export cluster), stale smoke expectation fixed, SW-navigation 401→login redirect fix (middleware Accept:text/html + sw.js). 295/295 tests, typecheck green, smoke ALL PASS, local restore drill PASS, app.css v259, SW v280 |
| 21 | 2026-09 | v0.3.11.3 — Session 21: live-feedback visual fixes — bug-bubble pastel red + shadow removed (sig-chip recipe, AA-checked both themes), whole --stage-bar-* set softened to pastel (7 tokens), skip-to-main-content anchor removed from all 17 pages (+CSS +i18n key; owner: covered the header avatar). 295/295 tests, typecheck green, smoke ALL PASS, app.css v260, SW v281 |
| 22 | 2026-09 | v0.3.11.4 — Session 22: live-feedback fixes — dialog.modal specificity bug fixed (taskadd/taskedit actually open at min(78rem,96vw); pd-editor 60rem; db-modal 52rem; textareas 18rem/9rem + resizable), 300-char limit halted everywhere (FE caps removed, devboard.ts 2000→100k guard; 150-char hidden-rest clamp + read-more button on project + board, textContent stays full), board color system unified with pd recipes (medium keeps column color — board no longer all-orange; prio-dots un-hidden; AA inks; muted dark set), client-rendered cards click-to-edit like server cards, stale-card edit-update selector fixed. 295/295 tests, typecheck green, smoke ALL PASS, app.css v261, SW v282 |
| 23 | 2026-09 | v0.3.11.5 — Session 23: live-feedback fixes — task editor CODE support (``` fenced blocks rendered as monospace LTR `<code class="t-code">` islands with data-lang labels + hidden fence markers so textContent round-trips the raw title exactly; **bold**; multi-line titles with preserved newlines; Code/Bold/Bullet toolbar in all 3 composers; one renderer ported to projects.ts/project.html/board.html), FA dropdown root cause (pde selects used never-existing status.*/prio.* keys → now the board's db.st.*/db.pr.* translations), FA editors now dir=rtl (was auto→LTR on Latin first char; recipe applied to 5 textareas incl. backlog), ذخیره buttons green (#pde-save + data-db-save plain-button CTA), vanished FAB root cause (tour overlay z-80 buried the z-81 target trapped in .fab-stack's z-40 context → :has(.tour-target) lifts fab-stack/topbar to z-82; verified live pre-fix), 14 hover-leak fixes (button:hover's green bg leaked under dark/brand text — full green+light recipe on 12 action buttons, neutral reset on 2 content surfaces), FA mono-font specificity twin for .t-code. 295/295 tests, typecheck green, smoke ALL PASS, app.css v262, i18n.js v55, devboard.js v11, SW v283 |

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
