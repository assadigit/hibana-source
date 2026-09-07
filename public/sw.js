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
// Perf session (2026-09-10, docs/perf-and-data-safety.md §2.2): the fetch handler now
// splits strategies by URL class instead of network-first-for-everything:
//   1. versioned app assets (/js/*.js?v=N, /css/*.css?v=N) → CACHE-FIRST. The full URL
//      (including the ?v= query) is the cache key, and this repo's discipline —
//      scripts/check-cache-bust.mjs in CI + a SW SHELL version bump on every public/
//      change — guarantees a cache hit is byte-identical to origin. This removes ~15-25
//      network round-trips from every repeat visit. A hard refresh (req.cache === 'reload')
//      still bypasses the cache for power users.
//   2. vendor libs / fonts / images / webmanifest → STALE-WHILE-REVALIDATE: served
//      instantly from cache, refreshed in the background (their names are unhashed, so
//      they must stay revalidatable).
//   3. navigations → network-first (unchanged: fresh HTML always), offline falls back
//      to the cached shell.
//   4. /api/* → network-only (unchanged), unversioned same-origin assets → network-first
//      (unchanged — the 2026-08-26 stale-pin lesson: never cache-first an unversioned
//      URL whose content can change under the same name).
// Residual risk (documented in the design doc): a JS/CSS change shipped WITHOUT a ?v=
// bump AND without an SW version bump would pin stale for class-1 URLs. That failure
// class is exactly what check-cache-bust + the SHELL-alignment convention guard.

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
  '/js/admin.js?v=1',
  '/css/app.css?v=200',
  '/css/task-controls.css?v=4', // P4.15 (F-L27): precache task-controls.css (3-dot prog-track) — was missing from SHELL
  '/js/devboard.js?v=9',
  '/js/app.js?v=159',
  '/js/touch-drag.js',
  '/js/command-palette.js?v=1',
  '/js/mobile-nav.js?v=4',
  '/js/zen-mode.js',
  '/js/micro-interactions.js',
  '/js/jalali-holidays.js',
  '/js/go-to.js',
  '/js/install-prompt.js?v=1',
  '/js/tour.js?v=2',
  '/js/boot.js?v=3',
  '/js/queue.js',
  '/js/nav.js',
  '/js/emoji-data.js?v=1',
  '/js/emoji-picker.js?v=1',
  '/js/i18n.js?v=31',
  '/js/whiteboard.js?v=8',
  '/js/canvas.js?v=13',
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
  e.waitUntil(caches.open('hibana-v227').then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => keys.filter((k) => k !== 'hibana-v227').map((k) => caches.delete(k))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || !req.url.startsWith('http')) return
  // Cross-origin requests pass through untouched (see header note): only same-origin
  // assets/navigations/API get the network-first + offline-cache treatment below.
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
          caches.open('hibana-v227').then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
    )
    return
  }

  // Assets: strategy split by URL class (perf session 2026-09-10 — see header).
  const url = new URL(req.url)

  // Class 1 — versioned app assets (/js/x.js?v=N, /css/x.css?v=N): cache-first. The
  // ?v= query is part of the cache key and changes whenever content changes, so a hit
  // is always current. Hard refresh (req.cache === 'reload') still goes to network.
  const versioned = /^\/(js|css)\//.test(url.pathname) && /^\?v=\d+$/.test(url.search)
  if (versioned) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit && req.cache !== 'reload') return hit
        const res = await fetch(req)
        if (res.ok) {
          const copy = res.clone()
          caches.open('hibana-v227').then((c) => c.put(req, copy)).catch(() => {})
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
              caches.open('hibana-v227').then((c) => c.put(req, copy)).catch(() => {})
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
          caches.open('hibana-v227').then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
  )
})