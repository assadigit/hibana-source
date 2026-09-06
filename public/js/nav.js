// Hibana client-side navigation ("everything ajax" — spec decision: single origin, no refresh).
// Intercepts internal links and swaps ONLY <main class="shell">. The topbar nav, theme,
// quick-add dialog, toasts and the offline badge stay mounted; pages register a
// mount/unmount pair through __hibanaPage so soft navigation never leaks listeners.
//
// Pages whose bootstrap lives in <head> scripts (Fabric boards) or that have no shell
// (auth pages) keep full-page loads.
(() => {
  const QUEUE_KEY = '__hibanaPageQueue'
  const HARD_PAGES = new Set(['/canvas.html', '/whiteboard.html', '/login.html', '/reset.html', '/sadhana.html', '/to-do-list'])

  let active = null // { name, unmount } — the page currently mounted
  let navSeq = 0 // monotonically increasing — lets a newer nav win an in-flight one

  // --- mount registry -----------------------------------------------------------
  // Inline page scripts call window.__hibanaPage({ name, mount }). On initial full load
  // nav.js runs after them (deferred), so a queue stub collects defs until init drains them.
  const stub = (def) => (window[QUEUE_KEY] = window[QUEUE_KEY] || []).push(def)
  window.__hibanaPage = window.__hibanaPage || stub

  const applyDef = (def) => {
    if (!def || typeof def.mount !== 'function') return
    // A page mounted by boot.js on the hard load (before nav.js ran) must be unmounted
    // before the next page mounts — its document listeners would otherwise leak.
    if (window.__hibanaBoot) {
      window.__hibanaBoot.unmount()
      window.__hibanaBoot = null
    }
    if (active) active.unmount() // any previous page (incl. re-entering the same one)
    const listeners = []
    const ctx = {
      // Document-level listener that is auto-removed when the page unmounts.
      on(type, fn, opts) {
        document.addEventListener(type, fn, opts)
        listeners.push([type, fn, opts])
      },
    }
    const customUnmount = def.mount(ctx)
    active = {
      name: def.name,
      unmount() {
        for (const [t, f, o] of listeners) document.removeEventListener(t, f, o)
        listeners.length = 0
        if (typeof customUnmount === 'function') customUnmount()
        if (typeof def.unmount === 'function') def.unmount()
      },
    }
  }
  window.__hibanaPage = applyDef
  for (const def of window[QUEUE_KEY] || []) applyDef(def)
  window[QUEUE_KEY] = []

  // --- navigation ---------------------------------------------------------------
  function go(path, opts = {}) {
    let url
    try { url = new URL(path, location.href) } catch { return }
    if (url.origin !== location.origin) { location.href = url.href; return }
    if (HARD_PAGES.has(url.pathname)) { location.href = url.href; return }
    if (opts.sameSkip !== false && url.pathname + url.search === location.pathname + location.search) return
    load(url, opts.push !== false)
  }

  async function load(url, push) {
    const seq = ++navSeq
    // 2026-09-09 (user request): minimal + modern animated page-transition loader. Shows
    // a thin top progress bar the moment a soft-navigation fetch starts, hides it once the
    // new shell is swapped in. The bar is a fixed-position element at the very top of the
    // viewport (z above the topbar but below toasts/dialogs), a 2px teal line that grows
    // from 0→80% in 400ms then completes on swap. Pure CSS animation; no deps.
    showNavLoader()
    try {
      // Network-first page fetch (the service worker routes X-Hibana-Nav network-first so
      // shell HTML is never stale; htmx fragments inside are network-first already).
      const res = await fetch(url.href, { credentials: 'same-origin', headers: { 'X-Hibana-Nav': '1' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const html = await res.text()
      if (seq !== navSeq) return // a newer navigation superseded this one
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const nextShell = doc.querySelector('main.shell')
      const shell = document.querySelector('main.shell')
      if (!nextShell || !shell) throw new Error('no main.shell')

      if (active) { active.unmount(); active = null }
      // Replace the <main> element outright instead of reusing it: htmx skips already-processed
      // nodes, so reusing the old element means its hx-trigger="load" never re-fires and the
      // dashboard (hx-get on <main> itself) would strand on its loading state after any soft
      // navigation or reload. The fetched element is adopted into this document and swapped in.
      const fresh = document.adoptNode(nextShell)
      shell.replaceWith(fresh)
      document.title = doc.title || document.title
      if (push) history.pushState({ hibana: url.href }, '', url.href)
      else history.replaceState({ hibana: url.href }, '', url.href)
      window.scrollTo({ top: 0 })

      window.hibanaI18n?.apply()

      // The target page may depend on external scripts this document doesn't carry yet
      // (e.g. board/sprint pages need /js/devboard.js + jalaali, which project.html
      // never loads). Bring over any missing <script src> in document order and WAIT
      // for them — the inline page scripts below reference those globals at boot
      // (window.HibanaBoard undefined otherwise left sprint.html stuck on "Loading…").
      const existing = new Set(
        Array.from(document.querySelectorAll('script[src]')).map((s) =>
          new URL(s.getAttribute('src') || s.src, location.href).href),
      )
      const missing = []
      for (const s of doc.querySelectorAll('script[src]')) {
        if (s.type && s.type !== 'text/javascript') continue
        const raw = s.getAttribute('src')
        if (!raw) continue
        const url = new URL(raw, location.href).href
        if (existing.has(url)) continue
        existing.add(url)
        missing.push(url)
      }
      if (missing.length) {
        await Promise.all(missing.map((url) => new Promise((resolve) => {
          const el = document.createElement('script')
          el.src = url
          el.async = false // preserve document order among the batch
          el.onload = resolve
          el.onerror = () => { console.warn('hibana nav: script failed:', url); resolve() }
          document.head.appendChild(el)
        })))
        if (seq !== navSeq) return // a newer navigation superseded this one
      }

      // Run the fetched page's inline scripts. adoptNode doesn't auto-execute inline
      // scripts (they were already "executed" in the source document's context during
      // DOMParser parse — but that context is detached and they didn't actually run).
      // M4 fix (2026-09-10): replaced `new Function(s.textContent)()` with the standard
      // script-element re-injection pattern — create a new <script> element, set its
      // textContent, and append it. This is functionally identical (the browser executes
      // it in the same global scope) but avoids the eval-equivalent `new Function` path,
      // so CSP 'unsafe-eval' is no longer required for THIS code path (Alpine still needs
      // it for x-data expressions). The scripts self-register through __hibanaPage →
      // applyDef above.
      for (const s of doc.querySelectorAll('script:not([src])')) {
        if (s.type && s.type !== 'text/javascript') continue
        try {
          const runner = document.createElement('script')
          runner.textContent = s.textContent
          document.head.appendChild(runner)
          runner.remove() // clean up the now-executed element
        } catch (err) { console.error('hibana page script:', err) }
      }

      // htmx + Alpine take over the fresh subtree.
      if (window.htmx?.process) window.htmx.process(fresh)
      if (window.Alpine?.initTree) window.Alpine.initTree(fresh)
      markNav(url.pathname)
      hideNavLoader()
    } catch (err) {
      // Any parse/fetch failure → standard full navigation.
      console.warn('soft navigation failed, reloading:', err)
      hideNavLoader()
      location.href = url.href
    }
  }

  // --- page-transition loader (2026-09-09) -----------------------------------
  // A thin top progress bar: shows the moment a soft-nav fetch starts, completes + fades
  // once the new shell is swapped in. Two states: .is-loading (bar grows 0→80% over 400ms)
  // and .is-done (bar completes to 100% + fades out over 300ms). The element is reused
  // across navigations; a fast back-to-back nav just re-triggers .is-loading.
  let navLoaderEl = null
  let navLoaderTimer = null
  const showNavLoader = () => {
    if (!navLoaderEl) {
      navLoaderEl = document.createElement('div')
      navLoaderEl.id = 'hibana-nav-loader'
      navLoaderEl.setAttribute('aria-hidden', 'true')
      document.body.appendChild(navLoaderEl)
    }
    clearTimeout(navLoaderTimer)
    navLoaderEl.className = 'is-loading'
    // Force a reflow so the transition restarts on a rapid re-trigger.
    void navLoaderEl.offsetWidth
  }
  const hideNavLoader = () => {
    if (!navLoaderEl) return
    navLoaderEl.className = 'is-done'
    // Remove the done state after the fade so the next nav can re-trigger cleanly.
    clearTimeout(navLoaderTimer)
    navLoaderTimer = setTimeout(() => { if (navLoaderEl) navLoaderEl.className = '' }, 400)
  }

  function markNav(pathname) {
    // The five page links live inside .nav-links (a display:contents wrapper on desktop,
    // its own flex row at ≤720px); the avatar-menu items are also inside .topbar and
    // their underline style shouldn't apply there.
    document.querySelectorAll('.topbar .nav-links a').forEach((a) => {
      const href = a.getAttribute('href') || ''
      if (href === pathname) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
  }

  // htmx-fetched fragments can contain Alpine components (dashboard notebook, reports, …).
  // htmx dispatches both the legacy `htmx:`-prefixed and the new unprefixed event names.
  for (const name of ['htmx:afterSwap', 'afterSwap']) {
    document.addEventListener(name, (e) => {
      if (!window.Alpine?.initTree) return
      const root = e.detail?.elt || e.detail?.target || e.target || document.body
      if (root && root.nodeType === 1) window.Alpine.initTree(root) // skips already-inited trees
    })
  }

  // Back/forward: refetch and swap without pushing history.
  window.addEventListener('popstate', () => {
    const url = new URL(location.href)
    if (HARD_PAGES.has(url.pathname)) { location.reload(); return }
    load(url, false)
  })

  // --- interception -------------------------------------------------------------
  // Boards (canvas/notebook) keep their full-page lifecycle — no soft-nav from them.
  const isBoardOrigin = /^\/(canvas|whiteboard)\.html/.test(location.pathname)
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest('a[href]')
      if (!a || a.href?.startsWith('javascript:')) return
      if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-ajax-off')) return
      // htmx-bound anchors are handled by htmx, not the navigator.
      if (['hx-get', 'hx-post', 'hx-patch', 'hx-delete', 'hx-put'].some((h) => a.hasAttribute(h))) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return
      const href = a.getAttribute('href') || ''
      if (!href.startsWith('/')) return
      if (isBoardOrigin) return
      e.preventDefault()
      e.stopPropagation()
      go(href)
    },
    true,
  )

  // Server-rendered clickable cards (kanban / sticky notes) with navigation semantics.
  document.addEventListener(
    'click',
    (e) => {
      const card = e.target.closest('[data-nav-url]')
      if (!card || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      e.preventDefault()
      e.stopPropagation()
      go(card.getAttribute('data-nav-url'))
    },
    true,
  )

  window.hibanaNav = {
    go,
    // Re-fetch the current URL in place (used by the language toggle: server fragments
    // re-render in the new language without a hard reload).
    reload: () => load(new URL(location.href), false),
  }
})()