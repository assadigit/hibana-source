// Hibana service worker — PWA packaging. Precaches the static shell (below) at
// install + the hashed /dist/ bundles via manifest.json; runtime strategy split:
// navigations network-first (401 → login redirect), /api/* always network, hashed
// /dist/ + versioned /js|css ?v=N cache-first, vendor SWR. Strategy details are
// documented inline at the fetch handler.
//
// VERSION discipline (load-bearing — stale caches caused ~4 user bug reports):
// bump on any sw.js logic change or when existing clients must re-fetch the
// manifest/shell. Since v0.3.0 app bundles are content-hashed, so a bump is NOT
// needed for ordinary JS/CSS edits (their ?v= URLs change instead).
//
// Session history lives in Changelogs.md + git log (the VERSION line carried the
// last ~40 release notes until S199 trimmed it to the last 3 — every prior entry
// is recoverable verbatim: `git show <sha>:public/sw.js`).

// v458 (S246): THE TASK DEPENDENCIES UI — SPEC PACK PHASE 7 (feat/sprint-deadline-deps): Screen K — the COLLAPSED Dependencies (optional) section in the task modal (collapsed by default, the S244 due-toggle's grammar; expanded reveals the SEARCHABLE Blocked-by multi-select of same-project tasks — title + sprint glyph + status per option, the current blockers pre-selected; EDIT mode mutates LIVE through the existing POST /api/devtasks/:id/deps {blocker_id} / DELETE …/deps/:blockerId endpoints riding the shared api() — ZERO new fetch sites — so the 400 self / 409 cycle answers surface INLINE at the bad pick with the offending task named, and the modal never carries a dep-diff; ADD mode STAGES the picks and POSTs them right after the create ack — the create-then-link chain); Screen L — the compact card badges in ALL THREE renderers (board-page.js + the detail-helpers.ts server twin + the project-page.js pdTruthWrap repaint twin, byte-identical): `Blocked` (optionally `Blocked · N`), the DERIVED reverse `Blocks N` (the same task_deps edge fold's other half — never a second endpoint or stored column, spec §15), and `Ready` (§16.1's resolution — blockers existed and ALL are complete; the fold answers it every render, the relationship is retained); the S238 task view's row-only twin carries the blocker NAMES (the details surface); completing a blocker re-renders the badges (the /kanban reload path + the embedded board's DONE-transition full-lane repaint); the embedded-fold decision: the DETAIL POOL feeds the embedded board (loadDetail's additive taskDeps key — the same /api/projects/:id fetch, never a second board pull); SOFT constraints pinned (assumption 2 — the badges never gate Kanban movement, never mutate priority/status/sprint/deadline). Carriers: devboard.js v36 (3 pages + 3 injector literals), board-page.js v33, project-page.js v84, sprint-page.js v27 (injector literal), devboard.css v44 (23 pages), i18n-en.js v110 + i18n.js v163 (26 pages — v163 carries the lazy i18n-fa.js?v=104 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v457 (S245): THE DEADLINE EXTENSION FLOWS — SPEC PACK PHASE 6 (feat/sprint-deadline-deps): J1 the sprint-deadline extension dialog (sprint identity + the current deadline with the S244 label wording + the four §13.1 choices — +24h/+48h/+72h presets that ADD TO THE EXISTING deadline, never to the current moment, and Custom date through the shared D6 control pre-loaded with the current value — + the BEFORE-confirmation impact counts: how many tasks INHERIT and follow vs how many are PROTECTED by personal overrides, folded client-side from the payload the §12.5 doctrine; Confirm PATCHes /api/sprints/:id {due_at} — value→value preserves due_origin_at, §13.2's no-reset); J2 the personal task-deadline extension (the card deadline row's hover-revealed Extend affordance + the task view's row + the Edit modal's due-field Extend… link → the picker → PATCH /api/devtasks/:id {due_at}, only-that-task-changes, origin preserved §13.3); J3 the INHERITED-deadline extension CHOICE modal (two clearly distinct paths with visible scope — Extend sprint deadline reuses J1 with its full preview vs Extend this task only, which creates the personal override based on the CURRENT INHERITED deadline + the extension and rides the NEW additive due_origin_at body field (honored server-side ONLY on the null→value transition) so the bar keeps the SPRINT's origin — §13.4's preserve-the-inherited-origin invariant, never a silent sprint change); the anchors: the S243 sprint popover's Extend label rewires to J1 (the S48p window.prompt ended_at flow RETIRED), the compact overview's Extend action on BOTH board surfaces, the settings panel's Extend… link; the detail-helpers.ts server twin carries the byte-identical row affordance. Carriers: devboard.js v35 (3 pages + 3 injector literals), board-page.js v32, project-page.js v83, sprint-page.js v26, devboard.css v43 (23 pages), i18n-en.js v109 + i18n.js v162 (26 pages — v162 carries the lazy i18n-fa.js?v=103 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v456 (S244): THE DEADLINE ENGINE + UI — SPEC PACK PHASE 5 (feat/sprint-deadline-deps): the shared Gregorian/Jalali deadline date control (D6 CLOSED — the NEW due-control.js: the segmented calendar selector defaulting to the user's calendar_pref, ONE editable date field per calendar (native date for Gregorian, Persian-digit-tolerant numeric text for Jalali), the six §11.3 presets with the exact semantics (Today/24h/48h/72h = LOCAL 23:59 / now+N hours; This week / This month per the SELECTED calendar's convention — Sunday-first Gregorian ends Saturday, Saturday-first Jalali ends Friday, Esfand 29/30 included), the Add time (optional) toggle OFF by default, date-only resolving to LOCAL 23:59 (§11.2 — SUPERSEDING assumption 10's interim UTC end-of-day parse with its ~3.5h Tehran delta), value = the ISO-8601 UTC instant); the task modal's Due date (optional) toggle OFF by default (§9.1) with the read-only inherited line (§10.1 — reads the payload row's server-computed effective_due_source) + the explicit-null removal contract (§10.2: PATCH due_at:null clears and inheritance resumes; create always sends the explicit key); the CARD DEADLINE ROW + the thin 5px elapsed-time progress bar in BOTH renderers (Screen A order — the sprint row seam: row = the calendar-clock icon + the §12.3 threshold WORD (Comfortable/Approaching/Urgent/Overdue + neutral Done for §12.4) at the exact 48h/7d boundaries; bar = the §12.2 elapsed ratio from the payload's effective_due_origin_at, clamped 0-100, direction-locked LTR per §17's RTL exception) — the board-page.js client twin + the detail-helpers.ts server twin (byte-identical grammar; the detail pool's devTasks now carry the additive computed triple through the same effectiveDeadlineOf seam) + the project-page.js repaint twin; the S238 read-only task view's meta rows join the deadline display; the sprint QUICK-CREATE + the sprint SETTINGS due inputs got SWAPPED to the shared control (the S242/S206 UTC-parse interim superseded — the settings PATCH sends due_at explicitly: value→value preserves the origin per §13's semantics); the vendored jalaali joins project.html (the FA card labels' conversion). Carriers: due-control.js v1 (NEW tag on board+sprint), devboard.js v34 (3 pages + 1 injector literal), board-page.js v31, project-page.js v82, sprint-page.js v25, devboard.css v42 (23 pages), i18n-en.js v108 + i18n.js v161 (26 pages — v161 carries the lazy i18n-fa.js?v=102 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v455 (S243b): THE EMBEDDED-FOLD ACCURACY FIX (the reconciliation round on top of b770258): the project page's compact sprint overview + the shared H1/H2 dialogs now fold the FETCHED task truth (pdTaskTruth extended with sprint_id + status) with the DOM wraps' live statuses overriding (pdOvRows) — the DOM-only fold undercounted lanes past the server's MAX_VISIBLE=5-per-column render window and could omit a sprint's tasks entirely when other cards filled a column's slots first; pdRepaintColumns re-syncs status + sprint assignment as the drag-optimistic DOM graduates to fetched truth. Carriers: project-page.js v81 (the only touched file) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v454 (S243): THE SPRINT LIFECYCLE — SPEC PACK PHASE 4 (feat/sprint-deadline-deps): the pause/resume client wrappers + the confirmation dialogs (H1 the one-active conflict — Pause A & Start B / Finish A & Start B with the archive-count note / Cancel; H2 finish — the Implemented-count preview + unfinished-stay-put + the server-count toast; H3 the lightweight pause confirm; Screen-I delete — EXACT impact counts incl. the archived-with-snapshot rows + never-deletes-tasks), the Sprints page EXTENSION (D5 — the lifecycle-grouped list Active/Planned/Paused/Completed-history + the Settings/Tasks detail panel with the five-lane client fold + the completed sprint's archived history + the ?sprint= deep link), the compact Kanban overview on BOTH board surfaces (Screen G — identity + lane counts + total + Start/Resume/Pause/Finish + the Settings deep-link; the embedded-board parity decision SHIPPED), the distinct PAUSED timeline render (hatched band + ⏸ chip), and the archives list now carries sprint_id + sprint_name_snapshot (additive; the delete preview + completed history read it). Carriers: devboard.js v33 (3 pages + 3 injector literals), board-page.js v30, project-page.js v80, sprint-page.js v24, devboard.css v41 (23 pages), i18n-en.js v107 + i18n.js v160 (26 pages — v160 carries the lazy i18n-fa.js?v=101 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v453 (S242): THE SPRINT UI — SPEC PACK PHASE 3 (feat/sprint-deadline-deps): the board toolbar gains the SPRINT view filter (compact select, All tasks / No sprint / every sprint with emoji-or-default glyph — composes with search+priority+labels, never mutates; the embedded project-page board carries its twin), the task modal's sprint dropdown wears the identity glyph + hides completed sprints from NEW assignment (a task already in one keeps it selected), ＋ New sprint opens the QUICK-CREATE dialog (required name, optional emoji via the shared full-library picker — NEW tag on board+sprint, description/due toggles OFF by default, inline 409 duplicate/draft_exists errors, auto-select on success), the task CREATE body now sends an EXPLICIT sprint_id (null = No sprint — D2 closed: the old undefined tripped the legacy draft/open auto-assign), and the card SPRINT IDENTITY renders as its own compact row under the description (emoji/◆ + name, both renderers — the Phase 5 deadline seam follows). Carriers: devboard.js v32 (2 pages + 3 injector literals), board-page.js v29, project-page.js v79, sprint-page.js v23 (injector literal), devboard.css v40 (23 pages), i18n-en.js v106 + i18n.js v159 (26 pages — v159 carries the lazy i18n-fa.js?v=100 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v452 (S238): THE TASK VIEW MODAL + THE SHEET POLISH (the owner's round): a card click (Enter/Space, ?task= deep link too) now opens a READ-ONLY centered task view (the blurred+greyscale backdrop, the full title+content through the same markdown-lite renderer, the meta rows, a Copy/Edit foot) — the editor opens ONLY from the ⋯ menu's Edit or the view's Edit button (the project page's S149 contract, brought to the board); the enlarge sheet grows to the ~800×600 rectangle over the SAME blurred+grey backdrop; every sheet row gains a one-tap copy button + its cloned ⋯ menus come ALIVE (the data-ok strip — Copy/Edit/Delete worked on the board, were dead in the sheet); the priority banner + the detail pill read REGULAR weight (was 700). Carriers: board-page.js v28, focus-core.js v2 (the escPeel round), devboard.css v39 (23 pages), polish-batch.css v30 (23 pages), quicknotes.css v51 (25 pages), i18n-en.js v105 + i18n.js v158 (26 pages — v158 carries the lazy i18n-fa.js?v=99 injector literal) → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v451 (S237): FOCUS MODE (the settings toggle + the two per-lane head buttons + the enlarge sheet): localStorage hibana-focus-mode/hibana-focus-last, live via the hibana:focus-mode event, blur-dim recipe + centered RTL-native sheet in devboard.css, F/[/]/Esc layering in board-page.js + the NEW pure focus-core.js. Carriers: focus-core.js v1 (NEW tag on board.html), board-page.js v27, devboard.css v38 (23 pages), i18n-en.js v104 (26 pages), i18n.js v157 (its lazy i18n-fa.js?v=98 injector literal), settings-page.js v18, i18n-fa.js v98 → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v449 (S233): EVERY MODAL CARRIES A TOP-RIGHT CLOSE (the owner's ask, with the settings-sheet screenshot): the S210 confirm card grows a head row — title (when present) + the corner ✕ (data-hib-confirm="x", the cancel path's twin: close(false), never the confirm); the board's shot-note editor + the delete-task confirm join the task editor / labels / pinned-pictures grammar (row spread, h3 + ✕). app.js v221, devboard.js v31, board-page.js v26, components.css v10 (the .hib-confirm-head/-x rules) across every page + the three devboard injectors → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v448 (S232): DELETE ANY LABEL — the labels dialog's ✕ now rides every row (S230 had it hidden behind usage_count=0, the owner's "two labels that can't be deleted"): a used label confirms first (the count is in the message) and DELETE /api/tags/:id?force=1 cascades the unlink from its tasks + rewrites search_tags (the server route + settings chips follow); a race-lost delete answers the new db.labelsInUse toast. devboard.js v30, i18n-en v103, i18n-fa v97 + the touched carriers board-page v25, sprint-page v22, project-page v78, i18n v156 (the injector literals) across every page → SHELL re-fetch (the ?v= refs in the precached HTML moved).
// v447 (S231, the refinement & polish pass): the populated lanes' Add-task row no longer stretches into an enormous outlined rectangle (the grid align-content root cause), the filter toolbar's dashed container retires (clean 32px controls, search capped 20rem), 56px lane headers with 13px/600 titles, 14px board titles + 12px meta, one lane-tinted 40px Add-task recipe for both placements, 120px @ 0.70/0.78 empty-state illustrations, the drag-over empty-group yield — devboard.css v37 (this bump) across all shells.
// v446 (S230, completion round): the UI-redesign follow-up + the SHELL re-fetch the round owes. The base round (aee9acf) landed the five-lane redesign — the toolbar's "{n} of {m} done" summary retired (#db-counts emptied+hidden), full-height lane surfaces with one ⋯ overflow menu each (copy/export/archive/clear preserved verbatim), the per-lane monochrome empty states (public/icons/empty-state/*.png, NEW) with lane-accent Add task buttons, EN+FA copy, and the quiet bottom helper hint — and bumped every ?v= (devboard.css v36, board-page v24, i18n-en v102, i18n v156, i18n-fa v96 (the completion round re-bumped devboard.css + board-page — the base round already deployed v35/v23)) across all 24 pages, which this SHELL bump must re-fetch for existing PWA clients (the base round's gap: board.html + every shell page changed their ?v= references — a stale precache would keep serving the old script URLs). The completion round closes the handoff's remaining spec items: the NEUTRAL CANVAS behind the white lanes (var(--statcard-bg) — light #F5F6F7 / dark #191817, bleeding to the frame's edges, flexing to the 100dvh floor), the scroll scope (only the lanes scroll horizontally below the toolbar — never the toolbar itself), the empty group's central lane placement, the helper hint's legibility (var(--muted) @ 0.85 — the handoff's #7B8491 @ 0.66 start lands under 2:1; its own verify-legibility caveat wins), the dark-theme illustration lift (0.72 — 0.46 read too faint), inline EN fallbacks for every empty-state string, the solid ⋯ dots, the e2e the base round owed (board-filters adapted to the ⋯ menu + the NEW s230-kanban-redesign spec: names/order, empty states, add-flow, populate, menus, DnD, 800px scroll, dark, FA/RTL, the embedded board's sr-only heading), and the version ladder (package 0.4.1.38 + Changelogs + worklog).
const VERSION = "hibana-v458" // v458 (S246): the task dependencies UI — Screen K the collapsed Dependencies section with the searchable Blocked-by multi-select (live POST/DELETE through the existing endpoints, inline 400 self / 409 cycle surfaces) + Screen L the compact Blocked / Blocks N / Ready card badges in all three renderers (the derived reverse fold, §16.1's completion resolution, soft constraints). Carriers: devboard.js v36, board-page.js v33, project-page.js v84, sprint-page.js v27, devboard.css v44, i18n-en.js v110 + i18n.js v163 (i18n-fa.js?v=104 injector) → SHELL re-fetch.

// Static shell: unhashed pages/partials/icons/vendor/fonts (SWR or network-first at
// runtime; precached here for offline). The hashed app bundles come from the manifest
// at install time (below), NOT from this list.
const SHELL = [
  '/',
  '/login.html',
  '/signup.html',
  '/confirm.html',
  '/dashboard.html',
  '/projects.html',
  '/sparks.html',
  '/spark.html', // S161: the LEAN idea detail page — offline-safe like its shelf
  '/notes.html', // S53: the Notes Vault — offline-safe like every shell page
  '/project.html',
  '/canvas.html',
  '/whiteboard.html',
  '/sadhana.html',
  '/to-do-list',
  '/reset.html',
  '/clients.html',
  '/archive.html',
  '/gallery.html', // S39: the media library — offline-safe like every shell page
  '/reports.html',
  '/calendar.html',
  '/notifications.html',
  '/settings.html',
  '/board.html',
  '/kanban', // S205: the dedicated project-Kanban entry point (Worker-served board.html; offline shell parity with /board.html)
  '/sprint.html',
  '/admin.html',
  '/404.html',
  '/clip.html', // Session 19 cron round 2: web-clipper popup (offline-safe)
  '/api/nav', // S72: the nav partial via the Worker route (no-store) — the static /partials/nav.html URL sat in the CF edge cache for hours post-deploy (zone Edge-TTL override; query strings don't reach that cache key). Precached here for offline boots; Class 3 network-first lands every deploy.
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-light.png',
  '/logo-dark.png',
  '/logo-square-light.png', // S89: the rail's square brand pair — one per theme
  '/logo-square-dark.png',
  '/vendor/bebas-note/font-face.css',
  '/vendor/bebas-note/BebasNotes-Regular.woff2',
  '/vendor/bebas-note/BebasNotes-Bold.woff2',
  '/vendor/bebas-note/BebasNotes-Light.woff2',
  '/vendor/manrope/font-face.css',
  '/vendor/manrope/Manrope-400.woff2',
  '/vendor/manrope/Manrope-500.woff2',
  '/vendor/manrope/Manrope-600.woff2',
  '/vendor/manrope/Manrope-700.woff2',
  '/vendor/htmx.min.js',
  '/vendor/idiomorph-ext.min.js', // P4 (Focus 2): htmx morph swap extension for notebook
  '/vendor/alpine.min.js',
  '/vendor/jalaali.min.js',
  '/vendor/vazir/font-face.css',
  // P9 (Focus 2): Vazir woff2 files removed from SHELL precache — they're only needed
  // by FA users (~132KB for 3 weights). EN users never inject Vazir (i18n.js:ensureVazir
  // only fires when lang=fa). The runtime SWR cache (Class 3 below) caches them on
  // first FA page visit. Offline FA users who never visited a FA page online fall back
  // to system-ui (acceptable degradation). font-face.css stays in SHELL (tiny, and the
  // CSS is needed to trigger the woff2 fetch when Vazir activates).
  // S70: fabric.min.js (292KB) REMOVED from the precache the same way — only canvas +
  // whiteboard load it (3 of 30+ pages; the dashboard/notebook Fabric surface loads
  // its own bundle). The runtime SWR cache holds it after the first canvas visit, so
  // offline-first creators lose nothing they've used before; a fresh install just
  // stopped paying 292KB (≈13% of the 2.16MB install) up front. SHELL install → ~1.87MB.
  // S200 (PERF-5): the real measured install = SHELL files + the dist/ manifest
  // entries (excl. i18n-fa + vendor) — 2,138 KB raw at v0.4.1.25 (was 2,180 pre-
  // WebP). The stale "~1.87MB" number above is kept for history; `npm run
  // check:precache-size` gates growth now.
  '/Login.webp', // S200 (PERF-8): the auth hero re-encoded, 110KB JPEG → 68KB WebP
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      // Static shell — with cache:'reload' (Session 27 fix, 2026-09-12): cache.addAll()
      // uses default fetch semantics, so the browser's HTTP cache (vendor files are served
      // max-age=86400) can hand back a STALE file during a new version's install — a
      // deploy that updated fabric.min.js would precache the OLD bytes under the NEW
      // cache version, and clients would keep running the stale vendor until the next
      // version bump (the v313 fabric-v7 compat rollout was exposed to exactly this).
      // 'reload' forces a fresh network fetch per shell file. Install still must survive
      // a missing manifest — but a shell file that cannot be fetched AT ALL fails install
      // (same atomic behavior as the previous addAll).
      await Promise.all(
        SHELL.map((url) =>
          fetch(url, { cache: 'reload' }).then((res) => {
            if (!res.ok) throw new Error(`shell precache failed: ${url} → ${res.status}`)
            return cache.put(url, res)
          }),
        ),
      )
      // Manifest-driven precache: the hashed app bundles (app.<hash>.js etc.). Best-effort
      // per file: one missing hash must not kill installation for the whole shell.
      // S80 (§10-D, the Vazir/fabric precedent class): i18n-fa.js is FA-ONLY — EN users
      // never inject it (i18n.js:ensureFaDict fires only when lang resolves to fa), so
      // precaching it billed every EN install 436KB raw / 74KB gz for a bundle only the
      // FA minority ever fetches. It stays a normal manifest entry: the first FA page
      // view injects it like any dist bundle and Class 1a (cache-first) holds it for
      // offline from then on. Offline degradation mirrors the Vazir fonts' accepted
      // contract: an EN→FA flip while offline, before any online FA load, keeps EN copy
      // (ensureFaDict's onerror resolves with dict.fa = {} and t() falls back).
      try {
        const res = await fetch('/dist/manifest.json', { cache: 'no-store' })
        if (res.ok) {
          const manifest = await res.json()
          const hashed = Object.entries(manifest || {})
            .filter(([k, v]) => typeof v === 'string' && v.startsWith('dist/') && k !== 'i18n-fa.js')
            .map(([, v]) => v)
          await Promise.allSettled(
            hashed.map((rel) =>
              cache.add(`/${rel}`).catch(() => {
                /* keep going — the file will be fetched from network on first use */
              }),
            ),
          )
        }
      } catch {
        /* no manifest (dev tree, or offline at install) — static shell is enough */
      }
    })(),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith('http')) return
  // Cross-origin requests pass through untouched (see header note): only same-origin
  // assets/navigations/API get the strategy treatment below.
  try {
    if (new URL(req.url).origin !== self.location.origin) return
  } catch {
    return // unparseable URL — nothing sensible to do with it
  }

  // Soft-navigation page fetches (nav.js): always network, never the cached shell — so
  // shell HTML can't go stale between deploys.
  if (req.headers.get('x-hibana-nav')) {
    e.respondWith(fetch(req))
    return
  }

  // API calls: always network (fresh data); never serve stale from cache.
  if (req.url.includes('/api/') || req.url.includes('/api?')) {
    e.respondWith(fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })))
    return
  }

  // Navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Session 20 (v280): the navigate re-fetch above re-stamps the request as a
          // worker-initiated fetch — Sec-Fetch-Dest: document never reaches the origin —
          // so an expired/absent session on an authed shell (/app) came back as the raw
          // JSON 401 body, which the browser rendered as a JSON viewer page (no JS, no
          // login bounce). The Worker now also keys on Accept: text/html (middleware.ts),
          // and this redirect is the client-side belt-and-suspenders: a 401 on a real
          // navigation is never a renderable document — bounce to login.
          if (res.status === 401) {
            // S111 (v405): the bounce preserves the destination — login.html returns the
            // user to ?next= after sign-in, so an expired session on a PWA share-target
            // navigation no longer drops the captured idea (the query rides inside the
            // encoded next and consumeShareTarget in app.js lands it after login).
            const dest = new URL(req.url)
            return Response.redirect('/login.html?next=' + encodeURIComponent(dest.pathname + dest.search), 302)
          }
          // S108 (v404): only GOOD navigations enter the offline cache. A transient 5xx
          // (deploy window, Worker error) used to be cached verbatim and then served as
          // the offline/stale fallback on the next network failure — the failure page
          // itself became the shell. The response still passes through untouched either
          // way; only the cache write is gated.
          const copy = res.ok ? res.clone() : null
          if (copy) caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
    )
    return
  }

  // Assets: strategy split by URL class (perf session 2026-09-10 — see header).
  const url = new URL(req.url)

  // Class 1a — content-hashed dist bundles (/dist/<name>.<hash>.js|css): cache-first.
  // These URLs are content-addressed AND served immutable by _headers — a cache hit is
  // byte-identical to origin by construction, forever. (dr-integrity session wiring.)
  // Class 1b — versioned app assets (/js/x.js?v=N, /css/x.css?v=N): cache-first. The ?v=
  // query is part of the cache key; dev-mode pages + in-code injections still use it.
  // Hard refresh (req.cache === 'reload') still goes to network in both.
  const hashedDist = url.pathname.startsWith('/dist/') && /\.(?:js|css)$/.test(url.pathname)
  const versioned = /^\/(js|css)\//.test(url.pathname) && /^\?v=\d+$/.test(url.search)
  if (hashedDist || versioned) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit && req.cache !== 'reload') return hit
        const res = await fetch(req)
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })(),
    )
    return
  }

  // Class 2 — vendor libs, fonts, images, webmanifest: stale-while-revalidate. Serve
  // the cached copy instantly, refresh it in the background (names are unhashed, so
  // a deploy can change content under the same name — hence revalidation).
  const staticish =
    url.pathname.startsWith('/vendor/') || /\.(?:png|jpe?g|svg|webp|ico|woff2?|webmanifest)$/.test(url.pathname)
  if (staticish) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        const refresh = fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
            }
            return res
          })
          .catch(() => null)
        if (hit && req.cache !== 'reload') {
          refresh.catch(() => {}) // background refresh; the cached copy answers now
          return hit
        }
        const fresh = await refresh
        if (fresh) return fresh
        const fallback = await caches.match(req)
        return fallback || Response.error()
      })(),
    )
    return
  }

  // Class 3 — everything else same-origin (unversioned JS, partials, misc): network-
  // first with cache fallback (2026-08-26). Cache-first kept pinning old CSS/JS after
  // deploys — a hard refresh doesn't bypass the SW, so users stayed on stale styles.
  // Network-first lands every deploy on the next load; offline still gets the shell.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
  )
})
