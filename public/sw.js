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
// Session history lives in Changelogs.md + git log (this header was a ~150-line
// changelog until S49 trimmed it — every prior entry is recoverable verbatim:
// `git show <sha>:public/sw.js`).

const VERSION = "hibana-v424" // v424 (S188): EVERY SHELL page re-busts its panel assets — nav.js v41 + layout.css v62 + i18n-en.js v95 + i18n.js v149 (+ the i18n-fa v89 lazy literal) — the Projects sidebar panel round: single-line ellipsis idea rows at ONE equal 32px row height with ALL items listed (the /api/rail projectTasks LIMIT 200 RETIRED, the projects window 40→400), the panel body scrolls internally with STICKY top-level group headers, every node's open/closed state persists to localStorage (data-fold-key) and restores on load, nested-level GUIDE LINES + rounded elbows (1px --line, logical, RTL-true; top-level groups stay bare), inline-end COUNT BADGES (circle→pill, neutral tint, zero-hidden, none on expanded projects, aria-labeled "N projects/sections/items"), the rail's ONE active pattern (the aria-current bar; the panel-open brand icon accent retires — aria-expanded keeps the semantics), and the panel becomes a ROUNDED FLOATING surface (10px gaps, 16px radius, thin border + soft shadow, inner padding, clipped scroll) on the tinted canvas — installers must re-cache them. // v423 (S187 r2): the quadrant STATUS LINES re-mapped against the owner's LIVE EISENHOWER board (their Q4 "Urgent & Important/Do" — the owner's picked line "Nothing urgent right now." now lands THERE; Q3 "Not Urgent & Important/Schedule" → "Nothing scheduled ahead."; Q2 "Urgent & Not Important/Delegate" → "Nothing pressing right now."; Q1 "Not Urgent & Not Important" → "Nothing waiting here." — still honest on default boards), caught in the owner-account pass after the first deploy; the ?v= re-busts: app.js v219 + i18n-en v94 + i18n.js v148 + the i18n-fa v88 lazy literal — installers must re-cache them. // v422 (S187): the to-do empty-state round — the dashboard quadrant's "Add a task" text link RETIRES from the DOM (the header ＋ is the one add path, now named "Add task to {quadrant}"), each empty quadrant speaks its OWN centered muted status line (dashboard.quadrantEmptyQ1..Q4 — "Nothing urgent right now." and siblings; the ?v= busts: dashboard-todo.css v24 + app.js v218 + i18n-en v93 + i18n.js v147 + the i18n-fa v87 lazy literal + dashboard.css v39), and the board page's dashed bulb block CENTERS in the card body (sadhana-board.css v25 + sadhana-page.js v14; the hint now points at the card's own ＋ — "Tap + to add one") — installers must re-cache them. // v421 (S186): EVERY SHELL page changed markup — the global ?v= busts (base.css v13 + app.js v217 across all pages; to-do-list.css v11 + sadhana-page.js v13 on sadana; notes.css v19 + notes-page.js v23 + the FAB injection on notes; sparks-page.js v13 on sparks; projects-page.js v8 on projects; image-crop.js v3; sprint-page.js v18; clients-page.js v4; signup.html's reordered verify row) — the owner's CTA round: the ONE-primary-per-view rule (the shared solid-teal bare-button primary at the trailing end, neutral secondaries — the teal ghost text retires), the Crop-banner incident fixed, every modal footer reordered [secondary, primary], the Notes page's mobile CTA consolidation + the global FAB, and the shared hibanaMenu body-portal lift for every ⋯ menu (clipping killed) — installers must re-cache them. // v420 (S185): EVERY SHELL page changed markup — the global ?v= busts (variables.css v24 + claude-dark-theme.css v27 across all pages; project-header.css v49 on its 23 linkers + project.html's own body.pd-page class) — the owner's batch-1 color round, the Project Detail palette: the role-named token block (--page-bg/--surface/--border-soft/--primary + the five one-family OKLCH column tints/dots/inks + the --prio-* pairs), the warm #F5F4F1 canvas + the warm-gray card borders + the Notes tab's white bordered field, all scoped to the project page — installers must re-cache them. // v419 (S184): the layout-audit round — the dashboard's ONE section rhythm (main.shell-dash flex gap 24px, per-card margins retired), the ONE 1rem panel inset + the 3rem head strips + the .dash-sec-link header grammar (+ the notebook archive button's move to the foot), the composer's card-surface affordance (light) + the dark well twin, the carousel handles joining the dots row — every page referencing the bumped sheets (dashboard, dashboard-todo, quicknotes, polish-ui, misc, claude-dark-theme) re-caches. v418 (S183): EVERY SHELL page changed markup — the global ?v= busts (dashboard-todo.css v22, dashboard.css v37, quicknotes.css v43, misc.css v21, polish-ui.css v37, claude-dark-theme.css v25, app.js v216, resume.js v15, i18n-en v92, i18n.js v146 + the i18n-fa v86 lazy literal; the dashboard's head-inside-panel skeleton) — the depth-audit round: every dashboard section head rides INSIDE its panel card (header strip + hairline), the section panels carry --shadow-card, the dark L4 splits from L3, the resume progress bar retires, the to-do rows compact to the 3-fit window + the fade-edge scroll affordance — installers must re-cache them. // bump on sw.js logic changes — see Changelogs.md §1 (current state) + git log (full history). v417 (S182): EVERY SHELL page changed markup — the global ?v= busts (dashboard-todo.css v20, claude-dark-theme.css v24, app.js v215, i18n-en v91, i18n.js v145 across all pages; the dashboard's skeleton panel + third shimmer row) — the to-do section round: the section body joins the Quick Notebook's card grammar (.dash-todo-panel), the four quadrant cards go FIXED-HEIGHT equal boxes (the 3-item window + the list's own scroll; the S106 frost pill + hidden-row shipping + the S179 empty-collapse retire), the over-cap board link rides inside the scrollable list — installers must re-cache them. // v416 (S181): EVERY SHELL page changed markup — the global ?v= busts (variables.css v23, layout.css v60, claude-dark-theme.css v23, polish-ui.css v35, i18n-en v90, i18n.js v144 across all pages; dashboard.css v34 + resume.js v14 on the dashboard — the opening quartet round: the visible page h1, the resume strip's head joining the one-section pattern + the summary line + progress bar, the vault banner quieted to the nudge register, the zero-page empty register, the dedicated --ident-* identity family, the sidebar bars' --brand-hover rung) — installers must re-cache them. // v415 (S180): EVERY SHELL page changed markup — the global ?v= busts (quicknotes.css v42, claude-dark-theme.css v22, app.js v214, resume.js v13 — the sticky restore round: the dashboard compact notebook's yellow sticky papers + brown inks + the wrapping row, the Move-to keyboard wiring, the delete path's widget re-GET, the resume strip's server seed) — installers must re-cache them. // bump on sw.js logic changes — see Changelogs.md §1 (current state) + git log (full history). v414 (S179): EVERY SHELL page changed markup — the global ?v= busts (variables.css v22, base.css v12, layout.css v59, app.js v213, i18n-en v89, i18n.js v143 across all pages — the advisor's dashboard blocks 5–16 round: the one section-heading pattern, surface tokens, the compact Quick Notebook with Move-to, the rail's inset active bar + 11px labels, the four-card overview with N-open text, the focus-ring token) — installers must re-cache them. // bump on sw.js logic changes — see Changelogs.md §1 (current state) + git log (full history). v413 (S178): EVERY SHELL page changed markup — the global ?v= busts (nav.js v39, layout.css v58 across all pages — the quiet-sidebar refinement round: the panel header on the sidebar surface, inline counts, the type hierarchy, tighter rows + 18px group bands, the chevron slot alignment, the inset selection bar) — installers must re-cache them. v412 (S177): EVERY SHELL page changed markup — the global ?v= busts (nav.js v38, layout.css v57 across all pages — the quiet-sidebar round: text-only group headers, no tree connectors, the platform chevron, hover-revealed goto chips) — installers must re-cache them. v411 (S176): EVERY SHELL page changed markup — the global ?v= busts (i18n-en v88, i18n.js v142, project-header.css v48, chip-render.js v11 across all pages; project-page.js v73 on project.html) — installers must re-cache them. v410 (S175): ONE SHELL page changed markup — project.html (the progress board's fold chevrons + the ?v= busts) — installers must re-cache it. v409 (S174): TWO SHELL pages changed markup — settings.html (the category Delete button joins the row actions) + project.html (the ?v= busts) — installers must re-cache them. v408 (S171/S172): THREE SHELL pages changed markup — spark.html (the Created·Updated meta line), sparks.html (the ?q=/?folder= deep-link stamp + the search input joining hx-include), project.html + settings.html (the ?v= busts) — installers must re-cache them. v407 (S169): spark.html changed (the AI-assist wand joins the lean idea page — magic-wand.js loads + [data-magic] on its fields) and it sits in the SHELL precache, so installers must re-cache it. v406 (S161): the LEAN idea page /spark.html joins the SHELL precache — sparks open on their own surface now (the heavy project template renders projects only), so offline boots need it cached. v405 (S111): the navigate 401 bounce now carries ?next=<path+query> — login.html returns the user to the exact place (and a PWA share-target capture's query survives the login round-trip). v404 (S108): the navigate handler caches res.ok responses ONLY — a transient 5xx during a deploy window used to be put() verbatim and then served as the offline/stale navigation fallback, making the failure page itself the shell.

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
  '/Login.jpg',
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
