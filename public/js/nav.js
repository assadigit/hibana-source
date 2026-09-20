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
  const railBox = () => document.querySelector('[data-rail-panel-box]')
  const railT = (k, fb) => { const v = window.hibanaI18n?.t(k); return v && v !== k ? v : fb }
  const escHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))

  const RAIL_SECTIONS = {
    dashboard: { href: '/dashboard.html', i18n: 'nav.dashboard', label: 'Dashboard' },
    todo: { href: '/to-do-list', i18n: 'nav.sadhana', label: 'To-do list' },
    projects: { href: '/projects.html', i18n: 'nav.projects', label: 'Projects' },
    sparks: { href: '/sparks.html', i18n: 'nav.sparks', label: 'Ideas' },
    notes: { href: '/notes.html', i18n: 'nav.notes', label: 'Notes' },
    canvas: { href: '/canvas.html', i18n: 'nav.canvas', label: 'Canvas' },
    notebook: { href: '/whiteboard.html', i18n: 'nav.whiteboard', label: 'Notebook' },
    calendar: { href: '/calendar.html', i18n: 'nav.calendar', label: 'Calendar' },
  }
  const RAIL_DONE = new Set(['operational'])

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

  // one grouped list section: label + count + collapsible body of .rail-item rows
  const railGroup = (label, items, opts = {}) => {
    const count = Array.isArray(items) ? items.length : 0
    if (!count && opts.hideWhenEmpty !== false) return ''
    const open = opts.collapsed ? '' : ' open-group'
    return '<div class="rail-group' + (opts.collapsed ? ' is-collapsed' : '') + '">' +
      '<button type="button" class="rail-group-head" data-rail-group aria-expanded="' + (opts.collapsed ? 'false' : 'true') + '">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>' +
      '<span>' + escHtml(label) + '</span>' +
      '<span class="rail-group-count">' + count + '</span>' +
      '</button><div class="rail-group-body">' + (Array.isArray(items) ? items.join('') : items) + '</div></div>'
  }
  const railItem = (href, label, dotStatus, extra) =>
    '<a class="rail-item" href="' + href + '">' +
    (dotStatus ? '<span class="rail-dot" data-status="' + escHtml(dotStatus) + '"></span>' : '') +
    (extra || '') +
    '<span class="rail-item-label" dir="auto">' + escHtml(label) + '</span></a>'

  const renderRailDashboard = () => {
    // "Continue where you left off" — the resume store (last OPENED, the S85 one
    // definition) is client-side; no server round trip for this section.
    let recent = []
    try { recent = JSON.parse(localStorage.getItem('hibana-resume') || '[]') } catch { recent = [] }
    const items = recent.slice(0, 6).map((r) => {
      const href = r.k === 'note' ? '/notes.html#n=' + encodeURIComponent(r.id) : '/project.html?id=' + encodeURIComponent(r.id)
      return railItem(href, r.title || (r.k === 'note' ? 'Untitled' : 'Project'), r.k === 'note' ? null : (r.badge || 'unreviewed'))
    })
    const groups = [
      railGroup(railT('rail.g.recent', 'Continue'), items, { collapsed: false }),
      railGroup(railT('rail.g.jump', 'Jump to'), [
        railItem('/to-do-list', railT('nav.sadhana', 'To-do list'), 'todo'),
        railItem('/projects.html', railT('nav.projects', 'Projects'), 'doing'),
        railItem('/notes.html', railT('nav.notes', 'Notes'), null),
        railItem('/calendar.html', railT('nav.calendar', 'Calendar'), 'awaiting'),
      ]),
    ].join('')
    return groups || '<div class="rail-panel-empty">' + escHtml(railT('rail.empty', 'Nothing here yet — open something and it will appear.')) + '</div>'
  }

  const renderRailTodos = (d) => {
    const today = new Date().toISOString().slice(0, 10)
    const todos = d.todos || []
    const todayItems = todos.filter((t) => t.due_date === today).map((t) =>
      railItem('/to-do-list', t.title, t.done ? 'done' : 'todo'))
    const openItems = todos.filter((t) => !t.done && t.due_date !== today).map((t) =>
      railItem('/to-do-list', t.title, 'todo'))
    const doneItems = todos.filter((t) => t.done).map((t) =>
      railItem('/to-do-list', t.title, 'done'))
    return [
      railGroup(railT('rail.g.today', 'Today'), todayItems),
      railGroup(railT('rail.g.all', 'All'), openItems),
      railGroup(railT('rail.g.done', 'Done'), doneItems, { collapsed: true }),
    ].join('') || '<div class="rail-panel-empty">' + escHtml(railT('rail.empty', 'Nothing here yet — open something and it will appear.')) + '</div>'
  }

  const renderRailProjects = (d) => {
    const projects = d.projects || []
    const all = projects.map((p) => railItem('/project.html?id=' + encodeURIComponent(p.id), p.title, p.status))
    const ongoing = projects.filter((p) => ['unreviewed', 'investigating', 'awaiting', 'doing'].includes(p.status))
      .map((p) => railItem('/project.html?id=' + encodeURIComponent(p.id), p.title, p.status))
    const done = projects.filter((p) => RAIL_DONE.has(p.status))
      .map((p) => railItem('/project.html?id=' + encodeURIComponent(p.id), p.title, p.status))
    return [
      railGroup(railT('rail.g.all', 'All'), all),
      railGroup(railT('rail.g.ongoing', 'Ongoing'), ongoing),
      railGroup(railT('rail.g.done', 'Done'), done, { collapsed: true }),
    ].join('')
  }

  const renderRailSparks = (d) => {
    const sparks = d.sparks || []
    const items = sparks.map((sp) => railItem('/sparks.html', sp.title, 'spark'))
    return railGroup(railT('rail.g.all', 'All'), items) ||
      '<div class="rail-panel-empty">' + escHtml(railT('rail.sparksEmpty', 'No ideas captured yet — the Ideas shelf fills as you spark.')) + '</div>'
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

  const renderRailCalendar = (d) => {
    const today = new Date().toISOString().slice(0, 10)
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const due = []
    for (const p of d.projects || []) {
      if (p.due_date && p.due_date >= today && p.due_date <= in7) due.push(railItem('/project.html?id=' + encodeURIComponent(p.id), p.title + ' · ' + p.due_date, p.status))
    }
    for (const t of d.todos || []) {
      if (t.due_date && t.due_date >= today && t.due_date <= in7 && !t.done) due.push(railItem('/to-do-list', t.title + ' · ' + t.due_date, 'todo'))
    }
    due.sort()
    const groups = railGroup(railT('rail.g.dueSoon', 'Due next 7 days'), due)
    return groups + '<div class="rail-panel-empty">' + escHtml(railT('rail.calendarHint', 'Deadlines from your projects and to-dos land here as they approach.')) + '</div>'
  }

  const renderRailHint = (hintKey, fallback) =>
    '<div class="rail-panel-empty">' + escHtml(railT(hintKey, fallback)) + '</div>'

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
      '<button type="button" class="rail-panel-close" data-rail-close aria-label="' + escHtml(railT('rail.close', 'Close panel')) + '" data-i18n-aria-label="rail.close">' +
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>'
    // dashboard reads the client-side resume store; everything else needs /api/rail
    if (railSection === 'dashboard') {
      box.innerHTML = head + '<div class="rail-panel-body">' + renderRailDashboard() + '</div>'
      return
    }
    if (railSection === 'canvas') {
      box.innerHTML = head + '<div class="rail-panel-body">' + renderRailHint('rail.canvasHint', 'The boundless Canvas is a single board — open it to draw, pin notes, and frame regions.') + '</div>'
      return
    }
    if (railSection === 'notebook') {
      box.innerHTML = head + '<div class="rail-panel-body">' + renderRailHint('rail.notebookHint', 'The Notebook is your single whiteboard — open it to sketch and write freehand.') + '</div>'
      return
    }
    box.innerHTML = head + '<div class="rail-panel-body"><div class="rail-panel-loading">' + escHtml(railT('rail.loading', 'Loading…')) + '</div></div>'
    let data
    try { data = await loadRailData() } catch {
      const box2 = railBox()
      if (box2 && railSection) box2.innerHTML = head + '<div class="rail-panel-body"><div class="rail-panel-empty">' + escHtml(railT('rail.failed', 'Could not reach the server — reopen the panel to retry.')) + '</div></div>'
      return
    }
    // a section switch (or close) superseded this render
    if (!railSection || railBox() !== box) return
    let body = ''
    if (railSection === 'todo') body = renderRailTodos(data)
    else if (railSection === 'projects') body = renderRailProjects(data)
    else if (railSection === 'sparks') body = renderRailSparks(data)
    else if (railSection === 'notes') body = renderRailNotes(data)
    else if (railSection === 'calendar') body = renderRailCalendar(data)
    box.innerHTML = head + '<div class="rail-panel-body">' + body + '</div>'
  }

  function markRailIcons() {
    document.querySelectorAll('.rail-btn[data-rail-panel]').forEach((b) => {
      b.classList.toggle('is-panel-open', !!railSection && b.getAttribute('data-rail-panel') === railSection)
    })
  }

  function openRailPanel(section) {
    const box = railBox()
    if (!box || !RAIL_SECTIONS[section]) return
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
  // navigates; the panel's header "Open →" + the item rows do). Registered BEFORE
  // the generic link interceptor below so stopPropagation keeps the navigator out.
  document.addEventListener('click', (e) => {
    const icon = e.target.closest ? e.target.closest('.rail-btn[data-rail-panel]') : null
    if (!icon) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    e.stopPropagation()
    const section = icon.getAttribute('data-rail-panel') || ''
    if (railSection === section) closeRailPanel()
    else openRailPanel(section)
  }, true)

  // Panel-internal controls (delegated — the panel re-renders constantly):
  // ✕ closes; a group head collapses/expands; the Help icon replays the tour.
  document.addEventListener('click', (e) => {
    if (e.target.closest ? e.target.closest('[data-rail-close]') : null) { closeRailPanel(); return }
    const groupHead = e.target.closest ? e.target.closest('[data-rail-group]') : null
    if (groupHead) {
      const group = groupHead.closest('.rail-group')
      if (group) {
        const collapsed = group.classList.toggle('is-collapsed')
        groupHead.setAttribute('aria-expanded', String(!collapsed))
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
  if (window.matchMedia('(min-width: 1025px)').matches) {
    let saved = null
    try { saved = localStorage.getItem(RAIL_PANEL_KEY) } catch { saved = null }
    if (saved && RAIL_SECTIONS[saved]) {
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