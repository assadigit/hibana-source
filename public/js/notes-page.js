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

// S83: the inline first-load watchdog in notes.html keys on this attribute. Setting
// it at TOP LEVEL (not inside mount) is deliberate — the signal that matters is
// "this file arrived at all". If the asset fetch itself was reset on the owner's
// flaky first-visit link, this line never runs and the watchdog reloads the page
// (the automated version of the owner's manual "refresh 1-2 times").
document.documentElement.setAttribute('data-hibana-booted', '1')

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
      // S83 (owner request — the Checklist): GitHub-style `- [ ]` / `- [x]` lines.
      // renderMarkdown tags each box with its occurrence index (data-md-task); the
      // click delegation flips that line in the SOURCE textarea — the preview stays
      // a pure function of the source (the autosave/edit pipeline is untouched).
      // S84 (owner follow-up — "it shows like a raw markdown [ ]"): the grammar
      // WIDENED. The bullet is now optional (a bare `[ ] milk` line is a task — the
      // exact shape the owner typed), `+` joins `-`/`*`, and the marker may END the
      // line (`- [ ]` with no trailing space is still a task, never a bullet with
      // literal brackets). A space after `]` before text stays REQUIRED so a link
      // line like `[x](https://…)` keeps parsing as a link, never a task.
      const TASK_LINE_RE = /^[ \t]*(?:[-*+] )?\[([ xX])\](?:[ \t]+(.*))?$/gm
      const TASK_LINE_TEST = /^[ \t]*(?:[-*+] )?\[([ xX])\](?:[ \t]+(.*))?$/
      /* ── S88 code blocks (owner: "mono font, smaller size, syntax coloring, a Copy
         button") — the SAME contract as src/lib/markdown.ts (keep them in lockstep):
         fences are pulled out of the RAW text (pre-escape) so the tokenizer sees real
         quotes; each fence renders as a .md-code panel — lang chip + copy button
         (data-md-copy; app.js owns the ONE delegated clipboard handler) + per-token
         coloring. A BARE fence (no language tag) stays un-tokenized so plain-text
         snippets never light up English words as keywords. ── */
      const MD_HASH_LANGS = new Set(['py', 'python', 'sh', 'bash', 'zsh', 'shell', 'console', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'ruby', 'rb', 'r', 'perl', 'dockerfile', 'makefile', 'make', 'ps1'])
      const MD_DASH_LANGS = new Set(['sql', 'lua', 'haskell', 'hs'])
      const MD_KEYWORDS = new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'class', 'extends', 'implements', 'new', 'delete', 'typeof', 'instanceof', 'void', 'in', 'of', 'try', 'catch', 'finally', 'throw', 'yield', 'await', 'async', 'import', 'from', 'export', 'this', 'super', 'static', 'get', 'set', 'null', 'true', 'false', 'undefined', 'def', 'elif', 'lambda', 'pass', 'with', 'as', 'not', 'and', 'or', 'is', 'none', 'raise', 'except', 'assert', 'global', 'print', 'echo', 'exit', 'then', 'fi', 'done', 'esac', 'local', 'export', 'source', 'alias', 'unset', 'package', 'struct', 'impl', 'match', 'go', 'defer', 'chan', 'select', 'mut', 'crate', 'pub', 'nil', 'string', 'int', 'bool', 'float', 'select', 'insert', 'update', 'delete', 'where', 'join', 'left', 'right', 'inner', 'outer', 'create', 'table', 'index', 'values', 'group', 'order', 'by', 'having', 'limit'])
      const MD_COPY_ICON = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>'
      function highlightCode(code, lang) {
        const langKey = String(lang || '').toLowerCase()
        const commentAlts = [
          /\/\*[\s\S]*?\*\//.source,
          /\/\/[^\n]*/.source,
          /<!--[\s\S]*?-->/.source,
          MD_HASH_LANGS.has(langKey) ? /#[^\n]*/.source : '',
          MD_DASH_LANGS.has(langKey) ? /--[^\n]*/.source : '',
        ].filter(Boolean).join('|')
        // string literals via regex-literal .source (avoids quote-escaping soup)
        const strAlt = [
          /"(?:\\.|[^"\\\n])*"/.source,
          /'(?:\\.|[^'\\\n])*'/.source,
          /`(?:\\.|[^`\\])*`/.source,
        ].join('|')
        const tokenRe = new RegExp(
          '(' + commentAlts + ')' +
          '|(' + strAlt + ')' +
          '|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)' +
          '|([A-Za-z_$][\\w$]*)' +
          '|([{}()\\[\\];]|[+\\-*/%=<>!&|^~?:@]+)',
          'g')
        let out = ''
        let last = 0
        for (const m of code.matchAll(tokenRe)) {
          const idx = m.index || 0
          if (idx > last) out += mdEscape(code.slice(last, idx))
          last = idx + m[0].length
          const full = m[0], com = m[1], str = m[2], num = m[3], ident = m[4], op = m[5]
          if (com !== undefined) out += '<span class="md-tok-com">' + mdEscape(full) + '</span>'
          else if (str !== undefined) out += '<span class="md-tok-str">' + mdEscape(full) + '</span>'
          else if (num !== undefined) out += '<span class="md-tok-num">' + mdEscape(full) + '</span>'
          else if (ident !== undefined) {
            const isKw = MD_KEYWORDS.has(ident.toLowerCase())
            const isFn = /^\s*[(]/.test(code.slice(last))
            out += isKw ? '<span class="md-tok-kw">' + mdEscape(full) + '</span>'
              : isFn ? '<span class="md-tok-fn">' + mdEscape(full) + '</span>'
              : mdEscape(full)
          } else if (op !== undefined) out += '<span class="md-tok-op">' + mdEscape(op) + '</span>'
          else out += mdEscape(full)
        }
        if (last < code.length) out += mdEscape(code.slice(last))
        return out
      }
      function renderCodeBlock(info, code) {
        const lang = (String(info || '').split(/\s+/)[0] || '').toLowerCase()
        const langLabel = lang ? mdEscape(lang) : 'text'
        const body = lang ? highlightCode(code, lang) : mdEscape(code)
        return '<div class="md-code" data-lang="' + langLabel + '" dir="ltr">' +
          '<div class="md-code-bar"><span class="md-code-lang">' + langLabel + '</span>' +
          '<button type="button" class="md-code-copy" data-md-copy aria-label="' + esc(_t('md.copy', 'Copy code')) + '">' + MD_COPY_ICON + '</button></div>' +
          '<pre><code>' + body + '</code></pre>' +
          '</div>'
      }
      function renderMarkdown(src) {
        let s = String(src ?? '')
        const fences = []
        s = s.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, info, code) => {
          fences.push(renderCodeBlock(info, code))
          return '\x03' + (fences.length - 1) + '\x03'
        })
        s = mdEscape(s)
        s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>')
        s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>')
        s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>')
        s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
        // task-list lines BEFORE the generic bullet (mirror of src/lib/markdown.ts);
        // interactive button here vs the server's static span — the only divergence,
        // documented on both sides.
        let taskIdx = 0
        s = s.replace(TASK_LINE_RE, (_m, mark, rest) => {
          const done = mark.toLowerCase() === 'x'
          const i = taskIdx++
          return '\x01U\x02<li class="md-task' + (done ? ' is-done' : '') + '"><button type="button" class="md-check' + (done ? ' is-on' : '') + '" data-md-task="' + i + '" role="checkbox" aria-checked="' + done + '" aria-label="' + esc(_t('notes.tb.checkToggle', 'Toggle task')) + '"></button><span class="md-task-txt">' + (rest ?? '') + '</span></li>'
        })
        s = s.replace(/^[ \t]*[-*] (.*)$/gm, '\x01U\x02<li>$1</li>')
        s = s.replace(/^[ \t]*\d+\. (.*)$/gm, '\x01O\x02<li>$1</li>')
        s = s.replace(/(?:\x01U\x02<li[^>]*>[\s\S]*?<\/li>\n?)+/g, '<ul>$&</ul>')
        s = s.replace(/(?:\x01O\x02<li[^>]*>[\s\S]*?<\/li>\n?)+/g, '<ol>$&</ol>')
        s = s.replace(/\x01[OU]\x02/g, '')
        s = s.replace(/^---+$/gm, '<hr>')
        s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
        s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
        s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
        s = s.replace(/`([^`]+)`/g, '<code class="md-ic">$1</code>')
        s = s.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
          .map((b) => (/^<(h[1-6]|ul|ol|pre|blockquote|hr|div|\x03)/.test(b) ? b : '<p>' + b + '</p>'))
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
        // S83: the load-failed panel — cloud-off for the icon, the circular arrow
        // for the Retry button (same visual family as I.restore but distinct path:
        // two arrows for a full round trip).
        cloudOff: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H8"/><path d="M12 4h4.5a3.5 3.5 0 0 1 3.4 4.3A4.5 4.5 0 0 1 19.5 17H9"/><path d="M3 3l18 18"/></svg>',
        refresh: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v5h-5"/></svg>',
        // S67: reading-time chip glyph — same clock path as the palette's 'clock'.
        clock: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
        // S86: the emoji-picker menu glyph + the Ask-AI sparkle (the wand's twin).
        smile: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.7h.01M15 9.7h.01" stroke-linecap="round" stroke-width="2.2"/></svg>',
        sparkle: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z"/></svg>',
      }

      /* ── state ── */
      const PREFS_KEY = 'hibana-vault-prefs'
      const prefs = (() => {
        try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } catch { return {} }
      })()
      prefs.expanded = Array.isArray(prefs.expanded) ? prefs.expanded : []
      // S105: section collapse (Folders/Tags headings) — default OPEN, persisted.
      prefs.secFolders = prefs.secFolders !== false
      prefs.secTags = prefs.secTags !== false
      const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch {} }

      const isMobile = () => window.matchMedia('(max-width: 940px)').matches
      const defaultMode = () => (isMobile() ? 'edit' : 'split')

      const state = {
        folders: [],
        tags: [],
        // S105: the light note index from /bootstrap — powers the Obsidian-style
        // note rows nested under their folders in the sidebar tree.
        noteIndex: [],
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
        // S83: "the list fetch failed" is NOT "the vault is empty" — the S82 fix
        // rendered the real chrome on failure but the notes pane still showed the
        // fake "No notes yet" empty state, which on a flaky link reads as "broken
        // template". These two flags drive the distinct Couldn't-reach-the-vault
        // panel (with a Retry button) instead of the lying empty state.
        loadFailed: false, // last /api/vault/notes fetch exhausted its retries
        bootFailed: false, // last /api/vault/bootstrap fetch exhausted its retries
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
          btn.addEventListener('click', () => { closeMenu(); it.onClick(anchor) })
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
        // S105: the folder's OWN notes join the tree — a folder with notes (even
        // without subfolders) is a collapsible GROUP now (owner: "collapsing the
        // group of the ‘AI’ folder"). Obsidian-style: subfolders first, then notes.
        const ownNotes = notesInFolder(f.id)
        const isOpen = state.expanded.has(f.id)
        const cur = state.view.type === 'folder' && state.view.id === f.id
        const cnt = noteCountIn(f.id)
        // S86 (0059): the folder's user-picked emoji replaces the default folder glyph
        // (the sparks-shelf treatment). A set icon also gets a subtle emphasis so the
        // pick reads as intentional, not as stray text.
        const glyph = f.icon
          ? `<span class="vault-folder-emoji" role="img" aria-label="">${esc(f.icon)}</span>`
          : I.folder
        const hasKids = !!(kids.length || ownNotes.length)
        return `<div class="vault-folder-row" data-folder-row="${f.id}" style="padding-inline-start:${depth * 0.85}rem">
          <button type="button" class="vault-tw${hasKids ? '' : ' spacer'}" data-vault-tw="${f.id}" aria-expanded="${hasKids ? isOpen : false}" aria-label="${esc(_t('notes.toggleFolder', 'Expand folder'))}" tabindex="${hasKids ? 0 : -1}">${I.chevron}</button>
          <button type="button" class="vault-folder" data-vault-view="folder" data-vault-id="${f.id}" aria-current="${cur}">
            ${glyph}<span class="vault-folder-name" dir="auto">${esc(f.name)}</span>
            ${cnt != null ? `<span class="vault-n">${cnt}</span>` : ''}
            <span class="vault-kebab" data-vault-folder-kebab="${f.id}" role="button" tabindex="0" aria-label="${esc(_t('notes.folderMenu', 'Folder options'))}" aria-haspopup="menu">${I.kebab}</span>
          </button>
        </div>
          ${hasKids && isOpen ? kids.map((k) => folderRow(k, depth + 1)).join('') : ''}
          ${hasKids && isOpen ? ownNotes.map((n) => noteRow(n, depth + 1)).join('') : ''}`
      }

      // S105: a note nested under its folder in the tree — the Obsidian row. Click
      // opens the note in the editor (same as clicking its card in the middle pane).
      const noteRow = (n, depth) => {
        const cur = state.active && state.active.id === n.id
        // S118: the tree rows hardcoded English 'Untitled' — the vault cards one
        // function down already speak the localized key; the tree now agrees.
        const untitled = _t('notes.untitled', 'Untitled')
        const title = (n.title || untitled).trim() || untitled
        return `<div class="vault-note-row" data-note-row="${n.id}" style="padding-inline-start:${(depth + 0.4) * 0.85}rem">
          <button type="button" class="vault-note" data-vault-note="${n.id}" aria-current="${cur}" title="${esc(title)}">
            ${I.note}<span class="vault-note-name" dir="auto">${esc(title)}</span>
          </button>
        </div>`
      }

      const notesInFolder = (folderId) =>
        state.noteIndex.filter((n) => (n.folder_id || null) === folderId)

      // S105: keep the tree's note index honest across note mutations (create,
      // save-title, move, delete, restore) so the sidebar never shows ghosts.
      const upsertNoteIndex = (note) => {
        if (!note || !note.id) return
        const i = state.noteIndex.findIndex((n) => n.id === note.id)
        const row = { id: note.id, title: note.title || '', folder_id: note.folder_id ?? null }
        if (i >= 0) state.noteIndex[i] = row; else state.noteIndex.unshift(row)
      }
      const removeNoteIndex = (id) => {
        state.noteIndex = state.noteIndex.filter((n) => n.id !== id)
      }

      // S105: the collapsible section heading (Folders / Tags) — a button with a
      // chevron; collapsed hides the section body. Persisted in prefs.
      const secHead = (key, labelKey, labelFallback, extra = '') => {
        const open = key === 'folders' ? prefs.secFolders : prefs.secTags
        return `<button type="button" class="vault-sec-head" data-vault-sec="${key}" aria-expanded="${open}">
          <span class="vault-sec-tw">${I.chevron}</span>
          <span class="vault-sec-label">${esc(_t(labelKey, labelFallback))}</span>
          ${extra}
        </button>`
      }

      const renderTree = () => {
        const el = treeEl()
        if (!el) return
        const tagActive = state.view.type === 'tag' ? state.view.id : null
        // S83: bootstrap exhausted its retries — say so in the tree (a muted row
        // under the quick views), instead of showing counts that are all zero and
        // letting the sidebar lie about an empty vault.
        const bootFailRow = state.bootFailed ? `<p class="vault-tree-offline" data-vault-retry role="button" tabindex="0">${I.cloudOff}<span>${esc(_t('notes.offlineTree', 'Folders offline — tap to retry'))}</span></p>` : ''
        el.innerHTML = `
          <div class="vault-sec">
            ${quickRow('all', '', I.note, 'notes.allNotes', 'All notes', state.counts.all)}
            ${quickRow('starred', '', I.star, 'notes.starred', 'Starred', state.counts.starred)}
            ${quickRow('unfiled', '', I.layers, 'notes.unfiled', 'Unfiled', state.counts.unfiled)}
            ${quickRow('trash', '', I.trash, 'notes.trash', 'Trash', state.counts.trash, true)}
            ${bootFailRow}
          </div>
          <div class="vault-sec">
            <div class="row spread" style="align-items:center;min-inline-size:0">
              ${secHead('folders', 'notes.folders', 'Folders')}
              <button type="button" class="vault-sec-add" data-vault-newfolder-root aria-label="${esc(_t('notes.newFolder', 'New folder'))}" title="${esc(_t('notes.newFolder', 'New folder'))}">${I.plus}</button>
            </div>
            <div data-vault-folders ${prefs.secFolders ? '' : 'hidden'}>${state.folders.length
              ? childrenOf(null).map((f) => folderRow(f, 0)).join('')
              : `<p class="muted small" style="padding:0.25rem 0.5rem;margin:0">${esc(_t('notes.noFolders', 'No folders yet — create one to organize.'))}</p>`}
            </div>
            <div class="vault-newfolder" data-vault-newfolder hidden>
              <input data-vault-newfolder-input maxlength="80" dir="auto" placeholder="${esc(_t('notes.folderName', 'Folder name…'))}" aria-label="${esc(_t('notes.folderName', 'Folder name…'))}">
              <button type="button" class="vault-sec-add" data-vault-newfolder-ok aria-label="${esc(_t('common.save', 'Save'))}">${I.check}</button>
            </div>
          </div>
          ${state.tags.length ? `<div class="vault-sec">
            ${secHead('tags', 'notes.tags', 'Tags', `<span class="vault-sec-count vault-n">${state.tags.length}</span>`)}
            <div class="vault-tags" ${prefs.secTags ? '' : 'hidden'}>
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
        // S86: the note's user-picked emoji rides the title (cards + drag affordance:
        // live notes are draggable to reorder — trash is frozen at its deletion order).
        const emoji = n.icon ? `<span class="vault-card-emoji" role="img" aria-label="">${esc(n.icon)}</span>` : ''
        const draggable = state.view.type === 'trash' ? '' : ' draggable="true"'
        // S67: reading-time chip on the CARD — the S63 reader-head estimate, surfaced
        // where the list is scanned (the S66 next-session candidate). Same rule as the
        // reader: <200 words stays silent (an instant read needs no number); ~200 wpm;
        // Persian digits via dig(). Title tooltip carries the full phrase for clarity.
        const words = Number(n.word_count) || 0
        const readChip = words >= 200
          ? `<span class="vault-card-read" title="${esc(_t('notes.readTime', '~{n} min read').split('{n}').join(dig(Math.max(1, Math.round(words / 200)))))}">${I.clock || ''}${esc(_t('notes.minRead', '~{n} min').split('{n}').join(dig(Math.max(1, Math.round(words / 200)))))}</span>`
          : ''
        return `<article class="vault-card" data-vault-card="${n.id}" aria-current="${active}" tabindex="0"${draggable}>
          <div class="vault-card-date">
            <time datetime="${n.updated_at}">${fmtDay(n.updated_at)}</time>
            ${n.starred ? `<span class="vault-card-star" aria-label="${esc(_t('notes.starred', 'Starred'))}">${I.star}</span>` : ''}
          </div>
          <h2 class="vault-card-title${n.title.trim() ? '' : ' is-untitled'}" dir="auto">${emoji}${esc(n.title.trim() || title)}</h2>
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
        // S83: the load genuinely failed — the honest panel, not the fake empty
        // state. The retry button re-runs the fetch pair; it also re-runs bootstrap
        // so the tree's counts come back in the same click.
        if (state.loadFailed) {
          el.innerHTML = `<div class="vault-empty vault-load-failed">
            <span class="empty-state-icon" aria-hidden="true">${I.cloudOff}</span>
            <b>${esc(_t('notes.loadFailedTitle', 'Couldn\u2019t reach the vault'))}</b>
            <p>${esc(_t('notes.loadFailedHint', 'The connection dropped on the first try. Your notes are safe — one more round usually gets through.'))}</p>
            <button type="button" class="vault-new" data-vault-retry style="margin-block-start:0.5rem">${I.refresh}<span>${esc(_t('common.retry', 'Retry'))}</span></button>
          </div>`
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
            <button type="button" class="vault-ed-emoji${n.icon ? ' is-set' : ''}" data-vault-emoji ${trash ? 'disabled' : ''} title="${esc(_t('notes.setEmoji', 'Set emoji'))}" aria-label="${esc(_t('notes.setEmoji', 'Set emoji'))}">${n.icon ? esc(n.icon) : I.smile}</button>
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
            <button type="button" class="vault-tb" data-vault-tb="check" title="- [ ] ${esc(_t('notes.tb.checklist', 'Checklist'))}" aria-label="${esc(_t('notes.tb.checklist', 'Checklist'))}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.2 2.4 2.4 4.8-4.8"/></svg></button>
            <button type="button" class="vault-tb" data-vault-tb="ol" title="1. ${esc(_t('notes.tb.olist', 'Numbered list'))}" aria-label="${esc(_t('notes.tb.olist', 'Numbered list'))}">1≡</button>
            <button type="button" class="vault-tb" data-vault-tb="quote" title="&gt; ${esc(_t('notes.tb.quote', 'Quote'))}" aria-label="${esc(_t('notes.tb.quote', 'Quote'))}">❝</button>
            <span class="vault-tb-sep"></span>
            <button type="button" class="vault-tb" data-vault-tb="link" title="[${esc(_t('notes.tb.link', 'Link'))}](url)" aria-label="${esc(_t('notes.tb.link', 'Link'))}">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7L12.5 19"/></svg>
            </button>
            <button type="button" class="vault-tb" data-vault-tb="hr" title="---" aria-label="${esc(_t('notes.tb.hr', 'Divider'))}">—</button>
            <span class="vault-tb-sep"></span>
            <button type="button" class="vault-tb vault-tb-ai" data-vault-ai ${trash ? 'disabled' : ''} title="${esc(_t('notes.askAi', 'Ask AI — polish, translate, or your own instruction'))}" aria-label="${esc(_t('notes.askAi', 'Ask AI — polish, translate, or your own instruction'))}">${I.sparkle}</button>
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
            <div class="md-live" data-vault-md-live hidden><div class="md-live-in" data-vault-md-live-in></div></div>
          </div>
          <div class="vault-status">
            <span class="vault-save" data-vault-save data-state="${state.saveState}">${esc(saveLabel())}</span>
            <span class="vault-status-words" data-vault-words></span>
          </div>
        </div>`
        updateStatus()
        wirePreview()
        wireLiveChecks()
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
        syncLiveChecks()
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

      /* ── S84 (owner: "the checkbox shows like a raw markdown [ ] — it should be a
         clickable and nicely checkbox"): LIVE checkboxes in the EDITING surface
         itself, not just the preview pane (edit mode is the mobile default — the
         owner writes into the textarea and never sees the preview boxes at all).
         The textarea stays the single source of truth; a hidden MIRROR div —
         identical font, width, padding and wrapping, with unicode-bidi:plaintext to
         reproduce the textarea's per-line auto direction — measures where each task
         marker sits, and the overlay paints one pretty control EXACTLY over the raw
         `- [ ]` text (opaque card background: the syntax is covered, not deleted).
         The controls carry the same data-md-task delegation as the preview boxes (a
         click flips the source line); moving the caret onto a line LIFTS its cover
         so the syntax you are about to edit is the thing you see (Obsidian
         live-preview semantics). Zero cost for notes without checklists (one regex
         test); any measurement failure degrades to today's plain textarea. ── */
      let liveMirrorEl = null
      let liveRaf = 0
      let liveResizeT = 0

      const syncLiveChecks = () => {
        try {
          const ta = $('[data-vault-src]')
          const host = $('[data-vault-md-live]')
          if (!ta || !host) return
          const inner = host.querySelector('[data-vault-md-live-in]')
          if (!inner) return
          // read mode hides the textarea (print does it via CSS) — nothing to cover
          if (state.mode === 'read' || ta.readOnly) { host.hidden = true; return }
          const v = String(ta.value)
          const lines = v.split('\n')
          // ── S88 parse pass 1: CLOSED fenced blocks (opening ``` … closing ```). An
          // unclosed fence (mid-typing) shows raw — matching the preview's behavior
          // (renderMarkdown only fences closed runs), so the editor never shows a
          // panel the preview contradicts. Block lines (incl. the ``` lines) are
          // covered whole; their task/inline markdown is CODE, not markup — the
          // preview's taskIdx counts them the same way (fences leave first).
          const blocks = [] // { lang, code, start, end } (line indexes, inclusive)
          {
            let open = -1
            for (let i = 0; i < lines.length; i++) {
              if (/^```/.test(lines[i])) {
                if (open < 0) open = i
                else {
                  blocks.push({ lang: lines[open].slice(3).trim(), code: lines.slice(open + 1, i).join('\n'), start: open, end: i })
                  open = -1
                }
              }
            }
          }
          const blockOf = new Array(lines.length).fill(-1)
          blocks.forEach((b, bi) => { for (let i = b.start; i <= b.end; i++) blockOf[i] = bi })
          // ── detection: the common note pays ONE regex test per feature; overlay
          // work starts only when at least one pretty surface exists
          const hasTasks = lines.some((l, i) => blockOf[i] < 0 && TASK_LINE_TEST.test(l))
          const hasInline = lines.some((l, i) => blockOf[i] < 0 && !TASK_LINE_TEST.test(l) && /`[^`\n]+`/.test(l))
          if (!hasTasks && !hasInline && !blocks.length) { host.hidden = true; return }
          host.hidden = false
          // ── 1) mirror content. Task lines split into TWO measurable spans (A =
          // indent+bullet, B = marker+spaces) so the control covers A∪B while the
          // visible box sits exactly where the brackets sat. S88 adds: inline-code
          // spans (data-mic — the chip covers the whole `…` region) and fenced-block
          // lines (data-mbl — the panel covers the block's union rect). Everything
          // else escapes verbatim so the mirror measures the textarea's true geometry.
          const marks = [] // { done, cs, ce } — char range for the caret lift
          const ics = [] // { text, cs, ce }
          let html = ''
          let pos = 0
          const lineCs = [] // char offset of each line start (for block covers)
          for (let li = 0; li < lines.length; li++) {
            const line = lines[li]
            const ls = pos
            const le = pos + line.length
            lineCs.push(ls)
            if (blockOf[li] >= 0) {
              html += '<span data-mbl="' + blockOf[li] + '">' + mdEscape(line) + '</span>\n'
            } else {
              const m = line.match(TASK_LINE_TEST)
              const icOnLine = !m && /`[^`\n]+`/.test(line)
              if (m) {
                const a = (/^[ \t]*(?:[-*+] )?/.exec(line) || [''])[0]
                const b = (/^\[[ xX]\][ \t]*/.exec(line.slice(a.length)) || [''])[0]
                html += '<span data-ma="' + marks.length + '">' + mdEscape(a) + '</span><span data-mk="' + marks.length + '" data-cs="' + ls + '" data-ce="' + le + '">' + mdEscape(b) + '</span>' + mdEscape(line.slice(a.length + b.length)) + '\n'
                marks.push({ done: m[1].toLowerCase() === 'x', cs: ls, ce: le })
              } else if (icOnLine) {
                let out = ''
                let last = 0
                for (const mm of line.matchAll(/`([^`\n]+)`/g)) {
                  const idx = mm.index || 0
                  out += mdEscape(line.slice(last, idx))
                  out += '<span data-mic="' + ics.length + '" data-cs="' + (ls + idx) + '" data-ce="' + (ls + idx + mm[0].length) + '">' + mdEscape(mm[0]) + '</span>'
                  ics.push({ text: mm[1], cs: ls + idx, ce: ls + idx + mm[0].length })
                  last = idx + mm[0].length
                }
                html += out + mdEscape(line.slice(last)) + '\n'
              } else html += mdEscape(line) + '\n'
            }
            pos = le + 1
          }
          if (!liveMirrorEl) {
            liveMirrorEl = document.createElement('div')
            liveMirrorEl.setAttribute('data-vault-md-mirror', '')
            liveMirrorEl.setAttribute('aria-hidden', 'true')
            document.body.appendChild(liveMirrorEl)
          }
          const mir = liveMirrorEl
          const cs = getComputedStyle(ta)
          const st = mir.style
          st.position = 'absolute'; st.visibility = 'hidden'; st.left = '0'; st.top = '0'; st.margin = '0'
          st.width = ta.getBoundingClientRect().width + 'px'; st.height = 'auto'
          for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'letterSpacing', 'wordSpacing', 'lineHeight', 'textTransform', 'textIndent', 'tabSize', 'whiteSpace', 'overflowWrap', 'wordBreak', 'direction', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing']) {
            try { st[p] = cs[p] } catch {}
          }
          // a dir=auto textarea resolves direction PER LINE (UA unicode-bidi:
          // plaintext) — the mirror must too, or mixed-direction notes mis-measure
          st.unicodeBidi = 'plaintext'
          st.whiteSpace = 'pre-wrap'
          mir.innerHTML = html
          // 2) measure: each span pair's rects, relative to the mirror's border box
          //    (identical geometry to the textarea's — the offsets transfer 1:1)
          const mrect = mir.getBoundingClientRect()
          const label = esc(_t('notes.tb.checkToggle', 'Toggle task'))
          inner.textContent = ''
          let k = 0
          for (const el of mir.querySelectorAll('[data-mk]')) {
            const i = Number(el.getAttribute('data-mk'))
            const mk = marks[i]
            const aEl = mir.querySelector('[data-ma="' + i + '"]')
            const r = el.getBoundingClientRect()
            const ar = aEl ? aEl.getBoundingClientRect() : r
            const left = Math.min(ar.left, r.left)
            const right = Math.max(ar.right, r.right)
            const top = Math.min(ar.top, r.top)
            const h = Math.max(ar.height, r.height, 20)
            if (right - left <= 0) continue
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'md-live-check' + (mk.done ? ' is-on' : '')
            btn.setAttribute('data-md-task', String(k)) // rides the preview's click delegation
            btn.setAttribute('role', 'checkbox')
            btn.setAttribute('aria-checked', String(!!mk.done))
            btn.setAttribute('aria-label', label)
            btn.setAttribute('data-cs', String(mk.cs))
            btn.setAttribute('data-ce', String(mk.ce))
            btn.style.top = (top - mrect.top) + 'px'
            btn.style.left = (left - mrect.left) + 'px'
            btn.style.width = Math.max(right - left, 20) + 'px'
            btn.style.height = h + 'px'
            // the visible box sits exactly where the brackets sat (physical coords —
            // correct in LTR and RTL alike; B sits left of A on an RTL line)
            btn.innerHTML = '<span class="md-live-box" aria-hidden="true" style="left:' + Math.max(r.left - left, 0) + 'px"></span>'
            // the cover is a control, not a focus target: keep the caret in the textarea
            btn.addEventListener('mousedown', (ev) => ev.preventDefault())
            inner.appendChild(btn)
            k += 1
          }
          // ── S88 inline-code chips: the `…` region becomes an opaque mono chip with
          // < > tag glyphs at its edges (the owner's "clarify with < > tags") — code
          // reads as code IN the editing surface, not just in the preview.
          for (const el of mir.querySelectorAll('[data-mic]')) {
            const i = Number(el.getAttribute('data-mic'))
            const r = el.getBoundingClientRect()
            if (r.width <= 0) continue
            const chip = document.createElement('span')
            chip.className = 'md-live-ic'
            chip.setAttribute('aria-hidden', 'true')
            chip.setAttribute('data-cs', el.getAttribute('data-cs'))
            chip.setAttribute('data-ce', el.getAttribute('data-ce'))
            chip.style.top = (r.top - mrect.top) + 'px'
            chip.style.left = (r.left - mrect.left) + 'px'
            chip.style.width = r.width + 'px'
            chip.style.height = Math.max(r.height, 18) + 'px'
            chip.innerHTML = '<i class="md-ic-tag" aria-hidden="true">&lt;</i><span class="md-ic-txt">' + mdEscape(ics[i].text) + '</span><i class="md-ic-tag" aria-hidden="true">&gt;</i>'
            inner.appendChild(chip)
          }
          // ── S88 code-block panels: the block's union rect gets the SAME .md-code
          // panel the preview renders (lang chip + token colors + copy button — the
          // global [data-md-copy] delegation in app.js serves it). The panel is opaque
          // over the raw ```…``` region; its own mono 0.85em content fits inside.
          for (let bi = 0; bi < blocks.length; bi++) {
            const spans = mir.querySelectorAll('[data-mbl="' + bi + '"]')
            if (!spans.length) continue
            let bl = Infinity, br = -Infinity, bt = Infinity, bb = -Infinity
            for (const el of spans) {
              const rc = el.getBoundingClientRect()
              bl = Math.min(bl, rc.left); br = Math.max(br, rc.right)
              bt = Math.min(bt, rc.top); bb = Math.max(bb, rc.bottom)
            }
            if (br - bl <= 0) continue
            const panel = document.createElement('div')
            panel.innerHTML = renderCodeBlock(blocks[bi].lang, blocks[bi].code)
            const pc = panel.firstElementChild
            if (!pc) continue
            pc.classList.add('md-live-code')
            pc.setAttribute('data-cs', String(lineCs[blocks[bi].start]))
            pc.setAttribute('data-ce', String(lineCs[blocks[bi].end] + lines[blocks[bi].end].length))
            pc.style.left = (bl - mrect.left) + 'px'
            pc.style.top = (bt - mrect.top) + 'px'
            pc.style.width = Math.max(br - bl, 80) + 'px'
            pc.style.minHeight = Math.max(bb - bt, 48) + 'px'
            // the copy button must not steal focus from the textarea (blur = every
            // cover returning while the owner is mid-thought)
            for (const cbtn of pc.querySelectorAll('.md-code-copy')) {
              cbtn.addEventListener('mousedown', (ev) => ev.preventDefault())
            }
            inner.appendChild(pc)
          }
          // 3) scroll sync: the buttons live in content coordinates; the pane translates
          inner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)'
          updateLiveCaret()
        } catch { /* any measurement failure degrades to the plain textarea */ }
      }

      // the caret (or a selection) touching a cover's char range lifts that cover —
      // the raw syntax you are editing is the thing you should see. Only a FOCUSED
      // caret lifts: an unfocused textarea (a note just opened, or focus moved to
      // the title/toolbar) shows every pretty surface — the reading-while-editing
      // view. S88: ONE mechanism for ALL covers (checkbox, inline chip, code panel)
      // via the data-cs/data-ce char range each cover now carries.
      const updateLiveCaret = () => {
        const ta = $('[data-vault-src]')
        const inner = $('[data-vault-md-live-in]')
        if (!ta || !inner) return
        const focused = document.activeElement === ta
        const s0 = ta.selectionStart ?? 0
        const s1 = ta.selectionEnd ?? s0
        for (const cov of inner.querySelectorAll('[data-cs]')) {
          let lift = false
          if (focused) {
            const csAt = Number(cov.getAttribute('data-cs'))
            const ceAt = Number(cov.getAttribute('data-ce'))
            lift = s0 <= ceAt && csAt <= s1
          }
          cov.classList.toggle('is-raw', lift)
        }
      }

      const onLiveScroll = () => {
        const ta = $('[data-vault-src]')
        const inner = $('[data-vault-md-live-in]')
        if (!ta || !inner) return
        inner.style.transform = 'translateY(' + (-ta.scrollTop) + 'px)'
      }
      const onLiveCaret = () => { if (!liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; updateLiveCaret() }) }
      const onLiveResize = () => {
        clearTimeout(liveResizeT)
        liveResizeT = setTimeout(syncLiveChecks, 180)
      }
      const wireLiveChecks = () => {
        const ta = $('[data-vault-src]')
        if (!ta) return
        syncLiveChecks()
        ta.addEventListener('scroll', onLiveScroll, { passive: true })
        ta.addEventListener('keyup', onLiveCaret)
        ta.addEventListener('mouseup', onLiveCaret)
        ta.addEventListener('focus', onLiveCaret)
        ta.addEventListener('blur', onLiveCaret) // focus leaves → every cover returns
        ta.addEventListener('touchend', onLiveCaret)
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
      /* ── S84: the reveal contract with #hibana-page-loader ──
         (owner: "notes.html still appears pre-emptively and unloaded — elements
         are not looking proper"): app.js gates THIS page's veil on data, not
         DOMContentLoaded (notes.html declares <html data-hibana-reveal="gated">").
         revealPage() fires once the vault's first REAL paint happened — the list
         pane rendered with real cards, or the honest load-failed Retry panel;
         either way the page is worth looking at. Idempotent (later view switches
         re-run loadNotes — the second call is a no-op). Belt: hide the loader
         DIRECTLY too — if app.js itself never arrived (a dropped asset on the
         flaky link), the veil would otherwise trap this booted page forever
         (base.css's 20s CSS escape is the last resort behind this). */
      let pageRevealed = false
      const revealPage = () => {
        if (pageRevealed) return
        pageRevealed = true
        try { document.documentElement.setAttribute('data-hibana-ready', '1') } catch {}
        try { window.dispatchEvent(new CustomEvent('hibana:page-ready')) } catch {}
        try { const veil = document.getElementById('hibana-page-loader'); if (veil) veil.classList.add('is-hidden') } catch {}
      }
      // S82 (owner: "notes.html first opens broken/unloaded — I have to refresh 1-2
      // times to see the real page"): a failed bootstrap used to leave the tree's
      // skeleton shimmering FOREVER (renderTree only ran on success), and a single
      // transient network failure (Iran + VPN) rendered the fake "No notes yet"
      // template. One quick retry + always rendering the tree on failure makes the
      // first load self-heal instead of demanding a manual refresh.
      const loadBootstrapOnce = async () => {
        // S84: the inline head script starts this fetch at HTML-parse time (seconds
        // before the deferred scripts run on a slow link — the veil's total time
        // becomes max(scripts, data) instead of scripts + data). Consume it once;
        // any rejection (401 logged-out, net reset) falls through to the api() path.
        const pre = window.__hibanaVaultBoot
        if (pre) { window.__hibanaVaultBoot = null }
        try {
          const boot = pre ? await pre : await api('/api/vault/bootstrap')
          state.folders = boot.folders || []
          state.tags = boot.tags || []
          state.noteIndex = boot.noteIndex || []
          state.counts = boot.counts || { all: 0, starred: 0, trash: 0 }
          state.bootFailed = false
          return true
        } catch { return false }
      }
      const loadBootstrap = async () => {
        const seq = ++bootSeq
        let ok = await loadBootstrapOnce()
        if (!ok) {
          // one retry after a beat — the classic cold-connection hiccup
          await new Promise((r) => setTimeout(r, 1200))
          ok = await loadBootstrapOnce()
        }
        if (seq !== bootSeq) return
        state.bootFailed = !ok
        renderTree() // ALWAYS render — even on failure the sidebar shows its real
        // (empty) chrome instead of an eternal skeleton
      }

      let listSeq = 0
      const loadNotesOnce = async (qs) => {
        const res = await api('/api/vault/notes?' + qs.toString())
        return res.notes || []
      }
      const loadNotes = async () => {
        const seq = ++listSeq
        state.loadingList = true
        renderCards()
        const qs = new URLSearchParams()
        if (state.view.type === 'folder' && state.view.id) { qs.set('view', 'folder'); qs.set('folder', state.view.id) }
        else if (state.view.type === 'unfiled') { qs.set('view', 'folder'); qs.set('folder', 'none') }
        else if (state.view.type === 'tag') { qs.set('view', 'all'); qs.set('tag', state.view.id) }
        else qs.set('view', state.view.type)
        if (state.q) qs.set('q', state.q)
        if (state.sort) qs.set('sort', state.sort)
        let notes = null
        try {
          notes = await loadNotesOnce(qs)
          state.loadFailed = false
        } catch {
          // S82: one retry — a single dropped request used to render the fake
          // "No notes yet" template (the refresh-the-page bug)
          try {
            await new Promise((r) => setTimeout(r, 1200))
            notes = await loadNotesOnce(qs)
            state.loadFailed = false
          } catch { notes = []; state.loadFailed = true } // S83: mark it — the empty
          // state below must NOT claim "No notes yet" when the truth is "offline"
        }
        if (seq !== listSeq) return
        state.notes = notes
        state.loadingList = false
        renderCards()
        // S84: the first REAL paint just happened (real cards — or the honest
        // load-failed Retry panel above) → lift the veil. Later view switches
        // re-run loadNotes; revealPage is idempotent so this line costs nothing.
        revealPage()
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
      /* ── S120: the interrupted-session draft store — sync local writes survive any
         teardown (tab close, crash, navigation); see openNote for the restore. ── */
      const VAULT_DRAFT_KEY = 'hibana-vault-draft'
      const saveVaultDraft = () => {
        try {
          if (!state.active) return
          localStorage.setItem(VAULT_DRAFT_KEY, JSON.stringify({ id: state.active.id, t: state.draft.title, c: state.draft.content, at: Date.now() }))
        } catch { /* storage full / private mode — the autosave still runs */ }
      }
      const clearVaultDraft = () => { try { localStorage.removeItem(VAULT_DRAFT_KEY) } catch { /* private mode */ } }

      const doSave = async () => {
        if (!state.active || state.active.deleted_at) return
        const payload = { title: state.draft.title, content: state.draft.content }
        const sentTitle = payload.title
        const sentContent = payload.content
        state.saveState = 'saving'
        updateStatus()
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify(payload) })
          state.active = res.note
          state.saveState = 'saved'
          // S120: the server now holds exactly what was sent — the interrupted-session
          // draft has served its purpose (unless newer keystrokes landed mid-save; the
          // re-arm below handles those, and the draft stays until THEY save).
          try {
            const dr = JSON.parse(localStorage.getItem(VAULT_DRAFT_KEY) || 'null')
            if (dr && dr.id === state.active.id && dr.t === sentTitle && dr.c === sentContent) localStorage.removeItem(VAULT_DRAFT_KEY)
          } catch { /* draft unreadable — nothing to retire */ }
          // patch the card in place (no list refetch — keeps scroll + feels instant)
          const idx = state.notes.findIndex((c) => c.id === state.active.id)
          if (idx >= 0) {
            state.notes[idx] = { ...state.notes[idx], title: state.active.title, tags: state.active.tags, starred: state.active.starred, folder_id: state.active.folder_id, updated_at: state.active.updated_at }
            const cardEl = document.querySelector('[data-vault-card="' + state.active.id + '"]')
            if (cardEl) cardEl.outerHTML = cardHtml(state.notes[idx])
          }
          const stampEl = document.querySelector('.vault-ed-stamp')
          if (stampEl) stampEl.textContent = _t('notes.edited', 'Edited') + ' ' + fmtStamp(state.active.updated_at)
          // S105: the tree's note index follows the save (title + folder changes
          // re-render the sidebar rows — no full bootstrap refetch needed).
          upsertNoteIndex(state.active)
          renderTree()
          // S105 (owner: resume lists only ACTIVELY-INTERACTED items): saving a
          // note IS the interaction that records it — opening/viewing no longer does.
          window.hibanaResume?.record?.('note', state.active.id, state.active.title)
          // S120 (two jobs #1 — never lose an idea): keystrokes typed while this PATCH
          // was in flight had no timer (markDirty skips the 'saving' state) and would
          // never re-save once it landed — if the draft moved past what was sent,
          // re-arm the autosave so it converges on the next beat.
          if (state.draft.title !== sentTitle || state.draft.content !== sentContent) markDirty()
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
          // S120 (two jobs #1 — never lose an idea): the 900ms autosave debounce is a
          // LOSS WINDOW — a tab closed (or crashed) inside it dropped the tail
          // keystrokes. The belt is a LOCAL draft (sync writes survive any teardown —
          // no network involved): if the stored draft for THIS note is newer than the
          // server copy, an interrupted session left keystrokes behind — restore them
          // and let the autosave converge. (The pagehide keepalive PATCH below stays
          // as the network belt — real browsers usually deliver it; this draft is the
          // guarantee.)
          try {
            const dr = JSON.parse(localStorage.getItem(VAULT_DRAFT_KEY) || 'null')
            const serverAt = Date.parse(res.note.updated_at || '') || 0
            if (dr && dr.id === id && typeof dr.at === 'number' && dr.at > serverAt) {
              state.draft.title = String(dr.t ?? '').slice(0, 300)
              state.draft.content = String(dr.c ?? '')
              state.saveState = 'dirty'
            }
          } catch { /* corrupt draft — the server copy stands */ }
          renderEditor()
          renderCards() // refresh the aria-current highlight
          renderTree() // S105: the tree's note rows highlight the open note too
          if (isMobile()) $('[data-vault-editor]')?.setAttribute('data-open', 'true')
          try { history.replaceState(null, '', '#n=' + id) } catch {}
          if (state.saveState === 'dirty') markDirty() // restored draft → converge on the next beat
          if (focusBody) { const ta = $('[data-vault-src]'); if (ta && state.mode !== 'read') { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length) } }
        } catch { toast(_t('notes.openFailed', 'Could not open that note.'), 'err') }
      }

      const closeNote = async () => {
        await flushSave()
        state.active = null
        state.draft = { title: '', content: '', tags: '' }
        state.saveState = 'idle'
        clearVaultDraft() // S120: a deliberately closed note has no orphan draft
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
          // S105: creating a note is an interaction — it joins the resume strip.
          window.hibanaResume?.record?.('note', res.note.id, res.note.title)
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

      /* ── S86: emoji for notes + folders (the shared full-library picker) ── */
      const pickNoteEmoji = (anchor) => {
        if (!state.active || state.active.deleted_at) return
        window.hibanaEmojiPicker?.open({
          anchor: anchor instanceof Element ? anchor : undefined,
          current: state.active.icon || undefined,
          onPick: async (emoji) => {
            try {
              const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify({ icon: emoji }) })
              if (state.active && res.note) state.active = res.note
              // the open card + the editor chip update in place (no list refetch —
              // the icon PATCH must not masquerade as an edit for OTHER sort modes)
              const card = document.querySelector('[data-vault-card="' + state.active.id + '"] .vault-card-title')
              if (card) {
                const old = card.querySelector('.vault-card-emoji')
                if (old) old.remove()
                card.insertAdjacentHTML('afterbegin', `<span class="vault-card-emoji" role="img" aria-label="">${esc(emoji)}</span>`)
              }
              renderEditor()
            } catch { toast(_t('notes.emojiFailed', 'Could not set the emoji.'), 'err') }
          },
        })
      }

      const clearNoteEmoji = async () => {
        if (!state.active || state.active.deleted_at) return
        try {
          const res = await api('/api/vault/notes/' + state.active.id, { method: 'PATCH', body: JSON.stringify({ icon: null }) })
          if (state.active && res.note) state.active = res.note
          const card = document.querySelector('[data-vault-card="' + state.active.id + '"] .vault-card-emoji')
          if (card) card.remove()
          renderEditor()
        } catch { toast(_t('notes.emojiFailed', 'Could not set the emoji.'), 'err') }
      }

      const pickFolderEmoji = (f, anchor) => {
        window.hibanaEmojiPicker?.open({
          anchor: anchor instanceof Element ? anchor : undefined,
          current: f.icon || undefined,
          onPick: async (emoji) => {
            try {
              await api('/api/vault/folders/' + f.id, { method: 'PATCH', body: JSON.stringify({ icon: emoji }) })
              const row = folderById(f.id)
              if (row) row.icon = emoji
              renderTree()
            } catch { toast(_t('notes.emojiFailed', 'Could not set the emoji.'), 'err') }
          },
        })
      }

      const clearFolderEmoji = async (f) => {
        try {
          await api('/api/vault/folders/' + f.id, { method: 'PATCH', body: JSON.stringify({ icon: null }) })
          const row = folderById(f.id)
          if (row) row.icon = null
          renderTree()
        } catch { toast(_t('notes.emojiFailed', 'Could not set the emoji.'), 'err') }
      }

      /* ── S86 (0059): manual drag-reorder of the note cards ──
         HTML5 DnD on [draggable] cards; touch-drag.js (already loaded on this page)
         synthesizes the same events from a 250ms long-press, so phones reorder too.
         The dragged node moves LIVE (insertBefore on dragover, the quicknotes
         pattern); drop/dragend persists the whole visible order. A drag flips the
         sort to 'manual' — the arrangement the user just made becomes THE order. */
      let dragCard = null
      const onCardDragStart = (e) => {
        const card = e.target instanceof Element ? e.target.closest('[data-vault-card][draggable]') : null
        if (!card) return
        dragCard = card
        card.classList.add('vault-card-dragging')
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', card.getAttribute('data-vault-card') || '') } catch {}
      }
      const onCardDragOver = (e) => {
        if (!dragCard) return
        const over = e.target instanceof Element ? e.target.closest('[data-vault-card]') : null
        if (!over || over === dragCard || over.parentElement !== dragCard.parentElement) return
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'move' } catch {}
        const r = over.getBoundingClientRect()
        const before = e.clientY - r.top < r.height / 2
        over.parentElement.insertBefore(dragCard, before ? over : over.nextSibling)
      }
      const onCardDrop = (e) => {
        if (!dragCard) return
        e.preventDefault()
        persistReorder()
      }
      const onCardDragEnd = () => {
        if (!dragCard) return
        dragCard.classList.remove('vault-card-dragging')
        dragCard = null
      }
      const persistReorder = async () => {
        const el = cardsEl()
        if (!el) return
        const ids = [...el.querySelectorAll('[data-vault-card]')].map((c) => c.getAttribute('data-vault-card'))
        if (ids.length < 2) return
        // The arrangement the user just made IS the order — flip the sort so it STAYS.
        if (state.sort !== 'manual') {
          state.sort = 'manual'
          prefs.sort = 'manual'
          savePrefs()
          const sel = $('[data-vault-sort]')
          if (sel) sel.value = 'manual'
        }
        // keep the local model in the DOM's order (no refetch, no flash)
        const byId = new Map(state.notes.map((n) => [n.id, n]))
        state.notes = ids.map((id) => byId.get(id)).filter(Boolean)
        try {
          await api('/api/vault/notes/reorder', { method: 'POST', body: JSON.stringify({ ids }) })
        } catch {
          toast(_t('notes.reorderFailed', "Couldn't save the order."), 'err')
          loadNotes() // the server truth wins — restore the last saved order
        }
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
          window.hibanaResume?.record?.('note', res.note.id, res.note.title) // S105: moving IS interacting
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
        // S86: emoji set/clear rides the note menu (the editor chip is the quick path)
        items.push({ icon: I.smile, label: _t('notes.setEmoji', 'Set emoji…'), onClick: (anchor) => pickNoteEmoji(anchor) })
        if (n.icon) items.push({ icon: I.x, label: _t('notes.removeEmoji', 'Remove emoji'), onClick: clearNoteEmoji })
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
          { icon: I.smile, label: _t('notes.setEmoji', 'Set emoji…'), onClick: (a) => pickFolderEmoji(f, a) },
          ...(f.icon ? [{ icon: I.x, label: _t('notes.removeEmoji', 'Remove emoji'), onClick: () => clearFolderEmoji(f) }] : []),
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

      // S83 (the Checklist toolbar action): line-prefix toggle for `- [ ] `. Strips
      // ANY task marker (open or done) first so re-clicking a done task never stacks
      // a second marker; all-lines-are-tasks → clicking again unwraps to plain text.
      const linePrefixTask = (ta) => {
        const v = ta.value
        let start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1
        let end = v.indexOf('\n', ta.selectionEnd)
        if (end === -1) end = v.length
        // S84: the same widened grammar as the renderer — a bare `[ ] milk` line the
        // owner typed by hand round-trips the toolbar toggle like a canonical one
        const stripTask = (l) => l.replace(/^[ \t]*(?:[-*+] )?\[[ xX]\][ \t]*/, '')
        const isTask = (l) => TASK_LINE_TEST.test(l)
        const lines = v.slice(start, end).split('\n')
        const all = lines.every((l) => isTask(l))
        const out = lines.map((l) => all ? stripTask(l) : '- [ ] ' + stripTask(l)).join('\n')
        ta.setRangeText(out, start, end, 'end')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
        ta.focus()
      }

      // S83: a preview checkbox click flips the matching source line (the Nth task in
      // document order — renderMarkdown tags each box with that index). Riding the
      // textarea's input event keeps the draft/autosave/re-render pipeline untouched.
      const toggleMdTask = (idx) => {
        const ta = $('[data-vault-src]')
        if (!ta || ta.readOnly) return
        const lines = String(ta.value).split('\n')
        let k = -1
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(TASK_LINE_TEST)
          if (!m) continue
          k += 1
          if (k !== idx) continue
          const open = m[1].toLowerCase() !== 'x'
          lines[i] = lines[i].replace(/\[[ xX]\]/, open ? '[x]' : '[ ]')
          // S84: `[ ]`↔`[x]` is length-neutral — restoring the caret keeps the writer's
          // place when the flip comes from a preview/overlay click mid-editing.
          const s0 = ta.selectionStart, s1 = ta.selectionEnd
          ta.value = lines.join('\n')
          try { ta.setSelectionRange(s0, s1) } catch {}
          ta.dispatchEvent(new Event('input', { bubbles: true }))
          syncLiveChecks() // the overlay flips NOW, not 140ms later
          return
        }
        // idx beyond the last task = a stale render index (an edit reshuffled the
        // lines mid-click); the input-driven re-render heals it — nothing to do.
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
        else if (act === 'code') {
          wrapSel(ta, '`', '`', _t('notes.tb.codeText', 'code'))
          // S83 (owner: "when you add code in the middle of a note it must APPEAR
          // differently"): in edit-only mode the backticks land in a mono source
          // textarea where nothing reads as styled. Flip to split the moment code is
          // inserted so the rust mono chip renders beside the cursor — the visual
          // confirmation the </> button promises. The selection (wrapSel selects the
          // inserted span) is carried across the re-render so the cursor doesn't
          // teleport to the end.
          if (state.mode === 'edit') {
            const selStart = ta.selectionStart, selEnd = ta.selectionEnd
            state.mode = 'split'
            prefs.mode = 'split'
            savePrefs()
            renderEditor()
            const back = $('[data-vault-src]')
            if (back) {
              const max = back.value.length
              back.focus({ preventScroll: true })
              back.setSelectionRange(Math.min(selStart, max), Math.min(selEnd, max))
            }
          }
        }
        else if (act === 'h1') linePrefix(ta, '# ')
        else if (act === 'h2') linePrefix(ta, '## ')
        else if (act === 'h3') linePrefix(ta, '### ')
        else if (act === 'ul') linePrefix(ta, '- ')
        else if (act === 'check') linePrefixTask(ta)
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

        // S83: the load-failed panel's Retry — re-runs both fetches (the list first
        // so the panel swaps to skeleton instantly, bootstrap alongside for counts).
        if (t.closest('[data-vault-retry]')) {
          state.loadFailed = false
          loadNotes()
          loadBootstrap()
          return
        }

        // S83: the preview's checklist boxes toggle the source line (edit + split modes)
        const chk = t.closest('[data-md-task]')
        if (chk) { toggleMdTask(Number(chk.getAttribute('data-md-task'))); return }

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

        // S105: section heading collapse (Folders / Tags)
        const sec = t.closest('[data-vault-sec]')
        if (sec) {
          e.stopPropagation()
          const key = sec.getAttribute('data-vault-sec')
          if (key === 'folders') prefs.secFolders = !prefs.secFolders
          else if (key === 'tags') prefs.secTags = !prefs.secTags
          savePrefs()
          renderTree()
          return
        }

        // S105: a note row in the tree — opens the note (same as its card)
        const noteBtn = t.closest('[data-vault-note]')
        if (noteBtn) {
          e.stopPropagation()
          openNote(noteBtn.getAttribute('data-vault-note'), { focusBody: false })
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
        // S86: the editor's emoji chip + the toolbar's Ask-AI button
        const emojiBtn = t.closest('[data-vault-emoji]')
        if (emojiBtn) { pickNoteEmoji(emojiBtn); return }
        const aiBtn = t.closest('[data-vault-ai]')
        if (aiBtn) {
          const src = $('[data-vault-src]')
          // S88: the popover anchors to THIS toolbar icon (below it, wherever the
          // editor lives) — not to the hover-wand's corner at a fixed page position.
          if (src && window.hibanaMagicWand) window.hibanaMagicWand.openFor(src, aiBtn)
          else if (!window.hibanaMagicWand) toast(_t('magic.failed', 'The AI request failed. Your text was not changed.'), 'err')
          return
        }
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
          saveVaultDraft() // S120: the keystroke survives even a mid-debounce teardown
          clearTimeout(previewTimer)
          previewTimer = setTimeout(renderPreview, 140)
          updateStatus()
        } else if (t.matches('[data-vault-title]')) {
          state.draft.title = t.value
          markDirty()
          saveVaultDraft() // S120: ditto
          updateStatus()
        } else if (t.matches('[data-vault-newfolder-input]')) {
          // Enter commits (keydown below)
        }
      }

      // S120 (two jobs #1 — never lose an idea): the pagehide keepalive PATCH is the
      // NETWORK BELT for the debounce window — real headed browsers usually deliver
      // it, but some engines (and CDP-driven teardowns) drop unload-time requests
      // entirely, so the GUARANTEE is the local draft (see openNote: restore +
      // converge). 'saving' is included: the in-flight request dies with the page,
      // so the belt carries the full current draft (both PATCHes are full snapshots
      // — last write wins, and the belt holds the newest).
      window.addEventListener('pagehide', () => {
        if (!state.active || state.active.deleted_at) return
        if (!state.saveTimer && state.saveState !== 'dirty' && state.saveState !== 'saving') return
        if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null }
        try {
          fetch('/api/vault/notes/' + state.active.id, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: state.draft.title, content: state.draft.content }),
            keepalive: true,
          }).catch(() => {})
        } catch { /* keepalive quota exhausted — the next edit re-saves */ }
      })
      // bfcache restore: if the keepalive didn't land (quota/race), the strip is
      // still marked dirty — re-arm the autosave so the server converges (an
      // idempotent full-snapshot PATCH).
      window.addEventListener('pageshow', () => {
        if (state.active && !state.active.deleted_at && state.saveState === 'dirty' && !state.saveTimer) {
          state.saveTimer = setTimeout(() => { state.saveTimer = null; doSave() }, 250)
        }
      })

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
        // S84 (the checklist flow): Enter at the END of a task line continues the
        // list (the next line is born `- [ ] ` — the gesture every checklist editor
        // has); Enter on an EMPTY task unwraps it — the exit. Mid-line Enters stay
        // native (splitting text must not inherit the marker).
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
          && t.matches('[data-vault-src]') && !t.readOnly && t.selectionStart === t.selectionEnd) {
          const v = t.value
          const pos = t.selectionStart
          const ls = v.lastIndexOf('\n', pos - 1) + 1
          let le = v.indexOf('\n', pos)
          if (le === -1) le = v.length
          if (pos === le && TASK_LINE_TEST.test(v.slice(ls, le))) {
            e.preventDefault()
            const line = v.slice(ls, le)
            const bare = line.replace(/^[ \t]*(?:[-*+] )?\[[ xX]\][ \t]*/, '')
            if (!bare) t.setRangeText('\n', ls, le, 'end')
            else {
              const indent = (/^[ \t]*/.exec(line) || [''])[0]
              t.setRangeText('\n' + indent + '- [ ] ', le, le, 'end')
            }
            t.dispatchEvent(new Event('input', { bubbles: true }))
            return
          }
        }
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
      // S86: the card drag-reorder (HTML5 DnD — touch-drag.js synthesizes these on phones)
      document.addEventListener('dragstart', onCardDragStart)
      document.addEventListener('dragover', onCardDragOver)
      document.addEventListener('drop', onCardDrop)
      document.addEventListener('dragend', onCardDragEnd)
      // S84: caret tracking for the live checkboxes (selectionchange covers caret
      // moves in Chromium; the per-textarea keyup/mouseup/focus listeners in
      // wireLiveChecks are the belt) + pane re-measure on resize/rotation
      document.addEventListener('selectionchange', onLiveCaret)
      window.addEventListener('resize', onLiveResize)

      // sort select initial value
      const sortSel = $('[data-vault-sort]')
      if (sortSel) sortSel.value = state.sort

      /* ── boot: restore view pref + hash deep-link ── */
      // S82 (the "first load feels broken, needs 1-2 refreshes" report): bootstrap +
      // the notes list used to load SEQUENTIALLY — two full round trips (measured
      // ~1.3s + ~1.1s on a good day, far worse over VPN) before ANY real content
      // painted. The 99% case (no folder deep-link) now runs BOTH fetches in
      // parallel; only the folder deep-link path needs bootstrap first (it resolves
      // the folder id), and even there the notes fetch starts against the hash/pref
      // view the moment the folder is known.
      const boot = async () => {
        const wantNew = new URLSearchParams(location.search).get('new') === '1'
        let initial = { type: 'all', id: null }
        let jumpQ = null
        try {
          const m = location.hash.match(/^#n=([0-9a-f-]+)(?:&q=([^&]+))?$/i)
          if (m) { initial = { type: 'note', id: m[1] }; if (m[2]) jumpQ = decodeURIComponent(m[2]) }
          else {
            const qs = new URLSearchParams(location.search)
            if (qs.get('view') === 'folder' && qs.get('folder')) {
              initial = { type: 'folder-pending', id: qs.get('folder') }
              try { history.replaceState(null, '', location.pathname) } catch {}
            }
          }
          if (initial.type === 'folder-pending' && prefs.view && prefs.view.type) {
            // the saved view may be a folder too — keep the pending flag only for the
            // deep-linked id; a plain saved view resolves after bootstrap as before
            if (prefs.view.type !== 'folder') initial = prefs.view
          } else if (initial.type !== 'folder-pending' && prefs.view && prefs.view.type) initial = prefs.view
        } catch {}
        // PARALLEL: the notes fetch rides alongside bootstrap for every view the
        // URL/prefs already determine (all/starred/trash/unfiled/tag/note/pending-
        // folder fallback → all). Only a resolved folder deep-link re-fetches.
        const needFolderResolve = initial.type === 'folder-pending'
        const notesView = needFolderResolve ? { type: 'all', id: null } : initial
        const fetchedView = notesView.type === 'note' ? { type: 'all', id: null } : notesView
        const bootP = loadBootstrap()
        let notesP = null
        if (!wantNew) {
          state.view = fetchedView
          notesP = loadNotes()
        }
        await bootP
        if (wantNew) {
          try { history.replaceState(null, '', location.pathname) } catch {}
          if (!notesP) { state.view = { type: 'all', id: null }; notesP = loadNotes() }
          await notesP
          await newNote()
          return
        }
        if (needFolderResolve) {
          initial = folderById(initial.id) ? { type: 'folder', id: initial.id } : { type: 'all', id: null }
        }
        if (initial.type === 'note' && initial.id) {
          await notesP // the list is what openNote's jumpToMatch scrolls within
          await openNote(initial.id, { focusBody: false })
          if (jumpQ) jumpToMatch(jumpQ)
          return
        }
        if (initial.type === 'folder' && !folderById(initial.id)) initial = { type: 'all', id: null }
        if (initial.type === 'tag' && !state.tags.some((x) => x.tag.toLowerCase() === initial.id.toLowerCase())) initial = { type: 'all', id: null }
        state.view = initial
        // The parallel fetch ran against fetchedView; if post-bootstrap validation
        // landed on a different view (deleted folder/tag, resolved deep-link), the
        // already-rendered list is stale for it — refetch instead of awaiting it.
        const sameView = initial.type === fetchedView.type && String(initial.id || '') === String(fetchedView.id || '')
        if (!sameView) { await loadNotes(); renderTree() }
        else await notesP
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
        document.removeEventListener('dragstart', onCardDragStart)
        document.removeEventListener('dragover', onCardDragOver)
        document.removeEventListener('drop', onCardDrop)
        document.removeEventListener('dragend', onCardDragEnd)
        if (liveRaf) cancelAnimationFrame(liveRaf)
        clearTimeout(liveResizeT)
        document.removeEventListener('selectionchange', onLiveCaret)
        window.removeEventListener('resize', onLiveResize)
        if (liveMirrorEl) { liveMirrorEl.remove(); liveMirrorEl = null }
      }
    },
  })
})()
