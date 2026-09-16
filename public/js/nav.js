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

  // --- Alpine auto-init pause (P0, review round 2) ------------------------------
  // Depth-based wrapper around Alpine's mutation observer. nav.js pauses it across the
  // shell swap → page-script-load → initTree window (see the long comment in load());
  // depth counting keeps overlapping/superseded navigations from resuming the observer
  // while a newer navigation is still inside its own paused window.
  let alpinePauseDepth = 0
  const pauseAlpine = () => {
    if (++alpinePauseDepth === 1) window.Alpine?.stopObservingMutations()
  }
  const resumeAlpine = () => {
    if (alpinePauseDepth === 0) return
    if (--alpinePauseDepth === 0) window.Alpine?.startObservingMutations()
  }

  // --- navigation ---------------------------------------------------------------
  function go(path, opts = {}) {
    let url
    try { url = new URL(path, location.href) } catch { return }
    if (url.origin !== location.origin) { location.href = url.href; return }
    if (HARD_PAGES.has(url.pathname)) { location.href = url.href; return } // full load
    // S44: ?-only changes (projects.html?status=… from the glance strip, the language
    // toggle's reload()) are NOT skipped anymore — the same-page re-entry path below
    // re-mounts the page, so a query change is a real navigation. Only a byte-identical
    // URL is a no-op.
    if (opts.sameSkip !== false && url.pathname === location.pathname && url.search === location.search) return
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
      // P0 fix (2026-09-12, review round 2) — Alpine auto-init race on the swapped shell:
      // Alpine's own MutationObserver initializes any x-data element the moment it lands in
      // the DOM. The fresh <main> below can contain x-data components (reports, settings)
      // whose Alpine.data registration happens when the page script loads — INSIDE the
      // await below. Without pausing the observer it walked the tree first, every x-data
      // expression died ("report is not defined" etc.), the x-if/x-show effects were never
      // registered, and nav.js's later initTree skipped the now-processed element — the
      // component stayed half-dead for the rest of the visit (soft-nav twin of the
      // hard-load defer-order bug; only literal x-data="{…}" pages were immune).
      // Pause observation for the whole swap → script-load → initTree window; restart after.
      pauseAlpine()
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
      // S44: SAME-PAGE RE-ENTRY — navigating projects.html → projects.html?status=…
      // (glance strip, language toggle, popstate) skipped the page's own script above
      // ("already present"), so the fresh shell never got a mount: the URL changed but
      // the content stayed the default grid. The page-def scripts follow the
      // /js/<name>-page.js convention — re-EXECUTE those even when present (a fresh
      // <script> element always runs) so the new shell mounts. Shared scripts (app.js,
      // alpine, nav.js itself…) stay missing-only — re-running those would be catastrophic.
      const reexec = []
      // Matches BOTH script shapes: source (/js/projects-page.js) and the content-hashed
      // dist build (/dist/projects-page.72191d7a.js). NOTE: no leading "/" — the marker
      // is the FILENAME's "-page" tail (…/projects-page.js), not a path segment.
      const pageScriptRe = /-page(\.[0-9a-f]+)?\.js$/
      for (const s of doc.querySelectorAll('script[src]')) {
        if (s.type && s.type !== 'text/javascript') continue
        const raw = s.getAttribute('src')
        if (!raw) continue
        const url = new URL(raw, location.href).href
        if (existing.has(url)) {
          if (pageScriptRe.test(new URL(url, location.href).pathname)) reexec.push(url)
          continue
        }
        existing.add(url)
        missing.push(url)
      }
      const loadScript = (url) => new Promise((resolve) => {
        const el = document.createElement('script')
        el.src = url
        el.async = false // preserve document order among the batch
        el.onload = resolve
        el.onerror = () => { console.warn('hibana nav: script failed:', url); resolve() }
        document.head.appendChild(el)
      })
      const batch = [...missing, ...reexec]
      if (batch.length) {
        await Promise.all(batch.map(loadScript))
        if (seq !== navSeq) { resumeAlpine(); return } // a newer navigation superseded this one
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

      // htmx + Alpine take over the fresh subtree. Alpine's own tree walk initializes
      // x-data components NOW (registration completed above); the auto-observer resumes
      // right after, so any mutation from here on (htmx swaps, x-if template inserts)
      // behaves exactly as on a hard load.
      if (window.htmx?.process) window.htmx.process(fresh)
      if (window.Alpine?.initTree) window.Alpine.initTree(fresh)
      resumeAlpine()
      markNav(url.pathname)
      hideNavLoader()
    } catch (err) {
      // Any parse/fetch failure → standard full navigation. The observer restart is
      // belt-and-suspenders: the reload tears this document down anyway.
      console.warn('soft navigation failed, reloading:', err)
      hideNavLoader()
      resumeAlpine()
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
    // S59: the mobile bottom bar goes stale without this — it was built once at page
    // load and never re-marked on soft navigation (the bug: notes → projects kept
    // "Notes" lit). Secondary pages also light up the More tab via the same call.
    window.hibanaMobileNav?.mark(pathname)
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
  // data-nav-local (S44): a page-owned control — the navigator stands down and lets the
  // page's own click handler run (projects.html's glance strip filters the list in
  // place; sparks' kanban/sticky ⋯ menus open instead of navigating the card).
  const isBoardOrigin = /^\/(canvas|whiteboard)\.html/.test(location.pathname)
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('[data-nav-local]')) return
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
  // The data-nav-local check comes FIRST: a page-owned control (a ⋯ menu button) inside
  // a navigable card must not drag the card into navigation.
  document.addEventListener(
    'click',
    (e) => {
      if (e.target.closest?.('[data-nav-local]')) return
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