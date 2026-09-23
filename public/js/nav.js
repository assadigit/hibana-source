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
    // S64: hash-only changes count as real navigations too. go() previously compared
    // pathname+search only, so a palette deep link like /app#note-<id>&q=… fired FROM
    // /app was silently dropped — the click did nothing at all (the same drop hit the
    // vault's #n= deep link when the palette opened ON /notes.html, and canvas anchors
    // from the canvas page). A different hash now re-mounts the page, whose boot reads
    // the fresh hash — the universal fix, no per-page hashchange listeners needed.
    if (opts.sameSkip !== false && url.pathname === location.pathname && url.search === location.search && url.hash === location.hash) return
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
      // S70: close any open <dialog> before the swap. Page modals (quick-add, note
      // reader, task editor, the palette, …) are appended to <body> OUTSIDE <main>, so
      // the shell swap never touches them — navigating away with one open left it
      // floating over the new page, blocking clicks (verified live: quick-add open →
      // topbar Projects → projects page rendered UNDER the still-open dialog).
      // EXCEPTION — hash-only re-entries (same pathname + search, only the fragment
      // changed): the S64 design deliberately re-mounts the page so its boot can act on
      // the fresh hash, and the whole POINT of that flow is the deep-link handler itself
      // OPENING a dialog (e.g. /app#note-<id> beyond the widget cap → the archive).
      // The popstate-driven load() races that open — closing dialogs here would kill
      // the dialog the hash just opened (caught by the S65 archive e2e). A hash-only
      // re-entry is the SAME page: keep its live modal state, exactly as pre-S70.
      const samePage = location.pathname === url.pathname && location.search === url.search
      if (!samePage) {
        for (const dlg of document.querySelectorAll('dialog[open]')) {
          try { dlg.close() } catch { /* non-modal open() — remove the attribute directly */ dlg.removeAttribute('open') }
        }
      }
      // Replace the <main> element outright instead of reusing it: htmx skips already-processed
      // nodes, so reusing the old element means its hx-trigger="load" never re-fires and the
      // dashboard (hx-get on <main> itself) would strand on its loading state after any soft
      // navigation or reload. The fetched element is adopted into this document and swapped in.
      const fresh = document.adoptNode(nextShell)
      shell.replaceWith(fresh)
      document.title = doc.title || document.title
      if (push) history.pushState({ hibana: url.href }, '', url.href)
      else history.replaceState({ hibana: url.href }, '', url.href)
      // S95 (the rail tree's deep links): a soft navigation carrying a SECTION
      // anchor lands ON that section instead of the page top. Targets rendered
      // in the shell scroll on the next frame; targets swept in later by htmx
      // (the project page's #pd-board arrives with its #project-body fetch)
      // are watched for — a short-lived observer scrolls the moment the anchor
      // appears and is VISIBLE. Hashes naming no element (the S64 dialog
      // vocabulary #note-<id>, #n=<id> — each page's boot owns those) keep the
      // top-scroll; hidden targets (the project page's tab panels) are skipped
      // here — that page's own hash boot un-hides + scrolls them.
      if (url.hash) {
        const anchorId = decodeURIComponent(url.hash.slice(1))
        const el = document.getElementById(anchorId)
        if (el && !el.hidden) {
          requestAnimationFrame(() => { if (el.isConnected) el.scrollIntoView() })
        } else if (!el) {
          let mo = null
          const stop = () => { clearTimeout(timer); if (mo) mo.disconnect() }
          const timer = setTimeout(stop, 4000)
          mo = new MutationObserver(() => {
            const found = document.getElementById(anchorId)
            if (found && !found.hidden && found.isConnected) {
              stop()
              requestAnimationFrame(() => { if (found.isConnected) found.scrollIntoView() })
            }
          })
          mo.observe(document.body, { childList: true, subtree: true })
        } else {
          window.scrollTo({ top: 0 })
        }
      } else {
        window.scrollTo({ top: 0 })
      }

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
      // S95 r2 (owner item 9): a panel remembered by an icon-rail navigation (e.g.
      // Projects clicked from the Notes module) opens now that the destination has
      // landed — unless the destination is itself a module-sidebar page.
      if (pendingPanelOnNav) {
        const section = pendingPanelOnNav
        pendingPanelOnNav = null
        if (!MODULE_SIDEBAR_PAGES.has(url.pathname)) openRailPanel(section)
      }
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

  // S95 r2 (owner item 9): MODULE-SIDEBAR pages — a page that carries its own
  // list-sidebar (the Notes vault's 3-pane tree|list|editor) collapses the PRIMARY
  // rail to an icon-only rail, so the same navigation hierarchy is never rendered
  // twice at full width (the Notion/Obsidian/VS Code pattern: exactly ONE sidebar
  // shows labels at a time). Navigating to a page without its own sidebar restores
  // the labeled rail. The class drives layout.css (labels hidden, --rail-w 4rem —
  // the same anatomy the short-viewport collapse uses) and suppresses the rail
  // PANEL on these pages (no second column beside the module's own sidebars).
  const MODULE_SIDEBAR_PAGES = new Set(['/notes.html', '/notes'])
  function syncRailIconMode(pathname) {
    const on = MODULE_SIDEBAR_PAGES.has(pathname)
    document.body.classList.toggle('rail-icons-only', on)
    if (on && railSection) closeRailPanel()
  }

  function markNav(pathname) {
    // S88: the RAIL's primary icons are the desktop nav (the old .topbar .nav-links
    // is retired — the selector stays for any straggler surface). /app IS the
    // dashboard; a project detail page lights the Projects icon (the section you're
    // inside), sadhana.html lights To-do. The filled rounded-square indicator rides
    // aria-current (layout.css).
    const railNorm = (p) => {
      if (p === '/app') return '/dashboard.html'
      if (p === '/project.html' || p === '/project') return '/projects.html'
      if (p === '/sadhana.html') return '/to-do-list'
      return p
    }
    document.querySelectorAll('.rail .rail-primary a').forEach((a) => {
      const href = a.getAttribute('href') || ''
      if (railNorm(href) === railNorm(pathname)) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    document.querySelectorAll('.topbar .nav-links a').forEach((a) => {
      const href = a.getAttribute('href') || ''
      if (href === pathname) a.setAttribute('aria-current', 'page')
      else a.removeAttribute('aria-current')
    })
    // S59: the mobile bottom bar goes stale without this — it was built once at page
    // load and never re-marked on soft navigation (the bug: notes → projects kept
    // "Notes" lit). Secondary pages also light up the More tab via the same call.
    window.hibanaMobileNav?.mark(pathname)
    syncRailIconMode(pathname) // S95 r2 item 9: the icon-rail follows the page
    markRailRows()
  }

  // S95 (the "never lose your place" job): rows in the open rail panel carry a
  // current-location marker. The panel DOM persists across soft navigations (the
  // e2e contract: a row click navigates and the panel stays open), so this runs
  // from markNav on EVERY navigation + after each panel render. Rule: a row
  // WITHOUT a hash (the project/spark/note identity row) lights while you're on
  // that page; a row WITH a hash (a tree leaf deep-linked to a section) lights
  // only when the current hash is exactly that section — landing via «Problems»
  // lights the project row AND its problems leaf, landing at the page top lights
  // only the project row.
  function markRailRows() {
    const box = railBox()
    if (!box) return
    let here
    try { here = new URL(location.href) } catch { return }
    const idOf = (u) => u.searchParams.get('id')
    box.querySelectorAll('.rail-item[href]').forEach((a) => {
      let row
      try { row = new URL(a.href) } catch { return }
      const sameDoc = row.pathname === here.pathname &&
        (idOf(row) || null) === (idOf(here) || null)
      const active = sameDoc && (!row.hash || row.hash === here.hash)
      a.classList.toggle('is-row-active', active)
    })
    // S115 r2: a project BRANCH carries the current-location mark too — its identity
    // is the goto chip's href (the head is a toggle, not a link), so markRailRows
    // walks the branch's chip and tints the headrow (.is-here in layout.css) while
    // the owner sits on that project's page.
    box.querySelectorAll('.rail-project-group[data-project-branch]').forEach((g) => {
      const chip = g.querySelector('.rail-group-goto')
      if (!chip) return
      let row
      try { row = new URL(chip.href) } catch { return }
      g.classList.toggle('is-here', row.pathname === here.pathname &&
        (idOf(row) || null) === (idOf(here) || null))
    })
  }

  // --- S88: the navigation rail's SECONDARY PANEL (VS Code Activity Bar + Side Bar) --
  // Selecting a rail icon opens a panel DIRECTLY to its right: a list of that
  // section's items under labeled, COLLAPSIBLE group headers. The rail stays visible
  // (switching icons swaps the panel's section, never hiding the rail), and the panel
  // is PERSISTENT — body padding pushes the main content (rail-panel-open), never an
  // overlay. Clicking the open section's icon again (or the panel's ✕, or Escape)
  // closes it. The open section survives page loads (localStorage) — "persistent".
  // Data: ONE GET /api/rail (projects/sparks/folders/notes/todos, user-scoped,
  // no-store) feeds every section; the Dashboard section reads the resume store
  // (hibana-resume, client-side) instead.
  const RAIL_PANEL_KEY = 'hibana-rail-panel'
  // S117 (two jobs, #1 — never lose an idea): the quick-add DRAFT survives the
  // panel's constant re-renders AND a full page navigation — including the
  // navigator icons' own go() (To-do/Projects/Ideas/Calendar all navigate with
  // the panel open) and the 401 login bounce with its ?next round-trip. A
  // half-typed idea no longer dies because the user moved. sessionStorage
  // (per-tab, like the draft itself) holds {q, text}; Escape stays the DELIBERATE
  // discard, a successful submit clears it, a failed POST keeps it.
  const RAIL_ADD_DRAFT_KEY = 'hibana-rail-add-draft'
  const railAddDraftRead = () => {
    try {
      const raw = sessionStorage.getItem(RAIL_ADD_DRAFT_KEY)
      if (!raw) return null
      const v = JSON.parse(raw)
      return v && typeof v === 'object' && typeof v.text === 'string' ? v : null
    } catch { return null }
  }
  const railAddDraftWrite = (q, text) => {
    try {
      const t = String(text || '')
      if (!t.trim()) sessionStorage.removeItem(RAIL_ADD_DRAFT_KEY)
      else sessionStorage.setItem(RAIL_ADD_DRAFT_KEY, JSON.stringify({ q: Number(q) || 0, text: t }))
    } catch { /* storage unavailable — the draft just lives in the input */ }
  }
  const railAddDraftClear = () => {
    try { sessionStorage.removeItem(RAIL_ADD_DRAFT_KEY) } catch { /* storage unavailable */ }
  }
  const railBox = () => document.querySelector('[data-rail-panel-box]')
  const railT = (k, fb) => { const v = window.hibanaI18n?.t(k); return v && v !== k ? v : fb }
  const escHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
  // S90 (owner request): the group-head COUNT digits follow the UI script — Farsi
  // digits when the interface is fa (the same "digits match the script" rule the
  // reports page + whiteboard already follow; Latin digits in a Farsi panel read
  // as noise). Evaluates per render, so a language toggle re-renders honestly.
  const railFaDig = (s) => ((window.hibanaI18n?.lang?.() || 'en') === 'fa'
    ? String(s).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x])
    : String(s))

  const RAIL_SECTIONS = {
    todo: { href: '/to-do-list', i18n: 'nav.sadhana', label: 'To-do list' },
    projects: { href: '/projects.html', i18n: 'nav.projects', label: 'Projects' },
    sparks: { href: '/sparks.html', i18n: 'nav.sparks', label: 'Ideas' },
    notes: { href: '/notes.html', i18n: 'nav.notes', label: 'Notes' },
    calendar: { href: '/calendar.html', i18n: 'nav.calendar', label: 'Calendar' },
    // S93 (owner round, items 2 + 14): the DASHBOARD panel section is RETIRED — its rail
    // icon is pure navigation now (clicking Dashboard must SHOW the dashboard), and the
    // "Jump to" link list the owner rejected went with it. A stale persisted
    // 'hibana-rail-panel' = 'dashboard' simply fails this lookup and is ignored.
    // S89: canvas + notebook LEFT THE RAIL (redundant beside Notes — the account
    // menu links them now). Their panel sections are retired too.
  }
  const RAIL_DONE = new Set(['operational'])
  // S93 (owner round, item 14): the projects panel lists projects UNDER THEIR STAGE —
  // the owner's sketch ("-planning / item one / item two / -queued / …"). The 0060
  // taxonomy: planning → queued → developing → awaiting_dev, operational collapsed at
  // the end. Empty stages stay hidden (nothing to show, nothing to tap).
  const RAIL_STAGE_GROUPS = [
    { key: 'planning', i18n: 'status.planning', label: 'Planning', collapsed: false },
    { key: 'queued', i18n: 'status.queued', label: 'Queued', collapsed: false },
    { key: 'developing', i18n: 'status.developing', label: 'Developing', collapsed: false },
    { key: 'awaiting_dev', i18n: 'status.awaiting_dev', label: 'Awaiting Development', collapsed: false },
    { key: 'operational', i18n: 'status.operational', label: 'Operational', collapsed: true },
  ]

  let railSection = null
  let railData = null
  let railFetch = null

  const loadRailData = () => {
    if (railData) return Promise.resolve(railData)
    if (!railFetch) {
      railFetch = fetch('/api/rail', { credentials: 'same-origin' }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      }).then((d) => { railData = d; railFetch = null; return d })
        .catch((e) => { railFetch = null; throw e })
    }
    return railFetch
  }

  // --- S116: the re-render keeps your place --------------------------------------
  // Every panel RE-RENDER (a fresh /api/rail read, the Undo path, a quick-add
  // landing, the calendar's month step) rebuilds the body — and used to fold every
  // group back to its shipped default, so an expanded project branch collapsed
  // under the owner's cursor. The collapse states are now HARVESTED before each
  // body swap and RE-APPLIED after (keyed by the branch's project id for project
  // groups, the head's label text for stages/aspects/folders). Groups that are NEW
  // since the last render (a first In-Progress task grows its aspect group) render
  // at their defaults; the S97 fold button re-syncs after each restore. The states
  // live as long as the document does — reopening the panel keeps the tree the
  // owner left (the box only hides), while a hard reload starts fresh (they are
  // interaction state, not a preference — the S97 button stays the explicit boss).
  const railGroupKey = (g) =>
    g.getAttribute('data-project-branch') ||
    g.querySelector('.rail-group-head span:not(.rail-group-count)')?.textContent?.trim() ||
    ''
  const railHarvestGroups = () => {
    const box = railBox()
    const m = new Map()
    if (box) box.querySelectorAll('.rail-group').forEach((g) => {
      const k = railGroupKey(g)
      if (k) m.set(k, g.classList.contains('is-collapsed'))
    })
    return m
  }
  const railRestoreGroups = (prev) => {
    const box = railBox()
    if (!box || !prev || !prev.size) return
    box.querySelectorAll('.rail-group').forEach((g) => {
      const was = prev.get(railGroupKey(g))
      if (was === undefined) return
      g.classList.toggle('is-collapsed', was)
      const head = g.querySelector('.rail-group-head')
      if (head) head.setAttribute('aria-expanded', String(!was))
    })
    syncRailTreeBtn() // S97: the restored tree may complete/clear a full fold
  }

  // one grouped list section: label + count + collapsible body of .rail-item rows.
  // S93 (item 6): opts.accent tints the head with the quadrant's picked pastel (a
  // 12% wash + a colored lead dot — the same token the board quadrant renders).
  // S95 r2 (owner item 2): the disclosure chevron points DOWN in its collapsed
  // state ("open me — the content lives below"); the expanded state rotates it
  // upright via layout.css. The old right-pointing glyph read as pointing "top"
  // when the collapsed rotation tipped it up.
  const railGroup = (label, items, opts = {}) => {
    const count = Array.isArray(items) ? items.length : 0
    if (!count && opts.hideWhenEmpty !== false) return ''
    const open = opts.collapsed ? '' : ' open-group'
    const accentAttr = opts.accent ? ' style="--ga: var(--' + escHtml(opts.accent) + ')"' : ''
    const dot = opts.accent ? '<span class="rail-group-dot" style="--sw: var(--' + escHtml(opts.accent) + ')" aria-hidden="true"></span>' : ''
    const head =
      '<button type="button" class="rail-group-head" data-rail-group aria-expanded="' + (opts.collapsed ? 'false' : 'true') + '">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      dot +
      '<span>' + escHtml(label) + '</span>' +
      '<span class="rail-group-count">' + railFaDig(count) + '</span>' +
      '</button>'
    // S98 (the goto chips): a group carrying opts.href rides its head inside a
    // FLEX ROW — the toggle button (flex:1, its contract untouched) + the chip
    // as its SIBLING <a> (an anchor can never nest inside a <button>). The chip
    // is the .rail-panel-close recipe (quiet 2rem icon, muted ink, bg-soft
    // hover, brand focus ring) and lands the deep link on the exact target via
    // the S97 arrival system. href-less groups keep the exact FLAT markup —
    // the other panels' DOM is untouched (zero churn).
    const inner = opts.href
      ? '<div class="rail-group-headrow">' + head +
        '<a class="rail-group-goto" href="' + escHtml(opts.href) + '"' +
        ' aria-label="' + escHtml(railT('rail.openOnBoard', 'Open on the board')) + '"' +
        ' title="' + escHtml(railT('rail.openOnBoard', 'Open on the board')) + '">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></a></div>'
      : head
    return '<div class="rail-group' + (opts.collapsed ? ' is-collapsed' : '') + '"' + accentAttr + '>' +
      inner + '<div class="rail-group-body">' + (Array.isArray(items) ? items.join('') : items) + '</div></div>'
  }
  // S106 r2 (owner: "I still see regular font for project names in sidebar"): the
  // optional cls param lets a caller tag its rows — projectBranch marks the
  // tree's PROJECT rows .rail-project-row so layout.css can give them the 700
  // bold register WITHOUT touching the other panels' items (sparks, notes,
  // calendar, todos) or the sub-group's idea/bug leaves (content stays 400,
  // the S106 hierarchy contract).
  const railItem = (href, label, dotStatus, extra, badge, cls) =>
    '<a class="rail-item' + (cls ? ' ' + cls : '') + '" href="' + href + '">' +
    (dotStatus ? '<span class="rail-dot" data-status="' + escHtml(dotStatus) + '"></span>' : '') +
    (extra || '') +
    '<span class="rail-item-label" dir="auto">' + escHtml(label) + '</span>' +
    (badge || '') + '</a>'

  // S93 (owner round, item 1 — "so user can directly tick them"): a to-do row is a
  // CHECKBOX + title, not a link. Ticking POSTs /complete (un-ticking /uncomplete) —
  // the same endpoints the dashboard's rows use — and the row strikes through + sinks
  // to its group's end without a panel re-render (collapse states survive).
  const railTodoItem = (t) =>
    '<label class="rail-item rail-todo-item' + (t.done ? ' is-done' : '') + '">' +
    '<input type="checkbox" class="rail-check" data-rail-todo="' + escHtml(t.id) + '"' + (t.done ? ' checked' : '') +
    ' aria-label="' + escHtml(t.title) + '">' +
    '<span class="rail-item-label" dir="auto">' + escHtml(t.title) + '</span></label>'

  // S113 (owner, URGENT): the all-clear state — the panel's finish line when every
  // task on the list is done. A quiet brand-accent check in a soft ring + one line
  // of muted copy (role=status so screen readers announce the milestone; the
  // generic rail.empty stays for a list that has no tasks at all).
  const railTodoAllClear = () =>
    '<div class="rail-todo-clear" role="status">' +
    '<span class="rail-todo-clear-badge" aria-hidden="true">' +
    '<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg></span>' +
    '<p>' + escHtml(railT('rail.todoAllDone', 'All clear — every task here is done.')) + '</p>' +
    '</div>'

  // S114 (the two-jobs rule, job #1 — "never lose an idea"): the to-do panel grows
  // a QUICK-ADD row — capture a task into any quadrant straight from the sidebar,
  // no board trip. One form: quadrant picker (its dot wears the quadrant's picked
  // pastel via --rail-add-accent, the same token the group heads tint with) + a
  // borderless input + a round + submit. Submit POSTs /api/sadhana/tasks (the
  // board's own create endpoint, {title, quadrant}), then lands the row by
  // re-rendering the panel from the updated cache (the Undo path's proven recipe:
  // markRailRows + syncRailTreeBtn keep the tree honest) and refocuses the input
  // EMPTY so ideas keep flowing. The row rides EVERY panel state — groups,
  // all-clear, and the nothing-yet empty — because capture is exactly what an
  // empty list is for.
  const RAIL_TODO_DEF = {
    1: ['rail.q1', 'Today'],
    3: ['rail.q3', 'Urgent & High Value'],
    2: ['rail.q2', 'Strategic'],
    4: ['rail.q4', 'Personal & Sentimental'],
  }
  let railTodoCtx = { order: [1, 3, 2, 4], custom: new Map(), picked: 0 }
  const railTodoLabel = (q) => {
    const meta = railTodoCtx.custom.get(q)
    return meta && meta.name ? meta.name : railT(RAIL_TODO_DEF[q][0], RAIL_TODO_DEF[q][1])
  }
  const railTodoAddHtml = () => {
    // S114 r2: the picker HOLDS the last-picked quadrant across re-renders — a
    // capture loop stays on the list you're filling (the change handler and the
    // submit both keep railTodoCtx.picked honest; the dot follows via the same
    // --rail-add-accent style the change handler sets).
    if (!railTodoCtx.order.includes(railTodoCtx.picked)) railTodoCtx.picked = railTodoCtx.order[0]
    // S117: a surviving draft RECLAIMS its quadrant — the picker lands back on
    // the list the idea was being typed into, even across a page navigation
    // (railTodoCtx.picked alone only lives in memory).
    const draft = railAddDraftRead()
    if (draft && draft.q && railTodoCtx.order.includes(draft.q)) railTodoCtx.picked = draft.q
    const draftText = draft ? draft.text : ''
    const opts = railTodoCtx.order.map((q) => {
      const meta = railTodoCtx.custom.get(q)
      const accent = meta && meta.accent_color ? ' data-accent="' + escHtml(meta.accent_color) + '"' : ''
      const sel = q === railTodoCtx.picked ? ' selected' : ''
      return '<option value="' + q + '"' + accent + sel + '>' + escHtml(railTodoLabel(q)) + '</option>'
    }).join('')
    const picked = railTodoCtx.custom.get(railTodoCtx.picked)
    const accentStyle = picked && picked.accent_color ? ' style="--rail-add-accent: var(--' + escHtml(picked.accent_color) + ')"' : ''
    const ph = railT('rail.todoAddPlaceholder', 'New task…')
    return '<form class="rail-todo-add" data-rail-add' + accentStyle + '>' +
      '<span class="rail-add-dot" aria-hidden="true"></span>' +
      '<select class="rail-add-picker" data-rail-add-picker aria-label="' + escHtml(railT('rail.todoAddList', 'Which list')) + '">' + opts + '</select>' +
      '<input class="rail-add-input" data-rail-add-input type="text" maxlength="255" enterkeyhint="done" autocomplete="off" spellcheck="false"' +
      (draftText ? ' value="' + escHtml(draftText) + '"' : '') +
      ' placeholder="' + escHtml(ph) + '" aria-label="' + escHtml(ph) + '">' +
      '<button class="rail-add-btn" type="submit" data-rail-add-btn aria-label="' + escHtml(railT('rail.todoAdd', 'Add task')) + '">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>' +
      '</form>'
  }

  const renderRailTodos = (d) => {
    // S93 (owner round, item 1): the to-do panel IS the quadrant board in miniature —
    // each quadrant's name heads its group (the user's renamed sadhana_quadrant_names
    // or localized defaults, in the user's saved order), and every item carries a
    // tickable checkbox.
    // S113 (owner, URGENT): the sidebar is the OPEN-WORK glance — DONE tasks never
    // show here. The board page keeps its full done-sinking history; this panel only
    // ever lists what's left to do. A quadrant whose tasks are all done folds away
    // with them (the group contract hides empty groups), and the last group out
    // flips the panel to the all-clear state.
    const todos = d.todos || []
    const open = todos.filter((t) => !t.done)
    railTodoCtx.custom = new Map((d.todoNames || []).map((r) => [r.quadrant, r]))
    let order = [1, 3, 2, 4]
    if (Array.isArray(d.todoOrder) && d.todoOrder.length) {
      order = d.todoOrder.filter((q) => [1, 2, 3, 4].includes(q))
    }
    railTodoCtx.order = order
    const parts = []
    for (const q of order) {
      const meta = railTodoCtx.custom.get(q)
      const items = open.filter((t) => t.quadrant === q).map((t) => railTodoItem(t))
      // S98: every quadrant group head carries a goto chip → its own board
      // quadrant (/to-do-list#Q<id>), landing ON that exact box via the S97
      // arrival system (.q-arrived + scroll/carousel).
      parts.push(railGroup(railTodoLabel(q), items, { accent: meta && meta.accent_color ? meta.accent_color : null, href: '/to-do-list#Q' + q }))
    }
    // S114: the quick-add row rides EVERY state — groups, all-clear, empty —
    // because capture is exactly what an empty list is for.
    const add = railTodoAddHtml()
    const html = parts.join('')
    if (html) return html + add
    // nothing open — distinguish "the list has no tasks yet" from "every task is done"
    if (todos.length) return railTodoAllClear() + add
    return '<div class="rail-panel-empty">' + escHtml(railT('rail.empty', 'Nothing here yet — open something and it will appear.')) + '</div>' + add
  }

  const renderRailProjects = (d) => {
    // S93 (owner round, item 14): the projects panel groups projects under their
    // STAGE (0060 taxonomy) — the owner's sketch: "-planning / item one / item two /
    // -queued / …". Operational rides collapsed at the end.
    // S115 r2 (owner, the sidebar sketch): every project's ASPECT groups (New ideas /
    // Problems / Plans / In Progress / Done — the board's column order) used to ride
    // under its row permanently visible; the owner wants them COLLAPSED until the
    // project title itself is clicked — "then the collapsible menu expands to show
    // different aspects of project". So a project carrying board dev-tasks grows a
    // per-project collapsible branch (the .rail-group contract — [data-rail-group]
    // toggles the CLOSEST group, so the nesting toggles honestly): the branch ships
    // .is-collapsed, the TITLE is the toggle, and a quiet ↗ goto chip (the S98
    // recipe) keeps the S89 deep-link to the project's page — expansion and
    // navigation no longer fight over one click. The branch's body holds the S95
    // sub-groups (each collapsed in turn; their leaves deep-link to the EXACT box —
    // #pd-col-<status> / #detail-problems). A project with no board tasks stays a
    // plain link row — nothing to expand, so the click opens the project itself.
    const projects = d.projects || []
    const ptasks = d.projectTasks || []
    // The board's column order + vocabulary (detail-helpers COLS) — one source of
    // truth mirrored here for the tree heads.
    const SUB_GROUPS = [
      { key: 'idea', i18n: 'rail.g.newIdeas', label: 'New ideas' },
      { key: 'bug', i18n: 'rail.g.problems', label: 'Problems' },
      { key: 'planned', i18n: 'rail.g.plans', label: 'Plans' },
      { key: 'in_progress', i18n: 'rail.g.inProgress', label: 'In Progress' },
      { key: 'done', i18n: 'rail.g.done', label: 'Done' },
    ]
    // S95 (candidate 3 + r2): the tree's leaf rows land ON the exact BOX where that
    // work lives — every board column carries its own anchor (#pd-col-<status>), so a
    // box's items deep-link to the column itself; problems keep their dedicated tab
    // panel (#detail-problems — the page's hash boot opens that tab).
    const SUB_TARGET = {
      idea: '#pd-col-idea',
      bug: '#detail-problems',
      planned: '#pd-col-planned',
      in_progress: '#pd-col-in_progress',
      done: '#pd-col-done',
    }
    const bugBadgeFor = (pid) => {
      const bugCount = ptasks.filter((t) => t.project_id === pid && t.status === 'bug').length
      if (!bugCount) return ''
      // S95 (at-a-glance triage): a project carrying OPEN BUGS wears a small count
      // badge — the owner scans which projects carry problems WITHOUT expanding
      // anything (the awaiting_dev rust, the ink the Problems dot speaks). aria-label
      // composes from the existing rail.g.problems key so FA reads «۳ مشکلات».
      return '<span class="rail-item-badge rail-bug-badge"' +
        ' title="' + escHtml(railFaDig(bugCount) + ' ' + railT('rail.g.problems', 'Problems')) + '"' +
        ' aria-label="' + escHtml(railFaDig(bugCount) + ' ' + railT('rail.g.problems', 'Problems')) + '">' +
        railFaDig(bugCount) + '</span>'
    }
    const projectBranch = (p) => {
      const href = '/project.html?id=' + encodeURIComponent(p.id)
      const mine = ptasks.filter((t) => t.project_id === p.id)
      if (!mine.length) {
        // No board tasks → no aspects to reveal: a plain bold row, click = open.
        return railItem(href, p.title, p.status, null, bugBadgeFor(p.id), 'rail-project-row')
      }
      // The branch head is a TOGGLE (not a link): chevron + the project's status dot
      // + the bold name (.rail-project-row, the S106 700 register) + the bug badge.
      const head =
        '<button type="button" class="rail-group-head rail-project-head" data-rail-group aria-expanded="false">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '<span class="rail-dot" data-status="' + escHtml(p.status) + '" aria-hidden="true"></span>' +
        '<span class="rail-project-row" dir="auto">' + escHtml(p.title) + '</span>' +
        bugBadgeFor(p.id) +
        '</button>'
      const goto =
        '<a class="rail-group-goto" href="' + escHtml(href) + '"' +
        ' aria-label="' + escHtml(railT('rail.openProject', 'Open project')) + '"' +
        ' title="' + escHtml(railT('rail.openProject', 'Open project')) + '">' +
        '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></a>'
      const subs = SUB_GROUPS.map((g) => {
        const items = mine.filter((t) => t.status === g.key)
        if (!items.length) return ''
        return '<div class="rail-group rail-sub-group is-collapsed">' +
          '<button type="button" class="rail-group-head" data-rail-group aria-expanded="false">' +
          '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
          '<span>' + escHtml(railT(g.i18n, g.label)) + '</span>' +
          '<span class="rail-group-count">' + railFaDig(items.length) + '</span>' +
          '</button><div class="rail-group-body">' +
          items.map((t) => railItem(href + (SUB_TARGET[g.key] || ''), t.title, null)).join('') +
          '</div></div>'
      }).join('')
      return '<div class="rail-group rail-project-group is-collapsed" data-project-branch="' + escHtml(p.id) + '">' +
        '<div class="rail-group-headrow">' + head + goto + '</div>' +
        '<div class="rail-group-body">' + subs + '</div>' +
        '</div>'
    }
    const rows = (s) => projects.filter((p) => p.status === s).map(projectBranch)
    return RAIL_STAGE_GROUPS.map((g) =>
      railGroup(railT(g.i18n, g.label), rows(g.key), { collapsed: g.collapsed })).join('') ||
      '<div class="rail-panel-empty">' + escHtml(railT('rail.empty', 'Nothing here yet — open something and it will appear.')) + '</div>'
  }

  const renderRailSparks = (d) => {
    // S89 (owner request): ideas are shown UNDER THEIR FOLDERS — the same shelf
    // anatomy as the Notes panel. Unfiled sparks first, then one group per spark
    // folder (emoji icon when the folder has one), items inside.
    // S92 (owner report: "clicking an idea item must show the idea itself, not
    // its folder"): every idea row now deep-links to THE SPARK'S OWN PAGE —
    // /project.html?id= is the exact destination a spark card click uses on the
    // Ideas page itself (the grid title's <a href> + the kanban/sticky cards'
    // data-nav-url, helpers.ts). The old bare /sparks.html landed on the folder
    // shelf — the row you tapped vanished into the folder grid behind it. Mirrors
    // the Notes panel's #n=<id> and the Projects panel's ?id= deep links.
    const sparks = d.sparks || []
    const folders = d.sparkFolders || []
    const sparkEmoji = (fid) => {
      const f = folders.find((x) => x.id === fid)
      return f && f.icon ? '<span class="rail-item-emoji" aria-hidden="true">' + escHtml(f.icon) + '</span>' : ''
    }
    const sparkHref = (sp) => '/project.html?id=' + encodeURIComponent(sp.id)
    const inFolder = (fid) => sparks.filter((sp) => sp.folder_id === fid).map((sp) =>
      railItem(sparkHref(sp), sp.title, 'spark', sparkEmoji(fid)))
    const unfiled = sparks.filter((sp) => !sp.folder_id).map((sp) =>
      railItem(sparkHref(sp), sp.title, 'spark'))
    // S115 r2 (owner, "the folders must be collapsed until user clicks on them"):
    // each spark folder ships FOLDED — the panel opens as a quiet shelf of folder
    // names (+ the unfiled inbox, which stays open: it is the capture surface, not
    // a folder); a click on the folder head reveals its ideas. The [data-rail-group]
    // toggle + the S97 tree-fold button keep working unchanged.
    return [
      railGroup(railT('rail.g.unfiled', 'Unfiled'), unfiled),
      folders.map((f) => railGroup(f.name, inFolder(f.id), { collapsed: true })).join(''),
    ].join('') || '<div class="rail-panel-empty">' + escHtml(railT('rail.sparksEmpty', 'No ideas captured yet — the Ideas shelf fills as you spark.')) + '</div>'
  }

  const renderRailNotes = (d) => {
    const folders = d.folders || []
    const notes = d.notes || []
    const inFolder = (fid) => notes.filter((n) => n.folder_id === fid).map((n) =>
      railItem('/notes.html#n=' + encodeURIComponent(n.id), n.title || 'Untitled', null,
        n.icon ? '<span class="rail-item-emoji" aria-hidden="true">' + escHtml(n.icon) + '</span>' : ''))
    const folderGroups = folders.map((f) =>
      railGroup(f.name, inFolder(f.id), { collapsed: false })).join('')
    const unfiled = notes.filter((n) => !n.folder_id).map((n) =>
      railItem('/notes.html#n=' + encodeURIComponent(n.id), n.title || 'Untitled', null,
        n.icon ? '<span class="rail-item-emoji" aria-hidden="true">' + escHtml(n.icon) + '</span>' : ''))
    return [
      railGroup(railT('rail.g.unfiled', 'Unfiled'), unfiled),
      folderGroups,
    ].join('') || '<div class="rail-panel-empty">' + escHtml(railT('rail.notesEmpty', 'No notes yet — the vault fills as you write.')) + '</div>'
  }

  // --- S89: the CALENDAR section renders a REAL mini month grid -----------------
  // The owner's report: clicking the Calendar rail icon opened an EMPTY sidebar.
  // The panel now carries a compact month — Gregorian when the UI is English,
  // Jalali when Farsi (the math inlined from calendar-page.js: the standard
  // jalaali-js algorithm, zero deps, no vendor race), a weekday header, today's
  // ring, per-day due dots off the SAME /api/rail deadlines, and ‹ › stepping.
  // Day cells soft-navigate to /calendar.html; the due-next-7-days list follows.
  const JC_BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178]
  const jcDiv = (a, b) => ~~(a / b)
  const jcMod = (a, b) => a - ~~(a / b) * b
  function jcJalCal(jy) {
    const bl = JC_BREAKS.length
    const gy = jy + 621
    let leapJ = -14, jp = JC_BREAKS[0], jm = 0, jump = 0
    for (let i = 1; i < bl; i++) { jm = JC_BREAKS[i]; jump = jm - jp; if (jy < jm) break; leapJ += jcDiv(jump, 33) * 8 + jcDiv(jcMod(jump, 33), 4); jp = jm }
    let n = jy - jp
    leapJ += jcDiv(n, 33) * 8 + jcDiv(jcMod(n, 33) + 3, 4)
    if (jcMod(jump, 33) === 4 && jump - n === 4) leapJ += 1
    const leapG = jcDiv(gy, 4) - jcDiv((jcDiv(gy, 100) + 1) * 3, 4) - 150
    const march = 20 + leapJ - leapG
    if (jump - n < 6) n = n - jump + jcDiv(jump + 4, 33) * 33
    let leap = jcMod(jcMod(n + 1, 33) - 1, 4)
    if (leap === -1) leap = 4
    return { leap, gy, march }
  }
  function jcG2D(gy, gm, gd) {
    let d = jcDiv((gy + jcDiv(gm - 8, 6) + 100100) * 1461, 4) + jcDiv(153 * jcMod(gm + 9, 12) + 2, 5) + gd - 34840408
    d = d - jcDiv(jcDiv(gy + 100100 + jcDiv(gm - 8, 6), 100) * 3, 4) + 752
    return d
  }
  function jcD2G(jdn) {
    let j = 4 * jdn + 139361631
    j = j + jcDiv(jcDiv(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908
    const i = jcDiv(jcMod(j, 1461), 4) * 5 + 308
    return { gy: jcDiv(j, 1461) - 100100 + jcDiv(7 - jcMod(jcDiv(i, 153), 12), 6), gm: jcMod(jcDiv(i, 153), 12) + 1, gd: jcMod(jcDiv(i, 153), 5) + 1 }
  }
  function jcD2J(jdn) {
    let gy = jcD2G(jdn).gy, jy = gy - 621
    const r = jcJalCal(jy), jdn1f = jcG2D(gy, 3, r.march)
    let k = jdn - jdn1f
    if (k >= 0) { if (k <= 185) return { jy, jm: 1 + jcDiv(k, 31), jd: jcMod(k, 31) + 1 }; k -= 186 }
    else { jy -= 1; k += 179; if (r.leap === 1) k += 1 }
    return { jy, jm: 7 + jcDiv(k, 30), jd: jcMod(k, 30) + 1 }
  }
  function jcJ2D(jy, jm, jd) { const r = jcJalCal(jy); return jcG2D(r.gy, 3, r.march) + (jm - 1) * 31 - jcDiv(jm, 7) * (jm - 7) + jd - 1 }
  const jcToJ = (gy, gm, gd) => jcD2J(jcG2D(gy, gm, gd))
  const jcToG = (jy, jm, jd) => jcD2G(jcJ2D(jy, jm, jd))
  const JC_MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
  const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const DOW_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] // Saturday-first
  const DOW_EN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // Sunday-first
  let railCalMonth = null // Gregorian { y, m } anchor of the displayed month

  const railCalDueMap = (d) => {
    const map = new Map() // ISO → [{ kind }]
    for (const p of d.projects || []) {
      if (!p.due_date) continue
      const list = map.get(p.due_date) || []
      list.push({ kind: p.status })
      map.set(p.due_date, list)
    }
    for (const t of d.tasks || []) {
      // S93 (item 15): project TASKS join the due map — the mini-cal dots now cover
      // every scheduled thing the upcoming list shows.
      if (!t.due_date) continue
      const list = map.get(t.due_date) || []
      list.push({ kind: 'todo' })
      map.set(t.due_date, list)
    }
    for (const t of d.todos || []) {
      if (!t.due_date) continue
      const list = map.get(t.due_date) || []
      list.push({ kind: t.done ? 'done' : 'todo' })
      map.set(t.due_date, list)
    }
    return map
  }

  const renderRailCalendar = (d) => {
    const lang = window.hibanaI18n?.lang?.() || 'en'
    const fa = lang === 'fa'
    const faDig = (s) => (fa ? String(s).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]) : String(s))
    const pad = (n) => String(n).padStart(2, '0')
    const isoOf = (y, m, dd) => y + '-' + pad(m + 1) + '-' + pad(dd)
    if (!railCalMonth) {
      const t = new Date()
      railCalMonth = { y: t.getFullYear(), m: t.getMonth() }
    }
    // The DISPLAYED month. Gregorian anchor {y,m} → the month of that system
    // containing the anchor's 15th (mid-month keeps conversion off month edges).
    const mid = new Date(railCalMonth.y, railCalMonth.m, 15)
    let title, gridStart, days, dayNum
    if (fa) {
      const j = jcToJ(mid.getFullYear(), mid.getMonth() + 1, mid.getDate())
      const start = jcToG(j.jy, j.jm, 1)
      gridStart = new Date(start.gy, start.gm - 1, start.gd)
      days = j.jm <= 6 ? 31 : j.jm <= 11 ? 30 : (jcJalCal(j.jy).leap === 0 ? 30 : 29)
      title = JC_MONTHS_FA[j.jm - 1] + ' ' + faDig(j.jy)
      dayNum = (i) => faDig(i)
    } else {
      gridStart = new Date(railCalMonth.y, railCalMonth.m, 1)
      days = new Date(railCalMonth.y, railCalMonth.m + 1, 0).getDate()
      title = EN_MONTHS[railCalMonth.m] + ' ' + railCalMonth.y
      dayNum = (i) => String(i)
    }
    const due = railCalDueMap(d)
    const todayISO = new Date().toISOString().slice(0, 10)
    // Weekday offset: fa weeks start Saturday ((getDay()+1)%7), en Sunday.
    const firstDow = fa ? (gridStart.getDay() + 1) % 7 : gridStart.getDay()
    const dows = (fa ? DOW_FA : DOW_EN).map((w) => '<span class="rail-cal-dow" aria-hidden="true">' + w + '</span>').join('')
    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push('<span class="rail-cal-day" aria-hidden="true"></span>')
    for (let i = 1; i <= days; i++) {
      const iso = isoOf(gridStart.getFullYear(), gridStart.getMonth(), i)
      const list = due.get(iso) || []
      const dots = list.slice(0, 3).map((x) => '<i data-kind="' + escHtml(x.kind) + '" aria-hidden="true"></i>').join('')
      const dotsEl = list.length ? '<span class="rail-cal-dots" aria-hidden="true">' + dots + '</span>' : ''
      const dueTitle = list.length ? ' title="' + escHtml(railT('rail.calDue', '{n} due').split('{n}').join(faDig(list.length))) + '"' : ''
      cells.push(
        '<button type="button" class="rail-cal-day' + (iso === todayISO ? ' is-today' : '') + '" data-rail-cal-day="' + iso + '"' + dueTitle + '>' +
        dayNum(i) + dotsEl + '</button>')
    }
    const grid = '<div class="rail-cal-grid" dir="' + (fa ? 'rtl' : 'ltr') + '">' + dows + cells.join('') + '</div>'
    const head =
      '<div class="rail-cal-head">' +
      '<button type="button" class="rail-cal-nav" data-rail-cal-nav="-1" aria-label="' + escHtml(railT('rail.calPrev', 'Previous month')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button>' +
      '<span class="rail-cal-title" aria-live="polite">' + escHtml(title) + '</span>' +
      '<button type="button" class="rail-cal-nav" data-rail-cal-nav="1" aria-label="' + escHtml(railT('rail.calNext', 'Next month')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>' +
      '</div>'
    // S93 (owner round, item 15): the UPCOMING list — everything the user scheduled
    // for the next 14 days (project deadlines, project TASKS, to-do deadlines),
    // sorted by date, each row labeled with a localized date (Jalali + Farsi digits
    // when the UI is fa — the same calendar system the mini grid above renders).
    const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10)
    const dueItems = []
    for (const p of d.projects || []) {
      if (p.due_date && p.due_date >= todayISO && p.due_date <= in14) dueItems.push({ date: p.due_date, href: '/project.html?id=' + encodeURIComponent(p.id), label: p.title, dot: p.status })
    }
    for (const t of d.tasks || []) {
      // S100 (the client-task deep links): a dated CLIENT-CHECKLIST task (the
      // tasks table's only writer is the clients UI — rail.ts scopes the query
      // to type='client') lands ON its own checklist item. The old project-page
      // href pointed at a page that NEVER renders these rows — the checklist
      // lives on /clients.html only (module.ts); a genuine never-lose-your-place
      // violation, now closed.
      if (t.due_date && t.due_date >= todayISO && t.due_date <= in14) dueItems.push({ date: t.due_date, href: '/clients.html#task-' + encodeURIComponent(t.id), label: t.title, dot: 'todo' })
    }
    for (const t of d.todos || []) {
      // S99 (the Coming-up deep links): a dated to-do lands ON ITS QUADRANT
      // (/to-do-list#Q<id>, the S97 arrival system) instead of the board top —
      // a pure client-side join (quadrant already rides the /api/rail todos
      // payload, schema-CHECKed 1–4).
      if (!t.done && t.due_date && t.due_date >= todayISO && t.due_date <= in14) dueItems.push({ date: t.due_date, href: '/to-do-list#Q' + t.quadrant, label: t.title, dot: 'todo' })
    }
    dueItems.sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
    const dateLabel = (iso) => {
      const parts = iso.split('-').map(Number)
      if (fa) {
        const j = jcToJ(parts[0], parts[1], parts[2])
        return faDig(j.jd) + ' ' + JC_MONTHS_FA[j.jm - 1]
      }
      return EN_MONTHS[parts[1] - 1].slice(0, 3) + ' ' + parts[2]
    }
    const dueRows = dueItems.slice(0, 18).map((x) => railItem(x.href, x.label + ' · ' + dateLabel(x.date), x.dot))
    return '<div class="rail-cal">' + head + grid + '</div>' +
      railGroup(railT('rail.g.upcoming', 'Coming up'), dueRows) +
      '<div class="rail-panel-empty">' + escHtml(railT('rail.calendarHint', 'Deadlines from your projects, tasks and to-dos land here as they approach.')) + '</div>'
  }

  // Month stepping: ± one month of the DISPLAYED system (Jalali when fa) — the
  // anchor moves by that system's month so the title never desyncs from the grid.
  const railCalStep = (dir) => {
    const lang = window.hibanaI18n?.lang?.() || 'en'
    if (!railCalMonth) return null
    if (lang !== 'fa') {
      const d = new Date(railCalMonth.y, railCalMonth.m + dir, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    }
    const mid = new Date(railCalMonth.y, railCalMonth.m, 15)
    const j = jcToJ(mid.getFullYear(), mid.getMonth() + 1, mid.getDate())
    let jm = j.jm + dir, jy = j.jy
    if (jm > 12) { jm = 1; jy++ }
    if (jm < 1) { jm = 12; jy-- }
    const g = jcToG(jy, jm, 1)
    return { y: g.gy, m: g.gm - 1 }
  }

  // The section→body switch, shared by the async panel render AND the calendar's
  // in-place month stepping (which re-renders from the CACHED payload).
  const railBodyFor = (section, data) => {
    if (section === 'todo') return renderRailTodos(data)
    if (section === 'projects') return renderRailProjects(data)
    if (section === 'sparks') return renderRailSparks(data)
    if (section === 'notes') return renderRailNotes(data)
    if (section === 'calendar') return renderRailCalendar(data)
    return ''
  }

  async function renderRailPanel() {
    const box = railBox()
    if (!box || !railSection) return
    const meta = RAIL_SECTIONS[railSection]
    if (!meta) { closeRailPanel(); return }
    const head =
      '<div class="rail-panel-head">' +
      '<span class="rail-panel-title">' + escHtml(railT(meta.i18n, meta.label)) + '</span>' +
      '<a class="rail-panel-open-link" href="' + meta.href + '">' + escHtml(railT('rail.open', 'Open')) +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m0 0-6-6m6 6-6 6"/></svg></a>' +
      // S97 (the tree fold): one button collapses/expands EVERY group in the
      // panel (incl. nested sub-groups) — the .rail-panel-close recipe (quiet
      // 2rem icon, muted ink, bg-soft hover, brand focus ring). syncRailTreeBtn
      // mirrors the tree's state (label/icon/aria/title flip together).
      '<button type="button" class="rail-panel-tree" data-rail-tree' +
      ' aria-label="' + escHtml(railT('rail.collapseAll', 'Collapse all')) + '" data-i18n-aria-label="rail.collapseAll">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>' +
      '<button type="button" class="rail-panel-close" data-rail-close aria-label="' + escHtml(railT('rail.close', 'Close panel')) + '" data-i18n-aria-label="rail.close">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>'
    // S93: every panel section reads /api/rail (the dashboard panel is retired —
    // its icon navigates; see RAIL_SECTIONS).
    // S116: harvest BEFORE the loading swap — the fresh render re-applies the
    // owner's expanded branches (the language switch / a data refresh keeps the tree).
    const prevGroups = railHarvestGroups()
    box.innerHTML = head + '<div class="rail-panel-body"><div class="rail-panel-loading">' + escHtml(railT('rail.loading', 'Loading…')) + '</div></div>'
    let data
    try { data = await loadRailData() } catch {
      const box2 = railBox()
      if (box2 && railSection) box2.innerHTML = head + '<div class="rail-panel-body"><div class="rail-panel-empty">' + escHtml(railT('rail.failed', 'Could not reach the server — reopen the panel to retry.')) + '</div></div>'
      return
    }
    // a section switch (or close) superseded this render
    if (!railSection || railBox() !== box) return
    box.innerHTML = head + '<div class="rail-panel-body">' + railBodyFor(railSection, data) + '</div>'
    railRestoreGroups(prevGroups) // S116: the owner's folded/expanded tree survives
    markRailRows() // S95: freshly rendered rows get their current-location marks
    syncRailTreeBtn() // S97: the fold button mirrors the freshly rendered tree
  }

  function markRailIcons() {
    document.querySelectorAll('.rail-btn[data-rail-panel]').forEach((b) => {
      b.classList.toggle('is-panel-open', !!railSection && b.getAttribute('data-rail-panel') === railSection)
    })
  }

  // S97 (the tree fold): the button mirrors the tree's state — every group
  // collapsed → offers Expand all (chevron-up); anything open → offers
  // Collapse all (chevron-down). Label/icon/aria/title flip together so EN,
  // FA and screen readers all read the CURRENT offer.
  function railTreeAllCollapsed(box) {
    if (!box) return false
    const groups = box.querySelectorAll('.rail-group')
    return groups.length > 0 && box.querySelectorAll('.rail-group:not(.is-collapsed)').length === 0
  }
  function syncRailTreeBtn() {
    const box = railBox()
    const btn = box ? box.querySelector('[data-rail-tree]') : null
    if (!btn) return
    const expand = railTreeAllCollapsed(box)
    const key = expand ? 'rail.expandAll' : 'rail.collapseAll'
    const label = railT(key, expand ? 'Expand all' : 'Collapse all')
    btn.setAttribute('aria-label', label)
    btn.setAttribute('title', label)
    btn.setAttribute('data-i18n-aria-label', key)
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (expand ? 'm6 9 6-6 6 6' : 'm6 15 6 6 6-6') + '"/></svg>'
  }

  function openRailPanel(section) {
    const box = railBox()
    if (!box || !RAIL_SECTIONS[section]) return
    // S95 r2 (owner item 9): the panel never mounts on a module-sidebar page —
    // the module's own sidebars own the real estate beside the icon rail.
    if (document.body.classList.contains('rail-icons-only')) return
    railSection = section
    box.hidden = false
    document.body.classList.add('rail-panel-open')
    try { localStorage.setItem(RAIL_PANEL_KEY, section) } catch { /* storage unavailable */ }
    markRailIcons()
    renderRailPanel()
  }

  function closeRailPanel() {
    const box = railBox()
    railSection = null
    document.body.classList.remove('rail-panel-open')
    if (box) box.hidden = true
    try { localStorage.removeItem(RAIL_PANEL_KEY) } catch { /* storage unavailable */ }
    markRailIcons()
  }

  // The rail icons: click OPENS the panel (VS Code semantics — single click never
  // navigates; the panel's header "Open →" + the item rows do). S93 (owner items 2
  // + 10): an icon carrying data-rail-nav ALSO navigates — Projects shows the page
  // AND its grouped sidebar together. S95 r2 (owner items 3 + 9): To-do joins the
  // navigators (a click lands on /to-do-list), and on a MODULE-SIDEBAR page (the
  // icon rail) every icon is a plain link — the panel never opens there; a
  // navigating icon remembers its panel for the destination (it opens once the
  // module class lifts, so Projects-from-Notes still arrives with its tree).
  // Registered BEFORE the generic link interceptor below so stopPropagation keeps
  // the navigator out.
  let pendingPanelOnNav = null // a panel section to open after the NEXT load() lands
  document.addEventListener('click', (e) => {
    const icon = e.target.closest ? e.target.closest('.rail-btn[data-rail-panel]') : null
    if (!icon) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    // S95 r2 item 9 — the icon rail: no panel HERE. Nav icons navigate and remember
    // their panel for the destination; the rest navigate as plain links (the module
    // page is where their panel would live — the destination owns it).
    if (document.body.classList.contains('rail-icons-only')) {
      const section = icon.getAttribute('data-rail-panel') || ''
      if (icon.hasAttribute('data-rail-nav') && RAIL_SECTIONS[section]) {
        e.preventDefault()
        e.stopPropagation()
        pendingPanelOnNav = section
        // A HARD destination (e.g. To-do → /to-do-list) full-reloads — the persisted
        // key is what its boot restore reads (soft destinations use the pending flag).
        try { localStorage.setItem(RAIL_PANEL_KEY, section) } catch { /* storage unavailable */ }
        go(icon.getAttribute('href') || '')
      }
      return // no data-rail-nav → the plain anchor navigates via the generic interceptor
    }
    e.preventDefault()
    e.stopPropagation()
    const section = icon.getAttribute('data-rail-panel') || ''
    const alsoNav = icon.hasAttribute('data-rail-nav')
    if (!alsoNav && railSection === section) { closeRailPanel(); return }
    if (RAIL_SECTIONS[section]) openRailPanel(section)
    if (alsoNav) go(icon.getAttribute('href') || '')
  }, true)

  // S113 (owner, URGENT): a ticked task LEAVES the sidebar — done work never shows
  // here (the S93 strike-and-sink register lives on on the board page only). The row
  // folds itself away (a measured max-height collapse + fade, pinned from JS so the
  // transition has a real start value), the group's count follows, an emptied group
  // folds with its last row, and the last group out flips the panel to the all-clear
  // state. Reduced motion skips the fold entirely.
  const retireRailTodoRow = (row) => {
    const body = row.closest('.rail-group-body')
    const group = row.closest('.rail-group')
    const finish = () => {
      row.remove()
      const box = railBox()
      const panel = box ? box.querySelector('.rail-panel-body') : null
      if (!panel) return
      if (group) {
        const left = body ? body.querySelectorAll('.rail-todo-item').length : 0
        const count = group.querySelector('.rail-group-count')
        if (count) count.textContent = railFaDig(left)
        if (!left) group.remove()
      }
      if (!panel.querySelector('.rail-group')) {
        panel.innerHTML = railTodoAllClear() + railTodoAddHtml() // S114: the finish line keeps the capture row
      } else {
        syncRailTreeBtn() // S97: the removal can complete/clear a full fold — keep the button honest
      }
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return }
    row.style.maxHeight = row.scrollHeight + 'px'
    requestAnimationFrame(() => row.classList.add('is-leaving'))
    window.setTimeout(finish, 360)
  }

  // S93 (owner round, item 1): the to-do panel's CHECKBOXES — a delegated change
  // handler POSTs /complete|/uncomplete (the same endpoints the dashboard rows use).
  // S113 (owner, URGENT): completing a task now REMOVES the row from the panel (done
  // work never shows in the sidebar). The toast's UNDO reopens the task and
  // re-renders the panel from the updated cache — an accidental tick is one tap
  // from recovery, no board trip (never lose your place).
  document.addEventListener('change', (e) => {
    const input = e.target.closest ? e.target.closest('[data-rail-todo]') : null
    if (!input || !(input instanceof HTMLInputElement)) return
    const id = input.getAttribute('data-rail-todo') || ''
    const row = input.closest('.rail-todo-item')
    if (!id || !row) return
    const next = input.checked
    input.disabled = true
    fetch('/api/sadhana/tasks/' + encodeURIComponent(id) + (next ? '/complete' : '/uncomplete'), { method: 'POST', credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) { if (r.status === 401) window.hibana?.handle401?.(r); throw new Error('HTTP ' + r.status) }
        const t = (railData && railData.todos ? railData.todos : []).find((x) => x.id === id)
        if (t) t.done = next ? 1 : 0
        input.disabled = false
        row.classList.toggle('is-done', next)
        if (next) {
          retireRailTodoRow(row)
          window.hibana?.toast?.(railT('rail.todoDone', 'Task completed'), 'ok', 6000, [
            {
              label: railT('common.undo', 'Undo'),
              onClick: () => {
                fetch('/api/sadhana/tasks/' + encodeURIComponent(id) + '/uncomplete', { method: 'POST', credentials: 'same-origin' })
                  .then((r2) => {
                    if (!r2.ok) { if (r2.status === 401) window.hibana?.handle401?.(r2); throw new Error('HTTP ' + r2.status) }
                    if (t) t.done = 0
                    const box = railBox()
                    if (box && railSection === 'todo') {
                      const prevGroups = railHarvestGroups() // S116: keep the tree as the owner left it
                      const body = box.querySelector('.rail-panel-body')
                      if (body) body.innerHTML = railBodyFor('todo', railData)
                      railRestoreGroups(prevGroups) // S116: re-apply
                      markRailRows() // S95: fresh rows re-mark their current location
                      syncRailTreeBtn() // S97: the re-render rebuilt the tree
                    }
                  })
                  .catch(() => window.hibana?.toast?.(railT('rail.todoFailed', "Couldn't update the task — try again"), 'err'))
              },
            },
          ])
        } else {
          // stale-panel un-tick: reopen at the group's top (near-dead path — done
          // rows no longer render, but the panel can outlive a fast double toggle).
          const body = row.closest('.rail-group-body')
          if (body) body.insertBefore(row, body.firstChild)
        }
      })
      .catch(() => {
        input.disabled = false
        input.checked = !next
        row.classList.toggle('is-done', !next)
        window.hibana?.toast?.(railT('rail.todoFailed', "Couldn't update the task — try again"), 'err')
      })
  })

  // S114: the quick-add picker's DOT follows the picked quadrant's pastel — the
  // selected option carries data-accent (the same token the group heads tint
  // with); a quadrant without a picked pastel falls back to the brand accent.
  document.addEventListener('change', (e) => {
    const sel = e.target.closest ? e.target.closest('[data-rail-add-picker]') : null
    if (!sel || !(sel instanceof HTMLSelectElement)) return
    const form = sel.closest('[data-rail-add]')
    if (!form) return
    const opt = sel.selectedOptions && sel.selectedOptions[0]
    const acc = opt ? opt.getAttribute('data-accent') : ''
    form.style.setProperty('--rail-add-accent', acc ? 'var(--' + acc + ')' : 'var(--accent)')
    railTodoCtx.picked = Number(sel.value) || railTodoCtx.picked // S114 r2: even a draft-less switch holds
    // S117: a draft already being typed FOLLOWS its list switch — the stored
    // quadrant updates so the navigation/re-render restore lands both.
    const input = form.querySelector('[data-rail-add-input]')
    if (input && input.value.trim()) railAddDraftWrite(Number(sel.value), input.value)
  })

  // S117: the draft PERSISTS as it's typed — every keystroke updates the
  // sessionStorage draft, so a navigator-icon click (which navigates), a panel
  // re-render, or a 401 login bounce round-trip all bring the half-typed idea
  // back. Clearing the input (manually) clears the stored draft too.
  document.addEventListener('input', (e) => {
    const input = e.target.closest ? e.target.closest('[data-rail-add-input]') : null
    if (!input || !(input instanceof HTMLInputElement)) return
    const form = input.closest('[data-rail-add]')
    const picker = form ? form.querySelector('[data-rail-add-picker]') : null
    railAddDraftWrite(picker ? Number(picker.value) : railTodoCtx.picked, input.value)
  })

  // S114: capture a task from the sidebar. Submit POSTs /api/sadhana/tasks (the
  // board's own create endpoint — {title, quadrant}), then lands the row by
  // re-rendering the panel from the updated cache (the Undo path's proven
  // recipe: markRailRows + syncRailTreeBtn) and refocuses the input EMPTY so
  // ideas keep flowing. A failed POST keeps the draft in place for a retry;
  // an empty submit is a quiet no-op (focus back, nothing sent).
  document.addEventListener('submit', (e) => {
    const form = e.target.closest ? e.target.closest('[data-rail-add]') : null
    if (!form || !(form instanceof HTMLFormElement)) return
    e.preventDefault()
    const input = form.querySelector('[data-rail-add-input]')
    const picker = form.querySelector('[data-rail-add-picker]')
    if (!input || !picker) return
    const title = input.value.trim()
    if (!title) { input.focus(); return }
    if (form.getAttribute('data-busy') === '1') return
    form.setAttribute('data-busy', '1')
    const btn = form.querySelector('[data-rail-add-btn]')
    if (btn) btn.disabled = true
    const quadrant = Number(picker.value) || 1
    fetch('/api/sadhana/tasks', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, quadrant }),
    })
      .then((r) => {
        if (r.status === 401) { window.hibana?.handle401?.(r); throw new Error('HTTP 401') }
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json()
      })
      .then((data) => {
        form.removeAttribute('data-busy')
        railAddDraftClear() // S117: the idea LANDED — the stored draft retires with it
        if (railData) {
          railData.todos.push({ id: (data && data.id) || '', title, done: 0, due_date: null, quadrant })
        }
        railTodoCtx.picked = quadrant // S114 r2: the capture loop stays on the list you're filling
        const box = railBox()
        if (box && railSection === 'todo') {
          const prevGroups = railHarvestGroups() // S116: keep the tree as the owner left it
          const body = box.querySelector('.rail-panel-body')
          if (body) body.innerHTML = railBodyFor('todo', railData)
          railRestoreGroups(prevGroups) // S116: re-apply
          markRailRows() // S95: fresh rows re-mark their current location
          syncRailTreeBtn() // S97: the re-render rebuilt the tree
          const fresh = box.querySelector('[data-rail-add-input]')
          if (fresh) fresh.focus()
        }
        window.hibana?.toast?.(railT('rail.todoAdded', 'Task added'), 'ok', 3000)
      })
      .catch(() => {
        form.removeAttribute('data-busy')
        if (btn) btn.disabled = false
        input.focus()
        window.hibana?.toast?.(railT('rail.todoAddFailed', "Couldn't add the task — try again"), 'err')
      })
  })

  // S114: Escape clears the DRAFT first — a capture-phase listener runs before
  // the panel's own Escape handler, so a half-typed idea never costs the panel;
  // an empty input lets the panel-close Escape through untouched.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    const t = e.target
    const input = t && t.closest ? t.closest('[data-rail-add-input]') : null
    if (input && input.value) {
      e.preventDefault()
      e.stopPropagation()
      input.value = ''
      railAddDraftClear() // S117: Escape stays the DELIBERATE discard — nothing stored survives it
      input.focus()
    }
  }, true)

  // Panel-internal controls (delegated — the panel re-renders constantly):
  // ✕ closes; a group head collapses/expands; the calendar's ‹ › steps the month
  // (re-rendered from the CACHED /api/rail payload — zero extra requests); a day
  // cell opens the full Calendar page; the Help icon replays the tour.
  document.addEventListener('click', (e) => {
    if (e.target.closest ? e.target.closest('[data-rail-close]') : null) { closeRailPanel(); return }
    // S97 (the tree fold): collapse/expand EVERY group in one tap (incl. the
    // nested project → box sub-groups). When the whole tree sits collapsed the
    // button expands it; otherwise it collapses everything. Each group head's
    // aria-expanded follows, and the button re-syncs to the new state.
    const treeBtn = e.target.closest ? e.target.closest('[data-rail-tree]') : null
    if (treeBtn) {
      const box = railBox()
      if (box) {
        const expand = railTreeAllCollapsed(box)
        box.querySelectorAll('.rail-group').forEach((g) => {
          g.classList.toggle('is-collapsed', !expand)
          const h = g.querySelector('.rail-group-head')
          if (h) h.setAttribute('aria-expanded', String(expand))
        })
        syncRailTreeBtn()
      }
      return
    }
    const calNav = e.target.closest ? e.target.closest('[data-rail-cal-nav]') : null
    if (calNav) {
      const next = railCalStep(Number(calNav.getAttribute('data-rail-cal-nav')) || 0)
      if (next && railData) {
        railCalMonth = next
        const box = railBox()
        if (box && railSection) {
          const prevGroups = railHarvestGroups() // S116: keep the tree as the owner left it
          const body = box.querySelector('.rail-panel-body')
          if (body) body.innerHTML = railBodyFor(railSection, railData)
          railRestoreGroups(prevGroups) // S116: re-apply
        }
        syncRailTreeBtn() // S97: the month step re-rendered the tree (Coming up rides a group)
      }
      return
    }
    const calDay = e.target.closest ? e.target.closest('[data-rail-cal-day]') : null
    if (calDay) {
      e.preventDefault()
      e.stopPropagation()
      go('/calendar.html')
      return
    }
    const groupHead = e.target.closest ? e.target.closest('[data-rail-group]') : null
    if (groupHead) {
      const group = groupHead.closest('.rail-group')
      if (group) {
        const collapsed = group.classList.toggle('is-collapsed')
        groupHead.setAttribute('aria-expanded', String(!collapsed))
        syncRailTreeBtn() // S97: a manual toggle can complete/clear a full fold — the button stays honest
      }
      return
    }
    const help = e.target.closest ? e.target.closest('[data-rail-help]') : null
    if (help) {
      e.preventDefault()
      if (window.hibanaTour?.start) window.hibanaTour.start()
      else if (window.hibanaCmdK?.open) window.hibanaCmdK.open()
      return
    }
  })

  // Escape closes the panel (dialogs own their Escape first — the open-dialog guard).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && railSection && !document.querySelector('dialog[open]')) closeRailPanel()
  })

  // Restore the persisted panel on boot (desktop only — the panel is hidden ≤1024
  // and the fetch would be wasted). The section re-opens with fresh /api/rail data.
  // S95 r2 (owner item 9): boot sets the icon-rail class FIRST (a module-sidebar
  // page collapses the rail + never restores its panel — the module's own sidebar
  // owns the space beside the rail).
  syncRailIconMode(location.pathname)
  if (window.matchMedia('(min-width: 1025px)').matches) {
    let saved = null
    try { saved = localStorage.getItem(RAIL_PANEL_KEY) } catch { saved = null }
    if (saved && RAIL_SECTIONS[saved] && !document.body.classList.contains('rail-icons-only')) {
      // wait for the partial to mount the panel host (async /api/nav injection)
      const t0 = Date.now()
      const iv = setInterval(() => {
        if (railBox()) { clearInterval(iv); openRailPanel(saved) }
        else if (Date.now() - t0 > 4000) clearInterval(iv)
      }, 120)
    }
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