// notes-page.js — the Notes Vault controller (0057, S53): Obsidian-inspired 3-pane
// knowledge base at /notes. fetch()-driven (the vault is a rich client, not htmx
// fragments): /api/vault/bootstrap → sidebar tree, /api/vault/notes → card list,
// /api/vault/notes/:id → the open editor. Autosave PATCHes on a debounce; the preview
// renders live from the SAME markdown subset as the server (ported verbatim from
// src/lib/markdown.ts — keep the two in lockstep, see src/tests/markdown.test.ts).
//
// Layout contract (notes.css): .vault grid = tree | list | editor; under 940px the
// tree becomes a drawer and the editor a full-screen slide-over. All state lives in
// one object; every render is a full re-render of its pane (solo-owner scale — the
// same discipline as the quick-notebook widget).

;(() => {
  window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
  window.__hibanaPage({
    name: 'notes',
    mount(ctx) {
      const _t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f
      const esc = (v) => window.__hib?.escHtml ? window.__hib.escHtml(v) : String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
      const $ = (sel) => document.querySelector(sel)

      /* ── markdown port — MIRROR of src/lib/markdown.ts (same subset, same fixes) ── */
      const mdEscape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
      function renderMarkdown(src) {
        let s = mdEscape(String(src ?? ''))
        const fences = []
        s = s.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code) => {
          fences.push('<pre><code>' + code + '</code></pre>')
          return '\x03' + (fences.length - 1) + '\x03'
        })
        s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>')
        s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>')
        s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>')
        s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
        s = s.replace(/^[ \t]*[-*] (.*)$/gm, '\x01U\x02<li>$1</li>')
        s = s.replace(/^[ \t]*\d+\. (.*)$/gm, '\x01O\x02<li>$1</li>')
        s = s.replace(/(?:\x01U\x02<li>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>')
        s = s.replace(/(?:\x01O\x02<li>[\s\S]*?<\/li>\n?)+/g, '<ol>$&</ol>')
        s = s.replace(/\x01[OU]\x02/g, '')
        s = s.replace(/^---+$/gm, '<hr>')
        s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
        s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
        s = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
          .map((b) => (/^<(h[1-6]|ul|ol|pre|blockquote|hr|\x03)/.test(b) ? b : '<p>' + b + '</p>'))
          .join('\n')
        s = s.replace(/([^>\n])\n(?=[^<\n])/g, '$1<br>\n')
        s = s.replace(/\x03(\d+)\x03/g, (_m, i) => fences[Number(i)] || '')
        return s
      }

      /* ── inline #tag parsing (mirrors the server's bootstrap index regex) ── */
      const INLINE_TAG_RE = /(^|[^#\w\u0600-\u06FF])#([\w\u0600-\u06FF][\w\u0600-\u06FF/-]*)/g
      const inlineTags = (content) => {
        const out = []
        for (const m of String(content || '').matchAll(INLINE_TAG_RE)) if (!out.includes(m[2])) out.push(m[2])
        return out.slice(0, 4) // card shows at most 4 inline pills
      }
      const csvTags = (tags) => String(tags || '').split(',').map((t) => t.trim()).filter(Boolean)

      /* ── icons ── */
      const I = {
        chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
        folder: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
        star: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3Z"/></svg>',
        starOpen: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8L12 3Z"/></svg>',
        trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>',
        plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        kebab: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>',
        x: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
        download: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
        copy: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
        move: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v5m0 0-2-2m2 2 2-2"/></svg>',
        note: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h9l5 5v9a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6.5A1.5 1.5 0 0 1 5.5 5Z"/><path d="M8 12h8M8 15.5h5"/></svg>',
        layers: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
        pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/></svg>',
        check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>',
        arrowBack: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m0 0 6-6m-6 6 6 6"/></svg>',
        restore: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>',
        // S67: reading-time chip glyph — same clock path as the palette's 'clock'.
        clock: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
      }

      /* ── state ── */
      const PREFS_KEY = 'hibana-vault-prefs'
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch { return {} }
      })()
      prefs.expanded = Array.isArray(prefs.expanded) ? prefs.expanded : []
      const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch {} }

      const isMobile = () => window.matchMedia('(max-width: 940px)').matches
      const defaultMode = () => (isMobile() ? 'edit' : 'split')

      const state = {
        folders: [],
        tags: [],
        counts: { all: 0, starred: 0, trash: 0 },
        view: { type: 'all', id: null, name: '' }, // all | starred | trash | folder | unfiled | tag
        notes: [], // cards of the current view
        active: null, // the full open note
        draft: { title: '', content: '', tags: '' }, // local edit buffer
        q: '',
        sort: prefs.sort || 'updated',
        mode: prefs.mode || defaultMode(),
        saveState: 'idle', // idle | dirty | saving | saved | error
        loadingList: false,
        expanded: new Set(prefs.expanded),
      }

      /* ── api ── */
      const api = async (path, opts = {}) => {
        const res = await fetch(path, {
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          ...opts,
        })
        if (res.status === 401) { window.hibana?.handle401?.(res); throw new Error('unauthorized') }
        if (!res.ok) throw new Error('api ' + res.status)
        const ct = res.headers.get('content-type') || ''
        return ct.includes('json') ? res.json() : {}
      }

      /* ── dates ── */
      const isFa = () => document.documentElement.lang === 'fa'
      // S67: shared Persian-digit helper (updateStatus had a private copy; cards now
      // need it too). document.documentElement.lang is set by i18n.js on apply().
      const dig = (n) => (isFa() ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n))
      const fmtDay = (iso) => {
        try { return new Date(iso).toLocaleDateString(isFa() ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' }) } catch { return '' }
      }
      const fmtStamp = (iso) => {
        try { return new Date(iso).toLocaleString(isFa() ? 'fa-IR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) } catch { return '' }
      }

      /* ── folder helpers ── */
      const folderById = (id) => state.folders.find((f) => f.id === id) || null
      const childrenOf = (id) => state.folders.filter((f) => (f.parent_id || null) === id)
        .sort((a, b) => a.name.localeCompare(b.name, isFa() ? 'fa' : 'en'))
      const folderPath = (id) => {
        const parts = []
        const seen = new Set()
        let cur = folderById(id)
        while (cur && !seen.has(cur.id)) { seen.add(cur.id); parts.unshift(cur); cur = folderById(cur.parent_id) }
        return parts
      }
      // live note count per folder — carried by bootstrap (note_count on every row);
      // stale by one action at most until the next bootstrap refetch.
      // S55: counts are CUMULATIVE (the folder's own notes + every descendant's) —
      // a collapsed "Movies" reading 0 while its subfolders hold 3 notes looks
      // broken; Obsidian's convention is the subtree total. Moves are cycle-guarded
      // server-side, so the walk is acyclic by construction.
      const noteCountIn = (folderId) => {
        const f = state.folders.find((x) => x.id === folderId)
        const own = f && typeof f.note_count === 'number' ? f.note_count : 0
        let sub = 0
        for (const k of childrenOf(folderId)) sub += noteCountIn(k.id) ?? 0
        return own + sub
      }

      /* ── floating menu (folder kebabs + editor kebab) ── */
      let pop = null
      const closeMenu = () => { if (pop) { pop.remove(); pop = null } }
      const openMenu = (anchor, items) => {
        closeMenu()
        pop = document.createElement('div')
        pop.className = 'vault-pop'
        pop.setAttribute('role', 'menu')
        for (const it of items) {
          if (it === '-') { const sep = document.createElement('div'); sep.className = 'vault-pop-sep'; pop.appendChild(sep); continue }
          const btn = document.createElement('button')
          btn.type = 'button'
          btn.className = 'vault-pop-item' + (it.danger ? ' is-danger' : '')
          btn.setAttribute('role', 'menuitem')
          btn.innerHTML = (it.icon || '') + '<span>' + esc(it.label) + '</span>'
          btn.addEventListener('click', () => { closeMenu(); it.onClick() })
          pop.appendChild(btn)
        }
        document.body.appendChild(pop)
        // S63: menu keyboard navigation — the pop is role=menu with menuitems, but
        // arrow keys did nothing (Tab-only). ArrowUp/Down cycle, Home/End jump;
        // Escape stays with the global onDocKey closer. Roving focus, no selection
        // state to desync (focus IS the selection).
        pop.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
          const btns = Array.from(pop.querySelectorAll('button'))
          if (!btns.length) return
          e.preventDefault()
          const cur = btns.indexOf(document.activeElement)
          let next = 0
          if (e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % btns.length
          else if (e.key === 'ArrowUp') next = cur < 0 ? btns.length - 1 : (cur - 1 + btns.length) % btns.length
          else if (e.key === 'Home') next = 0
          else next = btns.length - 1
          btns[next].focus()
        })
        const r = anchor.getBoundingClientRect()
        const pw = pop.offsetWidth, ph = pop.offsetHeight
        let x = isFa() ? r.left : r.right - pw
        x = Math.max(8, Math.min(x, window.innerWidth - pw - 8))
        let y = r.bottom + 6
        if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6)
        pop.style.left = x + 'px'
        pop.style.top = y + 'px'
        const first = pop.querySelector('button'); if (first) first.focus()
      }
      const onDocPointer = (e) => { if (pop && !pop.contains(e.target)) closeMenu() }
      document.addEventListener('pointerdown', onDocPointer)
      const onDocKey = (e) => {
        if (e.key !== 'Escape') return
        closeMenu()
        closeDrawer()
        const ed = document.querySelector('[data-vault-editor]')
        if (ed && ed.hasAttribute('data-open')) { closeMobileEditor(); e.preventDefault() }
      }
      document.addEventListener('keydown', onDocKey)

      /* ── toasts (shared app toast with actions) ── */
      const toast = (msg, kind, ms, actions) => window.hibana?.toast?.(msg, kind, ms, actions)

      /* ══════════════ RENDER: sidebar tree ══════════════ */
      const treeEl = () => $('[data-vault-tree-inner]')

      const quickRow = (type, id, icon, labelKey, labelFallback, count, danger) => {
        const cur = state.view.type === type && (type !== 'folder' && type !== 'tag' ? true : state.view.id === id)
        return `<button type="button" class="vault-quick${danger ? ' is-danger' : ''}" data-vault-view="${type}" data-vault-id="${id || ''}" aria-current="${cur}">
          ${icon}<span class="vault-folder-name">${esc(_t(labelKey, labelFallback))}</span>
          ${count != null ? `<span class="vault-n">${count}</span>` : ''}
        </button>`
      }

      const folderRow = (f, depth) => {
        const kids = childrenOf(f.id)
        const isOpen = state.expanded.has(f.id)
        const cur = state.view.type === 'folder' && state.view.id === f.id
        const cnt = noteCountIn(f.id)
        return `<div class="vault-folder-row" data-folder-row="${f.id}" style="padding-inline-start:${depth * 0.85}rem">
          <button type="button" class="vault-tw${kids.length ? '' : ' spacer'}" data-vault-tw="${f.id}" aria-expanded="${kids.length ? isOpen : false}" aria-label="${esc(_t('notes.toggleFolder', 'Expand folder'))}" tabindex="${kids.length ? 0 : -1}">${I.chevron}</button>
          <button type="button" class="vault-folder" data-vault-view="folder" data-vault-id="${f.id}" aria-current="${cur}">
            ${I.folder}<span class="vault-folder-name" dir="auto">${esc(f.name)}</span>
            ${cnt != null ? `<span class="vault-n">${cnt}</span>` : ''}
            <span class="vault-kebab" data-vault-folder-kebab="${f.id}" role="button" tabindex="0" aria-label="${esc(_t('notes.folderMenu', 'Folder options'))}" aria-haspopup="menu">${I.kebab}</span>
          </button>
        </div>
          ${kids.length && isOpen ? kids.map((k) => folderRow(k, depth + 1)).join('') : ''}`
      }

      const renderTree = () => {
        const el = treeEl()
        if (!el) return
        const tagActive = state.view.type === 'tag' ? state.view.id : null
        el.innerHTML = `
          <div class="vault-sec">
            ${quickRow('all', '', I.note, 'notes.allNotes', 'All notes', state.counts.all)}
            ${quickRow('starred', '', I.star, 'notes.starred', 'Starred', state.counts.starred)}
            ${quickRow('unfiled', '', I.layers, 'notes.unfiled', 'Unfiled', state.counts.unfiled)}
            ${quickRow('trash', '', I.trash, 'notes.trash', 'Trash', state.counts.trash, true)}
          </div>
          <div class="vault-sec">
            <div class="vault-sec-head">
              <span>${esc(_t('notes.folders', 'Folders'))}</span>
              <button type="button" class="vault-sec-add" data-vault-newfolder-root aria-label="${esc(_t('notes.newFolder', 'New folder'))}" title="${esc(_t('notes.newFolder', 'New folder'))}">${I.plus}</button>
            </div>
            <div data-vault-folders>${state.folders.length
              ? childrenOf(null).map((f) => folderRow(f, 0)).join('')
              : `<p class="muted small" style="padding:0.25rem 0.5rem;margin:0">${esc(_t('notes.noFolders', 'No folders yet — create one to organize.'))}</p>`}
            </div>
            <div class="vault-newfolder" data-vault-newfolder hidden>
              <input data-vault-newfolder-input maxlength="80" dir="auto" placeholder="${esc(_t('notes.folderName', 'Folder name…'))}" aria-label="${esc(_t('notes.folderName', 'Folder name…'))}">
              <button type="button" class="vault-sec-add" data-vault-newfolder-ok aria-label="${esc(_t('common.save', 'Save'))}">${I.check}</button>
            </div>
          </div>
          ${state.tags.length ? `<div class="vault-sec">
            <div class="vault-sec-head"><span>${esc(_t('notes.tags', 'Tags'))}</span><span class="vault-sec-count vault-n">${state.tags.length}</span></div>
            <div class="vault-tags">
              ${state.tags.slice(0, 18).map((t) => `<button type="button" class="vault-tag-chip" data-vault-tag="${esc(t.tag)}" aria-pressed="${tagActive && tagActive.toLowerCase() === t.tag.toLowerCase()}">#${esc(t.tag)} <span class="vault-n">${t.count}</span></button>`).join('')}
            </div>
          </div>` : ''}`
      }

      /* ══════════════ RENDER: note cards ══════════════ */
      const cardsEl = () => $('[data-vault-cards]')

      const viewTitle = () => {
        if (state.view.type === 'starred') return _t('notes.starred', 'Starred')
        if (state.view.type === 'trash') return _t('notes.trash', 'Trash')
        if (state.view.type === 'unfiled') return _t('notes.unfiled', 'Unfiled')
        if (state.view.type === 'folder') { const f = folderById(state.view.id); return f ? f.name : _t('notes.allNotes', 'All notes') }
        if (state.view.type === 'tag') return '#' + state.view.id
        return _t('notes.allNotes', 'All notes')
      }

      const cardHtml = (n) => {
        const active = state.active && state.active.id === n.id
        const pills = csvTags(n.tags).slice(0, 3).map((t) => `<span class="vault-pill">#${esc(t)}</span>`).join('')
          + inlineTags(n.content).filter((t) => !csvTags(n.tags).some((m) => m.toLowerCase() === t.toLowerCase())).slice(0, 3 - Math.min(3, csvTags(n.tags).length))
            .map((t) => `<span class="vault-pill is-inline">#${esc(t)}</span>`).join('')
        const title = n.title.trim() || _t('notes.untitled', 'Untitled')
        // S67: reading-time chip on the CARD — the S63 reader-head estimate, surfaced
        // where the list is scanned (the S66 next-session candidate). Same rule as the
        // reader: <200 words stays silent (an instant read needs no number); ~200 wpm;
        // Persian digits via dig(). Title tooltip carries the full phrase for clarity.
        const words = Number(n.word_count) || 0
        const readChip = words >= 200
          ? `<span class="vault-card-read" title="${esc(_t('notes.readTime', '~{n} min read').split('{n}').join(dig(Math.max(1, Math.round(words / 200)))))}">${I.clock || ''}${esc(_t('notes.minRead', '~{n} min').split('{n}').join(dig(Math.max(1, Math.round(words / 200)))))}</span>`
          : ''
        return `<article class="vault-card" data-vault-card="${n.id}" aria-current="${active}" tabindex="0">
          <div class="vault-card-date">
            <time datetime="${n.updated_at}">${fmtDay(n.updated_at)}</time>
            ${n.starred ? `<span class="vault-card-star" aria-label="${esc(_t('notes.starred', 'Starred'))}">${I.star}</span>` : ''}
          </div>
          <h2 class="vault-card-title${n.title.trim() ? '' : ' is-untitled'}" dir="auto">${esc(n.title.trim() || title)}</h2>
          ${n.excerpt ? `<p class="vault-card-excerpt" dir="auto">${esc(n.excerpt)}</p>` : ''}
          <div class="vault-card-meta">
            ${pills}
            ${state.view.type === 'trash'
              ? `<span class="vault-card-trash">
                  <button type="button" data-vault-restore="${n.id}">${I.restore}<span>${esc(_t('notes.restore', 'Restore'))}</span></button>
                  <button type="button" class="is-danger" data-vault-purge="${n.id}">${I.trash}<span>${esc(_t('notes.deleteForever', 'Delete forever'))}</span></button>
                </span>`
              : `<span class="vault-card-words">${dig(n.word_count)} ${esc(_t('notes.words', 'words'))}</span>`}
            ${readChip}
          </div>
        </article>`
      }

      const renderCards = () => {
        const el = cardsEl()
        const titleEl = $('[data-vault-view-title]')
        const countEl = $('[data-vault-view-count]')
        if (titleEl) titleEl.textContent = viewTitle()
        if (countEl) countEl.textContent = state.notes.length ? String(state.notes.length) : ''
        if (!el) return
        if (state.loadingList) {
          el.innerHTML = `<div class="vault-sk" aria-hidden="true">
            <div class="vault-sk-card"><div class="skeleton vault-sk-line" style="inline-size:36%"></div><div class="skeleton vault-sk-line"></div><div class="skeleton vault-sk-line" style="inline-size:70%"></div></div>
            <div class="vault-sk-card"><div class="skeleton vault-sk-line" style="inline-size:48%"></div><div class="skeleton vault-sk-line"></div><div class="skeleton vault-sk-line" style="inline-size:62%"></div></div>
            <div class="vault-sk-card"><div class="skeleton vault-sk-line" style="inline-size:30%"></div><div class="skeleton vault-sk-line"></div><div class="skeleton vault-sk-line" style="inline-size:76%"></div></div>
          </div><span class="sr-only">${esc(_t('common.loading', 'Loading…'))}</span>`
          return
        }
        if (!state.notes.length) {
          const inTrash = state.view.type === 'trash'
          el.innerHTML = `<div class="vault-empty">
            <span class="empty-state-icon" aria-hidden="true">${inTrash ? I.trash : I.note}</span>
            <b>${esc(inTrash ? _t('notes.trashEmpty', 'Trash is empty') : state.q ? _t('notes.noResults', 'No matches') : _t('notes.emptyList', 'No notes yet'))}</b>
            <p>${esc(inTrash ? _t('notes.trashEmptyHint', 'Deleted notes rest here before you remove them for good.')
              : state.q ? _t('notes.noResultsHint', 'Try a different search.')
              : state.view.type === 'folder' ? _t('notes.emptyFolderHint', 'This folder is empty — create the first note.')
              : _t('notes.emptyListHint', 'The long-form knowledge base: curated lists, reference notes, things worth keeping.'))}</p>
            ${!inTrash && !state.q ? `<button type="button" class="vault-new" data-vault-new style="margin-block-start:0.5rem">${I.plus}<span>${esc(_t('notes.newNote', 'New note'))}</span></button>` : ''}
            ${!inTrash && !state.q && state.view.type === 'all' && state.counts.all === 0 && state.counts.has_sparks ? `<button type="button" class="vault-meta-add" data-vault-import style="margin-block-start:0.375rem;align-self:center">${I.copy}<span>${esc(_t('notes.importIdeas', 'Import your ideas'))}</span></button>` : ''}
            ${!inTrash && !state.q && state.view.type === 'all' && state.counts.all === 0 && state.counts.has_quicknotes ? `<button type="button" class="vault-meta-add" data-vault-import-qn style="margin-block-start:0.375rem;align-self:center">${I.copy}<span>${esc(_t('notes.importQuick', 'Import your quick notes'))}</span></button>` : ''}
          </div>`
          return
        }
        el.innerHTML = state.notes.map(cardHtml).join('')
      }

      /* ══════════════ RENDER: editor ══════════════ */
      const editorEl = () => $('[data-vault-editor]')

      const saveLabel = () => {
        if (state.saveState === 'saving') return _t('notes.saving', 'Saving…')
        if (state.saveState === 'saved') return _t('notes.saved', 'Saved')
        if (state.saveState === 'error') return _t('notes.saveFailed', 'Save failed — retry?')
        if (state.saveState === 'dirty') return _t('notes.unsaved', 'Unsaved')
        return ''
      }

      const crumbsHtml = () => {
        const path = state.active && state.active.folder_id ? folderPath(state.active.folder_id) : []
        if (!path.length) return `<button type="button" class="vault-crumb-leaf" data-vault-crumb-unfile>${esc(_t('notes.unfiled', 'Unfiled'))}</button>`
        // S54 fix: the path IS the crumb chain — every folder is clickable (incl. the
        // leaf), and there is NO trailing "Unfiled" on a filed note (it used to read
        // "Movies › Sci-fi › Unfiled", implying the note was unfiled).
        return path.map((f, i) =>
          (i ? '<span class="icon-sep">' + I.chevron + '</span>' : '') +
          `<button type="button" data-vault-crumb="${f.id}" dir="auto" class="${i === path.length - 1 ? 'vault-crumb-leaf' : ''}">${esc(f.name)}</button>`,
        ).join('')
      }

      const tagPillsHtml = () => {
        const pills = csvTags(state.draft.tags)
        const trash = !!state.active?.deleted_at // frozen: the pills stay, the ×-buttons don't
        return pills.map((t) => `<span class="vault-meta-pill">#${esc(t)}${trash ? '' : `
            <button type="button" data-vault-tagrm="${esc(t)}" aria-label="${esc(_t('notes.removeTag', 'Remove tag'))} ${esc(t)}">${I.x}</button>`}
          </span>`).join('')
      }

      const renderEditor = () => {
        const el = editorEl()
        if (!el) return
        if (!state.active) {
          el.innerHTML = `<div class="vault-ed-empty">
            <span class="empty-state-icon" aria-hidden="true">${I.note}</span>
            <b>${esc(_t('notes.emptyEditorTitle', 'Nothing open'))}</b>
            <span>${esc(_t('notes.emptyEditorHint', 'Pick a note from the list, or create a new one.'))}</span>
          </div>`
          return
        }
        const n = state.active
        const trash = !!n.deleted_at
        el.innerHTML = `<div class="vault-ed">
          <div class="vault-ed-head">
            <button type="button" class="vault-ed-back" data-vault-back aria-label="${esc(_t('common.back', 'Back'))}">${I.arrowBack}</button>
            <div class="vault-crumb" data-vault-crumb-bar>${crumbsHtml()}</div>
            <div class="vault-ed-actions">
              <button type="button" class="vault-iconbtn" data-vault-star aria-pressed="${n.starred === 1}" aria-label="${esc(_t('notes.toggleStar', 'Star'))}" title="${esc(_t('notes.toggleStar', 'Star'))}" ${trash ? 'disabled' : ''}>${n.starred === 1 ? I.star : I.starOpen}</button>
              <button type="button" class="vault-iconbtn" data-vault-kebab aria-label="${esc(_t('notes.noteMenu', 'Note options'))}" aria-haspopup="menu">${I.kebab}</button>
            </div>
          </div>
          <div class="vault-ed-titlewrap">
            <input class="vault-ed-title" data-vault-title dir="auto" maxlength="300"
              placeholder="${esc(_t('notes.titlePlaceholder', 'Untitled'))}"
              value="${esc(state.draft.title)}"
              ${trash ? 'readonly' : ''} aria-label="${esc(_t('notes.titleLabel', 'Note title'))}">
          </div>
          <div class="vault-ed-meta">
            ${tagPillsHtml()}
            ${!trash ? `<button type="button" class="vault-meta-add" data-vault-tagadd>${I.plus}<span>${esc(_t('notes.addTag', 'Add tag'))}</span></button>` : ''}
            <span class="vault-ed-stamp">${esc(_t('notes.edited', 'Edited'))} ${fmtStamp(n.updated_at)}</span>
          </div>
          <div class="vault-toolbar" role="toolbar" aria-label="${esc(_t('notes.toolbar', 'Formatting'))}">
            <button type="button" class="vault-tb" data-vault-tb="bold" title="**${esc(_t('notes.tb.bold', 'Bold'))}**" aria-label="${esc(_t('notes.tb.bold', 'Bold'))}"><b>B</b></button>
            <button type="button" class="vault-tb" data-vault-tb="italic" title="*${esc(_t('notes.tb.italic', 'Italic'))}*" aria-label="${esc(_t('notes.tb.italic', 'Italic'))}"><i>I</i></button>
            <button type="button" class="vault-tb" data-vault-tb="strike" title="~~${esc(_t('notes.tb.strike', 'Strikethrough'))}~~" aria-label="${esc(_t('notes.tb.strike', 'Strikethrough'))}"><s>S</s></button>
            <button type="button" class="vault-tb" data-vault-tb="code" title="\`${esc(_t('notes.tb.code', 'Code'))}\`" aria-label="${esc(_t('notes.tb.code', 'Code'))}">&lt;/&gt;</button>
            <span class="vault-tb-sep"></span>
            <button type="button" class="vault-tb" data-vault-tb="h1" title="# ${esc(_t('notes.tb.h1', 'Heading 1'))}" aria-label="${esc(_t('notes.tb.h1', 'Heading 1'))}">H1</button>
            <button type="button" class="vault-tb" data-vault-tb="h2" title="## ${esc(_t('notes.tb.h2', 'Heading 2'))}" aria-label="${esc(_t('notes.tb.h2', 'Heading 2'))}">H2</button>
            <button type="button" class="vault-tb" data-vault-tb="h3" title="### ${esc(_t('notes.tb.h3', 'Heading 3'))}" aria-label="${esc(_t('notes.tb.h3', 'Heading 3'))}">H3</button>
            <span class="vault-tb-sep"></span>
            <button type="button" class="vault-tb" data-vault-tb="ul" title="- ${esc(_t('notes.tb.list', 'Bulleted list'))}" aria-label="${esc(_t('notes.tb.list', 'Bulleted list'))}">•≡</button>
            <button type="button" class="vault-tb" data-vault-tb="ol" title="1. ${esc(_t('notes.tb.olist', 'Numbered list'))}" aria-label="${esc(_t('notes.tb.olist', 'Numbered list'))}">1≡</button>
            <button type="button" class="vault-tb" data-vault-tb="quote" title="&gt; ${esc(_t('notes.tb.quote', 'Quote'))}" aria-label="${esc(_t('notes.tb.quote', 'Quote'))}">❝</button>
            <span class="vault-tb-sep"></span>
            <button type="button" class="vault-tb" data-vault-tb="link" title="[${esc(_t('notes.tb.link', 'Link'))}](url)" aria-label="${esc(_t('notes.tb.link', 'Link'))}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 19"/></svg>
            </button>
            <button type="button" class="vault-tb" data-vault-tb="hr" title="---" aria-label="${esc(_t('notes.tb.hr', 'Divider'))}">—</button>
            <div class="vault-modes" role="group" aria-label="${esc(_t('notes.editorMode', 'Editor mode'))}">
              <button type="button" class="vault-mode" data-vault-mode="edit" aria-pressed="${state.mode === 'edit'}">${esc(_t('notes.modeEdit', 'Edit'))}</button>
              <button type="button" class="vault-mode" data-vault-mode="split" aria-pressed="${state.mode === 'split'}">${esc(_t('notes.modeSplit', 'Split'))}</button>
              <button type="button" class="vault-mode" data-vault-mode="read" aria-pressed="${state.mode === 'read'}">${esc(_t('notes.modeRead', 'Read'))}</button>
            </div>
          </div>
          <div class="vault-body" data-mode="${state.mode}">
            <textarea class="vault-src" data-vault-src dir="auto" spellcheck="true"
              placeholder="${esc(_t('notes.writeHere', 'Write… markdown welcome'))}"
              aria-label="${esc(_t('notes.contentLabel', 'Note content'))}"
              ${trash ? 'readonly' : ''}>${esc(state.draft.content)}</textarea>
            <div class="vault-preview" data-vault-preview aria-label="${esc(_t('notes.preview', 'Preview'))}">
              <div class="markdown-body" data-vault-preview-body dir="auto">${renderMarkdown(state.draft.content)}</div>
            </div>
          </div>
          <div class="vault-status">
            <span class="vault-save" data-vault-save data-state="${state.saveState}">${esc(saveLabel())}</span>
            <span class="vault-status-words" data-vault-words></span>
          </div>
        </div>`
        updateStatus()
        wirePreview()
      }

      const updateStatus = () => {
        const wordsEl = $('[data-vault-words]')
        if (wordsEl) {
          const words = state.draft.content.trim() ? state.draft.content.trim().split(/\s+/).length : 0
          const chars = state.draft.content.length
          // S62: Persian digits in the FA locale — the rest of the vault (counter,
          // lightboxes) localizes numerals; the word count was the lone Latin-digit
          // holdout. document.documentElement.lang is set by i18n.js on apply().
          const dig = (n) => (document.documentElement.lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n))
          // S63: reading-time estimate — only once the note is long enough for the
          // number to mean something (a 30-word note is "instant"). ~200 wpm; the
          // reading speed is the same order in FA. Persian digits via dig().
          const mins = Math.max(1, Math.round(words / 200))
          const readTime = words >= 200 ? ' · ' + _t('notes.readTime', '~{n} min read').split('{n}').join(dig(mins)) : ''
          wordsEl.textContent = dig(words) + ' ' + _t('notes.words', 'words') + ' · ' + dig(chars) + ' ' + _t('notes.chars', 'chars') + readTime
        }
        const saveEl = $('[data-vault-save]')
        if (saveEl) {
          saveEl.setAttribute('data-state', state.saveState)
          saveEl.textContent = saveLabel()
        }
      }

      const renderPreview = () => {
        const body = $('[data-vault-preview-body]')
        if (body) body.innerHTML = renderMarkdown(state.draft.content)
        wirePreview()
      }

      /* ── S56: heading outline — Obsidian's "On this page" nav for the preview pane.
         Headings h1–h3 are parsed OUTSIDE fenced code blocks (a # inside ``` is code,
         not a heading); the outline shows when there are ≥ 2 headings (one heading is
         just the title, not a structure worth navigating). Clicking an item scrolls the
         preview pane to its heading; the pane's scroll position highlights the section
         you're reading. Lives INSIDE the preview pane so edit-mode hides it for free. ── */
      const outlineOf = (content) => {
        const out = []
        let inFence = false
        for (const line of String(content || '').split('\n')) {
          if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
          if (inFence) continue
          const m = /^(#{1,3})\s+(\S.*)$/.exec(line)
          if (m) out.push({ level: m[1].length, text: m[2].trim().replace(/[*_`~]*/, '').slice(0, 80) })
        }
        return out
      }

      const outlineCollapsed = () => {
        // S59b mobile dropdown variant: an EXPLICIT user pref always wins (the toggle
        // persists prefs.outline true/false). With no pref yet, phones/tablet-portrait
        // (≤940px — same breakpoint where the vault tree becomes a drawer) start
        // COLLAPSED: an open 38vh list over a 390px reading pane is space the note
        // itself needs. The collapsed head carries the live current-section label
        // (dropdown-style "current value"), so the row still answers "where am I?".
        if (prefs.outline === true || prefs.outline === false) return prefs.outline === false
        return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 940px)').matches
      }

      const wirePreview = () => {
        const pane = $('[data-vault-preview]')
        const body = $('[data-vault-preview-body]')
        if (!pane || !body) return
        // tag the rendered headings sequentially (data-vh mirrors the outline index)
        const heads = [...body.querySelectorAll('h1, h2, h3')]
        heads.forEach((h, i) => { h.dataset.vh = String(i) })
        // (re)build the outline box above the rendered content
        let nav = pane.querySelector('[data-vault-outline]')
        const items = outlineOf(state.draft.content)
        if (items.length < 2) { if (nav) nav.remove(); return }
        if (!nav) {
          nav = document.createElement('nav')
          nav.className = 'vault-outline'
          nav.setAttribute('data-vault-outline', '')
          nav.setAttribute('aria-label', _t('notes.outline', 'On this page'))
          pane.insertBefore(nav, pane.firstChild)
        }
        nav.dataset.open = outlineCollapsed() ? 'false' : 'true'
        nav.innerHTML = `<button type="button" class="vault-outline-head" data-vault-outline-toggle aria-expanded="${!outlineCollapsed()}">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h13"/></svg>
          <span>${esc(_t('notes.outline', 'On this page'))}</span>
          <span class="vault-outline-now" aria-hidden="true"></span>
          <svg class="icon vault-outline-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <ol class="vault-outline-list">
          ${items.map((it, i) => `<li class="vault-outline-item is-l${it.level}" data-vault-outline-item="${i}"><button type="button" data-vault-goto="${i}" tabindex="${outlineCollapsed() ? -1 : 0}"><span>${esc(it.text)}</span></button></li>`).join('')}
        </ol>`
        // active-heading tracking on pane scroll (passive — never blocks scrolling).
        // Rule: the last heading above the fold line (48px) is "where you're reading".
        // At the pane's BOTTOM (short notes can't scroll a late heading to the top),
        // the last heading still VISIBLE wins instead — so clicking an outline item
        // always highlights the section you jumped to.
        // S59b: tracking runs in BOTH states — collapsed updates the head's live
        // section label (dropdown "current value"); open updates the item highlights.
        pane.onscroll = () => {
          if (!heads.length) return
          const prect = pane.getBoundingClientRect()
          let active = 0
          for (const h of heads) {
            if (h.getBoundingClientRect().top - prect.top <= 48) active = Number(h.dataset.vh || 0)
          }
          if (pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 2) {
            for (const h of heads) {
              if (h.getBoundingClientRect().top - prect.top < prect.height - 8) active = Number(h.dataset.vh || 0)
            }
          }
          const nowEl = nav.querySelector('.vault-outline-now')
          if (nowEl) nowEl.textContent = items[active]?.text || ''
          if (outlineCollapsed()) return
          let activeEl = null
          nav.querySelectorAll('.vault-outline-item').forEach((li) => {
            const on = Number(li.getAttribute('data-vault-outline-item')) === active
            li.classList.toggle('is-active', on)
            if (on) activeEl = li
          })
          // keep the ACTIVE item visible inside the (scrollable) outline list itself —
          // manual scroll so the page/pane never moves, only the list
          const list = nav.querySelector('.vault-outline-list')
          if (activeEl && list && list.scrollHeight > list.clientHeight) {
            const lt = activeEl.getBoundingClientRect().top - list.getBoundingClientRect().top
            if (lt < 0) list.scrollTop += lt - 4
            else if (lt > list.clientHeight - activeEl.offsetHeight) list.scrollTop += lt - list.clientHeight + activeEl.offsetHeight + 4
          }
        }
        pane.onscroll() // initial state: highlight where the pane starts (heading 0)
      }

      const onOutlineClick = (e) => {
        const t = e.target instanceof Element ? e.target : null
        if (!t) return
        const nav = t.closest('[data-vault-outline]')
        if (!nav) return
        const toggle = t.closest('[data-vault-outline-toggle]')
        if (toggle) {
          const open = nav.dataset.open !== 'true'
          nav.dataset.open = String(open)
          toggle.setAttribute('aria-expanded', String(open))
          nav.querySelectorAll('.vault-outline-item button').forEach((b) => { b.tabIndex = open ? 0 : -1 })
          prefs.outline = open
          savePrefs()
          return
        }
        const item = t.closest('[data-vault-outline-item] button')
        if (item) {
          const pane = $('[data-vault-preview]')
          // resolve the HEADING inside the preview body (data-vh lives on rendered
          // h1–h3 only — the outline buttons ride data-vault-goto, so no collision)
          const head = pane?.querySelector(`[data-vault-preview-body] [data-vh="${item.getAttribute('data-vault-goto')}"]`)
          if (pane && head) {
            const delta = head.getBoundingClientRect().top - pane.getBoundingClientRect().top
            pane.scrollTo({ top: pane.scrollTop + delta - 10, behavior: 'smooth' })
          }
        }
      }

      /* ══════════════ data flows ══════════════ */
      let bootSeq = 0
      const loadBootstrap = async () => {
        const seq = ++bootSeq
        try {
          const boot = await api('/api/vault/bootstrap')
          if (seq !== bootSeq) return
          state.folders = boot.folders || []
          state.tags = boot.tags || []
          state.counts = boot.counts || { all: 0, starred: 0, trash: 0 }
          renderTree()
        } catch { /* 401 already handled; transient — the next action refetches */ }
      }

      let listSeq = 0
      const loadNotes = async () => {
        const seq = ++listSeq
        state.loadingList = true
        renderCards()
        try {
          const qs = new URLSearchParams()
          if (state.view.type === 'folder' && state.view.id) { qs.set('view', 'folder'); qs.set('folder', state.view.id) }
          else if (state.view.type === 'unfiled') { qs.set('view', 'folder'); qs.set('folder', 'none') }
          else if (state.view.type === 'tag') { qs.set('view', 'all'); qs.set('tag', state.view.id) }
          else qs.set('view', state.view.type)
          if (state.q) qs.set('q', state.q)
          if (state.sort) qs.set('sort', state.sort)
          const res = await api('/api/vault/notes?' + qs.toString())
          if (seq !== listSeq) return
          state.notes = res.notes || []
        } catch {
          if (seq === listSeq) state.notes = []
        } finally {
          if (seq === listSeq) { state.loadingList = false; renderCards() }
        }
      }

      const setView = (type, id, name) => {
        state.view = { type, id: id || null, name: name || '' }
        state.active = null
        state.draft = { title: '', content: '', tags: '' }
        state.saveState = 'idle'
        renderTree()
        renderEditor()
        closeDrawer()
        loadNotes()
      }

      /* ── open / close note ── */
      const flushSave = async () => {
        if (!state.active || state.active.deleted_at) return
        if (!state.saveTimer) return // nothing pending
        clearTimeout(state.saveTimer)
        state.saveTimer = null
        await doSave()
      }

      const doSave = async () => {
        if (!state.active || state.active.deleted_at) return
        const payload = { title: state.draft.title, content: state.draft.content }
        state.saveState = 'saving'
        updateStatus()
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify(payload) })
          state.active = res.note
          state.saveState = 'saved'
          // patch the card in place (no list refetch — keeps scroll + feels instant)
          const idx = state.notes.findIndex((c) => c.id === state.active.id)
          if (idx >= 0) {
            state.notes[idx] = { ...state.notes[idx], title: state.active.title, tags: state.active.tags, starred: state.active.starred, folder_id: state.active.folder_id, updated_at: state.active.updated_at }
            const cardEl = document.querySelector('[data-vault-card="' + state.active.id + '"]')
            if (cardEl) cardEl.outerHTML = cardHtml(state.notes[idx])
          }
          const stampEl = document.querySelector('.vault-ed-stamp')
          if (stampEl) stampEl.textContent = _t('notes.edited', 'Edited') + ' ' + fmtStamp(state.active.updated_at)
          setTimeout(() => { if (state.saveState === 'saved') { state.saveState = 'idle'; updateStatus() } }, 2200)
        } catch {
          state.saveState = 'error'
        }
        updateStatus()
      }

      const markDirty = () => {
        if (state.saveState !== 'saving') state.saveState = 'dirty'
        updateStatus()
        if (state.saveTimer) clearTimeout(state.saveTimer)
        state.saveTimer = setTimeout(() => { state.saveTimer = null; doSave() }, 900)
      }

      const openNote = async (id, { focusBody = true } = {}) => {
        await flushSave()
        try {
          const res = await api('/api/vault/notes/' + id)
          state.active = res.note
          state.draft = { title: res.note.title, content: res.note.content, tags: res.note.tags }
          state.saveState = 'idle'
          state.saveTimer = null
          renderEditor()
          renderCards() // refresh the aria-current highlight
          if (isMobile()) $('[data-vault-editor]')?.setAttribute('data-open', 'true')
          try { history.replaceState(null, '', '#n=' + id) } catch {}
          if (focusBody) { const ta = $('[data-vault-src]'); if (ta && state.mode !== 'read') { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length) } }
        } catch { toast(_t('notes.openFailed', 'Could not open that note.'), 'err') }
      }

      const closeNote = async () => {
        await flushSave()
        state.active = null
        state.draft = { title: '', content: '', tags: '' }
        state.saveState = 'idle'
        renderEditor()
        renderCards()
        try { history.replaceState(null, '', location.pathname) } catch {}
      }

      /* ── S63: jump-to-match — arriving from the palette's vault search, scroll the
         note to WHERE the query hit and flash it: split/read → the preview's first
         matching text node wrapped in a temporary <mark class="vault-jump"> that
         unwraps itself after the flash; edit mode → the textarea's native selection
         (focusing without preventScroll makes the browser scroll the caret into
         view — the selection IS the jump). A title-only match (body miss) is a
         graceful no-op. The query rides the deep link's hash (#n=<id>&q=<term>) and
         is stripped by openNote's replaceState, so a reload reopens clean. ── */
      const jumpToMatch = (term) => {
        const needle = String(term || '').toLowerCase()
        if (!needle) return
        if (state.mode === 'edit') {
          const ta = $('[data-vault-src]')
          if (!ta) return
          const idx = ta.value.toLowerCase().indexOf(needle)
          if (idx < 0) return
          try { ta.setSelectionRange(idx, idx + needle.length) } catch { /* detached */ }
          ta.focus()
          return
        }
        const body = $('[data-vault-preview-body]')
        if (!body) return
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const i = node.nodeValue ? node.nodeValue.toLowerCase().indexOf(needle) : -1
          if (i >= 0 && node.nodeValue) {
            const range = document.createRange()
            range.setStart(node, i)
            range.setEnd(node, i + needle.length)
            const mark = document.createElement('mark')
            mark.className = 'vault-jump'
            try { range.surroundContents(mark) } catch { return }
            mark.scrollIntoView({ block: 'center' })
            setTimeout(() => {
              if (mark.parentNode) { mark.replaceWith(...Array.from(mark.childNodes)); body.normalize() }
            }, 2600)
            return
          }
        }
      }

      const newNote = async () => {
        await flushSave()
        const folderId = state.view.type === 'folder' ? state.view.id : null
        try {
          const res = await api('/api/vault/notes', { method: 'POST', body: JSON.stringify({ title: '', content: '', folderId }) })
          state.active = res.note
          state.draft = { title: '', content: '', tags: '' }
          state.saveState = 'idle'
          renderEditor()
          await loadBootstrap()
          await loadNotes()
          if (isMobile()) $('[data-vault-editor]')?.setAttribute('data-open', 'true')
          const t = $('[data-vault-title]')
          if (t) { t.focus(); t.select && t.select() }
        } catch { toast(_t('notes.createFailed', 'Could not create the note.'), 'err') }
      }

      /* ── note actions ── */
      const toggleStar = async () => {
        if (!state.active) return
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify({ starred: state.active.starred !== 1 }) })
          state.active = res.note
          renderEditor()
          renderCards()
          loadBootstrap()
        } catch { toast(_t('notes.starFailed', 'Could not star the note.'), 'err') }
      }

      const deleteNote = async (id) => {
        try {
          await api('/api/vault/notes/' + id, { method: 'DELETE' })
          const wasActive = state.active && state.active.id === id
          if (wasActive) { state.active = null; state.draft = { title: '', content: '', tags: '' }; renderEditor() }
          toast(_t('notes.deletedNote', 'Note moved to Trash'), 'info', 6000, [
            { label: _t('notes.undo', 'Undo'), kind: 'primary', onClick: async () => {
              try { await api('/api/vault/notes/' + id + '/restore', { method: 'POST' }); loadBootstrap(); loadNotes() } catch {}
            } },
          ])
          loadBootstrap()
          loadNotes()
        } catch { toast(_t('notes.deleteFailed', 'Could not delete the note.'), 'err') }
      }

      const restoreNote = async (id) => {
        try {
          await api('/api/vault/notes/' + id + '/restore', { method: 'POST' })
          toast(_t('notes.restored', 'Note restored'), 'ok', 3000)
          // S54: restoring the OPEN note unfreezes its editor in place (no reload).
          if (state.active && state.active.id === id) {
            try {
              const res = await api('/api/vault/notes/' + id)
              state.active = res.note
              state.draft = { title: res.note.title, content: res.note.content, tags: res.note.tags }
              state.saveState = 'idle'
              renderEditor()
            } catch { /* the editor keeps its trashed render; the lists below still refresh */ }
          }
          loadBootstrap()
          loadNotes()
        } catch { toast(_t('notes.restoreFailed', 'Could not restore.'), 'err') }
      }

      const purgeNote = async (id) => {
        try {
          await api('/api/vault/notes/' + id + '/purge', { method: 'POST' })
          toast(_t('notes.purged', 'Deleted forever'), 'ok', 3000)
          loadBootstrap()
          loadNotes()
        } catch { toast(_t('notes.purgeFailed', 'Could not delete forever.'), 'err') }
      }

      const duplicateNote = async () => {
        if (!state.active) return
        await flushSave()
        try {
          const res = await api('/api/vault/notes/' + state.active.id + '/duplicate', { method: 'POST' })
          loadBootstrap()
          await loadNotes()
          openNote(res.note.id)
          toast(_t('notes.duplicated', 'Note duplicated'), 'ok', 2500)
        } catch { toast(_t('notes.duplicateFailed', 'Could not duplicate.'), 'err') }
      }

      /* ── S62: Copy as Markdown — the clipboard twin of Export as .md (same body:
         trimmed title as H1 + content, byte-for-byte what the file export produces).
         For pasting a note into Telegram/emails/docs without a download round-trip.
         flushSave() first so an unsaved keystroke lands in the copy too; the legacy
         execCommand fallback covers non-secure contexts where the async Clipboard
         API is absent. Works on trashed notes too — the data is already client-side. ── */
      const copyNoteMd = async () => {
        if (!state.active) return
        await flushSave()
        const body = (state.draft.title.trim() ? `# ${state.draft.title.trim()}\n\n` : '') + state.draft.content
        try {
          await navigator.clipboard.writeText(body)
          toast(_t('notes.copiedMd', 'Copied as Markdown'), 'ok', 2500)
        } catch {
          try {
            const ta = document.createElement('textarea')
            ta.value = body
            ta.setAttribute('readonly', '')
            ta.style.cssText = 'position:fixed;inset-inline-start:-9999px;opacity:0'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            ta.remove()
            toast(_t('notes.copiedMd', 'Copied as Markdown'), 'ok', 2500)
          } catch { toast(_t('notes.copyFailed', 'Could not copy.'), 'err') }
        }
      }

      const moveNote = async (folderId) => {
        if (!state.active) return
        await flushSave()
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify({ folderId }) })
          state.active = res.note
          renderEditor()
          loadNotes()
          loadBootstrap()
          toast(_t('notes.moved', 'Note moved'), 'ok', 2200)
        } catch { toast(_t('notes.moveFailed', 'Could not move the note.'), 'err') }
      }

      const moveMenu = () => {
        if (!state.active) return
        const cur = state.active.folder_id
        const items = [{ icon: I.layers, label: _t('notes.moveToUnfiled', 'Unfiled'), onClick: () => moveNote(null) }, '-']
        const walk = (depth) => (f) => {
          items.push({
            icon: I.folder,
            label: ' '.repeat(depth * 2) + f.name,
            onClick: () => moveNote(f.id),
          })
          childrenOf(f.id).forEach(walk(depth + 1))
        }
        childrenOf(null).forEach(walk(0))
        const anchor = $('[data-vault-kebab]')
        if (anchor) openMenu(anchor, items)
      }

      const noteMenu = (anchor) => {
        if (!state.active) return
        const n = state.active
        // S54 fix: a trashed note is FROZEN server-side (move/duplicate/re-trash all
        // 404) — its menu offers exactly the two things that work on it.
        if (n.deleted_at) {
          openMenu(anchor, [
            { icon: I.restore, label: _t('notes.restore', 'Restore'), onClick: () => restoreNote(n.id) },
            { icon: I.copy, label: _t('notes.copyMd', 'Copy as Markdown'), onClick: copyNoteMd },
            { icon: I.download, label: _t('notes.exportMd', 'Export as .md'), onClick: () => { window.location.href = '/api/vault/notes/' + n.id + '/export.md' } },
          ])
          return
        }
        const items = []
        items.push({ icon: I.move, label: _t('notes.moveTo', 'Move to folder…'), onClick: moveMenu })
        items.push({ icon: I.copy, label: _t('notes.duplicate', 'Duplicate'), onClick: duplicateNote })
        items.push({ icon: I.copy, label: _t('notes.copyMd', 'Copy as Markdown'), onClick: copyNoteMd })
        items.push({ icon: I.download, label: _t('notes.exportMd', 'Export as .md'), onClick: () => { window.location.href = '/api/vault/notes/' + n.id + '/export.md' } })
        items.push('-')
        items.push({ icon: I.trash, label: _t('notes.moveToTrash', 'Move to Trash'), danger: true, onClick: () => deleteNote(n.id) })
        openMenu(anchor, items)
      }

      /* ── S54: sparks → vault import (one-way copy; the sparks stay put) ── */
      const importIdeas = async () => {
        try {
          const res = await api('/api/vault/import/sparks', { method: 'POST' })
          if (res.created > 0) {
            toast(_t('notes.importDone', 'Imported {n} idea(s) as notes').split('{n}').join(String(res.created)), 'ok', 4000)
            await loadBootstrap()
            await loadNotes()
            renderTree()
          } else {
            toast(_t('notes.importNone', 'All your ideas are already notes here'), 'info', 3500)
          }
        } catch { toast(_t('notes.importFailed', 'Import failed.'), 'err') }
      }

      /* ── S55: quick notes → vault import (the sparks twin — copy, never move) ── */
      const importQuicknotes = async () => {
        try {
          const res = await api('/api/vault/import/quicknotes', { method: 'POST' })
          if (res.created > 0) {
            toast(_t('notes.importQuickDone', 'Imported {n} quick note(s)').split('{n}').join(String(res.created)), 'ok', 4000)
            await loadBootstrap()
            await loadNotes()
            renderTree()
          } else {
            toast(_t('notes.importQuickNone', 'All your quick notes are already notes here'), 'info', 3500)
          }
        } catch { toast(_t('notes.importFailed', 'Import failed.'), 'err') }
      }

      /* ── folder actions ── */
      const newFolderInline = (parentId, anchorRow) => {
        const box = $('[data-vault-newfolder]')
        if (!box) return
        box.hidden = false
        box.dataset.parent = parentId || ''
        const input = $('[data-vault-newfolder-input]')
        if (input) { input.value = ''; input.placeholder = _t('notes.folderName', 'Folder name…'); input.focus() }
      }

      const commitFolder = async () => {
        const box = $('[data-vault-newfolder]')
        const input = $('[data-vault-newfolder-input]')
        if (!box || !input) return
        const name = input.value.trim()
        const parentId = box.dataset.parent || null
        if (!name) { box.hidden = true; return }
        try {
          await api('/api/vault/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) })
          box.hidden = true
          if (parentId) state.expanded.add(parentId)
          await loadBootstrap()
          renderTree()
        } catch { toast(_t('notes.folderCreateFailed', 'Could not create the folder.'), 'err') }
      }

      const folderMenu = (id, anchor) => {
        const f = folderById(id)
        if (!f) return
        openMenu(anchor, [
          { icon: I.pencil, label: _t('notes.renameFolder', 'Rename…'), onClick: () => renameFolderDialog(f) },
          { icon: I.folder, label: _t('notes.newSubfolder', 'New subfolder…'), onClick: () => { state.expanded.add(f.id); renderTree(); newFolderInline(f.id) } },
          '-',
          { icon: I.trash, label: _t('notes.deleteFolder', 'Delete folder'), danger: true, onClick: () => deleteFolderDialog(f) },
        ])
      }

      const renameFolderDialog = (f) => {
        // inline prompt row reuses the new-folder box with a rename intent
        const box = $('[data-vault-newfolder]')
        const input = $('[data-vault-newfolder-input]')
        if (!box || !input) return
        box.hidden = false
        box.dataset.parent = f.parent_id || ''
        box.dataset.rename = f.id
        input.value = f.name
        input.placeholder = _t('notes.folderName', 'Folder name…')
        input.focus()
        input.select && input.select()
      }

      const commitRename = async () => {
        const box = $('[data-vault-newfolder]')
        const input = $('[data-vault-newfolder-input]')
        if (!box || !input) return
        const id = box.dataset.rename
        const name = input.value.trim()
        if (!name) { box.hidden = true; delete box.dataset.rename; return }
        try {
          await api('/api/vault/folders/' + id, { method: 'PATCH', body: JSON.stringify({ name }) })
          box.hidden = true
          delete box.dataset.rename
          await loadBootstrap()
          renderTree()
          renderCards() // folder view title may change
        } catch { toast(_t('notes.folderRenameFailed', 'Could not rename.'), 'err') }
      }

      const deleteFolderDialog = (f) => {
        const path = folderPath(f.id)
        const label = path.map((x) => x.name).join(' / ')
        toast(_t('notes.deleteFolderConfirm', 'Delete folder') + ' «' + label + '»? ' + _t('notes.deleteFolderHint', 'Its notes move to Unfiled — nothing is lost.'), 'info', 0, [
          { label: _t('common.delete', 'Delete'), onClick: async () => {
            try {
              await api('/api/vault/folders/' + f.id, { method: 'DELETE' })
              if (state.view.type === 'folder' && (state.view.id === f.id || folderPath(state.view.id).some((x) => x.id === f.id))) setView('all')
              else { await loadBootstrap(); renderTree() }
              toast(_t('notes.folderDeleted', 'Folder deleted — notes kept in Unfiled'), 'ok', 3500)
            } catch { toast(_t('notes.folderDeleteFailed', 'Could not delete the folder.'), 'err') }
          } },
        ])
      }

      /* ── tag actions ── */
      const addTagInline = () => {
        const addBtn = $('[data-vault-tagadd]')
        if (!addBtn || !state.active) return
        const form = document.createElement('form')
        form.className = 'vault-meta-add'
        form.innerHTML = `<input data-vault-taginput dir="auto" maxlength="40" placeholder="${esc(_t('notes.tagPlaceholder', 'tag name'))}" aria-label="${esc(_t('notes.addTag', 'Add tag'))}">`
        addBtn.replaceWith(form)
        const input = form.querySelector('input')
        input.focus()
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          const t = input.value.trim().replace(/^#/, '').replace(/,/g, ' ')
          if (t) saveTags(csvTags(state.draft.tags).concat([t]).join(', '))
          else renderEditor()
        })
        input.addEventListener('blur', () => setTimeout(() => { if (!document.contains(input)) return; if (!input.value.trim()) renderEditor() }, 120))
      }

      const saveTags = async (csv) => {
        if (!state.active) return
        state.draft.tags = csv
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify({ tags: csv }) })
          state.active = res.note
          state.draft.tags = res.note.tags
          renderEditor()
          const idx = state.notes.findIndex((c) => c.id === state.active.id)
          if (idx >= 0) state.notes[idx] = { ...state.notes[idx], tags: res.note.tags }
          renderCards()
          loadBootstrap()
        } catch { toast(_t('notes.tagSaveFailed', 'Could not save the tag.'), 'err') }
      }

      /* ── toolbar: markdown edits around the textarea selection ── */
      const wrapSel = (ta, before, after, placeholder) => {
        const start = ta.selectionStart, end = ta.selectionEnd
        const sel = ta.value.slice(start, end) || placeholder || ''
        const already = ta.value.slice(start - before.length, start) === before && ta.value.slice(end, end + after.length) === after
        ta.setRangeText(already ? sel : before + sel + after, start - (already ? before.length : 0), already ? end + after.length : end, 'select')
        if (already) { ta.selectionStart = start - before.length; ta.selectionEnd = ta.selectionStart + sel.length }
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
      }

      const linePrefix = (ta, prefix, numbered) => {
        const v = ta.value
        let start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1
        let end = v.indexOf('\n', ta.selectionEnd)
        if (end === -1) end = v.length
        const lines = v.slice(start, end).split('\n')
        const all = lines.every((l) => l.startsWith(prefix))
        const out = lines.map((l, i) => {
          if (all) return l.slice(prefix.length)
          const p = numbered ? (i + 1) + '. ' : prefix
          return p + l
        }).join('\n')
        ta.setRangeText(out, start, end, 'end')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
      }

      const insertAtCursor = (ta, text) => {
        ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
      }

      const onToolbar = (act, ta) => {
        if (!ta) return
        if (act === 'bold') wrapSel(ta, '**', '**', _t('notes.tb.boldText', 'bold'))
        else if (act === 'italic') wrapSel(ta, '*', '*', _t('notes.tb.italicText', 'italic'))
        else if (act === 'strike') wrapSel(ta, '~~', '~~', _t('notes.tb.strikeText', 'strike'))
        else if (act === 'code') wrapSel(ta, '`', '`', _t('notes.tb.codeText', 'code'))
        else if (act === 'h1') linePrefix(ta, '# ')
        else if (act === 'h2') linePrefix(ta, '## ')
        else if (act === 'h3') linePrefix(ta, '### ')
        else if (act === 'ul') linePrefix(ta, '- ')
        else if (act === 'ol') linePrefix(ta, '1. ', true)
        else if (act === 'quote') linePrefix(ta, '> ')
        else if (act === 'link') wrapSel(ta, '[', '](https://)', _t('notes.tb.linkText', 'link text'))
        else if (act === 'hr') insertAtCursor(ta, '\n\n---\n\n')
      }

      /* ── drawer + mobile editor ── */
      const drawer = () => $('[data-vault-tree]')
      const scrim = () => $('[data-vault-scrim]')
      const closeDrawer = () => {
        const d = drawer(); const s = scrim()
        if (d) d.removeAttribute('data-open')
        if (s) { s.removeAttribute('data-open'); s.hidden = true }
      }
      const openDrawer = () => {
        const d = drawer(); const s = scrim()
        if (d) d.setAttribute('data-open', 'true')
        if (s) { s.hidden = false; requestAnimationFrame(() => s.setAttribute('data-open', 'true')) }
      }
      const closeMobileEditor = async () => {
        await flushSave()
        const ed = $('[data-vault-editor]')
        if (ed) ed.removeAttribute('data-open')
        setTimeout(() => { if (!isMobile()) return; if (!$('[data-vault-editor]').hasAttribute('data-open')) { /* keep active note */ } }, 240)
      }

      /* ── global events (delegated) ── */
      const onClick = (e) => {
        const t = e.target instanceof Element ? e.target : null
        if (!t) return

        if (t.closest('[data-vault-burger]')) { openDrawer(); return }
        if (t.closest('[data-vault-scrim]')) { closeDrawer(); return }
        if (t.closest('[data-vault-back]')) { closeMobileEditor(); return }
        if (t.closest('[data-vault-outline]')) { onOutlineClick(e); return }

        // view switches
        const viewBtn = t.closest('[data-vault-view]')
        if (viewBtn && !t.closest('[data-vault-folder-kebab]') && !t.closest('[data-vault-tw]')) {
          const type = viewBtn.getAttribute('data-vault-view')
          const id = viewBtn.getAttribute('data-vault-id') || null
          if (type === 'folder' && id) setView('folder', id)
          else if (type === 'tag') setView('tag', id)
          else setView(type)
          return
        }

        // folder tree twisty
        const tw = t.closest('[data-vault-tw]')
        if (tw) {
          e.stopPropagation()
          const id = tw.getAttribute('data-vault-tw')
          if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id)
          prefs.expanded = [...state.expanded]
          savePrefs()
          renderTree()
          return
        }

        // folder kebab
        const fk = t.closest('[data-vault-folder-kebab]')
        if (fk) {
          e.stopPropagation()
          folderMenu(fk.getAttribute('data-vault-folder-kebab'), fk)
          return
        }

        // tag chip filter
        const chip = t.closest('[data-vault-tag]')
        if (chip) {
          const tag = chip.getAttribute('data-vault-tag')
          if (state.view.type === 'tag' && state.view.id.toLowerCase() === tag.toLowerCase()) setView('all')
          else setView('tag', tag)
          return
        }

        // new folder
        if (t.closest('[data-vault-newfolder-root]')) { newFolderInline(null); return }
        if (t.closest('[data-vault-newfolder-ok]')) {
          const box = $('[data-vault-newfolder]')
          if (box && box.dataset.rename) commitRename(); else commitFolder()
          return
        }

        // note card / trash actions
        const restore = t.closest('[data-vault-restore]')
        if (restore) { e.stopPropagation(); restoreNote(restore.getAttribute('data-vault-restore')); return }
        const purge = t.closest('[data-vault-purge]')
        if (purge) { e.stopPropagation(); purgeNote(purge.getAttribute('data-vault-purge')); return }

        const card = t.closest('[data-vault-card]')
        if (card) { openNote(card.getAttribute('data-vault-card'), { focusBody: false }); return }

        // editor actions
        if (t.closest('[data-vault-new]')) { newNote(); return }
        if (t.closest('[data-vault-star]')) { toggleStar(); return }
        const kb = t.closest('[data-vault-kebab]')
        if (kb) { noteMenu(kb); return }
        const crumbBtn = t.closest('[data-vault-crumb]')
        if (crumbBtn) { setView('folder', crumbBtn.getAttribute('data-vault-crumb')); return }
        if (t.closest('[data-vault-crumb-unfile]')) { setView('unfiled'); return }
        const trm = t.closest('[data-vault-tagrm]')
        if (trm) {
          const tag = trm.getAttribute('data-vault-tagrm')
          saveTags(csvTags(state.draft.tags).filter((x) => x !== tag).join(', '))
          return
        }
        if (t.closest('[data-vault-tagadd]')) { addTagInline(); return }
        if (t.closest('[data-vault-save]') && state.saveState === 'error' && state.saveTimer === null) { doSave(); return }
        if (t.closest('[data-vault-import]')) { importIdeas(); return }
        if (t.closest('[data-vault-import-qn]')) { importQuicknotes(); return }

        // mode toggle
        const mode = t.closest('[data-vault-mode]')
        if (mode) {
          state.mode = mode.getAttribute('data-vault-mode')
          prefs.mode = state.mode
          savePrefs()
          renderEditor()
          return
        }

        // toolbar
        const tb = t.closest('[data-vault-tb]')
        if (tb) { onToolbar(tb.getAttribute('data-vault-tb'), $('[data-vault-src]')); return }
      }

      const onCardKey = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        if (e.target instanceof HTMLButtonElement) return // Enter on an inner button = that button
        const card = e.target instanceof Element ? e.target.closest('[data-vault-card]') : null
        if (card) { e.preventDefault(); openNote(card.getAttribute('data-vault-card'), { focusBody: false }) }
      }

      const onKebabKey = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        const fk = e.target instanceof Element ? e.target.closest('[data-vault-folder-kebab]') : null
        if (fk) { e.preventDefault(); folderMenu(fk.getAttribute('data-vault-folder-kebab'), fk) }
      }

      // editor inputs (delegated at document — the editor re-renders constantly)
      let previewTimer = null
      const onInput = (e) => {
        const t = e.target
        if (!(t instanceof Element)) return
        if (t.matches('[data-vault-src]')) {
          state.draft.content = t.value
          markDirty()
          clearTimeout(previewTimer)
          previewTimer = setTimeout(renderPreview, 140)
          updateStatus()
        } else if (t.matches('[data-vault-title]')) {
          state.draft.title = t.value
          markDirty()
          updateStatus()
        } else if (t.matches('[data-vault-newfolder-input]')) {
          // Enter commits (keydown below)
        }
      }

      const onKeyDown = (e) => {
        const t = e.target
        if (!(t instanceof Element)) return
        if (t.matches('[data-vault-newfolder-input]') && e.key === 'Enter') {
          e.preventDefault()
          const box = $('[data-vault-newfolder]')
          if (box && box.dataset.rename) commitRename(); else commitFolder()
          return
        }
        if (t.matches('[data-vault-taginput]') && e.key === 'Escape') { renderEditor(); return }
        // Ctrl/Cmd+S — flush the autosave now (the writer's insurance key)
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          if (t.closest && (t.matches('[data-vault-src]') || t.matches('[data-vault-title]') || t.closest('.vault'))) {
            e.preventDefault()
            if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; doSave() }
          }
        }
        // Tab inside the textarea inserts two spaces (a writer's indent), not a focus jump
        if (e.key === 'Tab' && t.matches('[data-vault-src]') && !e.shiftKey) {
          e.preventDefault()
          insertAtCursor(t, '  ')
        }
      }

      let searchTimer = null
      const onSearch = (e) => {
        const t = e.target
        if (!(t instanceof Element) || !t.matches('[data-vault-search]')) return
        clearTimeout(searchTimer)
        searchTimer = setTimeout(() => {
          state.q = t.value.trim()
          loadNotes()
        }, 260)
      }
      const onSearchClear = (e) => {
        const btn = e.target instanceof Element ? e.target.closest('[data-vault-search-clear]') : null
        if (!btn) return
        const input = $('[data-vault-search]')
        if (input) { input.value = ''; state.q = ''; loadNotes(); input.focus() }
      }

      const onSort = (e) => {
        const t = e.target
        if (!(t instanceof Element) || !t.matches('[data-vault-sort]')) return
        state.sort = t.value
        prefs.sort = state.sort
        savePrefs()
        loadNotes()
      }

      // language switch → re-render every pane (labels, dates, folder sorting)
      const onI18n = () => {
        renderTree()
        renderCards()
        renderEditor()
      }

      // ── wire up ──
      document.addEventListener('click', onClick)
      document.addEventListener('click', onSearchClear)
      document.addEventListener('keydown', onCardKey)
      document.addEventListener('keydown', onKebabKey)
      document.addEventListener('input', onInput)
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('input', onSearch)
      document.addEventListener('change', onSort)
      document.addEventListener('hibana:i18n', onI18n)

      // sort select initial value
      const sortSel = $('[data-vault-sort]')
      if (sortSel) sortSel.value = state.sort

      /* ── boot: restore view pref + hash deep-link ── */
      const boot = async () => {
        await loadBootstrap()
        // S54: /notes?new=1 (from the FAB / command palette) → start a fresh note
        // right away. The param is stripped so a reload reopens the normal list.
        const wantNew = new URLSearchParams(location.search).get('new') === '1'
        if (wantNew) {
          try { history.replaceState(null, '', location.pathname) } catch {}
          await loadNotes()
          await newNote()
          return
        }
        let initial = { type: 'all', id: null }
        let jumpQ = null
        try {
          const m = location.hash.match(/^#n=([0-9a-f-]+)(?:&q=([^&]+))?$/i)
          if (m) { initial = { type: 'note', id: m[1] }; if (m[2]) jumpQ = decodeURIComponent(m[2]) }
          // S67: /notes?view=folder&folder=<id> — the command palette's folder-chip
          // deep link (also hand-typed/shareable). The hash (a specific note) wins
          // over the folder: opening the note directly is the more specific intent.
          // A folder id that no longer exists falls back to All notes (the palette
          // hit could predate a folder rename/delete); the params are stripped so a
          // reload reopens the normal saved view.
          else {
            const qs = new URLSearchParams(location.search)
            if (qs.get('view') === 'folder' && qs.get('folder')) {
              const fid = qs.get('folder')
              initial = folderById(fid) ? { type: 'folder', id: fid } : { type: 'all', id: null }
              try { history.replaceState(null, '', location.pathname) } catch {}
            }
          }
          if (initial.type !== 'folder' && prefs.view && prefs.view.type) initial = prefs.view
        } catch {}
        if (initial.type === 'note' && initial.id) {
          await loadNotes()
          await openNote(initial.id, { focusBody: false })
          if (jumpQ) jumpToMatch(jumpQ)
        } else {
          if (initial.type === 'folder' && !folderById(initial.id)) initial = { type: 'all', id: null }
          if (initial.type === 'tag' && !state.tags.some((x) => x.tag.toLowerCase() === initial.id.toLowerCase())) initial = { type: 'all', id: null }
          state.view = initial
          renderTree()
          await loadNotes()
        }
      }
      boot()

      // persist the view on every switch (named so teardown can remove it)
      const persistView = () => { prefs.view = { type: state.view.type, id: state.view.id }; savePrefs() }
      const onPersistView = (e) => {
        const t = e.target instanceof Element ? e.target : null
        if (t && (t.closest('[data-vault-view]') || t.closest('[data-vault-tag]') || t.closest('[data-vault-crumb]'))) persistView()
      }
      document.addEventListener('click', onPersistView)

      /* teardown on soft-navigation away */
      return () => {
        closeMenu()
        if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; doSave() }
        document.removeEventListener('pointerdown', onDocPointer)
        document.removeEventListener('keydown', onDocKey)
        document.removeEventListener('click', onClick)
        document.removeEventListener('click', onSearchClear)
        document.removeEventListener('keydown', onCardKey)
        document.removeEventListener('keydown', onKebabKey)
        document.removeEventListener('input', onInput)
        document.removeEventListener('keydown', onKeyDown)
        document.removeEventListener('input', onSearch)
        document.removeEventListener('change', onSort)
        document.removeEventListener('hibana:i18n', onI18n)
        document.removeEventListener('click', onPersistView)
      }
    },
  })
})()
