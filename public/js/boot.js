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