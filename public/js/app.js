// Hibana frontend helpers — vanilla + htmx + Alpine (no build step, per the stack decision).

// Apply the saved theme site-wide before paint (Settings → Theme store it in localStorage).
try {
  const savedTheme = localStorage.getItem('hibana-theme')
  if (savedTheme) document.documentElement.dataset.theme = savedTheme
} catch {}

// Ensure the shared offline queue (window.hibanaQueue) is always loaded — it lives in
// js/queue.js and powers the quick-add + canvas sync. Guard against pages that forgot the tag.
if (!window.hibanaQueue) {
  const qs = document.createElement('script')
  qs.src = '/js/queue.js'
  document.head.appendChild(qs)
}

window.hibana = (() => {
  // Persistent theme control — a deterministic light/dark toggle in the header.
  // Previously it cycled light→dark→'system', and 'system' has no data-theme rule, so
  // clicks silently fell back to the OS and appeared to "do nothing". Now the header
  // button always flips between the two explicit themes; 'system' is still stored when
  // chosen in Settings and resolved to whichever the OS prefers.
  const SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  const MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'
  function currentTheme() {
    const saved = localStorage.getItem('hibana-theme') || 'system'
    if (saved === 'light') return 'light'
    if (saved === 'dark') return 'dark'
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  function setTheme(t) {
    document.documentElement.dataset.theme = t
    try {
      localStorage.setItem('hibana-theme', t)
    } catch {}
    // P4.4 (F-M15): update the mobile address-bar color to match the theme. Dark mode bg
    // is #1E1A15 (the lifted warm dark); light mode bg is #FAF9F6.
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1E1A15' : '#FAF9F6')
  }
  function paintThemeButton() {
    const dark = currentTheme() === 'dark'
    document.querySelectorAll('[data-theme-toggle], .theme-floater').forEach((b) => {
      b.innerHTML = dark ? MOON : SUN
      b.title = dark ? _t('theme.toLight', 'Switch to light mode') : _t('theme.toDark', 'Switch to dark mode')
    })
  }
  function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    setTheme(next)
    paintThemeButton()
    return next
  }
  // One toast component for all errors and confirmations (spec §7).
  // Phase B2.4: action-button support + persistent errors by default.
  //   toast('Saved', 'info')              → 4s, auto-dismiss
  //   toast('Failed', 'err')              → persistent (stays until dismissed)
  //   toast('Deleted', 'info', 6000, [{label:'Undo', onClick:undoFn}]) → 6s + Undo button
  function toast(message, kind = 'info', ms, actions = null) {
    if (ms === undefined) ms = kind === 'err' ? 0 : 4000 // errors persist by default
    const old = document.getElementById('toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.id = 'toast'
    el.className = `toast ${kind}`
    el.setAttribute('role', 'status')
    // Message (existing behavior: message can contain HTML, e.g. links)
    const msg = document.createElement('span')
    msg.className = 'toast-msg'
    msg.innerHTML = message
    el.appendChild(msg)
    // Action buttons (undo, retry, etc.) — appended before the dismiss button
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const btn = document.createElement('button')
        btn.className = a.kind === 'primary' ? '' : 'ghost'
        btn.textContent = a.label
        btn.addEventListener('click', () => { try { a.onClick?.() } catch {} el.remove() })
        el.appendChild(btn)
      }
    }
    // Dismiss button (always present)
    const dismiss = document.createElement('button')
    dismiss.className = 'ghost danger'
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    dismiss.addEventListener('click', () => el.remove())
    el.appendChild(dismiss)
    document.body.appendChild(el)
    if (ms > 0) setTimeout(() => { if (el.parentNode) el.remove() }, ms)
  }

  // Minimal 401 handling (2026-08-29): an expired session on a user-initiated action
  // bounces to login instead of dead-ending behind a generic error toast. Called only
  // with the Response of a direct user action (drag/edit/submit) — background sync
  // (queue.js flush) must NEVER redirect; it keeps its items and retries (see queue.js).
  function handle401(res) {
    if (res && res.status === 401 && location.pathname !== '/login.html') {
      window.location.href = '/login.html'
      return true
    }
    return false
  }

  // ---- Quick-add Spark modal (native <dialog> — reliable open/close/Esc, no Alpine scope) ----
  // Client-side strings go through the i18n layer (spec §14); fallbacks keep English default.
  const _t = (key, fallback) => window.hibanaI18n?.t(key) ?? (fallback || key)
  // Built once into <body> so every page shares one implementation (spec §5.5 quick-add modal).
  let quickAddEl = null
  let quickAddForm = null

  function buildQuickAdd() {
    if (quickAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'quickadd-dialog'
    dlg.className = 'dialog'
    dlg.innerHTML = `
      <form class="modal" id="quickadd-form" novalidate>
        <h3>${_t('qa.title', 'New Idea')}</h3>
        <label>${_t('qa.title', 'New Idea')} <span class="row qa-title-row">
          <input type="text" id="qa-title" required maxlength="200" autocomplete="off">
        </span></label>
        <p class="muted small" id="qa-dup" hidden></p>
        <label>${_t('qa.oneLiner', 'One-liner')} <textarea id="qa-description" rows="2" maxlength="2000"></textarea></label>
        <label>${_t('qa.tags', 'Tags (comma-separated, optional)')} <input type="text" id="qa-tags" placeholder="${_t('qa.tagsPlaceholder', 'AI, WordPress, …')}" maxlength="200"></label>
        <label>${_t('qa.sketch', 'Sketch (optional)')} <input type="file" id="qa-file" accept="image/png,image/jpeg,image/webp,image/gif"></label>
        <p class="error" id="qa-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="qa-save">${_t('common.save', 'Save')}</button>
          <button type="button" class="ghost" id="qa-cancel">${_t('common.cancel', 'Cancel')}</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    quickAddForm = dlg.querySelector('#quickadd-form')
    const dupEl = dlg.querySelector('#qa-dup')

    // Duplicate-title soft warning (spec §5.3): never blocks, just nudges. Debounced so it
    // fires once the user pauses typing, and silenced while the field is empty.
    let dupTimer = null
    dlg.querySelector('#qa-title').addEventListener('input', () => {
      clearTimeout(dupTimer)
      dupEl.hidden = true
      const title = dlg.querySelector('#qa-title').value.trim()
      if (!title) return
      dupTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/duplicate-check?title=${encodeURIComponent(title)}`)
          const body = await res.json()
          dupEl.textContent = body.duplicate ? _t('qa.duplicate', 'A project with this title already exists') : ''
          dupEl.hidden = !body.duplicate
        } catch { /* the soft warning must never block capture */ }
      }, 350)
    })

    const close = () => dlg.close()
    const reset = () => {
      quickAddForm.reset()
      document.getElementById('qa-error').textContent = ''
      dupEl.hidden = true
      dupEl.textContent = ''
    }

    // Esc (native cancel) + backdrop click + explicit Cancel all dismiss cleanly.
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      close()
    })
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close() // click on the dimmed backdrop, not the panel
    })
    dlg.querySelector('#qa-cancel').addEventListener('click', close)

    dlg.addEventListener('close', () => {
      const save = dlg.querySelector('#qa-save')
      save.disabled = false
      save.textContent = _t('common.save', 'Save')
    })

    quickAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('qa-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#qa-save')
      save.disabled = true
      save.textContent = _t('qa.saving', 'Saving…')
      const err = document.getElementById('qa-error')
      err.textContent = ''
      try {
        const tags = document
          .getElementById('qa-tags')
          .value.split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((name) => ({ name })) // server assigns the default palette color
        const id = crypto.randomUUID() // rule 2: addressable before the network call
        const payload = { id, title, description: document.getElementById('qa-description').value, tags, status: 'spark' }
        await window.hibanaQueue.enqueue({ kind: 'project', data: payload })
        const synced = await window.hibanaQueue.flush()
        const drained = (await window.hibanaQueue.count()) === 0
        const file = document.getElementById('qa-file').files[0]
        if (file) {
          // Optional sketch attached to the raw idea (spec §2) — uploaded once the project exists.
          const b64 = await new Promise((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(String(r.result).split(',')[1])
            r.onerror = reject
            r.readAsDataURL(file)
          })
          await fetch(`/api/projects/${id}/screenshots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64 }),
          }).catch(() => {}) // attachment failure must not block capture
        }
        if (synced && drained && navigator.onLine) {
          close()
          reset()
          // User request (2026-08-25): capturing from the Ideas page lands back there with a
          // real reload so the new idea shows; anywhere else the dashboard. (nav.js skips
          // same-page navigation, hence the hard reload for the Ideas page.)
          if (location.pathname === '/sparks.html') window.location.href = '/sparks.html'
          else if (window.hibanaNav) window.hibanaNav.go('/app')
          else window.location.href = '/app'
        } else {
          close()
          reset()
          window.hibana?.toast(_t('qa.savedOffline', 'Saved offline — it will sync when you reconnect'), 'info', 5000)
        }
      } catch (e2) {
        err.textContent = `${_t('qa.errorPrefix', "Couldn't create the idea —")} ${e2 instanceof Error ? e2.message : 'network error'}`
        save.disabled = false
        save.textContent = _t('common.save', 'Save')
      }
    })

    quickAddEl = dlg
  }

  function openQuickAdd() {
    buildQuickAdd()
    quickAddEl.showModal()
  }

  // ---- New Project dialog (personal, lands in Pending — the vetted step of the pipeline,
  // spec §2). Same offline-safe queue flow as quick-add; only the starting status differs.
  let projectAddEl = null
  let projectAddForm = null

  function buildProjectAdd() {
    if (projectAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'projectadd-dialog'
    dlg.className = 'dialog'
    dlg.innerHTML = `
      <form class="modal" id="projectadd-form" novalidate>
        <h3>${_t('pa.title', 'New Project')}</h3>
        <label>${_t('qa.name', 'Name')} <input type="text" id="pa-title" required maxlength="200" autocomplete="off"></label>
        <p class="muted small" id="pa-dup" hidden></p>
        <label>${_t('qa.oneLiner', 'One-liner')} <textarea id="pa-description" rows="2" maxlength="2000"></textarea></label>
        <label>${_t('qa.tags', 'Tags (comma-separated, optional)')} <input type="text" id="pa-tags" placeholder="${_t('qa.tagsPlaceholder', 'AI, WordPress, …')}" maxlength="200"></label>
        <p class="error" id="pa-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="pa-save">${_t('common.save', 'Save')}</button>
          <button type="button" class="ghost" id="pa-cancel">${_t('common.cancel', 'Cancel')}</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    projectAddForm = dlg.querySelector('#projectadd-form')
    const dupEl = dlg.querySelector('#pa-dup')

    // Duplicate-title soft warning — same debounced, non-blocking behavior as quick-add.
    let dupTimer = null
    dlg.querySelector('#pa-title').addEventListener('input', () => {
      clearTimeout(dupTimer)
      dupEl.hidden = true
      const title = dlg.querySelector('#pa-title').value.trim()
      if (!title) return
      dupTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/duplicate-check?title=${encodeURIComponent(title)}`)
          const body = await res.json()
          dupEl.textContent = body.duplicate ? _t('qa.duplicate', 'A project with this title already exists') : ''
          dupEl.hidden = !body.duplicate
        } catch { /* the soft warning must never block capture */ }
      }, 350)
    })

    const close = () => dlg.close()
    const reset = () => {
      projectAddForm.reset()
      document.getElementById('pa-error').textContent = ''
      dupEl.hidden = true
      dupEl.textContent = ''
    }

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#pa-cancel').addEventListener('click', close)
    dlg.addEventListener('close', () => {
      const save = dlg.querySelector('#pa-save')
      save.disabled = false
      save.textContent = _t('common.save', 'Save')
    })

    projectAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('pa-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#pa-save')
      save.disabled = true
      save.textContent = _t('qa.saving', 'Saving…')
      const err = document.getElementById('pa-error')
      err.textContent = ''
      try {
        const tags = document
          .getElementById('pa-tags')
          .value.split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((name) => ({ name })) // server assigns the default palette color
        const id = crypto.randomUUID() // rule 2: addressable before the network call
        // batch q: a NEW project starts at phase 1 of the lifecycle (بررسی نشده) — ideas are
        // captured with the other FAB as sparks (status 'spark') and live on the Ideas shelf
        const payload = { id, title, description: document.getElementById('pa-description').value, tags, status: projectAddEl.dataset.startStatus || 'unreviewed', type: 'personal' }
        await window.hibanaQueue.enqueue({ kind: 'project', data: payload })
        const synced = await window.hibanaQueue.flush()
        const drained = (await window.hibanaQueue.count()) === 0
        close()
        reset()
        if (synced && drained && navigator.onLine) {
          // User request (2026-09-03): a NEW project lands on ITS detail page. The id is
          // client-generated (rule 2: addressable before the network call), so the
          // destination is known without waiting for a response body.
          const dest = '/project.html?id=' + id
          if (window.hibanaNav) window.hibanaNav.go(dest)
          else window.location.href = dest
        } else {
          window.hibana?.toast(_t('qa.savedOffline', 'Saved offline — it will sync when you reconnect'), 'info', 5000)
        }
      } catch (e2) {
        err.textContent = `${_t('qa.errorPrefix', "Couldn't create the project —")} ${e2 instanceof Error ? e2.message : 'network error'}`
        save.disabled = false
        save.textContent = _t('common.save', 'Save')
      }
    })

    projectAddEl = dlg
  }

  // batch q: default first project stage (legacy 'pending' callers map to unreviewed)
  function openProjectAdd(startStatus = 'unreviewed') {
    buildProjectAdd()
    projectAddEl.dataset.startStatus = startStatus
    projectAddEl.showModal()
  }

  // ---- New Task dialog (user request 2026-08-30): the FAB's primary action. A light
  // capture form — quadrant + title + optional deadline — that posts straight to the
  // to-do board. The full editor (emoji, tags, recurrence…) stays on the board page.
  let taskAddEl = null
  let taskAddForm = null
  let taskQuads = null // [{id, icon, name}] in the active language

  async function fillTaskQuads() {
    const lang = window.hibanaI18n?.lang?.() || 'en'
    if (taskQuads && taskQuads.lang === lang) return taskQuads.list
    let list = null
    try {
      const res = await fetch('/api/sadhana')
      const data = res.ok ? await res.json() : null
      if (data && Array.isArray(data.quads) && data.quads.length) {
        list = data.quads.map((q) => ({ id: q.id, icon: q.icon, name: lang === 'fa' ? q.name_fa : q.name_en }))
      }
    } catch { /* offline → defaults below */ }
    if (!list) {
      list = [
        { id: 1, icon: '⚙️', name: lang === 'fa' ? 'امروز' : 'Today' },
        { id: 3, icon: '🚨', name: lang === 'fa' ? 'فوری و باارزش' : 'Urgent & High Value' },
        { id: 2, icon: '🏔️', name: lang === 'fa' ? 'استراتژیک' : 'Strategic' },
        { id: 4, icon: '🍃', name: lang === 'fa' ? 'شخصی و احساسی' : 'Personal & Sentimental' },
      ]
    }
    taskQuads = { lang, list }
    return list
  }

  function buildTaskAdd() {
    if (taskAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'taskadd-dialog'
    dlg.className = 'dialog'
    dlg.innerHTML = `
      <form class="modal" id="taskadd-form" novalidate>
        <h3 data-i18n="taskAdd.title">New Task</h3>
        <label><span data-i18n="taskAdd.taskLabel">Task</span> <input type="text" id="taskadd-title" required maxlength="255" autocomplete="off"></label>
        <label><span data-i18n="taskAdd.quadrant">Quadrant</span> <select id="taskadd-quad"></select></label>
        <label><span data-i18n="taskAdd.deadline">Deadline (optional)</span> <input type="date" id="taskadd-date"></label>
        <p class="error" id="taskadd-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="taskadd-save" data-i18n="taskAdd.add">Add task</button>
          <button type="button" class="ghost" id="taskadd-cancel" data-i18n="common.cancel">Cancel</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    taskAddForm = dlg.querySelector('#taskadd-form')
    const close = () => dlg.close()
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#taskadd-cancel').addEventListener('click', close)
    taskAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('taskadd-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#taskadd-save')
      save.disabled = true
      const err = document.getElementById('taskadd-error')
      err.textContent = ''
      const dateVal = document.getElementById('taskadd-date').value
      const payload = {
        quadrant: Number(document.getElementById('taskadd-quad').value || 1),
        title,
        ...(dateVal ? { due_date: dateVal } : {}),
      }
      try {
        const res = await fetch('/api/sadhana/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        close()
        taskAddForm.reset()
        toast(_t('taskAdd.added', 'Task added'), 'info')
        // Realtime pickup everywhere (2026-09-02 user request): the dashboard to-do
        // section + calendar dots refresh via htmx; when the FAB was used ON the
        // to-do board page itself, the board re-fetches its payload — no manual
        // page refresh needed anymore.
        if (document.querySelector('#dash')) refreshDashboard()
        else if (typeof window.hibanaSadhanaRefresh === 'function') window.hibanaSadhanaRefresh()
      } catch {
        err.textContent = _t('taskAdd.failed', "Couldn't add the task — try again")
      } finally {
        save.disabled = false
      }
    })
    taskAddEl = dlg
  }

  async function openTaskAdd() {
    buildTaskAdd()
    document.getElementById('taskadd-title').value = ''
    document.getElementById('taskadd-date').value = ''
    document.getElementById('taskadd-error').textContent = ''
    // Dialog labels: the build-time _t snapshot can go stale after a language switch,
    // so re-translate the dialog's data-i18n nodes on every open (light local pass).
    document.getElementById('taskadd-dialog')?.querySelectorAll('[data-i18n]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18n)
      if (s && s !== el.dataset.i18n && !el.children.length) el.textContent = s
    })
    // Show IMMEDIATELY — the quadrant-names fetch can take a beat on slow links, and a
    // dead click feels broken. The select fills the moment the names land.
    taskAddEl.showModal()
    document.getElementById('taskadd-title')?.focus()
    const quads = await fillTaskQuads()
    const sel = document.getElementById('taskadd-quad')
    if (sel) sel.innerHTML = quads.map((q) => `<option value="${q.id}">${q.icon} ${q.name}</option>`).join('')
  }

  // ---- Quick-add triggers — DELEGATED, so they survive every page swap --------
  // nav.js replaces <main> wholesale on soft navigation (and drops the per-element
  // bindings this script made at DOMContentLoaded), which left the “Capture an idea”
  // button and the FABs dead on any page reached via the topbar. A document-level
  // listener catches them wherever they appear — hard load, soft nav, htmx swaps.
  document.addEventListener('click', (e) => {
    const task = e.target.closest('[data-taskadd-open]')
    if (task) {
      e.preventDefault()
      closeFabMenu()
      openTaskAdd()
      return
    }
    // Phase 7 item 12 — the FAB's third option: یادداشت سریع. A modal (textarea +
    // اتصال-to-project picker + ذخیره/لغو) that lands in the Quick Notebook.
    const note = e.target.closest('[data-notequickadd]')
    if (note) {
      e.preventDefault()
      closeFabMenu()
      openQuickNoteAdd()
      return
    }
    const quick = e.target.closest('[data-quickadd-open]')
    if (quick) {
      e.preventDefault()
      closeFabMenu()
      openQuickAdd()
      return
    }
    const project = e.target.closest('[data-projectquickadd], [data-projectquickadd-status]')
    if (project) {
      e.preventDefault()
      closeFabMenu()
      openProjectAdd(project.getAttribute('data-projectquickadd-status') || 'unreviewed')
    }
  })

  // ---- Single creation FAB (dashboard): one circle that expands into the two-item
  // menu (New idea / New project). Delegated + document-level so it survives nav.js
  // swaps; closes on outside click, Escape, or after picking an item. The FAB circle
  // itself means CREATE only — every other circular icon action in the app is a ghost/
  // outline button (design rule 2026-08-25).
  const fabEl = () => document.querySelector('.fab-stack[data-fab]')
  const setFabOpen = (open) => {
    const fab = fabEl()
    if (!fab) return
    const toggle = fab.querySelector('[data-fab-toggle]')
    const menu = fab.querySelector('[data-fab-menu]')
    if (menu) menu.hidden = !open
    if (toggle) toggle.setAttribute('aria-expanded', String(open))
  }
  window.closeFabMenu = () => setFabOpen(false)
  document.addEventListener('click', (e) => {
    const fab = fabEl()
    if (!fab) return
    const toggle = e.target.closest('[data-fab-toggle]')
    if (toggle) {
      e.stopPropagation()
      const open = toggle.getAttribute('aria-expanded') !== 'true'
      setFabOpen(open)
      return
    }
    if (!e.target.closest('.fab-stack[data-fab]')) setFabOpen(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setFabOpen(false)
  })

  // Quick-capture shortcut (audit 18/19): Ctrl/Cmd+N opens the New Task dialog (the FAB's
  // primary action, 2026-08-30) from any page. Skipped while typing (inputs,
  // contenteditable) and when a dialog is already open.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'n' && e.key !== 'N')) return
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
    e.preventDefault()
    openTaskAdd()
  })

  // ---- Phase 7 item 12: the FAB's «یادداشت سریع» modal ----------------------------
  // A native <dialog> (same .dialog/.modal recipe as New Task): a textarea, an اتصال
  // toggle that reveals the user's live projects (GET /api/projects, JSON mode), and
  // ذخیره/لغو. Saving POSTs /api/notes {kind:'note', content, project_id?} and refreshes
  // the dashboard's #notebook via htmx so the note is visible immediately.
  let quickNoteEl = null
  function buildQuickNoteAdd() {
    if (quickNoteEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'quicknote-dialog'
    dlg.className = 'dialog'
    dlg.innerHTML = `
      <form class="modal" id="quicknote-form" novalidate>
        <h3 data-i18n="qn.title">Quick note</h3>
        <textarea id="quicknote-text" rows="5" maxlength="20000" dir="auto"
          placeholder="${_t('notes.typeNote', 'Type a note and press Enter…')}" data-i18n-placeholder="notes.typeNote"></textarea>
        <div class="qn-attach">
          <button type="button" class="ghost small" id="quicknote-attach-btn" aria-expanded="false" data-i18n="qn.attach">Attach to project</button>
          <span class="chip qn-attach-chip" id="quicknote-attach-chip" hidden></span>
        </div>
        <div class="qn-attach-options" id="quicknote-attach-options" hidden></div>
        <p class="error" id="quicknote-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="quicknote-save" data-i18n="qn.save">Save</button>
          <button type="button" class="ghost" id="quicknote-cancel" data-i18n="common.cancel">Cancel</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    const form = dlg.querySelector('#quicknote-form')
    const ta = dlg.querySelector('#quicknote-text')
    const errEl = dlg.querySelector('#quicknote-error')
    const attachBtn = dlg.querySelector('#quicknote-attach-btn')
    const attachOpts = dlg.querySelector('#quicknote-attach-options')
    const attachChip = dlg.querySelector('#quicknote-attach-chip')
    let attachProject = null // {id, title} | null
    const paintChip = () => {
      if (attachProject) {
        attachChip.hidden = false
        attachChip.textContent = attachProject.title
      } else attachChip.hidden = true
    }
    const close = () => dlg.close()
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#quicknote-cancel').addEventListener('click', close)
    attachBtn.addEventListener('click', async () => {
      const open = attachOpts.hidden
      attachOpts.hidden = !open
      attachBtn.setAttribute('aria-expanded', String(open))
      if (!open) return
      attachOpts.innerHTML = `<span class="muted small">…</span>`
      try {
        const res = await fetch('/api/projects')
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        const projects = (data.projects || []).filter((p) => !p.deleted_at).slice(0, 40)
        attachOpts.innerHTML = projects.length
          ? `<strong class="small">${escHtml(_t('qn.attachTo', 'Attach to…'))}</strong>` +
            projects.map((p) => `<button type="button" class="qn-attach-option" data-id="${escHtml(p.id)}" data-title="${escHtml(p.title)}">${escHtml(p.title)}</button>`).join('')
          : `<span class="muted small">${escHtml(_t('qn.noProjects', 'No projects to attach to yet — create one first.'))}</span>`
      } catch {
        attachOpts.innerHTML = `<span class="muted small">${escHtml(_t('qn.loadFailed', "Couldn't load the projects"))}</span>`
      }
    })
    attachOpts.addEventListener('click', (e) => {
      const opt = e.target.closest('.qn-attach-option')
      if (!opt) return
      attachProject = { id: opt.dataset.id, title: opt.dataset.title }
      attachOpts.hidden = true
      attachBtn.setAttribute('aria-expanded', 'false')
      paintChip()
    })
    attachChip.addEventListener('click', () => {
      attachProject = null // tap the chip to detach
      paintChip()
    })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const content = ta.value.trim()
      errEl.textContent = ''
      if (!content) { errEl.textContent = _t('notes.emptyHint', 'Write a note first'); ta.focus(); return }
      const save = dlg.querySelector('#quicknote-save')
      save.disabled = true
      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'note', content, ...(attachProject ? { project_id: attachProject.id } : {}) }),
        })
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        close()
        form.reset()
        attachProject = null
        paintChip()
        toast(_t('qn.saved', 'Note saved'), 'info')
        // The dashboard's notebook widget swaps in the fresh list; on other pages the
        // note is already saved server-side and shows on the next dashboard visit.
        if (document.querySelector('#notebook') && window.htmx) {
          window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
        }
      } catch {
        errEl.textContent = _t('qn.failed', "Couldn't save the note — try again")
      } finally {
        save.disabled = false
      }
    })
    quickNoteEl = dlg
  }
  function openQuickNoteAdd() {
    buildQuickNoteAdd()
    const dlg = quickNoteEl
    if (!dlg) return
    dlg.querySelector('#quicknote-text').value = ''
    dlg.querySelector('#quicknote-error').textContent = ''
    dlg.querySelector('#quicknote-attach-options').hidden = true
    dlg.querySelector('#quicknote-attach-btn').setAttribute('aria-expanded', 'false')
    // re-translate on open (the taskAdd pattern — a build-time snapshot can go stale)
    dlg.querySelectorAll('[data-i18n]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18n)
      if (s && s !== el.dataset.i18n && !el.children.length) el.textContent = s
    })
    dlg.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18nPlaceholder)
      if (s && s !== el.dataset.i18nPlaceholder) el.placeholder = s
    })
    dlg.showModal()
    dlg.querySelector('#quicknote-text').focus()
  }

  // ---- Quick Notebook (dashboard widget): delegated so htmx swaps never lose it ----
  // Three client-side jobs: the Note/List composer toggle (updates the hidden kind input
  // + placeholder), the per-card done toggle (Phase 5 item 3 — ✓ marks a project-linked
  // note done/undone; it STAYS on the project's record, unlike the delete below), and
  // the per-card delete (fetch DELETE → toast + Undo → restore + refresh).
  document.addEventListener('click', (e) => {
    // Phase 5 item 3: ✓ done toggle — PATCH {done} then re-render the notebook (the
    // server repaints the card with the done styling + swapped icon). Distinct from
    // delete: nothing is removed, the note keeps its place everywhere.
    const doneBtn = e.target.closest('[data-note-done]')
    if (doneBtn) {
      const id = doneBtn.getAttribute('data-note-done')
      const card = doneBtn.closest('.note-card')
      if (!id || !card) return
      const next = doneBtn.getAttribute('aria-pressed') !== 'true'
      fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: next }),
      })
        .then(async (r) => {
          if (!r.ok) { handle401(r); throw new Error('done failed') }
          const mode = document.querySelector('form[data-note-compose] input[name="kind"]')?.value
          const qs = mode === 'list' || mode === 'note' ? `?mode=${mode}` : ''
          if (window.htmx) window.htmx.ajax('GET', `/api/notes${qs}`, { target: '#notebook', swap: 'outerHTML' })
        })
        .catch(() => toast(_t('notes.updateFailed', "Couldn't update the note"), 'err'))
      return
    }

    const seg = e.target.closest('.seg-btn[data-note-mode]')
    if (seg) {
      const group = seg.closest('.seg')
      if (!group) return
      const mode = seg.dataset.noteMode === 'list' ? 'list' : 'note'
      for (const b of group.querySelectorAll('.seg-btn')) {
        b.classList.toggle('active', b === seg)
        b.setAttribute('aria-pressed', String(b === seg))
      }
      const form = seg.closest('form[data-note-compose]')
      if (form) {
        const kind = form.querySelector('input[name="kind"]')
        if (kind) kind.value = mode
        const ta = form.querySelector('.note-compose-text')
        if (ta) ta.placeholder = mode === 'list' ? _t('notes.firstTask', 'Type a task and press Enter…') : _t('notes.typeNote', 'Type a note and press Enter…')
      }
      return
    }

    const del = e.target.closest('[data-note-delete]')
    if (del) {
      const id = del.getAttribute('data-note-delete')
      const card = del.closest('.note-card')
      if (!id || !card) return
      fetch(`/api/notes/${id}`, { method: 'DELETE' })
        .then(async (r) => {
          if (!r.ok) {
            toast(_t('notes.deleteFailed', "Couldn't delete the note"), 'err')
            return
          }
          card.remove()
          toast(_t('notes.deleted', 'Note deleted'), 'info', 6000)
          const toastEl = document.getElementById('toast')
          if (toastEl) {
            const undo = document.createElement('button')
            undo.className = 'ghost'
            undo.textContent = _t('notes.undo', 'Undo')
            undo.addEventListener('click', () => {
              const mode = document.querySelector('form[data-note-compose] input[name="kind"]')?.value
              const qs = mode === 'list' || mode === 'note' ? `?mode=${mode}` : ''
              fetch(`/api/notes/${id}/restore`, { method: 'POST' })
                .then((r2) => {
                  if (r2.ok && window.htmx) {
                    window.htmx.ajax('GET', `/api/notes${qs}`, { target: '#notebook', swap: 'outerHTML' })
                  }
                })
                .catch(() => {})
            })
            toastEl.appendChild(undo)
          }
        })
        .catch(() => toast(_t('notes.deleteFailed', "Couldn't delete the note"), 'err'))
    }
  })

  // ---- Notebook list mode: Enter drafts a line, + commits the whole list -----------------
  // The composer is a textarea (needed for note mode). In list mode each Enter turns the
  // current line into a draft row in a visible preview (nothing is saved yet — spec: show
  // the user a preview, then record the list and all its items when they tap +). The draft
  // lives on the form element, so an htmx re-render (after a commit) naturally clears it.
  // Delegated everywhere so htmx swaps never lose the behavior.
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const draftLines = (form) => (form.__draftLines = form.__draftLines || [])
  const DRAFT_CHECK = '<span class="draft-check" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/></svg></span>'
  const DRAFT_X = (i) => '<button type="button" class="ghost danger" data-draft-remove="' + i + '" aria-label="' + escHtml(_t('notes.removeDraft', 'Remove')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'

  function renderDraft(form) {
    const ul = form.querySelector('.note-draft')
    if (!ul) return
    const lines = draftLines(form)
    if (lines.length === 0) {
      ul.hidden = true
      ul.innerHTML = ''
      return
    }
    ul.hidden = false
    ul.innerHTML =
      `<li class="muted small draft-hint">${escHtml(_t('notes.draftHint', 'Draft — press + to save'))}</li>` +
      lines.map((t, i) => `<li class="hurdle draft-item">${DRAFT_CHECK}<span>${escHtml(t)}</span>${DRAFT_X(i)}</li>`).join('')
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    const ta = e.target
    if (!(ta instanceof HTMLTextAreaElement) || !ta.classList.contains('note-compose-text')) return
    const form = ta.closest('form[data-note-compose]')
    if (!form) return
    const mode = form.querySelector('input[name="kind"]')?.value
    const text = ta.value.trim()
    if (mode === 'list') {
      // List mode: Enter drafts a new preview item — nothing is saved until + (user request).
      e.preventDefault()
      if (!text) return
      draftLines(form).push(text) // add to the preview only — no server write yet
      ta.value = ''
      renderDraft(form)
      return
    }
    // Note mode: Enter records the note immediately (user request — write > Enter = saved).
    // Shift+Enter still breaks lines so multi-line notes stay possible.
    if (mode === 'note' && text && window.htmx) {
      e.preventDefault()
      window.htmx.ajax('POST', '/api/notes?mode=note', {
        target: '#notebook',
        swap: 'outerHTML',
        values: { kind: 'note', title: '', content: text },
      })
    }
  })

  // Commit the whole draft on + (form submit captures the click). Note mode is untouched.
  document.addEventListener('submit', (e) => {
    const form = e.target
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-note-compose')) return
    const mode = form.querySelector('input[name="kind"]')?.value
    if (mode === 'note') {
      // User request: an empty note must not be created — clicking ＋ with an empty
      // composer shows a hint instead of saving a blank card (Enter already ignores
      // empty input; this blocks the + button's natural form submit).
      const ta = form.querySelector('.note-compose-text')
      const text = ta ? ta.value.trim() : ''
      if (!text) {
        e.preventDefault()
        e.stopImmediatePropagation()
        toast(_t('notes.emptyHint', 'Write a note first'))
        ta?.focus()
      }
      return
    }
    if (mode !== 'list') return
    e.preventDefault()
    e.stopImmediatePropagation()
    const ta = form.querySelector('.note-compose-text')
    const lines = (form.__draftLines || []).slice()
    const left = ta ? ta.value.trim() : ''
    if (left) lines.push(left) // a typed-but-not-Entered tail is included on + too
    const text = lines.join('\n')
    if (!text || !window.htmx) return
    const latest = [...document.querySelectorAll('.note-card[data-kind="list"]')].at(-1)
    const id = latest ? latest.id.replace(/^note-/, '') : null
    // htmx.ajax sets the HX-Request header, so the server returns the re-rendered widget;
    // the server splits the newline-joined text into one item per line. ?mode=list keeps the
    // composer in list mode.
    const url = id ? `/api/notes/list/${id}?mode=list` : '/api/notes?mode=list'
    const values = id ? { text } : { kind: 'list', title: '', content: text }
    window.htmx.ajax('POST', url, {
      target: '#notebook',
      swap: 'outerHTML',
      values,
    })
  }, true)

  // Removing a drafted line from the preview.
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-draft-remove]')
    if (!rm) return
    const form = rm.closest('form[data-note-compose]')
    if (!form) return
    const i = Number(rm.getAttribute('data-draft-remove'))
    const lines = draftLines(form)
    if (Number.isInteger(i) && i >= 0 && i < lines.length) lines.splice(i, 1)
    renderDraft(form)
  })

  // ---- Dashboard boxes: drag an item between Idea → Pending → Building ----------
  // Native HTML5 DnD, delegated (survives htmx re-renders of the strip). The row carries
  // its project id + current status; dropping it onto another status box PATCHes the
  // status, then the strip re-renders from the server — a partial swap, no page refresh.
  let dashDragRow = null
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stat-box [data-project-id]')
    if (!row) return
    dashDragRow = row
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.dataset.projectId)
    row.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    const box = e.target.closest('.stat-box')
    if (!dashDragRow || !box) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    box.classList.add('drag-over')
  })
  document.addEventListener('dragleave', (e) => {
    const box = e.target.closest('.stat-box')
    if (box && !box.contains(e.relatedTarget)) box.classList.remove('drag-over')
  })
  document.addEventListener('drop', async (e) => {
    const box = e.target.closest('.stat-box')
    if (!dashDragRow || !box) return
    e.preventDefault()
    const status = box.dataset.status
    const current = dashDragRow.dataset.status
    const id = dashDragRow.dataset.projectId
    const row = dashDragRow
    dashDragRow = null
    row.classList.remove('dragging')
    document.querySelectorAll('.stat-box.drag-over').forEach((b) => b.classList.remove('drag-over'))
    if (status === current) return
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) { handle401(res); throw new Error('status change failed') }
      if (window.htmx) window.htmx.ajax('GET', '/api/dashboard', { target: '#dash', swap: 'innerHTML' })
    } catch {
      toast(_t('dashboard.moveFailed', "Couldn't move it — try again"), 'err')
    }
  })
  document.addEventListener('dragend', () => {
    if (dashDragRow) dashDragRow.classList.remove('dragging')
    dashDragRow = null
    document.querySelectorAll('.stat-box.drag-over').forEach((b) => b.classList.remove('drag-over'))
  })

  // ---- Dashboard projects strip: the stage-box carousel (batch s 2026-09-08) -----------
  // User request: "only three boxes by default, the rest behind carousel clicks". The
  // server orders the track (investigating · awaiting · doing first) and renders the
  // arrows + dots; this driver pages the scroll-snap rail. Delegated on document so it
  // survives every htmx re-render of #dash; the scroll listener uses CAPTURE (scroll
  // events don't bubble, but they do capture) to keep dots/arrows honest through native
  // touch/wheel scrolls. Works in RTL too: scrollBy is direction-relative, and the dot
  // math uses abs(scrollLeft) (RTL tracks scroll negative in Chromium/FF).
  const syncStatCarousel = (track) => {
    if (!track) return
    const root = track.closest('[data-stat-carousel]')
    if (!root) return
    const dots = root.querySelector('[data-stat-dots]')
    const prev = root.querySelector('[data-stat-prev]')
    const next = root.querySelector('[data-stat-next]')
    if (!prev || !next) return
    const pos = Math.abs(track.scrollLeft)
    const page = track.clientWidth
    const pages = Math.max(1, Math.round(track.scrollWidth / Math.max(1, page)))
    const active = Math.min(pages - 1, Math.round(pos / Math.max(1, page)))
    if (dots) {
      if (dots.children.length !== pages) {
        dots.textContent = ''
        for (let i = 0; i < pages; i++) {
          const dot = document.createElement('span')
          dot.className = 'stat-dot'
          dots.appendChild(dot)
        }
      }
      ;[...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === active))
    }
    // At the ends the arrows dim out (native touch/wheel scroll still works everywhere).
    prev.disabled = pos <= 1
    next.disabled = pos >= track.scrollWidth - track.clientWidth - 1
    root.classList.toggle('at-start', pos <= 1)
    root.classList.toggle('at-end', pos >= track.scrollWidth - track.clientWidth - 1)
  }
  document.addEventListener('click', (e) => {
    const arrow = e.target.closest('[data-stat-prev], [data-stat-next]')
    if (!arrow) return
    const track = arrow.closest('[data-stat-carousel]')?.querySelector('[data-stat-track]')
    if (!track) return
    const dir = arrow.hasAttribute('data-stat-next') ? 1 : -1
    // scrollBy's left is direction-relative: positive moves toward later content in LTR,
    // toward the START in RTL — so flip for RTL (later boxes live at lower scrollLeft).
    const rtl = getComputedStyle(track).direction === 'rtl'
    track.scrollBy({ left: (rtl ? -dir : dir) * track.clientWidth, behavior: 'smooth' })
  })
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.matches && e.target.matches('[data-stat-track]')) syncStatCarousel(e.target)
  }, true)
  // Initial paint + every #dash swap (the track element is recreated by htmx).
  const initStatCarousel = () => {
    document.querySelectorAll('[data-stat-track]').forEach((t) => syncStatCarousel(t))
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, initStatCarousel)
  }
  if (document.readyState !== 'loading') initStatCarousel()

  // ---- Dashboard To-Do preview: shared Sadhana data, local card UI state -------------
  // The preview never owns task data. It posts to the Sadhana endpoints and refreshes the
  // dashboard fragment, so completion, notes, progress, and renames stay in sync with the
  // dedicated /to-do-list page.
  const refreshDashboard = () => {
    if (window.htmx) window.htmx.ajax('GET', '/api/dashboard', { target: '#dash', swap: 'innerHTML' })
  }
  const closeDashMenu = (el) => {
    const menu = el?.closest?.('.dash-todo-menu')
    if (menu) menu.open = false
  }
  const dashTaskRequest = async (id, body) => {
    const res = await fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { handle401(res); throw new Error('task update failed') }
  }
  const refreshTaskSurface = (row) => {
    if (document.querySelector('#dash')) return refreshDashboard()
    const focus = row?.closest?.('#sadhana-focus[data-focus-q]')
    if (focus?.dataset.focusQ && window.htmx) {
      window.htmx.ajax('GET', `/api/sadhana/focus/${encodeURIComponent(focus.dataset.focusQ)}`, { target: '#sadhana-focus', swap: 'innerHTML' })
      return
    }
    if (document.querySelector('#sadhana-zone') && window.htmx) window.htmx.ajax('GET', '/api/sadhana', { target: '#sadhana-zone', swap: 'outerHTML' })
  }

  document.addEventListener('click', (e) => {
    const quadrantStyle = e.target.closest('[data-sadhana-style]')
    if (quadrantStyle) {
      const card = quadrantStyle.closest('.sadhana-quadrant')
      const pop = card?.querySelector(`[data-sadhana-style-pop="${quadrantStyle.dataset.sadhanaStyle}"]`)
      if (pop) {
        pop.hidden = !pop.hidden
        if (!pop.hidden) {
          pop.style.position = 'fixed'
          const rect = quadrantStyle.getBoundingClientRect()
          const width = pop.offsetWidth || 288
          pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px'
          pop.style.top = Math.max(8, Math.min(window.innerHeight - (pop.offsetHeight || 240) - 8, rect.bottom + 6)) + 'px'
        }
      }
      return
    }
    const quadrantChoice = e.target.closest('[data-sadhana-icon], [data-sadhana-accent]')
    if (quadrantChoice) {
      const card = quadrantChoice.closest('.sadhana-quadrant')
      const quadrant = card?.dataset.quadrant
      const iconChoice = quadrantChoice.dataset.sadhanaIcon
      const accentChoice = quadrantChoice.dataset.sadhanaAccent
      if (!card || !quadrant || (!iconChoice && !accentChoice)) return
      if (iconChoice) {
        const trigger = card.querySelector('[data-sadhana-style]')
        if (trigger) trigger.innerHTML = quadrantChoice.innerHTML
        card.querySelectorAll('[data-sadhana-icon]').forEach((el) => el.classList.toggle('is-selected', el === quadrantChoice))
      }
      if (accentChoice) {
        card.dataset.sadhanaAccent = accentChoice
        card.style.setProperty('--q-accent', `var(--${accentChoice})`)
        card.querySelectorAll('[data-sadhana-accent]').forEach((el) => el.classList.toggle('is-selected', el === quadrantChoice))
      }
      const name = card.dataset.sadhanaName || ''
      const body = iconChoice ? { name, icon_id: iconChoice } : { name, accent_color: accentChoice }
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
      return
    }

    // Phase 5 item 15 (2026-09-08): the dashboard task's 3-dot progress track.
    // (v) 2026-09-09: sadhana.html's setProgress semantics — clicking the
    // ALREADY-ACTIVE state (anything but untouched) resets the task to untouched;
    // the track rides under the row inside its pill board, always visible. PATCHes
    // { progress } and repaints IN PLACE — active dot + label + the row's state
    // board tint — no full section refresh (the quadrant keeps its scroll state).
    const progDot = e.target.closest('.dash-todo-task [data-prog-state]')
    if (progDot) {
      e.preventDefault()
      const state = progDot.dataset.progState
      const track = progDot.closest('.prog-track')
      const row = progDot.closest('.dash-todo-task')
      const id = track?.dataset.dashProg
      if (!track || !row || !id) return
      // the to-do page's reset rule: the same dot never "sticks" (except untouched)
      const activeDot = track.querySelector('.prog-dot.p-active')
      const current = activeDot?.dataset.progState ?? 'untouched'
      const next = (state === current && state !== 'untouched') ? 'untouched' : state
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: next }),
      })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('progress failed') }
          const stateClass = next === 'in_progress' ? 'st-inprog' : next === 'on_hold' ? 'st-hold' : 'st-untouched'
          row.classList.remove('st-untouched', 'st-inprog', 'st-hold')
          row.classList.add(stateClass)
          track.classList.remove('st-untouched', 'st-inprog', 'st-hold')
          track.classList.add(stateClass)
          track.querySelectorAll('.prog-dot').forEach((d) => {
            const active = d.dataset.progState === next
            d.classList.toggle('p-active', active)
            d.setAttribute('aria-pressed', String(active))
          })
          const lbl = track.querySelector('.prog-lbl')
          if (lbl) lbl.textContent = track.querySelector(`.prog-dot[data-prog-state="${next}"]`)?.getAttribute('title') || lbl.textContent
        })
        .catch(() => toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err'))
      return
    }

    const complete = e.target.closest('[data-task-complete]') || e.target.closest('.dash-todo-check')?.querySelector('input[data-task-complete]')
    if (complete) {
      e.preventDefault()
      const id = complete.dataset.taskComplete
      const row = complete.closest('.dash-todo-task, .sadhana-card')
      if (!id || !row || row.classList.contains('is-completing')) return
      const checkbox = complete instanceof HTMLInputElement ? complete : complete.querySelector('input[type="checkbox"]')
      const reopening = checkbox?.dataset.taskDone === '1'
      checkbox.checked = true
      checkbox.disabled = true
      row.classList.add('is-completing')
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('complete failed') }
          window.setTimeout(() => {
            row.classList.add('is-removing')
            window.setTimeout(() => refreshTaskSurface(row), 320)
          }, 1000)
        })
        .catch(() => {
          row.classList.remove('is-completing')
          checkbox.checked = false
          checkbox.disabled = false
          toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err')
        })
      return
    }

    const taskEditOpen = e.target.closest('[data-task-edit-open]')
    if (taskEditOpen) {
      const row = taskEditOpen.closest('.dash-todo-task, .sadhana-card')
      const form = row?.querySelector(`[data-task-edit-form="${taskEditOpen.dataset.taskEditOpen}"]`)
      if (form) {
        form.hidden = false
        taskEditOpen.setAttribute('aria-expanded', 'true')
        form.querySelector('.task-edit-error')?.setAttribute('hidden', '')
        const input = form.querySelector('input[name="title"]')
        if (input && !input.dataset.originalTitle) input.dataset.originalTitle = input.value
        input?.focus()
        input?.select()
      }
      return
    }
    const taskEditCancel = e.target.closest('[data-task-edit-cancel]')
    if (taskEditCancel) {
      const form = taskEditCancel.closest('[data-task-edit-form]')
      if (form) {
        form.hidden = true
        form.closest('.dash-todo-task, .sadhana-card')?.querySelector('[data-task-edit-open]')?.setAttribute('aria-expanded', 'false')
      }
      return
    }
    const taskNoteToggle = e.target.closest('[data-task-note-toggle]')
    if (taskNoteToggle) {
      const row = taskNoteToggle.closest('.dash-todo-task, .sadhana-card')
      const panel = row?.querySelector(`[data-task-notes-panel="${taskNoteToggle.dataset.taskNoteToggle}"]`)
      if (panel) {
        const open = panel.hidden
        panel.hidden = !open
        taskNoteToggle.setAttribute('aria-expanded', String(open))
        if (open) panel.querySelector('textarea')?.focus()
      }
      return
    }
    const taskNoteDelete = e.target.closest('[data-task-note-delete]')
    if (taskNoteDelete) {
      const legacyTask = taskNoteDelete.dataset.noteLegacyTask
      const noteId = taskNoteDelete.dataset.taskNoteDelete
      const url = legacyTask
        ? `/api/sadhana/tasks/${encodeURIComponent(legacyTask)}/notes/legacy`
        : `/api/sadhana/notes/${encodeURIComponent(noteId || '')}`
      taskNoteDelete.disabled = true
      fetch(url, { method: 'DELETE' })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('note delete failed') }; refreshTaskSurface() })
        .catch(() => { taskNoteDelete.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }
    const taskProgress = e.target.closest('[data-task-progress]')
    if (taskProgress) {
      const id = taskProgress.dataset.taskId
      const progress = taskProgress.dataset.taskProgress
      if (!id || !progress) return
      taskProgress.disabled = true
      dashTaskRequest(id, { progress })
        .then(refreshTaskSurface)
        .catch(() => { taskProgress.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const seeMore = e.target.closest('[data-dash-see-more]')
    if (seeMore) {
      const card = seeMore.closest('.dash-todo-quadrant')
      if (!card) return
      const expanded = card.classList.toggle('is-expanded')
      card.querySelectorAll('.dash-todo-task[hidden]').forEach((task) => { task.hidden = !expanded })
      seeMore.textContent = expanded ? _t('dashboard.seeLess', 'See Less') : _t('dashboard.seeMore', 'See More')
      return
    }

    const moveTask = e.target.closest('[data-dash-move-task]')
    if (moveTask) {
      const task = moveTask.closest('.dash-todo-task')
      const card = task?.closest('.dash-todo-quadrant')
      const list = dashTaskList(card)
      const tasks = list ? [...list.querySelectorAll(':scope > .dash-todo-task')] : []
      const index = task ? tasks.indexOf(task) : -1
      const direction = moveTask.dataset.dashMoveTask
      const adjacent = direction === 'start' ? tasks[index - 1] : tasks[index + 1]
      if (!task || !card || !adjacent || task.classList.contains('is-pinned') !== adjacent.classList.contains('is-pinned')) return
      if (direction === 'start') list.insertBefore(task, adjacent)
      else list.insertBefore(adjacent, task)
      task.classList.add('move-pending')
      persistDashOrder(card).then(() => task.classList.remove('move-pending')).catch(() => { task.classList.remove('move-pending'); refreshDashboard(); toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      closeDashMenu(moveTask)
      return
    }

    const styleTrigger = e.target.closest('[data-dash-style]')
    if (styleTrigger) {
      const card = styleTrigger.closest('.dash-todo-quadrant')
      const pop = card?.querySelector(`[data-dash-style-pop="${styleTrigger.dataset.dashStyle}"]`)
      if (pop) pop.hidden = !pop.hidden
      return
    }
    // Phase 7 item 1: the redesigned pop's لغو button — just closes it (the ذخیره button
    // is the form's submit; the existing submit listener does the PATCH + refresh).
    const styleCancel = e.target.closest('[data-dash-style-cancel]')
    if (styleCancel) {
      const card = styleCancel.closest('.dash-todo-quadrant')
      const pop = card?.querySelector(`[data-dash-style-pop="${styleCancel.dataset.dashStyleCancel}"]`)
      if (pop) pop.hidden = true
      return
    }
    // Phase 6 item 2: the customize popover's symbol button opens the shared
    // full-library emoji picker (emoji-picker.js + emoji-data.js). Picking PATCHes
    // icon_id through the SAME API the old 40-emoji grid used, then repaints the
    // quadrant's trigger + the preview button. The accent swatches are long gone
    // ("color is for icons, now we use emojis").
    const styleOpen = e.target.closest('[data-dash-icon-open]')
    if (styleOpen) {
      const card = styleOpen.closest('.dash-todo-quadrant')
      const quadrant = card?.dataset.dashQuadrant
      const name = card?.dataset.dashName
      if (!card || !quadrant || !name || !window.hibanaEmojiPicker) return
      window.hibanaEmojiPicker.open({
        anchor: styleOpen,
        current: styleOpen.dataset.current || '📌',
        onPick: (emoji) => {
          const trigger = card.querySelector('[data-dash-style]')
          if (trigger) trigger.innerHTML = `<span class="quadrant-emoji">${emoji}</span>`
          styleOpen.dataset.current = emoji
          styleOpen.textContent = emoji
          fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, icon_id: emoji }),
          }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
        },
      })
      return
    }

    // (k) 2026-09-06: the circular + FAB pinned to each quadrant's bottom corner
    // (inline-end: left in RTL, right in LTR — pure CSS logical property) reveals
    // the inline quick-add row.
    // (m) 2026-09-06 user request — "submitting must ALSO be possible by clicking the
    // + button again: click + → input appears → click + again → task registers".
    // The FAB is now a two-state control: hidden form → reveal + focus; visible form
    // → requestSubmit (Enter still works; empty input trips the native required
    // bubble). The submit handler's in-flight flag makes a double-click safe.
    const quickAdd = e.target.closest('[data-dash-quickadd-fab]')
    if (quickAdd) {
      const form = quickAdd.closest('.dash-todo-quadrant')?.querySelector(`[data-dash-quickadd-form="${quickAdd.dataset.dashQuickaddFab}"]`)
      if (form) {
        if (form.hidden) {
          form.hidden = false
          form.querySelector('input')?.focus()
        } else {
          form.requestSubmit()
        }
      }
      return
    }

    // (m) 2026-09-06: per-task delete (⋯ menu). Soft-delete → row collapse → refresh;
    // the toast offers Undo (POST /restore) — the board's pattern, no confirm modal.
    const dashDelete = e.target.closest('[data-dash-delete]')
    if (dashDelete) {
      const id = dashDelete.dataset.dashDelete
      closeDashMenu(dashDelete)
      if (!id) return
      const row = dashDelete.closest('.dash-todo-task')
      dashDelete.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('delete failed') }
          row?.classList.add('is-removing')
          setTimeout(refreshDashboard, 320)
          toast(_t('dashboard.taskDeleted', 'Task deleted'), 'info', 6000, [{
            label: _t('notes.undo', 'Undo'),
            onClick: () => {
              fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST' })
                .then((res) => { if (!res.ok) { handle401(res); throw new Error('restore failed') }; refreshDashboard() })
                .catch(() => toast(_t('dashboard.taskRestoreFailed', "Couldn't restore the task"), 'err'))
            },
          }])
        })
        .catch(() => { dashDelete.disabled = false; toast(_t('dashboard.taskDeleteFailed', "Couldn't delete the task"), 'err') })
      return
    }

    // (m) 2026-09-06: "Notes" in the ⋯ menu opens the note history panel (same panel
    // as clicking a note chip — works for note-less tasks too, so notes can be added
    // without ever visiting the to-do board).
    // (o) 2026-09-07: openDashNotePanel runs BEFORE closeDashMenu — its synchronous
    // anchor-rect snapshot needs the ⋯ menu still laid out; closing first feeds the
    // placer garbage coordinates (the bottom-right-corner bug).
    const notePanelTrigger = e.target.closest('[data-dash-note-panel]')
    if (notePanelTrigger) {
      openDashNotePanel(notePanelTrigger.dataset.dashNotePanel, notePanelTrigger)
      closeDashMenu(notePanelTrigger)
      return
    }

    const rename = e.target.closest('[data-dash-rename]')
    if (rename) {
      const form = rename.closest('.dash-todo-qtitle')?.querySelector(`[data-dash-rename-form="${rename.dataset.dashRename}"]`)
      if (form) {
        form.hidden = false
        rename.hidden = true
        form.querySelector('input')?.focus()
        form.querySelector('input')?.select()
      }
      return
    }

    const editOpen = e.target.closest('[data-dash-edit-open]')
    if (editOpen) {
      const editor = editOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-edit-form="${editOpen.dataset.dashEditOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.querySelector('.dash-todo-edit-error')?.setAttribute('hidden', '')
        const input = editor.querySelector('input[name="title"]')
        input?.focus()
        input?.select()
      }
      closeDashMenu(editOpen)
      return
    }

    const editCancel = e.target.closest('[data-dash-edit-cancel]')
    if (editCancel) {
      const editor = editCancel.closest('[data-dash-edit-form]')
      if (editor) editor.hidden = true
      return
    }

    const noteOpen = e.target.closest('[data-dash-note-open]')
    if (noteOpen) {
      const editor = noteOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-note-editor="${noteOpen.dataset.dashNoteOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.querySelector('textarea')?.focus()
        noteOpen.setAttribute('aria-expanded', 'true')
        editor.closest('.dash-todo-task')?.querySelectorAll('[data-dash-note-open]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'))
      }
      closeDashMenu(noteOpen)
      return
    }

    const progressOpen = e.target.closest('[data-dash-progress-open]')
    if (progressOpen) {
      const editor = progressOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-progress-editor="${progressOpen.dataset.dashProgressOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.closest('.dash-todo-task')?.querySelectorAll('[data-dash-progress-open]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'))
        editor.querySelector('[data-dash-progress]')?.focus()
      }
      closeDashMenu(progressOpen)
      return
    }

    const progress = e.target.closest('[data-dash-progress]')
    if (progress) {
      const id = progress.dataset.dashProgress
      const state = progress.dataset.progressState
      if (!id || !state) return
      progress.disabled = true
      dashTaskRequest(id, { progress: state })
        .then(refreshDashboard)
        .catch(() => { progress.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const toggle = e.target.closest('[data-dash-task-toggle]')
    if (toggle) {
      const id = toggle.dataset.dashTaskToggle
      if (!id) return
      const row = toggle.closest('.dash-todo-task')
      toggle.disabled = true
      row?.classList.add('is-completing')
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('complete failed') }
          // Let the completed state register before the row fades and collapses.
          setTimeout(() => {
            row?.classList.add('is-removing')
            setTimeout(refreshDashboard, 320)
          }, 1000)
        })
        .catch(() => {
          row?.classList.remove('is-completing')
          toggle.checked = false
          toggle.disabled = false
          toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err')
        })
      return
    }

    const noteSave = e.target.closest('[data-dash-note-save]')
    if (noteSave) {
      const id = noteSave.dataset.dashNoteSave
      const input = noteSave.closest('.dash-todo-task')?.querySelector(`[data-dash-note-input="${id}"]`)
      if (!id || !input) return
      noteSave.disabled = true
      dashTaskRequest(id, { note: input.value })
        .then(refreshDashboard)
        .catch(() => { noteSave.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }
  })

  document.addEventListener('keydown', (e) => {
    const grid = e.target.closest?.('[role="grid"]')
    if (grid && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const buttons = [...grid.querySelectorAll('button')]
      const current = buttons.indexOf(e.target)
      if (current >= 0) {
        const columns = 4
        const next = e.key === 'ArrowRight' ? current + 1 : e.key === 'ArrowLeft' ? current - 1 : e.key === 'ArrowDown' ? current + columns : current - columns
        if (buttons[next]) {
          e.preventDefault()
          buttons[next].focus()
        }
      }
      return
    }
    if (e.key !== 'Escape') return
    const editor = e.target.closest?.('[data-task-edit-form], [data-task-notes-panel], [data-dash-edit-form], [data-dash-note-editor], [data-dash-progress-editor]')
    if (editor) {
      const input = editor.querySelector('input[name="title"]')
      if (input?.dataset.originalTitle) input.value = input.dataset.originalTitle
      editor.hidden = true
      editor.closest('.dash-todo-task, .sadhana-card')?.querySelectorAll('[data-task-edit-open], [data-task-note-toggle], [data-dash-note-open], [data-dash-progress-editor]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'))
      return
    }
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (!input) return
    const form = input.closest('[data-dash-quickadd-form]')
    input.value = ''
    form.hidden = true
    setDashQuickaddReady(input, false) // (o) reset the FAB — the cleared form must not glow on re-reveal
  })
  document.addEventListener('focusout', (e) => {
    // (m) don't auto-hide an EMPTY quick-add when focus moves to the + FAB itself —
    // the second FAB click (submit) must find the form still open; focusout fires
    // before click, so an unguarded hide would flip the FAB back to "reveal".
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (input && !input.value.trim() && !e.relatedTarget?.closest?.('[data-dash-quickadd-fab]')) {
      input.closest('[data-dash-quickadd-form]').hidden = true
      setDashQuickaddReady(input, false) // (o) belt-and-braces: empty input ⇒ quiet FAB
    }
    const taskTitleInput = e.target.closest?.('[data-task-edit-form] input[name="title"]')
    if (taskTitleInput) {
      const form = taskTitleInput.closest('[data-task-edit-form]')
      window.setTimeout(() => {
        if (!form?.hidden && !form.contains(document.activeElement)) form.requestSubmit?.()
      }, 0)
    }
  })

  // ---- (o) 2026-09-07: the quick-add FAB's READY state ------------------------------
  // User request — "when the user writes in the input, the + button must fill and
  // signal it's ready to be clicked and add a task". Typing (or pasting/cutting)
  // lights the FAB as the filled capture circle (.is-ready, app.css); an emptied
  // input settles it back to the quiet outline. The hide paths above clear the
  // state so a re-revealed empty form never glows stale. Whitespace-only input
  // does NOT light it (trim) — matching the submit handler's own trim gate.
  const setDashQuickaddReady = (input, ready) => {
    const form = input?.closest?.('[data-dash-quickadd-form]')
    if (!form) return
    const fab = form.closest('.dash-todo-quadrant')?.querySelector(`[data-dash-quickadd-fab="${form.dataset.dashQuickaddForm}"]`)
    fab?.classList.toggle('is-ready', ready)
  }
  document.addEventListener('input', (e) => {
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (input) setDashQuickaddReady(input, !!input.value.trim())
  })

  // ---- (k) 2026-09-06: task-note chip bubble (dashboard to-do preview) -------------
  // A task with notes renders a clipboard chip beside its title (server HTML). The
  // bubble is a FIXED-position singleton — NOT a child of the task row: the task list
  // scrolls (overflow:auto), so an absolutely-positioned child would clip at the list
  // edge. Hover/focus opens it; any scroll/resize/Escape closes it (the chip would
  // detach from its anchor otherwise). Rect math is physical, so the viewport clamp
  // behaves identically in LTR and RTL.
  // (m) 2026-09-06: the bubble is HOVER-ONLY now — clicking the chip opens the full
  // note-history panel (below), where notes can be added/edited/deleted in place.
  let dashNoteBubble = null
  let dashNoteChipEl = null
  let dashNotePanel = null
  let dashNotePanelOpenedAt = 0 // scrolls in the first ~250ms are layout settling
  const closeDashNoteBubble = () => {
    dashNoteBubble?.remove()
    dashNoteBubble = null
    dashNoteChipEl?.classList.remove('is-open')
    dashNoteChipEl = null
  }
  const closeDashNotePanel = () => {
    dashNotePanel?.remove()
    dashNotePanel = null
  }
  const openDashNoteBubble = (chip) => {
    if (dashNotePanel) return // the history panel owns the screen while open
    const text = chip.dataset.note || ''
    if (!text) return
    closeDashNoteBubble()
    dashNoteChipEl = chip
    chip.classList.add('is-open')
    const bubble = document.createElement('div')
    bubble.className = 'dash-note-bubble'
    bubble.setAttribute('role', 'tooltip')
    const head = document.createElement('span')
    head.className = 'dash-note-bubble-head'
    const count = Number(chip.dataset.noteCount || '1')
    head.textContent = count > 1 ? `${_t('dashboard.noteLatest', 'Latest note')} (${count})` : _t('dashboard.noteLatest', 'Latest note')
    const body = document.createElement('span')
    body.textContent = text // textContent — the note text is never HTML
    bubble.appendChild(head)
    bubble.appendChild(body)
    document.body.appendChild(bubble)
    dashNoteBubble = bubble
    // Measure after paint, then place: prefer BELOW the chip, flip above when out of
    // room, clamp horizontally inside the viewport.
    bubble.style.visibility = 'hidden'
    requestAnimationFrame(() => {
      if (!dashNoteBubble) return
      const rect = chip.getBoundingClientRect()
      const bw = bubble.offsetWidth
      const bh = bubble.offsetHeight
      const gap = 8
      let top = rect.bottom + gap
      if (top + bh > window.innerHeight - 8) top = Math.max(8, rect.top - bh - gap)
      let left = rect.left + rect.width / 2 - bw / 2
      left = Math.max(8, Math.min(left, window.innerWidth - bw - 8))
      bubble.style.top = `${Math.round(top)}px`
      bubble.style.left = `${Math.round(left)}px`
      bubble.style.visibility = ''
    })
  }
  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip && chip !== dashNoteChipEl) openDashNoteBubble(chip)
  })
  document.addEventListener('mouseout', (e) => {
    if (dashNoteChipEl && e.target.closest?.('[data-dash-note-chip]') === dashNoteChipEl && !dashNoteChipEl.contains(e.relatedTarget)) closeDashNoteBubble()
  })
  document.addEventListener('focusin', (e) => {
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip && chip !== dashNoteChipEl) openDashNoteBubble(chip)
    else if (!chip && dashNoteChipEl && !dashNoteChipEl.contains(e.target)) closeDashNoteBubble()
  })
  document.addEventListener('click', (e) => {
    // (m) click = open the FULL history panel (the latest-note bubble stays hover-only).
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip) openDashNotePanel(chip.dataset.dashNoteChip, chip)
  })

  // ---- (m) 2026-09-06: note history panel ------------------------------------------
  // Clicking a note chip (or ⋯ → «یادداشت‌ها») opens a fixed-position singleton with
  // the FULL note history + add / edit / delete — notes can be managed without ever
  // leaving the dashboard (user request). Notes are FETCHED on demand
  // (GET /api/sadhana/tasks/:id/notes) so the dashboard HTML stays light no matter
  // how many notes exist. All user text goes through textContent — never innerHTML.
  const DASH_ICON = {
    x: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/></svg>',
  }
  const dashNoteFmt = (iso) => {
    try {
      const lang = window.hibanaI18n?.lang?.() || 'en'
      return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
    } catch {
      return String(iso || '').slice(0, 16).replace('T', ' ')
    }
  }
  const dashNoteEditStart = (li, note, taskId) => {
    if (li.querySelector('.task-note-editbox')) return
    const copy = li.querySelector('.task-note-copy')
    const acts = li.querySelector('.task-note-acts')
    if (!copy || !acts) return
    const box = document.createElement('div')
    box.className = 'task-note-editbox'
    const ta = document.createElement('textarea')
    ta.value = note.text
    ta.maxLength = 500
    ta.rows = 2
    ta.setAttribute('aria-label', _t('dashboard.editNote', 'Edit note'))
    const row = document.createElement('div')
    row.className = 'task-note-editacts'
    const save = document.createElement('button')
    save.type = 'button'
    save.setAttribute('aria-label', _t('dashboard.saveNote', 'Save note'))
    save.innerHTML = DASH_ICON.check
    save.addEventListener('click', () => {
      const text = ta.value.trim()
      if (!text || text === note.text) { dashNoteEditRestore(li); return }
      save.disabled = true
      // The legacy single note lives on the task row (PATCH /tasks/:id {note});
      // journal notes carry their own id (PATCH /updates/:id {text}).
      const url = note.legacy ? `/api/sadhana/tasks/${encodeURIComponent(taskId)}` : `/api/sadhana/updates/${encodeURIComponent(note.id)}`
      const body = note.legacy ? { note: text } : { text }
      fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('note edit failed') }
          note.text = text
          li.dataset.noteText = text // keep the restore path truthful for the next edit
          dashNoteEditRestore(li)
          refreshDashboard()
        })
        .catch(() => { save.disabled = false; toast(_t('dashboard.noteFailed', "Couldn't save the note"), 'err') })
    })
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.setAttribute('aria-label', _t('dashboard.close', 'Close'))
    cancel.innerHTML = DASH_ICON.x
    cancel.addEventListener('click', () => dashNoteEditRestore(li))
    row.append(save, cancel)
    box.append(ta, row)
    copy.replaceWith(box)
    acts.hidden = true
    ta.focus()
  }
  const dashNoteEditRestore = (li) => {
    // Rebuild the plain copy block (text + timestamp) from the row's stored note text.
    const box = li.querySelector('.task-note-editbox')
    const acts = li.querySelector('.task-note-acts')
    if (!box) return
    const text = li.dataset.noteText || ''
    const stamp = li.dataset.noteStamp || ''
    const copy = document.createElement('div')
    copy.className = 'task-note-copy'
    const time = document.createElement('time')
    time.textContent = stamp
    const span = document.createElement('span')
    span.className = 'task-note-text'
    span.textContent = text
    copy.append(time, span)
    box.replaceWith(copy)
    if (acts) acts.hidden = false
  }
  const dashNoteDelete = (li, note, taskId) => {
    li.querySelectorAll('button').forEach((b) => { b.disabled = true })
    const url = note.legacy ? `/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes/legacy` : `/api/sadhana/notes/${encodeURIComponent(note.id)}`
    fetch(url, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) { handle401(res); throw new Error('note delete failed') }
        li.remove()
        refreshDashboard()
      })
      .catch(() => { li.querySelectorAll('button').forEach((b) => { b.disabled = false }); toast(_t('dashboard.noteDeleteFailed', "Couldn't delete the note"), 'err') })
  }
  const dashNoteRow = (note, taskId) => {
    const li = document.createElement('li')
    li.className = 'task-note-item'
    li.dataset.noteText = note.text // for cancel/restore — never re-read from HTML
    li.dataset.noteStamp = dashNoteFmt(note.created_at)
    const copy = document.createElement('div')
    copy.className = 'task-note-copy'
    const time = document.createElement('time')
    time.textContent = li.dataset.noteStamp
    const span = document.createElement('span')
    span.className = 'task-note-text'
    span.textContent = note.text
    copy.append(time, span)
    const acts = document.createElement('div')
    acts.className = 'task-note-acts'
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'task-note-act'
    edit.setAttribute('aria-label', _t('dashboard.editNote', 'Edit note'))
    edit.title = _t('dashboard.editNote', 'Edit note')
    edit.innerHTML = DASH_ICON.pencil
    edit.addEventListener('click', () => dashNoteEditStart(li, note, taskId))
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'task-note-act danger'
    del.setAttribute('aria-label', _t('dashboard.deleteNote', 'Delete note'))
    del.title = _t('dashboard.deleteNote', 'Delete note')
    del.innerHTML = DASH_ICON.x
    del.addEventListener('click', () => dashNoteDelete(li, note, taskId))
    acts.append(edit, del)
    li.append(copy, acts)
    return li
  }
  // (o) 2026-09-07 fix — "the note panel opens in an odd place (bottom-right corner)
  // instead of showing around the task". Opened from the ⋯ menu, the anchor is a menu
  // item inside the <details>: the click handler used to close the menu FIRST, and
  // Chromium's closed-details implementation (content-visibility: hidden ⇒ contain:
  // layout) keeps the fixed-position pop laid out at STALE coordinates — the anchor's
  // rect reads garbage off-screen values (e2e-measured left=2048, top=574 on a 1366
  // viewport), so the viewport clamp flung the panel into the bottom-right corner.
  // Fix: snapshot the anchor's rect SYNCHRONOUSLY at open time (the click handler now
  // calls openDashNotePanel BEFORE closeDashMenu, while the menu is still laid out)
  // and place against the snapshot — the live element is never re-measured.
  const dashNoteAnchorRect = (anchor) => {
    const r = anchor?.getBoundingClientRect?.()
    if (!r || (!r.width && !r.height) || r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return null
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width }
  }
  const placeDashNotePanel = (panel, rect) => {
    panel.style.visibility = 'hidden'
    requestAnimationFrame(() => {
      if (dashNotePanel !== panel || !panel.isConnected) return
      const r = rect || { top: 0, bottom: 0, left: window.innerWidth / 2, width: 0 }
      const pw = panel.offsetWidth
      const ph = panel.offsetHeight
      const gap = 8
      let top = r.bottom + gap
      if (top + ph > window.innerHeight - 8) top = Math.max(8, Math.min(r.top - ph - gap, window.innerHeight - ph - 8))
      let left = r.left + r.width / 2 - pw / 2
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
      panel.style.top = `${Math.round(top)}px`
      panel.style.left = `${Math.round(left)}px`
      panel.style.visibility = ''
    })
  }
  const openDashNotePanel = async (taskId, anchor) => {
    closeDashNoteBubble()
    closeDashNotePanel()
    if (!taskId) return
    // Snapshot BEFORE any await — in the ⋯-menu path the menu is still open here
    // (the click handler opens the panel first, then collapses the menu).
    const anchorRect = dashNoteAnchorRect(anchor)
    const panel = document.createElement('div')
    panel.className = 'dash-note-pop'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', _t('dashboard.notes', 'Notes'))
    const head = document.createElement('div')
    head.className = 'dash-note-pop-head'
    const title = document.createElement('strong')
    title.textContent = _t('dashboard.notes', 'Notes')
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'dash-note-pop-close'
    closeBtn.setAttribute('aria-label', _t('dashboard.close', 'Close'))
    closeBtn.innerHTML = DASH_ICON.x
    closeBtn.addEventListener('click', closeDashNotePanel)
    head.append(title, closeBtn)
    const list = document.createElement('ol')
    list.className = 'task-notes-list dash-note-pop-list'
    const loading = document.createElement('li')
    loading.className = 'task-notes-empty muted'
    loading.textContent = _t('dashboard.loading', 'Loading…')
    list.append(loading)
    const form = document.createElement('form')
    form.className = 'task-note-add-form dash-note-pop-add'
    const ta = document.createElement('textarea')
    ta.name = 'text'
    ta.maxLength = 500
    ta.rows = 2
    ta.required = true
    ta.placeholder = _t('dashboard.addNotePlaceholder', 'Add a note…')
    ta.setAttribute('aria-label', _t('dashboard.addNote', 'Add note'))
    const addBtn = document.createElement('button')
    addBtn.type = 'submit'
    addBtn.setAttribute('aria-label', _t('dashboard.addNote', 'Add note'))
    addBtn.title = _t('dashboard.addNote', 'Add note')
    addBtn.innerHTML = DASH_ICON.plus
    form.append(ta, addBtn)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = ta.value.trim()
      if (!text) { ta.focus(); return }
      addBtn.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      })
        .then(async (res) => {
          if (!res.ok) { handle401(res); throw new Error('note add failed') }
          const created = await res.json()
          list.querySelector('.task-notes-empty')?.remove()
          list.prepend(dashNoteRow({ id: created.id, task_id: taskId, text: created.text || text, created_at: created.ts || new Date().toISOString() }, taskId))
          ta.value = ''
          refreshDashboard() // re-renders chips/counts; the panel stays open for more
        })
        .catch(() => toast(_t('dashboard.noteFailed', "Couldn't save the note"), 'err'))
        .finally(() => { addBtn.disabled = false })
    })
    panel.append(head, list, form)
    document.body.append(panel)
    dashNotePanel = panel
    dashNotePanelOpenedAt = Date.now()
    placeDashNotePanel(panel, anchorRect)
    try {
      const res = await fetch(`/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes`)
      if (!res.ok) { handle401(res); throw new Error('notes load failed') }
      const { notes } = await res.json()
      if (dashNotePanel !== panel) return // closed while loading
      list.textContent = ''
      const ordered = [...(notes || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      if (!ordered.length) {
        const empty = document.createElement('li')
        empty.className = 'task-notes-empty muted'
        empty.textContent = _t('dashboard.noNotes', 'No notes yet')
        list.append(empty)
      } else {
        for (const note of ordered) list.append(dashNoteRow(note, taskId))
      }
      placeDashNotePanel(panel, anchorRect) // re-place: the panel grew when notes loaded
      ta.focus()
    } catch {
      if (dashNotePanel !== panel) return
      list.textContent = ''
      const err = document.createElement('li')
      err.className = 'task-notes-empty muted'
      err.textContent = _t('dashboard.loadFailed', 'Load failed')
      list.append(err)
    }
  }
  // Outside click closes the history panel (clicks on the panel itself, a note chip,
  // or a ⋯-menu Notes trigger are the open/switch paths, not "outside").
  document.addEventListener('click', (e) => {
    if (!dashNotePanel) return
    if (e.target.closest?.('.dash-note-pop, [data-dash-note-chip], [data-dash-note-panel]')) return
    closeDashNotePanel()
  })
  // Page scroll closes it (the fixed panel would detach from its anchor) — but a
  // scroll INSIDE the panel's own list must keep it open (capture sees both), and
  // so must the LAYOUT-SETTLING scroll right after opening: closing the ⋯ menu
  // collapses the quadrant and nudges the page/list — that reflexive scroll used
  // to insta-kill panels opened from the menu (e2e: chip-open survived, menu-open
  // died). A 250ms grace window separates settling from a real user scroll.
  window.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.dash-note-pop')) return
    if (Date.now() - dashNotePanelOpenedAt < 250) return
    closeDashNotePanel()
  }, { capture: true, passive: true })
  // (n) 2026-09-06 fix — "the ⋯ menu opens UNDERNEATH other things, not visible".
  // The pop's CSS is position: FIXED now (the row's overflow:hidden + the list's
  // overflow:auto clipped the old absolute pop into invisibility), so JS owns its
  // viewport placement: on toggle-open, place it at the ⋯ button's coordinates —
  // end-aligned like the old inset-inline-end: 0 (RTL: leading edge on the button's
  // left; LTR: trailing edge on the button's right), clamped to the viewport, and
  // FLIPPED ABOVE the button when the space below runs out (bottom rows). Same
  // clipping-escape pattern as the note panel and the board's style popover.
  // `toggle` doesn't bubble (older engines) → capture delegation catches every
  // details, whichever way it opened (click, keyboard, hash navigation).
  let dashMenuOpenedAt = 0
  const closeOpenDashMenus = (except) => {
    document.querySelectorAll('.dash-todo-menu[open]').forEach((menu) => { if (menu !== except) menu.open = false })
  }
  const placeDashMenu = (menu) => {
    const pop = menu.querySelector('.dash-todo-menu-pop')
    const summary = menu.querySelector('summary')
    if (!pop || !summary) return
    const rect = summary.getBoundingClientRect()
    const width = pop.offsetWidth || 160
    const height = pop.offsetHeight || 132
    const pad = 8
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    let left = rtl ? rect.left : rect.right - width
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    let top = rect.bottom + 4
    if (top + height > window.innerHeight - pad) top = Math.max(pad, rect.top - height - 4)
    pop.style.left = `${Math.round(left)}px`
    pop.style.top = `${Math.round(top)}px`
  }
  document.addEventListener('toggle', (e) => {
    const menu = e.target
    if (!(menu instanceof HTMLDetailsElement) || !menu.classList?.contains('dash-todo-menu')) return
    if (!menu.open) return
    closeOpenDashMenus(menu) // single-open policy: clicking another row's ⋯ swaps menus
    placeDashMenu(menu)
    dashMenuOpenedAt = Date.now()
  }, true)
  // RACE GUARD (e2e-proven): the toggle event is an ASYNC queued task — a queued
  // scroll listener can slip between the click's default action (open=true) and the
  // toggle task, and the browser then COALESCES the open+close into a single
  // open:false event (menu dies invisibly). The scroll-closer's grace timestamp must
  // therefore be set SYNCHRONOUSLY at click time, not in the async toggle task —
  // and the === 0 check below only protects the FIRST open ever (a RE-open carries
  // a stale timestamp from its previous open, which the sync click stamp fixes).
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dash-todo-menu summary')) dashMenuOpenedAt = Date.now()
  }, true)
  // A fixed pop detaches from its anchor the moment the page/list scrolls → close on
  // real scrolls (the 250ms grace absorbs the layout-settling scroll the (m) lesson
  // pinned: opening/closing a details can nudge the list right after the click).
  window.addEventListener('scroll', () => {
    if (dashMenuOpenedAt === 0) return
    if (Date.now() - dashMenuOpenedAt < 250) return
    closeOpenDashMenus()
  }, { capture: true, passive: true })
  window.addEventListener('resize', () => closeOpenDashMenus())

  window.addEventListener('resize', closeDashNotePanel)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    closeDashNoteBubble()
    closeDashNotePanel()
    closeOpenDashMenus()
  })
  // (m) a click outside any open task ⋯ menu closes it (details has no outside-close).
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dash-todo-menu')) return
    closeOpenDashMenus()
  })

  document.addEventListener('submit', (e) => {
    const taskEditForm = e.target.closest?.('[data-task-edit-form]')
    if (taskEditForm) {
      e.preventDefault()
      const id = taskEditForm.dataset.taskEditForm
      const input = taskEditForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      const error = taskEditForm.querySelector('.task-edit-error')
      if (!id || !title) {
        if (error) error.hidden = false
        input?.focus()
        return
      }
      if (error) error.hidden = true
      const button = taskEditForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      dashTaskRequest(id, { title })
        .then(() => refreshTaskSurface(taskEditForm.closest('.dash-todo-task, .sadhana-card')))
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const quadrantRenameForm = e.target.closest?.('[data-sadhana-rename]')
    if (quadrantRenameForm) {
      e.preventDefault()
      const id = quadrantRenameForm.dataset.sadhanaRename
      const input = quadrantRenameForm.querySelector('input[name="name"]')
      const name = input?.value.trim()
      if (!id || !name) { input?.focus(); return }
      const body = { name }
      /* Subtitle travels with the name (2026-09 user request) — only when edited, so a
         name-only submit never pins the empty prefill as a custom blank subheading. */
      const subInput = quadrantRenameForm.querySelector('input[name="subtitle"]')
      if (subInput && subInput.value.trim() !== subInput.defaultValue.trim()) body.subtitle = subInput.value.trim()
      const button = quadrantRenameForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('rename failed') }; refreshTaskSurface() })
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.renameFailed', "Couldn't rename the quadrant"), 'err') })
      return
    }

    const taskNoteForm = e.target.closest?.('[data-task-note-form]')
    if (taskNoteForm) {
      e.preventDefault()
      const id = taskNoteForm.dataset.taskNoteForm
      const input = taskNoteForm.querySelector('textarea[name="text"]')
      const text = input?.value.trim()
      if (!id || !text) { input?.focus(); return }
      const button = taskNoteForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('note add failed') }; refreshTaskSurface() })
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const editForm = e.target.closest?.('[data-dash-edit-form]')
    if (editForm) {
      e.preventDefault()
      const id = editForm.dataset.dashEditForm
      const input = editForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      const error = editForm.querySelector('.dash-todo-edit-error')
      if (!id || !title) {
        if (error) error.hidden = false
        input?.focus()
        return
      }
      if (error) error.hidden = true
      const button = editForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      dashTaskRequest(id, { title })
        .then(refreshDashboard)
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const quickAddForm = e.target.closest?.('[data-dash-quickadd-form]')
    if (quickAddForm) {
      e.preventDefault()
      // (m) in-flight flag — the second-FAB-click submit path can re-enter while the
      // POST is still pending (the (l) double-add lesson: never re-read a still-filled
      // input). Cleared on failure; on success the htmx swap re-renders a fresh form.
      if (quickAddForm.dataset.inFlight === '1') return
      const quadrant = quickAddForm.dataset.dashQuickaddForm
      const input = quickAddForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      if (!quadrant || !title) { input?.focus(); return }
      if (input) input.disabled = true
      quickAddForm.dataset.inFlight = '1'
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('quick add failed') }; refreshDashboard() })
        .catch(() => {
          if (input) input.disabled = false
          delete quickAddForm.dataset.inFlight
          toast(_t('dashboard.quickAddFailed', "Couldn't add the task"), 'err')
        })
      return
    }

    const form = e.target.closest?.('[data-dash-rename-form]')
    if (!form) return
    e.preventDefault()
    const id = form.dataset.dashRenameForm
    const input = form.querySelector('input[name="name"]')
    const name = input?.value.trim()
    if (!id || !name) { input?.focus(); return }
    const body = { name }
    /* Subtitle (2026-09 user request): second input in the popover; sent only when it
       changed from the prefilled effective value, so a name-only edit doesn't pin the
       localized default subheading as a custom one (same rule as the board's qe-pop). */
    const subInput = form.querySelector('input[name="subtitle"]')
    if (subInput && subInput.value.trim() !== subInput.defaultValue.trim()) body.subtitle = subInput.value.trim()
    const button = form.querySelector('button[type="submit"]')
    if (button) button.disabled = true
    fetch(`/api/sadhana/quadrants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => { if (!res.ok) { handle401(res); throw new Error('rename failed') }; refreshDashboard() })
      .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.renameFailed', "Couldn't rename the quadrant"), 'err') })
  }, true)

  let dashTaskDrag = null
  let dashTaskFrom = null
  const clearDashTaskDropTargets = () => document.querySelectorAll('.dash-todo-quadrant.task-drop-target').forEach((el) => el.classList.remove('task-drop-target'))
  const dashTaskList = (card) => card?.querySelector('.dash-todo-list')
  const updateDashTaskEmpty = (list) => {
    if (!list) return
    const tasks = list.querySelectorAll(':scope > .dash-todo-task')
    const empty = list.querySelector(':scope > .dash-todo-empty')
    if (tasks.length) empty?.remove()
    else if (!empty) {
      const li = document.createElement('li')
      li.className = 'dash-todo-empty muted'
      li.textContent = _t('dashboard.nothing', 'Nothing here yet')
      list.append(li)
    }
  }
  const persistDashOrder = async (card) => {
    const list = dashTaskList(card)
    const quadrant = card?.dataset.dashQuadrant
    const ids = list ? [...list.querySelectorAll(':scope > .dash-todo-task')].map((el) => el.dataset.dashTaskId).filter(Boolean) : []
    if (!quadrant || !ids.length) return
    const res = await fetch('/api/sadhana/tasks/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quadrant: Number(quadrant), ids }),
    })
    if (!res.ok) { handle401(res); throw new Error('task reorder failed') }
  }
  const updateDashTaskCounter = (card) => {
    const count = dashTaskList(card)?.querySelectorAll(':scope > .dash-todo-task').length ?? 0
    const counter = card?.querySelector('.dash-todo-counter')
    if (!counter) return
    const digits = window.hibanaI18n?.lang() === 'fa' ? String(count).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(count)
    counter.textContent = (counter.textContent || '').replace(/([:：]\s*)[\d۰-۹]+$/, `$1${digits}`)
  }
  const showDashTaskMoveError = (task) => {
    if (!task) return
    task.classList.add('move-error')
    let indicator = task.querySelector('[data-dash-move-error]')
    if (!indicator) {
      indicator = document.createElement('span')
      indicator.className = 'dash-todo-move-error'
      indicator.dataset.dashMoveError = '1'
      indicator.setAttribute('role', 'status')
      indicator.textContent = _t('dashboard.taskUpdateFailed', "Couldn't update the task")
      task.append(indicator)
    }
    window.setTimeout(() => {
      task.classList.remove('move-error')
      indicator.remove()
    }, 2200)
  }
  document.addEventListener('dragstart', (e) => {
    const task = e.target.closest('.dash-todo-task[draggable]')
    if (!task) return
    dashTaskDrag = task
    dashTaskFrom = task.closest('.dash-todo-quadrant')
    task.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', task.dataset.dashTaskId || '') } catch {}
  })
  document.addEventListener('dragover', (e) => {
    if (!dashTaskDrag) return
    const target = e.target.closest('.dash-todo-quadrant')
    const targetList = dashTaskList(target)
    if (!target || !targetList) return
    e.preventDefault()
    clearDashTaskDropTargets()
    target.classList.add('task-drop-target')
  })
  document.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.dash-todo-quadrant')
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('task-drop-target')
  })
  document.addEventListener('drop', (e) => {
    if (!dashTaskDrag) return
    const target = e.target.closest('.dash-todo-quadrant')
    const targetList = dashTaskList(target)
    if (!target || !targetList) return
    e.preventDefault()
    clearDashTaskDropTargets()
    const task = dashTaskDrag
    if (target === dashTaskFrom) {
      const overTask = e.target.closest('.dash-todo-task')
      if (!overTask || overTask === task || overTask.parentElement !== targetList) return
      const next = task.nextSibling
      targetList.insertBefore(task, overTask)
      task.classList.add('move-pending')
      persistDashOrder(target)
        .then(() => task.classList.remove('move-pending'))
        .catch(() => { targetList.insertBefore(task, next && next.parentElement === targetList ? next : null); task.classList.remove('move-pending'); showDashTaskMoveError(task) })
      return
    }
    const sourceCard = dashTaskFrom
    const sourceList = task.parentElement
    const sourceNext = task.nextSibling
    const overTask = e.target.closest('.dash-todo-task')
    targetList.querySelector(':scope > .dash-todo-empty')?.remove()
    targetList.insertBefore(task, overTask && overTask.parentElement === targetList ? overTask : null)
    task.classList.add('move-pending')
    updateDashTaskEmpty(sourceList)
    updateDashTaskEmpty(targetList)
    updateDashTaskCounter(sourceCard)
    updateDashTaskCounter(target)

    const movedId = task.dataset.dashTaskId
    const restore = () => {
      sourceList.querySelector(':scope > .dash-todo-empty')?.remove()
      sourceList.insertBefore(task, sourceNext && sourceNext.parentElement === sourceList ? sourceNext : null)
      updateDashTaskEmpty(sourceList)
      updateDashTaskEmpty(targetList)
      updateDashTaskCounter(sourceCard)
      updateDashTaskCounter(target)
      task.classList.remove('move-pending')
      showDashTaskMoveError(task)
    }
    fetch(`/api/sadhana/tasks/${encodeURIComponent(movedId)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quadrant: Number(target.dataset.dashQuadrant) }),
    })
      .then((res) => { if (!res.ok) throw new Error('task move failed') })
      .then(() => Promise.all([persistDashOrder(sourceCard), persistDashOrder(target)]))
      .then(() => task.classList.remove('move-pending'))
      .catch(restore)
  })
  document.addEventListener('dragend', () => {
    if (dashTaskDrag) dashTaskDrag.classList.remove('dragging')
    clearDashTaskDropTargets()
    dashTaskDrag = null
    dashTaskFrom = null
  })

  let dashQuadrantDrag = null
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.dash-todo-quadrant[draggable]')
    if (!card || dashTaskDrag) return
    dashQuadrantDrag = card
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', card.dataset.dashQuadrant || '') } catch {}
    card.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    if (!dashQuadrantDrag) return
    const grid = e.target.closest('.dash-todo-grid')
    if (!grid || grid !== dashQuadrantDrag.parentElement) return
    e.preventDefault()
    const target = e.target.closest('.dash-todo-quadrant[draggable]')
    if (!target || target === dashQuadrantDrag) return
    const rect = target.getBoundingClientRect()
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
    const before = columns <= 1
      ? e.clientY < rect.top + rect.height / 2
      : getComputedStyle(grid).direction === 'rtl'
        ? e.clientX > rect.left + rect.width / 2
        : e.clientX < rect.left + rect.width / 2
    target.parentElement.insertBefore(dashQuadrantDrag, before ? target : target.nextSibling)
    target.classList.add('drag-over')
  })
  document.addEventListener('drop', async (e) => {
    if (!dashQuadrantDrag) return
    const grid = dashQuadrantDrag.parentElement
    if (!grid?.matches('.dash-todo-grid')) return
    e.preventDefault()
    const ids = [...grid.querySelectorAll(':scope > .dash-todo-quadrant')].map((card) => Number(card.dataset.dashQuadrant))
    const dragged = dashQuadrantDrag
    dashQuadrantDrag = null
    dragged.classList.remove('dragging')
    document.querySelectorAll('.dash-todo-quadrant.drag-over').forEach((card) => card.classList.remove('drag-over'))
    if (ids.length !== 4) return
    try {
      const res = await fetch('/api/sadhana/quadrants/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('quadrant reorder failed')
      refreshDashboard()
    } catch {
      toast(_t('dashboard.reorderFailed', "Couldn't reorder the quadrants"), 'err')
      refreshDashboard()
    }
  })
  document.addEventListener('dragend', () => {
    if (dashQuadrantDrag) dashQuadrantDrag.classList.remove('dragging')
    dashQuadrantDrag = null
    document.querySelectorAll('.dash-todo-quadrant.drag-over').forEach((card) => card.classList.remove('drag-over'))
  })

  // ---- Note cards auto-size to their content (a one-word note is one short line) -----
  // The note textarea is rows=1 on the server and grows with its text; a 60vh cap keeps a
  // huge note from swallowing the widget (overflow-y auto scrolls past the cap). Delegated so
  // htmx re-renders of the widget re-apply it.
  const autosizeNote = (el) => {
    el.style.height = 'auto'
    // box-sizing is border-box, so scrollHeight (content + padding) needs the two borders
    // added back; Math.ceil + 1px keeps fractional font metrics from leaving a ~1px overflow
    // that makes Chrome paint a scrollbar on a perfectly-fitted one-line note.
    const cs = getComputedStyle(el)
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const target = Math.ceil(el.scrollHeight + borders) + 1
    // In the sticky view each note scrolls internally instead of growing unboundedly — cap the
    // auto-grow at the CSS max-height (9rem) so the inline height never fights it (2026-08-25).
    const sticky = !!el.closest('#notebook')?.classList.contains('note-view-sticky')
    el.style.height = (sticky ? Math.min(target, 9 * 16) : Math.min(target, Math.round(window.innerHeight * 0.6))) + 'px'
  }
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t && t.classList && t.classList.contains('note-text')) autosizeNote(t)
  })
  // Markdown reading (2026-08-25): notes render formatted by default. Phase 6 item 6
  // (2026-09-09) splits the click by LENGTH: the card clamps to 3 lines (app.css), so a
  // note whose content overflows the clamp opens the full-note READER MODAL (with an
  // edit shortcut); a short note keeps the classic click-to-edit (Obsidian-style) —
  // blur/change → htmx PATCH → the swap re-renders back to render mode.
  let noteReaderDlg = null
  function buildNoteReader() {
    if (noteReaderDlg) return noteReaderDlg
    const dlg = document.createElement('dialog')
    dlg.id = 'note-reader'
    dlg.className = 'note-reader'
    dlg.innerHTML =
      '<div class="note-reader-head">' +
        '<h3 data-i18n="notes.readerTitle">Note</h3>' +
        '<button type="button" class="ghost icon-btn" data-note-reader-close aria-label="Close" data-i18n-aria-label="common.close"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="note-reader-body" dir="auto"></div>' +
      '<div class="note-reader-foot">' +
        '<button type="button" class="ghost" data-note-reader-edit data-i18n="notes.editNote">Edit note</button>' +
        '<button type="button" data-note-reader-close data-i18n="common.close">Close</button>' +
      '</div>'
    document.body.appendChild(dlg)
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
    dlg.querySelector('[data-note-reader-close]').addEventListener('click', () => dlg.close())
    dlg.querySelector('[data-note-reader-edit]').addEventListener('click', () => {
      const card = document.getElementById('note-' + dlg.dataset.noteId)
      dlg.close()
      if (card) enterNoteEdit(card)
    })
    noteReaderDlg = dlg
    return dlg
  }
  function enterNoteEdit(card) {
    card.classList.add('note-edit')
    const ta = card.querySelector('.note-text')
    if (ta) { ta.focus(); requestAnimationFrame(() => autosizeNote(ta)) }
  }
  function openNoteReader(card, render) {
    const dlg = buildNoteReader()
    dlg.dataset.noteId = card.id.replace(/^note-/, '')
    const body = dlg.querySelector('.note-reader-body')
    body.innerHTML = render.innerHTML // the full rendered markdown (the clamp is visual only)
    dlg.showModal()
  }
  document.addEventListener('click', (e) => {
    const render = e.target.closest('.note-render')
    const card = render?.closest('.note-card[data-kind="note"]')
    if (!card) return
    // long note (content overflows the 3-line clamp / the sticky-view scroll box) → modal
    const clamped = render.scrollHeight > render.clientHeight + 2
    if (clamped && render.hasAttribute('data-note-open')) { openNoteReader(card, render); return }
    enterNoteEdit(card)
  })
  // ---- Quick Notebook view: list ⇄ carousel ⇄ grid (2026-08-25) ----------------------
  // Both the view and the sticky-note size are client preferences (localStorage), re-applied
  // after every htmx swap — the server always renders the defaults, so without this the size
  // silently reset to Medium after a reorder (2026-08-26 user report). Cards become draggable
  // for reorder in the carousel view only (the drag handlers POST the order to /api/notes/reorder).
  const NOTE_VIEW_KEY = 'hibana-note-view'
  const NOTE_SIZE_KEY = 'hibana-note-size'
  // The layout toggle itself is PURE CSS (radios + sibling selectors) so it works even with a
  // stale cached app.js — this JS only persists the choice and enables carousel drag-reorder.
  const applyNoteView = () => {
    const nb = document.getElementById('notebook')
    if (!nb) return
    let view = 'list'
    try { view = localStorage.getItem(NOTE_VIEW_KEY) || 'list' } catch { /* storage unavailable — list view */ }
    const listR = nb.querySelector('#nv-list')
    const stickyR = nb.querySelector('#nv-sticky')
    const gridR = nb.querySelector('#nv-grid')
    if (listR) listR.checked = view === 'list'
    if (stickyR) stickyR.checked = view === 'sticky'
    if (gridR) gridR.checked = view === 'grid'
    nb.classList.toggle('note-view-sticky', view === 'sticky') // JS-only convenience for drag gating
    nb.querySelectorAll('.note-card').forEach((c) => {
      if (view === 'sticky') c.setAttribute('draggable', 'true')
      else c.removeAttribute('draggable')
    })
    const track = nb.querySelector('.note-list')
    if (track) track.scrollLeft = 0
  }
  const applyNoteSize = () => {
    const nb = document.getElementById('notebook')
    if (!nb) return
    let size = 'm'
    try { size = localStorage.getItem(NOTE_SIZE_KEY) || 'm' } catch { /* storage unavailable — medium */ }
    if (!/^[sml]$/.test(size)) size = 'm'
    const r = nb.querySelector(`#ns-${size}`)
    if (r) r.checked = true
  }
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('#notebook .note-view-radio')) {
      try { localStorage.setItem(NOTE_VIEW_KEY, e.target.checked ? e.target.value : 'list') } catch { /* storage unavailable */ }
      applyNoteView()
      return
    }
    if (e.target.matches?.('#notebook .note-size-radio')) {
      try { localStorage.setItem(NOTE_SIZE_KEY, e.target.checked ? e.target.value : 'm') } catch { /* storage unavailable */ }
    }
  })
  // Carousel arrows (scroll the snap track by one card).
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-note-sticky-prev], [data-note-sticky-next]')
    if (!nav) return
    const track = document.querySelector('#notebook .note-list')
    if (!track) return
    const card = track.querySelector('.note-card')
    const w = card ? card.getBoundingClientRect().width + 12 : 320
    track.scrollBy({ left: (nav.hasAttribute('data-note-sticky-next') ? 1 : -1) * w, behavior: 'smooth' })
  })
  // Sticky-note drag reorder (delegated, survives htmx swaps; only in sticky view).
  let stickyDrag = null
  const clearStickyDrag = () => { if (stickyDrag) stickyDrag.classList.remove('dragging'); stickyDrag = null }
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest('#notebook .note-card[draggable]')
    if (!c || !document.getElementById('nv-sticky')?.checked) return
    if (e.target.closest('button')) return // palette/delete clicks never start a reorder drag
    stickyDrag = c
    c.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', c.id) } catch {}
  })
  document.addEventListener('dragover', (e) => {
    if (!stickyDrag) return
    e.preventDefault()
    const c = e.target.closest('#notebook .note-card[draggable]')
    if (!c || c === stickyDrag) return
    const track = c.parentElement
    const r = c.getBoundingClientRect()
    track.insertBefore(stickyDrag, e.clientX < r.left + r.width / 2 ? c : c.nextSibling)
  })
  document.addEventListener('drop', async (e) => {
    if (!stickyDrag) return
    e.preventDefault()
    const track = stickyDrag.parentElement
    const ids = [...track.querySelectorAll('.note-card[draggable]')].map((c) => c.id.replace(/^note-/, ''))
    clearStickyDrag()
    if (!ids.length || !window.htmx) return
    try {
      const res = await fetch('/api/notes/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (res.ok) window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
      else toast(_t('notes.reorderFailed', "Couldn't reorder the notes"), 'err')
    } catch {
      toast(_t('notes.reorderFailed', "Couldn't reorder the notes"), 'err')
    }
  })
  // Phase 7 item 11 — «بیشتر…»: measure which note cards are actually clamped by the
  // 3-line cut and un-hide their show-more chip (the server renders it hidden so no
  // stale chip can ever show without a truncation). Runs after every htmx swap and on
  // load, inside rAF so layout is settled (scrollHeight needs the final line boxes).
  // Phase 7 item 13: when htmx lands the dashboard content, the skeleton (and the
  // main's aria-busy) must go together — a stale busy flag traps screen readers in
  // "loading" forever even though the real board is on screen.
  document.addEventListener('htmx:afterSwap', (e) => {
    const dash = document.getElementById('dash')
    if (dash && !dash.querySelector('.dash-skeleton')) dash.removeAttribute('aria-busy')
  })
  const markClampedNotes = () => {
    document.querySelectorAll('#notebook .note-card[data-kind="note"]').forEach((card) => {
      const render = card.querySelector('.note-render')
      if (!render) return
      const clamped = render.scrollHeight > render.clientHeight + 2
      card.classList.toggle('has-more', clamped)
    })
  }
  // the chip click routes to the same full-note reader modal as clicking clamped text
  document.addEventListener('click', (e) => {
    const more = e.target.closest('[data-note-more]')
    if (!more) return
    const card = document.getElementById('note-' + more.dataset.noteMore)
    const render = card?.querySelector('.note-render')
    if (card && render) openNoteReader(card, render)
  })
  document.addEventListener('dragend', clearStickyDrag)
  for (const name of ['htmx:afterSwap', 'afterSwap']) {
    document.addEventListener(name, () => {
      applyNoteView()
      applyNoteSize()
      requestAnimationFrame(() => document.querySelectorAll('.note-text').forEach(autosizeNote))
      requestAnimationFrame(markClampedNotes)
    })
  }
  document.addEventListener('DOMContentLoaded', () => {
    applyNoteView()
    applyNoteSize()
    requestAnimationFrame(() => document.querySelectorAll('.note-text').forEach(autosizeNote))
    requestAnimationFrame(markClampedNotes)
  })

  // ---- Sign-in form (2026-08-26): explicit submit handler. The htmx HX-Redirect flow
  // kept leaving the button stuck in its loading state, so this owns every branch:
  // loading on submit → redirect on success → reset + visible error on failure/timeout.
  document.querySelectorAll('form[data-auth-form]').forEach((form) => {
    const btn = form.querySelector('button[type="submit"]')
    const spinner = form.querySelector('[data-auth-spinner]')
    const err = form.querySelector('[data-auth-error]')
    const btnLabel = btn?.textContent || 'Sign in'
    const setLoading = (loading) => {
      if (btn) {
        btn.disabled = loading
        btn.textContent = loading ? 'Signing in…' : btnLabel
      }
      if (spinner) spinner.classList.toggle('htmx-request', loading)
    }
    const showError = (msg) => {
      if (err) {
        err.textContent = msg
        err.className = 'error'
      }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      showError('')
      if (!form.reportValidity()) return
      setLoading(true)
      // Bilingual messages for this public page (no session → no language pref; best-effort
      // detect from the browser locale, English otherwise).
      const fa = (navigator.language || '').toLowerCase().startsWith('fa')
      const netErr = fa
        ? 'اتصال به سرور برقرار نشد — اینترنت یا VPN را بررسی و دوباره تلاش کنید.'
        : "Can't reach the server — check your connection (VPN?) and try again."
      const timeoutErr = fa
        ? 'سرور دیر پاسخ داد — دوباره تلاش کنید.'
        : 'The server took too long to respond — try again.'
      const genericErr = fa ? 'ورود ناموفق بود، دوباره تلاش کنید.' : 'Sign-in failed, try again.'
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 12000)
      try {
        // HX-Request header makes the server answer with HX-Redirect (dashboard, or the
        // email-confirm gate) so this handler navigates to the exact same routes htmx did.
        const res = await fetch(form.action || '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' },
          body: new URLSearchParams(new FormData(form)).toString(),
          signal: ctrl.signal,
        })
        clearTimeout(timer)
        const redirect = res.headers.get('HX-Redirect')
        if (redirect) {
          window.location.href = redirect
          return
        }
        // Server errors for htmx requests come back as 200 with an HTML <p class="error">
        // (invalid credentials, missing fields) — strip tags and surface the message.
        const text = await res.text()
        const msg = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        showError(msg || genericErr)
      } catch (err) {
        // fetch throws ONLY when the request never completed: offline, DNS/VPN failure,
        // connection reset, or the 12s abort. Say so explicitly instead of a vague
        // "try again" — wrong credentials look totally different ("Wrong email/username…").
        showError(err && err.name === 'AbortError' ? timeoutErr : netErr)
      } finally {
        setLoading(false)
      }
    })
  })

  // ---- boot: nav, auth guard, PWA, trigger wiring ----
  let userChecked = false
  const favicon = document.createElement('link')
  favicon.rel = 'icon'
  favicon.type = 'image/svg+xml'
  favicon.href = '/icon.svg'
  document.head.appendChild(favicon)
  const link = document.createElement('link')
  link.rel = 'manifest'
  link.href = '/manifest.webmanifest'
  document.head.appendChild(link)
  // Fonts: Manrope (Latin) loads statically in every page head; Vazir is injected by
  // i18n.js only when the UI is in fa (keeps English lean).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW registration failed:', err))
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const mounts = document.querySelectorAll('[data-nav]')
    if (mounts.length > 0) {
      const res = await fetch('/partials/nav.html')
      if (res.ok) {
        const html = await res.text()
        for (const m of mounts) m.innerHTML = html
        // Phase 7 item 13: the skeleton's aria-busy leaves WITH the placeholder content
        for (const m of mounts) m.removeAttribute('aria-busy')
        // Re-run i18n now that nav chrome is in the DOM (data-i18n elements).
        window.hibanaI18n?.apply()
        const userEl = document.querySelector('[data-user]')
        const info = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null))
        // Super-admin panel link (batch r): the nav item ships hidden in the partial;
        // only owners ever see it. The API is the real gate — this is pure UX. The flag +
        // event let late-built chrome (the mobile sheet) catch up.
        if (info?.user?.role === 'owner') {
          window.__hibanaOwner = true
          document.querySelectorAll('[data-admin-link], [data-owner-tools]').forEach((el) => { el.hidden = false })
          document.dispatchEvent(new CustomEvent('hibana:role', { detail: { role: 'owner' } }))
        }
        if (userEl) {
          const name = info ? (info.user.username ?? info.user.email) : ''
          userEl.textContent = ''
          const avatar = document.createElement('span')
          avatar.className = 'avatar'
          if (info?.user?.avatar_path) {
            // profile picture (user request) — served through the worker so the GitHub token
            // never reaches the browser; cache-busted so a fresh upload shows on next load
            const img = document.createElement('img')
            img.src = '/api/settings/avatar/file?v=' + Date.now()
            img.alt = ''
            img.decoding = 'async'
            avatar.appendChild(img)
          } else {
            avatar.textContent = (name[0] || '?').toUpperCase()
          }
          const label = document.createElement('span')
          label.className = 'user-name'
          label.textContent = name
          userEl.append(avatar, label)
        }
        document.querySelector('[data-logout]')?.addEventListener('click', () => {
          fetch('/api/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login.html'))
        })
        document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
          b.addEventListener('click', () => window.hibana.toggleTheme())
        })
        window.hibana.paintThemeButton()
        // Profile avatar menu (nav partial): quick language toggle + quick-add. The global
        // quick-add wiring above ran before the nav fetch, so nav buttons need their own hookup.
        document.querySelectorAll('[data-lang-toggle]').forEach((b) => {
          b.addEventListener('click', async () => {
            // Explicit target (en/fa row buttons) wins; a bare data-lang-toggle keeps the
            // old toggle semantics (switch to the other language).
            const next = b.dataset.langToggle || ((window.hibanaI18n?.lang() ?? 'en') === 'fa' ? 'en' : 'fa')
            try {
              await fetch('/api/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ language_pref: next }),
              })
            } catch { /* still apply the client dictionary so the toggle works offline */ }
            if (window.hibanaI18n) await window.hibanaI18n.apply()
            // Re-fetch the current page in place — server-rendered fragments re-render in the
            // new language without a hard reload.
            if (window.hibanaNav) window.hibanaNav.reload()
            else window.location.reload()
          })
        })
        // Mark the current page in the nav (aria-current → visible underline + SR cue).
        // The five links live inside .nav-links (same selector as nav.js's soft-nav marking)
        // — matching structural parent, not visual, so display:contents doesn't affect it.
        document.querySelectorAll('.topbar .nav-links a').forEach((a) => {
          if (a.getAttribute('href') === location.pathname) a.setAttribute('aria-current', 'page')
        })
      }
    }
    if (!userChecked) {
      userChecked = true
      // Defense in depth (2026-08-24 /register incident): the assets edge cached an
      // attribute-stripped variant of the signup page, so the body-class check alone
      // bounced guests to login. Public paths are exempted by URL too — a public page
      // must never redirect to login just because a cached variant lost its classes.
      const publicPaths = ['/login', '/login.html', '/signup', '/signup.html', '/confirm', '/confirm.html', '/reset', '/reset.html']
      const me = await fetch('/api/auth/me')
      if (!me.ok && !publicPaths.includes(location.pathname) && !(document.body?.classList.contains('public-page') ?? false)) {
        window.location.replace('/login.html')
      }
    }
  })

  return { toast, handle401, openQuickAdd, openProjectAdd, openTaskAdd, setTheme, toggleTheme, paintThemeButton, currentTheme }
})()
