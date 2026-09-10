// Command Palette (Ctrl+K / Cmd+K) — Phase B2.1.
// Instant navigation + quick actions + FTS5 project search, all in one keyboard-driven
// overlay. Uses only existing APIs (/api/search JSON, window.hibana actions, page links).
// Zero deps, zero build step, loaded on every authed page after app.js.
//
// Keyboard: Ctrl/Cmd+K to open · type to search · ↑↓ to navigate · Enter to activate · Esc to close
// Also: "/" opens with focus on search (when not already in an input).

;(() => {
  const _t = (key, fallback) => window.hibanaI18n?.t(key) ?? fallback

  // ---- Quick actions (always available, shown first) -------------------------
  const ACTIONS = [
    { id: 'qa-new-idea', label: () => _t('cmdk.newIdea', 'New idea'), hint: 'Ctrl+N', icon: 'idea', run: () => window.hibana?.openQuickAdd?.() },
    { id: 'qa-new-project', label: () => _t('cmdk.newProject', 'New project'), icon: 'folder-plus', run: () => window.hibana?.openProjectAdd?.() },
    { id: 'qa-dashboard', label: () => _t('nav.dashboard', 'Dashboard'), icon: 'gear', go: '/dashboard.html' },
    { id: 'qa-projects', label: () => _t('nav.projects', 'Projects'), icon: 'folder-plus', go: '/projects.html' },
    { id: 'qa-sparks', label: () => _t('nav.sparks', 'Ideas'), icon: 'idea', go: '/sparks.html' },
    { id: 'qa-sadhana', label: () => _t('nav.sadhana', 'To-do list'), icon: 'target', go: '/to-do-list' },
    { id: 'qa-canvas', label: () => _t('nav.canvas', 'Canvas'), icon: 'pencil', go: '/canvas.html' },
    { id: 'qa-calendar', label: () => _t('nav.calendar', 'Calendar'), icon: 'calendar', go: '/calendar.html' },
    { id: 'qa-notifications', label: () => _t('nav.notifications', 'Notifications'), icon: 'bell', go: '/notifications.html' },
    { id: 'qa-whiteboard', label: () => _t('nav.whiteboard', 'Notebook'), icon: 'book', go: '/whiteboard.html' },
    { id: 'qa-reports', label: () => _t('nav.reports', 'Reports'), icon: 'clipboard', go: '/reports.html' },
    { id: 'qa-archive', label: () => _t('nav.archive', 'Archive'), icon: 'archive', go: '/archive.html' },
    { id: 'qa-settings', label: () => _t('nav.settings', 'Settings'), icon: 'gear', go: '/settings.html' },
    { id: 'qa-theme', label: () => _t('cmdk.toggleTheme', 'Toggle theme'), icon: 'sun', run: () => window.hibana?.toggleTheme?.() },
    { id: 'qa-zen', label: () => _t('cmdk.toggleZen', 'Toggle focus mode'), hint: 'Ctrl .', icon: 'target', run: () => window.hibanaZen?.toggle?.() },
  ]

  // ---- Build the dialog once -------------------------------------------------
  let dlg = null
  let input = null
  let list = null
  let items = [] // [{ kind: 'action'|'project'|'recent'|'tag', label, sub, icon, action }]
  let selected = -1
  let searchTimer = null
  let lastQuery = ''

  // R4.2: Recent projects (localStorage) + cached tags (fetched once on first open).
  // recentProjects is maintained by project.html on every project visit (recordRecent).
  const RECENT_KEY = 'hibana-recent-projects'
  let recentProjects = []
  let cachedTags = []
  let tagsFetched = false
  function loadRecent() {
    try { recentProjects = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { recentProjects = [] }
  }
  async function ensureTags() {
    if (tagsFetched) return
    tagsFetched = true
    try {
      const res = await fetch('/api/tags')
      if (res.ok) {
        const body = await res.json()
        cachedTags = (body.tags || []).sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0))
      }
    } catch { /* best-effort */ }
  }
  // Expose recordRecent so project.html can push to it.
  window.hibanaCmdK = window.hibanaCmdK || {}
  window.hibanaCmdK.recordRecent = (id, title, status) => {
    try {
      loadRecent()
      const filtered = recentProjects.filter((p) => p.id !== id)
      filtered.unshift({ id, title, status })
      recentProjects = filtered.slice(0, 10)
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentProjects))
    } catch {}
  }

  function buildDialog() {
    if (dlg) return
    dlg = document.createElement('dialog')
    dlg.id = 'cmdk-dialog'
    dlg.className = 'cmdk'
    dlg.innerHTML = `
      <div class="cmdk-panel">
        <div class="cmdk-input-row">
          <svg class="icon cmdk-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="cmdk-input" class="cmdk-input" placeholder="${_t('cmdk.placeholder', 'Search projects or run a command…')}" autocomplete="off" spellcheck="false" aria-label="${_t('cmdk.placeholder', 'Search projects or run a command…')}" aria-controls="cmdk-list">
          <kbd class="cmdk-esc">Esc</kbd>
        </div>
        <ul id="cmdk-list" class="cmdk-list" role="listbox" aria-label="${_t('cmdk.results', 'Results')}"></ul>
      </div>`
    document.body.appendChild(dlg)
    input = dlg.querySelector('#cmdk-input')
    list = dlg.querySelector('#cmdk-list')

    // Backdrop click closes
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })

    // Input: debounced search + arrow nav
    input.addEventListener('input', () => {
      clearTimeout(searchTimer)
      const q = input.value.trim()
      // Actions always show; search results append when q is non-empty
      searchTimer = setTimeout(() => refresh(q), 150)
    })
    input.addEventListener('keydown', onKeydown)
    // Keyboard nav on the list (for when focus is on an item via Tab)
    list.addEventListener('keydown', onKeydown)
  }

  function onKeydown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); activateSelected() }
    else if (e.key === 'Escape') { e.preventDefault(); close() }
  }

  function moveSelection(delta) {
    if (!items.length) return
    selected = (selected + delta + items.length) % items.length
    paintSelection()
  }

  function paintSelection() {
    list.querySelectorAll('.cmdk-item').forEach((el, i) => {
      el.classList.toggle('is-selected', i === selected)
      el.setAttribute('aria-selected', i === selected ? 'true' : 'false')
    })
    // Scroll selected into view
    const sel = list.querySelector('.cmdk-item.is-selected')
    if (sel) sel.scrollIntoView({ block: 'nearest' })
  }

  function activateSelected() {
    const item = items[selected]
    if (!item) return
    close()
    if (item.action) item.action()
  }

  // ---- Render ----------------------------------------------------------------
  // R8.2: Fuzzy matcher — returns a score (higher = better match) or -1 (no match).
  // Subsequence matching: each char of `q` must appear in `text` in order. Contiguous
  // matches get a bonus so "dash" matches "Dashboard" better than "D____a_s_h____".
  function fuzzyScore(text, q) {
    if (!q) return 0
    const t = text.toLowerCase()
    const p = q.toLowerCase()
    if (t.includes(p)) return 100 + p.length // exact substring = best match
    let ti = 0, pi = 0, score = 0, streak = 0
    while (ti < t.length && pi < p.length) {
      if (t[ti] === p[pi]) {
        score += 1 + streak * 0.5 // contiguous bonus
        streak++
        pi++
      } else {
        streak = 0
      }
      ti++
    }
    return pi === p.length ? score : -1
  }

  async function refresh(q) {
    lastQuery = q
    // R8.2: fuzzy-score the actions instead of includes(); sort by score desc.
    const scoredActions = !q
      ? ACTIONS.map((a) => ({ a, s: 0 }))
      : ACTIONS.map((a) => ({ a, s: fuzzyScore(a.label(), q) })).filter((x) => x.s >= 0)
    scoredActions.sort((x, y) => y.s - x.s)
    const actions = scoredActions.map((x) => x.a)
    let projects = []
    // 0040 search depth: the API now returns notes, backlog, sadhana, and canvas hits
    // alongside projects. Each group is capped at 20 server-side; the palette shows a
    // smaller slice per group so one keyword surfaces all five surfaces without scroll.
    let notes = [], backlog = [], sadhana = [], canvas = []
    if (q.length >= 1) {
      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(q))
        if (res.ok) {
          const body = await res.json()
          projects = (body.projects || []).slice(0, 6)
          notes = (body.notes || []).slice(0, 5)
          backlog = (body.backlog || []).slice(0, 5)
          sadhana = (body.sadhana || []).slice(0, 5)
          canvas = (body.canvas || []).slice(0, 5)
        }
      } catch { /* search is best-effort */ }
    }
    // If the response is stale (user typed more), ignore it
    if (q !== lastQuery) return
    render(actions, projects, notes, backlog, sadhana, canvas)
  }

  function iconSvg(name) {
    // Reuse the shared icon set from lib/html.ts (same SVG paths)
    const ICONS = {
      'idea': '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>',
      'folder-plus': '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/>',
      'gear': '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>',
      'target': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="1"/>',
      'pencil': '<path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/>',
      'book': '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>',
      'clipboard': '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.5A.5.5 0 0 1 9.5 3h5a.5.5 0 0 1 .5.5V4M9 9.5h6M9 13.5h6M9 17.5h4"/>',
      'archive': '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M10 9.5v3h4v-3"/>',
      'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      'rocket': '<path d="M12 2.5s4.5 3 4.5 8c0 2.6-1.6 4.6-1.6 6.5h-5.8c0-1.9-1.6-3.9-1.6-6.5 0-5 4.5-8 4.5-8Z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9.5 20.5h5"/>',
      'clock': '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      // 0040 search-depth groups: notebook (notes), list-check (backlog/برنامه آتی),
      // target (sadhana quadrant), book (canvas/notebook text elements).
      'list-check': '<path d="M3.5 6h2M3.5 12h2M3.5 18h2"/><path d="M9 6h11M9 12h11M9 18h7"/>',
      'note': '<path d="M5 5h9l5 5v9a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6.5A1.5 1.5 0 0 1 5.5 5Z"/><path d="M8 12h8M8 15.5h5"/>',
      'kanban': '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.2 8v8M14.8 8v5"/>',
    }
    const body = ICONS[name] || ICONS.gear
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`
  }

  // Status badge labels — translated at render time so the palette matches the
  // server-rendered badges (same wording as STATUS_LABEL/STATUS_LABEL_FA in lib/html.ts).
  const STATUS_LABELS = {
    spark: ['cmdk.statusSpark', 'Idea'],
    unreviewed: ['cmdk.statusUnreviewed', 'Unreviewed'],
    investigating: ['cmdk.statusInvestigating', 'Investigating'],
    awaiting: ['cmdk.statusAwaiting', 'Awaiting Execution'],
    doing: ['cmdk.statusDoing', 'In Progress'],
    halted: ['cmdk.statusHalted', 'Development Stopped'],
    operational: ['cmdk.statusOperational', 'Operational'],
  }
  const statusLabel = (s) => {
    const entry = STATUS_LABELS[s]
    return entry ? _t(entry[0], entry[1]) : s
  }

  // 0040 search depth: render() now takes 5 result groups. Each group renders only when it
  // has hits, with its own localized header + a distinct icon so the source surface is
  // scannable at a glance. Groups are ordered by Ali's mental model: the project first
  // (where am I working), then notes (capture), backlog (plan), sadhana (today), canvas
  // (visual). All keyboard navigation (↑↓ Enter) flows through the same `items` array.
  const SADHANA_QUADRANT = (q) => {
    const labels = ['cmdk.q1', 'cmdk.q2', 'cmdk.q3', 'cmdk.q4']
    const fallbacks = ['Q1 Today', 'Q2 Strategic', 'Q3 Urgent', 'Q4 Personal']
    return _t(labels[q - 1] || 'cmdk.q1', fallbacks[q - 1] || 'Q1')
  }

  function render(actions, projects, notes, backlog, sadhana, canvas) {
    items = []
    const html = []

    // Quick actions section
    if (actions.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.actions', 'Actions') + '</span></li>')
      for (const a of actions) {
        const idx = items.length
        items.push({ kind: 'action', label: a.label(), action: () => { a.run ? a.run() : (window.hibanaNav ? window.hibanaNav.go(a.go) : (window.location.href = a.go)) } })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg(a.icon)}</span>
          <span class="cmdk-label">${esc(a.label())}</span>
          ${a.hint ? `<kbd class="cmdk-hint">${a.hint}</kbd>` : ''}
        </li>`)
      }
    }

    // R4.2: Recent projects section — only when the query is empty (so it doesn't clutter
    // search results). Reads from localStorage `hibana-recent-projects` (a [{id,title,status}]
    // array maintained by project.html on every visit). Up to 5 items, newest first.
    if (!lastQuery && recentProjects.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.recent', 'Recent') + '</span></li>')
      for (const p of recentProjects.slice(0, 5)) {
        const idx = items.length
        const url = '/project.html?id=' + p.id
        const badge = statusLabel(p.status)
        items.push({ kind: 'recent', label: p.title, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon"><span class="badge badge-${p.status}">${badge}</span></span>
          <span class="cmdk-label">${esc(p.title)}</span>
        </li>`)
      }
    }

    // R4.2: Tags section — quick-jump to the projects page filtered by a tag. Only when the
    // query is empty (search matches tag names too via FTS5 on projects, but this gives a
    // one-keypress jump to the tag-filtered list). Up to 8 tags by usage.
    if (!lastQuery && cachedTags.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.tags', 'Tags') + '</span></li>')
      for (const t of cachedTags.slice(0, 8)) {
        const idx = items.length
        const url = '/projects.html?tag=' + t.id
        items.push({ kind: 'tag', label: t.name, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon"><span class="tag-swatch" style="background:${esc(t.color)}"></span></span>
          <span class="cmdk-label">${esc(t.name)}</span>
        </li>`)
      }
    }

    // Search results — Projects
    if (projects.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.projects', 'Projects') + '</span></li>')
      for (const p of projects) {
        const idx = items.length
        const url = '/project.html?id=' + p.id
        items.push({ kind: 'project', label: p.title, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        const badge = statusLabel(p.status)
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon"><span class="badge badge-${p.status}">${badge}</span></span>
          <span class="cmdk-label">${esc(p.title)}</span>
        </li>`)
      }
    }

    // 0040: Quick notes — deep link → notebook page (the dashboard widget is a preview).
    if (notes.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.notes', 'Notes') + '</span></li>')
      for (const n of notes) {
        const idx = items.length
        const url = '/whiteboard.html#note-' + n.id
        const label = n.title || _t('cmdk.untitledNote', 'Untitled note')
        items.push({ kind: 'note', label, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg('note')}</span>
          <span class="cmdk-label">${esc(label)}</span>
        </li>`)
      }
    }

    // 0040: Backlog docs (برنامه آتی) — deep link → the project page (backlog tab).
    if (backlog.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.backlog', 'Upcoming Plan') + '</span></li>')
      for (const b of backlog) {
        const idx = items.length
        const url = '/project.html?id=' + b.project_id + '&tab=backlog'
        const label = b.title + ' · ' + b.project_title
        items.push({ kind: 'backlog', label, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg('list-check')}</span>
          <span class="cmdk-label">${esc(b.title)}<span class="cmdk-sublabel muted"> · ${esc(b.project_title)}</span></span>
        </li>`)
      }
    }

    // 0040: Sadhana tasks — deep link → to-do list (the quadrant board).
    if (sadhana.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.sadhana', 'To-Do') + '</span></li>')
      for (const s of sadhana) {
        const idx = items.length
        const url = '/to-do-list?q=' + s.id
        items.push({ kind: 'sadhana', label: s.title, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        const qLabel = SADHANA_QUADRANT(s.quadrant)
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg('target')}</span>
          <span class="cmdk-label">${esc(s.title)}<span class="cmdk-sublabel muted"> · ${esc(qLabel)}</span></span>
        </li>`)
      }
    }

    // 0040: Canvas text elements (note/comment/block) — deep link → the board. The board
    // type lives in the `board` column ('canvas' for the main canvas, 'whiteboard' for the
    // notebook); we route accordingly so the hit opens in the right surface.
    if (canvas.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.canvas', 'Canvas') + '</span></li>')
      for (const el of canvas) {
        const idx = items.length
        const url = el.board === 'whiteboard' ? '/whiteboard.html#' + el.id : '/canvas.html#' + el.id
        const typeLabel = _t('cmdk.canvas_' + el.type, el.type.charAt(0).toUpperCase() + el.type.slice(1))
        items.push({ kind: 'canvas', label: typeLabel, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg('book')}</span>
          <span class="cmdk-label">${esc(typeLabel)}</span>
        </li>`)
      }
    }

    if (!items.length) {
      html.push(`<li class="cmdk-empty muted">${_t('cmdk.noResults', 'No matches.')}</li>`)
    }

    list.innerHTML = html.join('')
    selected = items.length ? 0 : -1
    paintSelection()

    // Click delegation
    list.querySelectorAll('.cmdk-item').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.idx)
        if (idx >= 0 && idx < items.length) { selected = idx; activateSelected() }
      })
      el.addEventListener('mouseenter', () => {
        const idx = Number(el.dataset.idx)
        if (idx >= 0) { selected = idx; paintSelection() }
      })
    })
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function open() {
    buildDialog()
    if (dlg.open) return
    loadRecent() // R4.2: refresh recent list on every open (in case project.html updated it)
    ensureTags() // R4.2: fetch tags once, cache for subsequent opens
    input.value = ''
    refresh('')
    dlg.showModal()
    setTimeout(() => input.focus(), 10)
  }

  function close() {
    if (dlg && dlg.open) dlg.close()
    if (input) input.value = ''
  }

  // ---- Keyboard shortcuts overlay (? key) — B2.2 ----------------------------
  let helpDlg = null
  function buildHelpDialog() {
    if (helpDlg) return
    helpDlg = document.createElement('dialog')
    helpDlg.id = 'cmdk-help-dialog'
    helpDlg.className = 'cmdk'
    const SHORTCUTS = [
      [_t('cmdk.shortcutPalette', 'Open command palette'), 'Ctrl K'],
      [_t('cmdk.shortcutNewIdea', 'New idea'), 'Ctrl N'],
      [_t('cmdk.shortcutSearch', 'Focus search / palette'), '/'],
      [_t('cmdk.shortcutHelp', 'Show this help'), '?'],
      [_t('cmdk.shortcutNavUp', 'Move selection up'), '↑'],
      [_t('cmdk.shortcutNavDown', 'Move selection down'), '↓'],
      [_t('cmdk.shortcutActivate', 'Activate selected'), 'Enter'],
      [_t('cmdk.shortcutClose', 'Close dialog'), 'Esc'],
      [_t('cmdk.shortcutDrag', 'Reorder / move status'), 'Drag'],
      [_t('cmdk.shortcutZen', 'Toggle focus mode'), 'Ctrl .'],
      [_t('cmdk.shortcutGoTo', 'Go to (then a letter: d/p/s/t/c/n/r/a/e/l/v/f)'), 'g'],
    ]
    helpDlg.innerHTML = `
      <div class="cmdk-panel cmdk-help-panel">
        <div class="cmdk-input-row">
          <strong>${_t('cmdk.helpTitle', 'Keyboard shortcuts')}</strong>
          <kbd class="cmdk-esc">Esc</kbd>
        </div>
        <ul class="cmdk-list">
          ${SHORTCUTS.map(([label, key]) =>
            `<li class="cmdk-item" role="presentation"><span class="cmdk-label">${esc(label)}</span><kbd class="cmdk-hint">${esc(key)}</kbd></li>`
          ).join('')}
        </ul>
      </div>`
    document.body.appendChild(helpDlg)
    helpDlg.addEventListener('click', (e) => { if (e.target === helpDlg) helpDlg.close() })
    helpDlg.addEventListener('cancel', (e) => { e.preventDefault(); helpDlg.close() })
  }
  function openHelp() {
    buildHelpDialog()
    if (helpDlg.open) return
    helpDlg.showModal()
  }

  // ---- Global key listener ---------------------------------------------------
  document.addEventListener('keydown', (e) => {
    // Ctrl+K / Cmd+K opens
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      open()
      return
    }
    // "/" opens with focus on search (only when not typing in an input)
    if (e.key === '/' && !/input|textarea|select/i.test(e.target.tagName) && !e.target.isContentEditable && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      open()
      return
    }
    // "?" opens the shortcuts overlay (only when not typing in an input)
    if (e.key === '?' && !/input|textarea|select/i.test(e.target.tagName) && !e.target.isContentEditable && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      openHelp()
      return
    }
  })

  // Expose for nav.js SPA unmount cleanup (if needed)
  window.hibanaCmdK = { open, close, openHelp }
})()
