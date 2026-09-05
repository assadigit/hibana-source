// Hard-load bootstrap fix: page Alpine components must register BEFORE Alpine scans the tree.
//
// On a full page load Alpine starts the moment its deferred script runs — which happens before
// nav.js (loaded later) drains the page-def queue, so page components were "unknown" on a
// refresh (only soft navigation worked). Alpine fires `alpine:init` during its startup, right
// before it scans the tree, and this script (loaded synchronously, before Alpine) is guaranteed
// to be listening. Draining the queued page defs here registers their Alpine.data components
// in time. Soft-navigation is unaffected (nav.js applies defs and inits the fresh subtree).
//
// Pages must be mounted with the SAME context nav.js provides ({ on() }): every page script
// registers delegated listeners through ctx.on, and without it hard loads threw
// "Cannot read properties of undefined (reading 'on')" mid-mount — silently killing everything
// mounted after the first listener (card menus, drag-and-drop, view switching). The mounted
// page is handed to nav.js via window.__hibanaBoot so a later soft navigation unmounts it
// instead of leaking document listeners into the next page.
//
// Phase 6 item 12 (2026-09-09): paint the user's page-width choice (localStorage
// 'hibana-page-width' — 'standard' | 'full') on <html> BEFORE first render. Synchronous,
// runs in every page's <head>, so the width never flashes from the old per-page default.
try {
  const w = localStorage.getItem('hibana-page-width')
  document.documentElement.dataset.pageWidth = w === 'full' ? 'full' : 'standard'
} catch { /* storage unavailable — the CSS default (standard) applies */ }

// Service Worker update → reload once so the new HTML/JS replaces the stale cached
// version. Without this, a user with an active old SW keeps seeing the old settings.html
// (etc.) even after a deploy — the old SW serves the cached shell, the new SW installs
// in the background but only takes control on the NEXT navigation, and if the tab stays
// open the user is stuck on stale UI. skipWaiting() + clients.claim() make the new SW
// activate immediately, and this listener catches that controllerchange and reloads so
// the fresh shell is what the user sees. Reload fires at most once per SW version (the
// flag is keyed by the SW's script URL, which changes with each hibana-vNNN bump).
//
// 2026-09-09 (aggressive update): also actively poll for SW updates on every page load.
// navigator.serviceWorker.getRegistration().update() forces the browser to re-fetch
// sw.js and compare — if a new SW is found, it installs + activates (skipWaiting +
// clients.claim), which fires controllerchange → the listener above reloads the page.
// This catches the case where the user stays on a long-lived tab and never navigates
// (the old SW would otherwise stay active until the next hard navigation).
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    try {
      const last = sessionStorage.getItem('hibana-sw-reload')
      // Throttle: don't reload more than once per 5s (the event can fire twice on some
      // browsers during a single SW swap). The sessionStorage flag survives the reload.
      if (last && Date.now() - Number(last) < 5000) return
      sessionStorage.setItem('hibana-sw-reload', String(Date.now()))
      location.reload()
    } catch { /* sessionStorage unavailable — reload anyway */ location.reload() }
  })
  // On every page load, force the SW to check for an update. If a new hibana-vNNN is
  // deployed, this triggers install → skipWaiting → activate → clients.claim → the
  // controllerchange listener reloads the page with the fresh shell. The update()
  // call is async + best-effort; a failure must never break the page.
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistration?.().then((reg) => {
      if (reg) reg.update().catch(() => {})
    }).catch(() => {})
  })
}

document.addEventListener('alpine:init', () => {
  const q = window.__hibanaPageQueue || []
  if (!q.length) return
  window.__hibanaPageQueue = []
  for (const def of q) {
    if (!def || typeof def.mount !== 'function') continue
    const listeners = []
    const ctx = {
      on(type, fn, opts) {
        document.addEventListener(type, fn, opts)
        listeners.push([type, fn, opts])
      },
    }
    const customUnmount = def.mount(ctx)
    window.__hibanaBoot = {
      name: def.name,
      unmount() {
        for (const [t, f, o] of listeners) document.removeEventListener(t, f, o)
        listeners.length = 0
        if (typeof customUnmount === 'function') customUnmount()
      },
    }
  }
})