// Hibana service worker — PWA packaging (Phase 5).
// Network-first for navigations (fresh data always), cache-first for the app shell so the
// interface loads instantly and works offline. The offline *queue* is IndexedDB-based and
// independent of this file (spec §3.4).
// 2026-08-30 (k2): cross-origin subresources are NEVER intercepted. The canvas/notebook
// "image from a link" tools hotlink external pictures; this handler used to respondWith
// their loads, and the SW's re-fetch is blocked by the SW script's OWN CSP (connect-src
// 'self' is set on every response incl. /sw.js) — the catch-fallback then answered the
// <img> with the cached shell HTML, so every external picture "failed to load". Pass
// them through: the PAGE CSP (img-src https:) governs external loads directly.
//
// Perf session (2026-09-10, docs/perf-and-data-safety.md §2.2): the fetch handler
// splits strategies by URL class instead of network-first-for-everything.
//
// Session-11 (2026-09-14, three owner follow-ups on v0.3.6): hibana-v231 → v232 —
// app.css v206 (dashboard section spacing finally applies via .shell-dash, restored ⚙
// note-controls-toggle, stat-kanban-card status LABEL instead of full tint) and app.js
// v162 (#dash → main.shell-dash selectors; note-controls-toggle open-state persistence)
// plus dashboard.html. Full-tree bump per the cache rules (drops every v231 copy).
//
// Session-10 (2026-09-14, four UI fixes): hibana-v230 → v231 — app.css v205
// (notebook view-mode controls always visible, dashboard prog-track hover-reveal,
// pglance subtle color + section spacing) and sadhana.html's unversioned full-tree
// content change (board section white space). Full-tree bump per the cache rules.
//
// dr-integrity session (2026-09-11, docs/dr-integrity-closeout.md §5): HTML → dist
// wiring. hibana-v227 → v228:
//   - PRECACHE IS MANIFEST-DRIVEN: install() fetches /dist/manifest.json (served
//     no-cache) and precaches its entries alongside the static shell. Deployed HTML
//     references content-hashed /dist/<name>.<hash>.js|css URLs, so asset changes need
//     no SW changes — new hashes are simply new URLs (fetched from network on first
//     request, precached on the next install/activate cycle).
//   - /dist/*.js|css joins the CACHE-FIRST class (they are content-addressed AND served
//     immutable by _headers — strictly safer than the ?v= URLs, which stay supported
//     for dev-mode pages and in-code injections).
//   - VERSION-BUMP RULE SIMPLIFIES: bump the hibana-vNNN version only when sw.js LOGIC
//     changes (this file). The old "bump on every public/ change" rule existed because
//     SHELL precache was hardcoded to ?v= URLs; that coupling is gone. Vendor/page
//     files still refresh via SWR / network-first exactly as before.

// Session 9 (2026-09-14): v228 → v229 — batch 1+2 (F1–F6, F14). Not a sw.js logic
// change, but a full-tree content change: app.js (F2 offline auth guard), i18n.js
// (offline.banner), app.css (F3–F6, F14 tokens), sadhana.html (F3/F14 — unversioned
// HTML rides exactly this bump, as do partials). The version bump drops the whole
// v228 cache on activate so no stale copy of any class survives the deploy.
// Session 9 batches 3+4 (F7–F13): v229 → v230 — app.js (F8 htmx error handler),
// i18n.js (new keys), app.css (F13 touch targets), sadhana.html (swipeable carousel
// + spacing), calendar/admin/canvas page changes (F9/F10/F12), to-do-list.html
// DELETED (F11). F7 also adds SHELL entries: /reset.html (public auth page was
// missing — offline boot impossible) and /to-do-list (the board's canonical URL —
// offline navigation used to fall through to the dashboard shell).
const VERSION = 'hibana-v232'

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
  '/project.html',
  '/canvas.html',
  '/whiteboard.html',
  '/sadhana.html',
  '/to-do-list',
  '/reset.html',
  '/clients.html',
  '/archive.html',
  '/reports.html',
  '/calendar.html',
  '/notifications.html',
  '/settings.html',
  '/board.html',
  '/sprint.html',
  '/admin.html',
  '/404.html',
  '/partials/nav.html',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/logo-light.png',
  '/logo-dark.png',
  '/vendor/bebas-note/font-face.css',
  '/vendor/bebas-note/BebasNotes-Regular.woff2',
  '/vendor/bebas-note/BebasNotes-Bold.woff2',
  '/vendor/bebas-note/BebasNotes-Light.woff2',
  '/vendor/manrope/font-face.css',
  '/vendor/manrope/Manrope-400.woff2',
  '/vendor/manrope/Manrope-500.woff2',
  '/vendor/manrope/Manrope-600.woff2',
  '/vendor/manrope/Manrope-700.woff2',
  '/vendor/fabric.min.js',
  '/vendor/htmx.min.js',
  '/vendor/alpine.min.js',
  '/vendor/jalaali.min.js',
  '/vendor/vazir/font-face.css',
  // P4.14 (F-M5): Vazir woff2 precache — offline FA users lose the font without these.
  // Only the 3 used weights (Regular/Medium/Bold); Thin/Light/Black are unused.
  '/vendor/vazir/Vazir-Regular.woff2',
  '/vendor/vazir/Vazir-Medium.woff2',
  '/vendor/vazir/Vazir-Bold.woff2',
  '/Login.jpg',
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION)
      // Static shell first — install must survive even if the manifest is unavailable.
      await cache.addAll(SHELL)
      // Manifest-driven precache: the hashed app bundles (app.<hash>.js etc.). Best-effort
      // per file: one missing hash must not kill installation for the whole shell.
      try {
        const res = await fetch('/dist/manifest.json', { cache: 'no-store' })
        if (res.ok) {
          const manifest = await res.json()
          const hashed = Object.values(manifest || {}).filter(
            (v) => typeof v === 'string' && v.startsWith('dist/'),
          )
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
          const copy = res.clone()
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {})
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
