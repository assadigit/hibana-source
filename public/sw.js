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
  '/css/app.css?v=192',
  '/css/task-controls.css?v=4', // P4.15 (F-L27): precache task-controls.css (3-dot prog-track) — was missing from SHELL
  '/js/devboard.js?v=9',
  '/js/app.js?v=159',
  '/js/touch-drag.js',
  '/js/command-palette.js',
  '/js/mobile-nav.js?v=4',
  '/js/zen-mode.js',
  '/js/micro-interactions.js',
  '/js/jalali-holidays.js',
  '/js/go-to.js',
  '/js/install-prompt.js',
  '/js/tour.js?v=2',
  '/js/boot.js',
  '/js/queue.js',
  '/js/nav.js',
  '/js/emoji-data.js?v=1',
  '/js/emoji-picker.js?v=1',
  '/js/i18n.js?v=27',
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
  e.waitUntil(caches.open('hibana-v213').then((c) => c.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => keys.filter((k) => k !== 'hibana-v213').map((k) => caches.delete(k))),
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
          caches.open('hibana-v213').then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
    )
    return
  }

  // Assets: network-first with cache fallback (2026-08-26). Cache-first kept pinning old
  // CSS/JS after deploys — a hard refresh doesn't bypass the SW, so users stayed on stale
  // styles. Network-first lands every deploy on the next load; offline still gets the shell.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open('hibana-v213').then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('/dashboard.html'))),
  )
})