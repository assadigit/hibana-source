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
    // S51-B: the 'Ctrl N' hint is GONE from New idea — that shortcut opens the New
    // TASK dialog (app.js openTaskAdd), not quick-add; the hint lied. Its real keys
    // live in the help overlay's General section.
    { id: 'qa-new-idea', label: () => _t('cmdk.newIdea', 'New idea'), icon: 'idea', run: () => window.hibana?.openQuickAdd?.() },
    { id: 'qa-new-project', label: () => _t('cmdk.newProject', 'New project'), icon: 'folder-plus', run: () => window.hibana?.openProjectAdd?.() },
    { id: 'qa-new-note', label: () => _t('cmdk.newNote', 'New note'), icon: 'book', run: () => { window.location.href = '/notes.html?new=1' } },
    { id: 'qa-dashboard', label: () => _t('nav.dashboard', 'Dashboard'), icon: 'gear', go: '/dashboard.html' },
    { id: 'qa-projects', label: () => _t('nav.projects', 'Projects'), icon: 'folder-plus', go: '/projects.html' },
    { id: 'qa-sparks', label: () => _t('nav.sparks', 'Ideas'), icon: 'idea', go: '/sparks.html' },
    { id: 'qa-notes', label: () => _t('nav.notes', 'Notes'), icon: 'book', go: '/notes.html' },
    { id: 'qa-sadhana', label: () => _t('nav.sadhana', 'To-do list'), icon: 'target', go: '/to-do-list' },
    { id: 'qa-canvas', label: () => _t('nav.canvas', 'Canvas'), icon: 'pencil', go: '/canvas.html' },
    { id: 'qa-calendar', label: () => _t('nav.calendar', 'Calendar'), icon: 'calendar', go: '/calendar.html' },
    { id: 'qa-notifications', label: () => _t('nav.notifications', 'Notifications'), icon: 'bell', go: '/notifications.html' },
    { id: 'qa-whiteboard', label: () => _t('nav.whiteboard', 'Notebook'), icon: 'book', go: '/whiteboard.html' },
    { id: 'qa-reports', label: () => _t('nav.reports', 'Reports'), icon: 'clipboard', go: '/reports.html' },
    { id: 'qa-archive', label: () => _t('nav.archive', 'Archive'), icon: 'archive', go: '/archive.html' },
    { id: 'qa-settings', label: () => _t('nav.settings', 'Settings'), icon: 'gear', go: '/settings.html' },
    // S52: Trash discoverability — the 7-day soft-delete window (S50's Settings → Data
    // panel) had no entry point beyond burrowing into Settings. First-class palette
    // command now, with the live recoverable count as the sublabel ("3 recoverable"),
    // fetched once per session alongside the tag cache. run() soft-navigates then
    // smooth-scrolls to the #settings-trash card.
    {
      id: 'qa-trash',
      label: () => _t('cmdk.openTrash', 'Trash — recover deleted items'),
      icon: 'trash',
      // Persian digits when fa is active (the settings Trash panel does the same).
      sub: () => {
        if (trashCount <= 0) return ''
        const n = String(trashCount)
        const fa = document.documentElement.lang === 'fa'
        const shown = fa ? n.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : n
        return _t('cmdk.trashCount', '{n} recoverable').split('{n}').join(shown)
      },
      run: () => {
        const scroll = () => document.getElementById('settings-trash')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (location.pathname === '/settings.html') { scroll(); return }
        if (window.hibanaNav) window.hibanaNav.go('/settings.html')
        else window.location.href = '/settings.html'
        // The soft-nav swap is async — poll briefly for the section to land, then scroll.
        let tries = 0
        const t = setInterval(() => {
          if (document.getElementById('settings-trash')) { clearInterval(t); scroll() }
          else if (++tries > 40) clearInterval(t)
        }, 100)
      },
    },
    { id: 'qa-theme', label: () => _t('cmdk.toggleTheme', 'Toggle theme'), icon: 'sun', run: () => window.hibana?.toggleTheme?.() },
    { id: 'qa-zen', label: () => _t('cmdk.toggleZen', 'Toggle focus mode'), hint: 'Ctrl .', icon: 'target', run: () => window.hibanaZen?.toggle?.() },
    // S51-B: discoverability fix — the shortcuts overlay was only reachable via '?',
    // which nothing advertises. Now it's a first-class palette command (hint '?').
    { id: 'qa-help', label: () => _t('cmdk.helpTitle', 'Keyboard shortcuts'), hint: '?', icon: 'book', run: () => window.hibanaCmdK?.openHelp?.() },
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
  // S52: Trash count for the palette sublabel — fetched once per session (the same
  // once-then-cache pattern as tags). -1 = not fetched yet; 0+ = live count.
  let trashCount = -1
  async function ensureTrashCount() {
    if (trashCount >= 0) return
    try {
      const res = await fetch('/api/settings/trash')
      if (res.ok) {
        const data = await res.json()
        trashCount = Array.isArray(data.items) ? data.items.length : 0
        // If this resolved AFTER the list rendered, refresh so the count shows now.
        if (dlg && dlg.open) refresh(input ? input.value : '')
      }
    } catch { /* offline — the sublabel just stays empty */ }
  }
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
    // alongside projects. S62 adds vault (the 0057 Notes Vault — the one surface the
    // 0040 matrix missed). Each group is capped at 20 server-side; the palette shows a
    // smaller slice per group so one keyword surfaces all seven surfaces without scroll.
    let notes = [], vault = [], backlog = [], sadhana = [], canvas = [], tasks = []
    if (q.length >= 1) {
      try {
        const res = await fetch('/api/search?q=' + encodeURIComponent(q))
        if (res.ok) {
          const body = await res.json()
          projects = (body.projects || []).slice(0, 6)
          notes = (body.notes || []).slice(0, 5)
          vault = (body.vault || []).slice(0, 5)
          backlog = (body.backlog || []).slice(0, 5)
          sadhana = (body.sadhana || []).slice(0, 5)
          canvas = (body.canvas || []).slice(0, 5)
          tasks = (body.tasks || []).slice(0, 5)
        }
      } catch { /* search is best-effort */ }
    }
    // If the response is stale (user typed more), ignore it
    if (q !== lastQuery) return
    render(actions, projects, notes, vault, backlog, sadhana, canvas, tasks)
  }

  // S62: highlight the matched substring in result labels — the eye needs to see WHY
  // each row matched, not just that it did. Case-insensitive; label and query are
  // HTML-escaped independently so the mark lands on exactly the visible characters
  // (an escaped entity can never be split). No directional tricks, so RTL/FA labels
  // highlight exactly like LTR ones; a query that doesn't substring-match (fuzzy
  // action hits, recents) renders plain. Persian lowercasing is a no-op — matches are
  // code-point exact, same as every other substring search in the app.
  function hl(label) {
    const q = lastQuery
    const safe = String(label ?? '')
    if (!q) return esc(safe)
    const idx = safe.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return esc(safe)
    return esc(safe.slice(0, idx)) + '<mark class="cmdk-mark">' + esc(safe.slice(idx, idx + q.length)) + '</mark>' + esc(safe.slice(idx + q.length))
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
      'trash': '<path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/><path d="M10 11v6M14 11v6"/>',
      // S62: the vault group — خزانه, the safe. A padlock: long-form notes are the
      // treasure, quick notes (the 'note' icon above) are the scratchpad.
      'vault': '<rect x="5.5" y="10.5" width="13" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><circle cx="12" cy="15" r="1.3"/>',
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

  function render(actions, projects, notes, vault, backlog, sadhana, canvas, tasks) {
    items = []
    const html = []

    // Quick actions section
    if (actions.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.actions', 'Actions') + '</span></li>')
      for (const a of actions) {
        const idx = items.length
        items.push({ kind: 'action', label: a.label(), action: () => { a.run ? a.run() : (window.hibanaNav ? window.hibanaNav.go(a.go) : (window.location.href = a.go)) } })
        const sub = a.sub ? a.sub() : ''
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg(a.icon)}</span>
          <span class="cmdk-label">${esc(a.label())}${sub ? `<span class="cmdk-sublabel muted"> · ${esc(sub)}</span>` : ''}</span>
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
          <span class="cmdk-label">${hl(p.title)}</span>
        </li>`)
      }
    }

    // S62: Vault notes (خزانه) — long-form notes, searchable at last. Deep link → the
    // vault editor's own #n=<id> format (opens the note directly, any folder). The
    // sublabel carries folder + a snippet of WHERE the query hit, so a body match is
    // distinguishable from a title match at a glance. Starred notes carry the amber
    // star chip (same #e0a92e as the vault list).
    if (vault && vault.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.vault', 'Vault') + '</span></li>')
      for (const v of vault) {
        const idx = items.length
        // S63: the deep link carries the query — the vault page jumps to + flashes the
        // first body match ("never lose your place": find → open → SEE the hit).
        const url = '/notes.html#n=' + v.id + (lastQuery ? '&q=' + encodeURIComponent(lastQuery) : '')
        const label = v.title || _t('cmdk.untitledNote', 'Untitled note')
        items.push({ kind: 'vault', label, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        const sub = (v.folder ? esc(v.folder) + ' · ' : '') + esc(v.snippet || '')
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon">${iconSvg('vault')}</span>
          <span class="cmdk-label">${v.starred === 1 ? '<span class="cmdk-star" aria-hidden="true">★</span>' : ''}${hl(label)}<span class="cmdk-sublabel muted"> · ${sub}</span></span>
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
          <span class="cmdk-label">${hl(label)}</span>
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
          <span class="cmdk-label">${hl(b.title)}<span class="cmdk-sublabel muted"> · ${hl(b.project_title)}</span></span>
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
          <span class="cmdk-label">${hl(s.title)}<span class="cmdk-sublabel muted"> · ${esc(qLabel)}</span></span>
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
          <span class="cmdk-label">${hl(typeLabel)}</span>
        </li>`)
      }
    }

    // S30 (B3, 0051): dev tasks — title + labels searchable at last. Deep link → the
    // board page with ?task=ID (the board opens the task editor for it); the sublabel
    // carries the project title + the priority dot so urgent hits read at a glance.
    if (tasks && tasks.length) {
      html.push('<li class="cmdk-group" role="presentation"><span class="cmdk-group-label">' + _t('cmdk.tasks', 'Tasks') + '</span></li>')
      for (const t of tasks) {
        const idx = items.length
        const url = '/board.html?project=' + t.project_id + '&task=' + t.id
        items.push({ kind: 'task', label: t.title, action: () => (window.hibanaNav ? window.hibanaNav.go(url) : (window.location.href = url)) })
        html.push(`<li class="cmdk-item" role="option" data-idx="${idx}" tabindex="-1">
          <span class="cmdk-icon"><span class="prio-dot prio-${esc(t.priority)}"></span></span>
          <span class="cmdk-label">${hl(t.title)}<span class="cmdk-sublabel muted"> · ${hl(t.project_title)}</span></span>
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
    ensureTrashCount() // S52: same once-per-session pattern for the Trash count sublabel
    input.value = ''
    refresh('')
    dlg.showModal()
    setTimeout(() => input.focus(), 10)
  }

  function close() {
    if (dlg && dlg.open) dlg.close()
    if (input) input.value = ''
  }

  // ---- Keyboard shortcuts overlay (? key) — B2.2, v2 (S51-B) -----------------
  // v2: grouped into sections, complete verified inventory, and reachable from the
  // palette itself (the qa-help action below) — v1 was only discoverable by pressing
  // ?, which you only know about from… this overlay. Every shortcut listed here was
  // verified against its keydown handler in the source (app.js / go-to.js / zen-mode.js
  // / sadhana-page.js); the g-letters mirror go-to.js TARGETS exactly.
  let helpDlg = null
  function buildHelpDialog() {
    if (helpDlg) return
    helpDlg = document.createElement('dialog')
    helpDlg.id = 'cmdk-help-dialog'
    helpDlg.className = 'cmdk'
    // Section rows: [label, keys] — labels localized at BUILD time; the dialog is
    // rebuilt never (one per page load), which matches every other cmdk surface.
    // Go-to destinations reuse the existing nav.* keys (already translated).
    const GOTO = [
      ['nav.dashboard', 'd'], ['nav.projects', 'p'], ['nav.sparks', 's'], ['nav.notes', 'o'], ['nav.sadhana', 't'],
      ['nav.canvas', 'c'], ['nav.whiteboard', 'n'], ['nav.calendar', 'l'],
      ['nav.reports', 'r'], ['nav.archive', 'a'], ['nav.settings', 'e'], ['nav.notifications', 'f'],
    ]
    const SECTIONS = [
      {
        title: ['cmdk.helpGeneral', 'General'],
        rows: [
          ['cmdk.shortcutPalette', 'Open command palette', 'Ctrl K'],
          ['cmdk.shortcutSearch', 'Focus search / palette', '/'],
          ['cmdk.shortcutHelp', 'Show this help', '?'],
          ['cmdk.shortcutNewTask', 'New task', 'Ctrl N'],
          ['cmdk.shortcutZen', 'Toggle focus mode', 'Ctrl .'],
          ['cmdk.shortcutClose', 'Close dialog', 'Esc'],
        ],
      },
      {
        title: ['cmdk.helpNavigate', 'Navigate'],
        rows: GOTO.map(([key, letter]) => [key, _t(key, key), 'g ' + letter]),
      },
      {
        title: ['cmdk.helpNotes', 'Notes & to-dos'],
        rows: [
          ['cmdk.shortcutSubmit', 'Save note / task', 'Enter'],
          ['cmdk.shortcutUndo', 'Undo delete (To-do list)', 'Ctrl Z'],
          ['cmdk.shortcutGridArrows', 'Move between cards (dashboard)', '← → ↑ ↓'],
          ['cmdk.shortcutDrag', 'Reorder / move status', 'Drag'],
        ],
      },
      {
        title: ['cmdk.helpDialogs', 'In the palette'],
        rows: [
          ['cmdk.shortcutNavUp', 'Move selection up', '↑'],
          ['cmdk.shortcutNavDown', 'Move selection down', '↓'],
          ['cmdk.shortcutActivate', 'Activate selected', 'Enter'],
        ],
      },
    ]
    helpDlg.innerHTML = `
      <div class="cmdk-panel cmdk-help-panel">
        <div class="cmdk-input-row">
          <strong>${_t('cmdk.helpTitle', 'Keyboard shortcuts')}</strong>
          <kbd class="cmdk-esc">Esc</kbd>
        </div>
        <ul class="cmdk-list">
          ${SECTIONS.map((sec) => `
            <li class="cmdk-help-sec" role="presentation">${_t(sec.title[0], sec.title[1])}</li>
            ${sec.rows.map(([key, fb, k]) =>
              `<li class="cmdk-item" role="presentation"><span class="cmdk-label">${esc(_t(key, fb))}</span><kbd class="cmdk-hint">${esc(k)}</kbd></li>`
            ).join('')}`).join('')}
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

  // S61: visible entry points — the palette was keyboard-only (Ctrl+K / "/"), which
  // meant touch users had NO way in and desktop users had no affordance to discover.
  // The topbar search button (partials/nav.html) carries [data-cmdk-open]; this
  // delegated listener survives any re-injection of the nav partial (the mobile More
  // sheet's palette row binds itself in mobile-nav.js and calls open() directly).
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-cmdk-open]') : null
    if (!el) return
    e.preventDefault()
    open()
  })

  // Expose for nav.js SPA unmount cleanup (if needed).
  // S51-B BUG FIX: this used to be a plain replacement assignment — which threw away
  // the recordRecent method attached earlier in this IIFE (line ~67), so the palette's
  // "Recent" section (R4.2) has been silently empty since S30: project.html calls
  // window.hibanaCmdK?.recordRecent?.(…) into a method that no longer existed, the
  // optional chaining swallowed it, and the recents list never populated. Merge, don't
  // replace.
  window.hibanaCmdK = Object.assign(window.hibanaCmdK || {}, { open, close, openHelp })
})()
