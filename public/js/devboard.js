// Hibana dev-board shared client (0029 — user design 2026-08-29).
// One task pool per project rendered two ways: the 4-column progress board
// (board.html) and the sprint timeline (sprint.html). This module owns the DATA
// and the task editor modal so both surfaces stay in perfect sync; each page
// only renders its own view of window.HibanaBoard.state.
/* global window, document, fetch */
(function () {
  'use strict'

  const api = (path, opts) => {
    // S206 parts 2+3 (live-probe root causes, 2026-10-18): the fetch layer is
    // hardened against a browser/edge dispatch bug that is REAL on prod and
    // invisible locally. WHAT HAPPENED (probe-prod truth, four reproduction
    // generations): the GET /devboard fired from a mutation's continuation
    // (create/start/finish → reload → the SAME URL) was dispatched by the renderer
    // (requestWillBeSent) but NEVER reached the Worker (wrangler tail: every other
    // invocation visible — the boot GET, the POST, the cleanup DELETE — never the
    // hung GET; all worker-side outcomes ok, single-digit ms) — the request
    // vanished between the browser and the edge, on BOTH hosts, with and without
    // the service worker, regardless of cache mode or a cache-busting unique URL.
    // The page's fetch promise hung FOREVER: every sprint mutation left the
    // timeline stale until a manual refresh — a core "the sprint system is buggy"
    // symptom for the daily user. THE FIX (validated 4/4 on prod, both hosts,
    // retries=0): every GET dispatches with an AbortController signal + a 3s
    // deadline + ONE retry — the signal-wrapped dispatch shape empirically avoids
    // the swallow entirely, and the deadline+retry is belt-and-braces for any
    // residual case (an aborted stuck request re-fetches; the second fetch has
    // always completed in every reproduction). Mutations keep the plain path (they
    // never hung; retrying them would double-write). cache:'no-store' rides along
    // on every call (part 2): the payload is always-fresh-by-design (the server
    // stamps `private, no-cache`), so skipping the revalidation machinery costs
    // nothing.
    const send = (signal) => fetch(path, { ...opts, cache: 'no-store', signal })
    const isMutation = !!(opts && opts.method && opts.method !== 'GET')
    const fetchOnce = isMutation ? send() : new Promise((resolve, reject) => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 3000)
      send(ctl.signal).then(
        (r) => { clearTimeout(timer); resolve(r) },
        (e) => {
          clearTimeout(timer)
          if (e && e.name === 'AbortError') {
            // one retry on a FRESH request (the second fetch has always completed)
            const ctl2 = new AbortController()
            const t2 = setTimeout(() => ctl2.abort(), 10000)
            send(ctl2.signal).then(
              (r2) => { clearTimeout(t2); resolve(r2) },
              (e2) => { clearTimeout(t2); reject(e2) },
            )
          } else reject(e)
        },
      )
    })
    return fetchOnce.then(async (r) => {
      if (!r.ok) {
        // Carry the HTTP status on the thrown error so pages can tell a DELETED
        // project (404 — retry will never help) from a transient failure (retry does).
        const err = new Error(r.status + ' ' + path)
        err.status = r.status
        // S242 (spec pack §7.1): best-effort parse of the uniform {error:'<code>'}
        // body — the sprint quick-create dialog needs the 409 code (duplicate /
        // draft_exists) to render its inline errors instead of a generic toast.
        // S243 (spec pack §5.2): the parse now carries the WHOLE body (err.body) —
        // the one-active conflict modal reads active_id from the 409
        // sprint_active_exists payload instead of trusting a stale client state.
        try {
          const b = await r.json()
          if (b && b.error) err.code = b.error
          if (b && typeof b === 'object') err.body = b
        } catch { /* non-JSON body — status alone */ }
        throw err
      }
      return r.status === 204 ? null : r.json()
    })
  }

  const t = (key, fallback) => (window.hibanaI18n && window.hibanaI18n.t(key)) || fallback
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // 0031: 'bug' closes the loop — a red Problems column on both boards.
  // Batch (p) 2026-09-06 terminology: planned = برنامه آتی (Upcoming Plan),
  // bug = مشکلات (Problems) — user renamed both terms everywhere.
  // Batch (s) 2026-09-08 position (Ali's 13-item list ⑩): مشکلات sits BETWEEN
  // «ایده‌های جدید» and «برنامه آتی» — second in reading order, not parked at the end.
  const STATUSES = ['idea', 'bug', 'planned', 'in_progress', 'done']
  const PRIORITIES = ['low', 'medium', 'high', 'urgent']
  // S30 batch 2: click-the-dot cycles low → medium → high → urgent → low (the
  // ascending promotion reads naturally — one click = one step up).
  const PRIO_CYCLE = ['low', 'medium', 'high', 'urgent']
  const cyclePriority = (p) => {
    const i = PRIO_CYCLE.indexOf(p)
    return PRIO_CYCLE[(i + 1 + PRIO_CYCLE.length) % PRIO_CYCLE.length] || 'medium'
  }
  // S30 batch 2: the Markdown bullet for a task — "- [URGENT] Fix auth leak #UI/UX
  // #Security" (user's own format). Title whitespace collapses to one space so a
  // multi-line title (fenced code etc.) stays ONE bullet; label spaces hyphenate
  // (GitHub-style). tagNames: the DISPLAY names (board resolves ids, project page
  // resolves its flat join).
  const mdTaskLine = (task, tagNames) => {
    const title = String((task && task.title) || '').replace(/\s+/g, ' ').trim()
    if (!title) return ''
    const prio = String((task && task.priority) || 'medium').toUpperCase()
    const tags = (tagNames || [])
      .map((n) => '#' + String(n || '').trim().replace(/\s+/g, '-'))
      .filter((n) => n.length > 1)
    return '- [' + prio + '] ' + title + (tags.length ? ' ' + tags.join(' ') : '')
  }

  const statusLabel = (s) => ({
    idea: t('db.st.idea', 'New Ideas'),
    planned: t('db.st.planned', 'Plans'),
    in_progress: t('db.st.inprog', 'In Progress'),
    done: t('db.st.done', 'Implemented'),
    bug: t('db.st.bug', 'Problems'),
  })[s] || s
  const prioLabel = (p) => ({
    low: t('db.pr.low', 'Low'),
    medium: t('db.pr.medium', 'Medium'),
    high: t('db.pr.high', 'High'),
    urgent: t('db.pr.urgent', 'Urgent'),
  })[p] || p

  const faDig = (s) => {
    if (!window.hibanaI18n || window.hibanaI18n.lang && window.hibanaI18n.lang() !== 'fa') return String(s)
    return String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
  }

  // Date helpers — UTC day math only; Jalali rendering through the vendored jalaali.
  const DAY = 86400000
  const dayIdx = (iso) => Math.floor(new Date(iso).getTime() / DAY)
  const todayIdx = () => Math.floor(Date.now() / DAY)

  const J_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند']
  const G_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  /** {y,m,d} of an absolute day index, in the ACTIVE calendar (fa → Jalali). */
  const calOf = (idx, lang) => {
    const d = new Date(idx * DAY)
    const gy = d.getUTCFullYear()
    const gm = d.getUTCMonth() + 1
    const gd = d.getUTCDate()
    if (lang === 'fa' && window.jalaali) {
      const j = window.jalaali.toJalaali(gy, gm, gd)
      return { y: j.jy, m: j.jm, d: j.jd }
    }
    return { y: gy, m: gm, d: gd }
  }
  const monthLabel = (idx, lang) => {
    const c = calOf(idx, lang)
    return lang === 'fa' ? J_MONTHS[c.m - 1] : G_MONTHS[c.m - 1]
  }
  /** day number label (Jalali day-of-month when fa). */
  const dayLabel = (idx, lang) => faDig(calOf(idx, lang).d, lang)
  const fullLabel = (idx, lang) => {
    const c = calOf(idx, lang)
    return lang === 'fa'
      ? faDig(c.d) + ' ' + J_MONTHS[c.m - 1] + ' ' + faDig(c.y)
      : c.d + ' ' + G_MONTHS[c.m - 1] + ' ' + c.y
  }
  /** weekday: 0=Sat..6=Fri in the fa week; 0=Sun..6=Sat raw for en. */
  const weekdayIdx = (idx, lang) => {
    const wd = new Date(idx * DAY).getUTCDay() // 0=Sun
    return lang === 'fa' ? (wd + 1) % 7 : wd
  }

  const state = { projectId: null, project: null, tasks: [], categories: [], sprints: [], tags: [] }

  async function load(projectId) {
    state.projectId = projectId
    const data = await api('/api/projects/' + projectId + '/devboard')
    state.project = data.project
    state.tasks = data.tasks
    state.categories = data.categories
    state.sprints = data.sprints
    state.tags = data.tags
    return data
  }

  const findTask = (id) => state.tasks.find((x) => x.id === id) || null
  const findCategory = (id) => state.categories.find((x) => x.id === id) || null
  const findSprint = (id) => state.sprints.find((x) => x.id === id) || null
  const tagById = (id) => state.tags.find((x) => x.id === id) || null
  // S242 (spec pack §4.2 — emoji identity): the sprint's identity glyph — the
  // user-picked emoji token, else the default sprint glyph ◆ (the diamond the
  // card badge has always worn; the SVG table's 'diamond' is the nav/icon twin).
  // Shared by the modal dropdown, the toolbar filter and the card sprint row —
  // one helper so every surface reads the same identity.
  const sprintGlyph = (s) => (s && s.emoji ? String(s.emoji) : '◆')
  // S242 (spec §8/§5.4): completed check for the assignment rules — status is
  // authoritative post-0065; ended_at is the lock-step belt (the invariant keeps
  // ended_at NOT NULL ⇔ completed, so a lagging null-status row still reads right).
  const sprintCompleted = (s) => !!(s && (s.status === 'completed' || s.ended_at))
  // S243 (spec pack §5 — the lifecycle UI): the client twin of the server's
  // sprintStatusOf (src/routes/devboard-helpers.ts): status is authoritative
  // post-0065; a lagging pre-0065 null-status row re-derives from the legacy
  // is_draft/ended_at pair (planned / completed / active — the D1 belt).
  const sprintStatusOf = (s) => {
    if (!s) return 'planned'
    if (s.status) return s.status
    if (s.ended_at) return 'completed'
    return s.is_draft ? 'planned' : 'active'
  }
  // S243 (spec pack §7.4 + contract §12.5 — the CLIENT-DERIVED overview counts):
  // fold the loaded board payload's tasks by sprint + status — five lanes + a
  // total, NOTHING else (no percentages, no analytics; the S241 recorded decision
  // — no /sprints/:sid/overview endpoint exists and none may be added). Every
  // overview surface (the Sprints page detail, the Kanban compact panel, the
  // embedded board's twin) reads THIS one fold; the embedded project page passes
  // its own DOM-derived rows (its truth is server-rendered wraps, not this state).
  const sprintLaneCounts = (sprintId, taskRows) => {
    const rows = taskRows || state.tasks
    const counts = {}
    let total = 0
    for (const st of STATUSES) counts[st] = 0
    for (const task of rows) {
      if (task.sprint_id !== sprintId) continue
      const st = task.status || 'idea'
      if (counts[st] === undefined) counts[st] = 0
      counts[st]++
      total++
    }
    return { counts, total }
  }

  // hibana-sync-status-spec §8/§14: every TASK mutation reports to the per-card
  // sync tracker (public/js/sync-state.js — the ONE state store; the card badges,
  // the header Sync button count and the aria-live region all derive from it).
  // track() paints Pending optimistically, flips to Syncing past 500ms, and
  // settles Synced/Failed on the server's ack — and the promise still REJECTS on
  // failure, so every caller's toast contract below stays intact. The retry
  // closure re-issues THIS mutation when the card's failed pill is clicked.
  // createTask is deliberately untracked: a fresh card renders from the server's
  // own creation ack (synced by definition — spec §2).
  const tracked = (id, run) => (window.HibanaSyncState && id ? window.HibanaSyncState.track(id, run) : run())
  const createTask = (body) => api('/api/projects/' + state.projectId + '/devtasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const patchTask = (id, body) => tracked(id, () => api('/api/devtasks/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  const deleteTask = (id) => tracked(id, () => api('/api/devtasks/' + id, { method: 'DELETE' }))
  // A reorder is ONE request for many cards: trackBulk puts every id Pending
  // together and settles them on the single verdict (the retry re-issues the bulk
  // — the server contract is idempotent).
  const reorderTasks = (ids) => (window.HibanaSyncState && ids && ids.length
    ? window.HibanaSyncState.trackBulk(ids, () => api('/api/projects/' + state.projectId + '/devtasks/reorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      }))
    : api('/api/projects/' + state.projectId + '/devtasks/reorder', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
      }))
  const addTaskTag = (id, name, color) => tracked(id, () => api('/api/devtasks/' + id + '/tags', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }),
  }))
  const removeTaskTag = (id, tagId) => tracked(id, () => api('/api/devtasks/' + id + '/tags/' + tagId, { method: 'DELETE' }))

  // S152: the category colors are the curated fill+ink PAIRS now — create sends the
  // pair, delete archives (soft — block 8: rows stay, task references stay).
  const createCategory = (name, colorFill, colorInk) => api('/api/projects/' + state.projectId + '/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color_fill: colorFill, color_text: colorInk }),
  })
  const patchCategory = (id, body) => api('/api/categories/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const deleteCategory = (id) => api('/api/categories/' + id + '/archive', { method: 'POST' })

  // S48n: createSprint now accepts optional started_at/ended_at. If both provided,
  // the sprint is created as STARTED (skips the draft step). Presets compute the dates.
  const createSprint = (name, startedAt, endedAt) => {
    const body = {}
    if (name) body.name = name
    if (startedAt) { body.started_at = startedAt; if (endedAt) body.ended_at = endedAt }
    return api('/api/projects/' + state.projectId + '/sprints', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }
  // Phase 5 (2026-09-08): start a DEFINED (draft) sprint — stamps started_at, puts it on
  // the board, and closes any currently open sprint first (server-side day edges).
  const startSprint = (id) => api('/api/sprints/' + id + '/start', { method: 'POST' })
  // generic sprint PATCH — rename AND manual boundaries ({ started_at?, ended_at? }, null = reopen)
  const patchSprint = (id, body) => api('/api/sprints/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const renameSprint = (id, name) => patchSprint(id, { name })
  const finishSprint = (id) => api('/api/sprints/' + id + '/finish', { method: 'POST' })
  const reopenSprint = (id) => api('/api/sprints/' + id + '/reopen', { method: 'POST' })
  const deleteSprint = (id) => api('/api/sprints/' + id, { method: 'DELETE' })
  // S243 (spec pack §5.5 — the S240 endpoints get their client wrappers): pause an
  // ACTIVE sprint (window + task associations untouched) and resume a PAUSED one
  // (subject to the one-active 409 — the conflict modal resolves it). Ridden
  // through the shared api() wrapper, so the fetch-site seam counts never move.
  const pauseSprint = (id) => api('/api/sprints/' + id + '/pause', { method: 'POST' })
  const resumeSprint = (id) => api('/api/sprints/' + id + '/resume', { method: 'POST' })
  const reorderCategories = (ids) => api('/api/projects/' + state.projectId + '/categories/reorder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })

  // ---------------------------------------------------------------- shots (S208)
  // S208 (owner: "when creating a new task it doesn't show the button to upload a
  // picture — but already established tasks give you the option; make sure ALL the
  // task options of the original hibana live on this board"): the screenshots /
  // attachments pipeline comes to the board's task editor, ported from
  // project-page.js's S35/S46/S61/S67/S69/S86 stack (the XHR uploader with real
  // per-file progress + cancel, the ≤1600px WebP prepare pass, the staged-shots
  // lifecycle, the inline pinned grid, the lightbox browser). Scoped to
  // state.projectId so the SAME machinery serves board.html AND sprint.html —
  // both surfaces render this modal:
  //   - NEW tasks: the Upload File button stages pictures immediately (POST, no
  //     task_id) — they PIN to the created task on save (PATCH {taskId}) and are
  //     DELETED on cancel/Esc (the project composer's contract — nothing orphans
  //     in the project's gallery).
  //   - EXISTING tasks: the same button uploads + pins in one round-trip per
  //     file, and the inline grid below shows the task's pinned shots with
  //     zoom / edit-note / delete — the pde-shots-grid contract.
  //   - Full S86 bucket: png/jpeg/webp/gif + video/webm + pdf/csv/xlsx/docx/
  //     md/txt (doc tiles download — the serving route stamps
  //     Content-Disposition: attachment for non-images).
  const fmtBytes = (bytes) => {
    // Compact KB/MB for the progress rows (language-neutral units + FA digits).
    const n = Number(bytes) || 0
    if (n >= 1024 * 1024) return faDig((n / (1024 * 1024)).toFixed(1)) + ' MB'
    if (n >= 1024) return faDig(Math.round(n / 1024)) + ' KB'
    return faDig(n) + ' B'
  }
  // S86: the bucket takes PDF, CSV, XLSX, DOCX, MD, TXT alongside the four image
  // types (+ webm video). Browsers report doc mimes unreliably (octet-stream,
  // vendor variants), so the EXTENSION maps to the canonical allowlist mime —
  // the same allowlist the server validates against.
  const MIME_BY_EXT = {
    pdf: 'application/pdf',
    csv: 'text/csv',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    md: 'text/markdown',
    markdown: 'text/markdown',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    webm: 'video/webm',
  }
  const fileExt = (f) => String(f && f.name ? f.name.split('.').pop() : '').toLowerCase()
  const canonicalMime = (f) => {
    const byExt = MIME_BY_EXT[fileExt(f)]
    if (f.type && f.type.startsWith('image/') && ['png', 'jpeg', 'webp', 'gif'].includes(f.type.slice(6))) return f.type
    if (f.type === 'video/webm') return f.type
    if (byExt && (!f.type || f.type === 'application/octet-stream' || f.type === 'text/plain' || f.type.startsWith('text/') || f.type === byExt)) return byExt
    return f.type || byExt || ''
  }
  const isAcceptedFile = (f) => {
    const mime = canonicalMime(f)
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return true
    return Object.values(MIME_BY_EXT).includes(mime)
  }
  const isImageMime = (m) => String(m || '').startsWith('image/')
  const fileExtLabel = (name) => {
    const ext = String(name || '').split('.').pop() || ''
    return ext.toUpperCase().slice(0, 5) || 'FILE'
  }
  const shotName = (s) => {
    const direct = String(s && (s.filename || s.fileName) ? (s.filename || s.fileName) : '').trim()
    if (direct) return direct
    return String(s && s.github_path ? s.github_path : '').split('/').pop().replace(/^[0-9a-f-]{36}-/i, '') || 'file'
  }
  // S86: the shared DOC tile — the same .shot-file shape the server's grid
  // renders; an <a download> (the serving route adds the disposition header).
  const fileTileHtml = (s) => {
    const name = shotName(s)
    const dl = t('project.downloadFile', 'Download {f}').replace('{f}', name)
    return '<a class="shot-file" href="/api/media/screenshots/' + encodeURIComponent(s.id) + '/file" download title="' + esc(dl) + '" aria-label="' + esc(dl) + '">' +
      '<span class="shot-file-ext" aria-hidden="true">' + esc(fileExtLabel(name)) + '</span>' +
      '<span class="shot-file-name" dir="auto">' + esc(name) + '</span>' +
      '<span class="shot-file-dl" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg></span>' +
    '</a>'
  }
  // image-resize.js is NOT linked by board.html/sprint.html (only project/spark/
  // settings pages carry it) — load it ON DEMAND the first time the editor opens
  // (the app.js ensureImageResize recipe). A failed load keeps the raw
  // FileReader path (uploadShotXHR degrades gracefully without the helper).
  let imgResizeLoader = null
  const ensureImageResize = () => {
    if (window.hibanaImageResize) return Promise.resolve(window.hibanaImageResize)
    if (imgResizeLoader) return imgResizeLoader
    imgResizeLoader = new Promise((resolve) => {
      const s = document.createElement('script')
      s.src = '/js/image-resize.js?v=1'
      s.onload = () => resolve(window.hibanaImageResize || null)
      s.onerror = () => resolve(null)
      document.head.appendChild(s)
    })
    return imgResizeLoader
  }
  // S69 prepare phase rides along: images bound to ≤1600px WebP (quality .85)
  // when >1600px or >220KB, + a ≤320px tile as thumbBase64. GIF/SVG/docs take
  // the raw path (a canvas pass would flatten the animation). registerAbort is
  // called per phase (reader → xhr) so each progress row's ✕ aborts whichever
  // is live; an aborted upload rejects with 'aborted' and drops the row
  // NEUTRALLY (nothing failed — the user cancelled).
  const uploadShotXHR = (file, onProgress, registerAbort) =>
    new Promise((resolve, reject) => {
      let prepareAborted = false
      let pendingThumb = null
      const uploadMime = canonicalMime(file)
      if (registerAbort) registerAbort(() => { prepareAborted = true })
      const reader = new FileReader()
      if (registerAbort) registerAbort(() => { try { reader.abort() } catch { /* already done */ } })
      reader.onabort = () => reject(new Error('aborted'))
      reader.onload = () => {
        const b64 = String(reader.result).split(',')[1]
        const xhr = new XMLHttpRequest()
        if (registerAbort) registerAbort(() => { try { xhr.abort() } catch { /* already done */ } })
        xhr.open('POST', '/api/projects/' + state.projectId + '/screenshots')
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total) }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)) } catch { resolve({}) } }
          else reject(new Error('status ' + xhr.status))
        }
        xhr.onerror = () => reject(new Error('network'))
        xhr.onabort = () => reject(new Error('aborted'))
        xhr.send(JSON.stringify({ fileName: file.name, mimeType: uploadMime, dataBase64: b64, caption: '', ...(pendingThumb ? { thumbBase64: pendingThumb } : {}) }))
      }
      reader.onerror = () => reject(new Error('read-failed'))
      const R = window.hibanaImageResize
      if (!R || !isImageMime(uploadMime) || file.type === 'image/gif' || file.type === 'image/svg+xml') { reader.readAsDataURL(file); return }
      ;(async () => {
        try {
          const img = await R.decodeImage(file)
          const maxSide = Math.max(img.width, img.height)
          const tooBig = maxSide > 1600 || file.size > 220 * 1024
          const main = tooBig ? await R.resizeAndEncode(file, { maxDim: 1600, quality: 0.85 }) : null
          let thumb = null
          try {
            const th = await R.resizeAndEncode(file, { maxDim: 320, quality: 0.8 })
            if (th.mimeType === 'image/webp' && th.dataBase64.length <= 120_000) thumb = th.dataBase64
          } catch { /* tile is optional */ }
          if (prepareAborted) return reject(new Error('aborted'))
          if (!main) { pendingThumb = thumb; reader.readAsDataURL(file); return } // small file — raw bytes + tile
          if (prepareAborted) return reject(new Error('aborted'))
          const xhr = new XMLHttpRequest()
          if (registerAbort) registerAbort(() => { try { xhr.abort() } catch { /* already done */ } })
          xhr.open('POST', '/api/projects/' + state.projectId + '/screenshots')
          xhr.setRequestHeader('Content-Type', 'application/json')
          xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total) }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) { try { resolve(JSON.parse(xhr.responseText)) } catch { resolve({}) } }
            else reject(new Error('status ' + xhr.status))
          }
          xhr.onerror = () => reject(new Error('network'))
          xhr.onabort = () => reject(new Error('aborted'))
          xhr.send(JSON.stringify({ fileName: file.name, mimeType: main.mimeType, dataBase64: main.dataBase64, caption: '', ...(thumb ? { thumbBase64: thumb } : {}) }))
        } catch {
          if (prepareAborted) return reject(new Error('aborted'))
          reader.readAsDataURL(file) // canvas failed — the raw path still works
        }
      })()
    })
  // The strip: per-file rows (name + size + bar + % + ✕) mounted above the grid;
  // rows go reading → active → done/error/canceled; done rows fade+remove, error
  // rows linger 6s, canceled rows drop immediately (neutral). aria-live=polite so
  // SR users hear completion without per-file toast spam.
  const makeUploadStrip = (mount, insertBefore) => {
    if (!mount) return { addRow: () => ({ setProgress() {}, done() {}, failed() {}, cancel() {} }) }
    let strip = mount.querySelector(':scope > .shots-upload-strip')
    const ensure = () => {
      if (strip) return strip
      strip = document.createElement('div')
      strip.className = 'shots-upload-strip'
      strip.setAttribute('role', 'status')
      strip.setAttribute('aria-live', 'polite')
      strip.setAttribute('aria-label', t('project.uploading', 'Uploading…'))
      mount.insertBefore(strip, insertBefore || null)
      return strip
    }
    return {
      addRow(fileName, fileSize) {
        ensure()
        const row = document.createElement('div')
        row.className = 'shots-upload-row'
        row.dataset.state = 'reading'
        row.innerHTML =
          '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg>' +
          '<span class="shots-upload-name"></span>' +
          (fileSize != null ? '<span class="shots-upload-size"></span>' : '') +
          '<div class="shots-upload-bar" aria-hidden="true"><div class="shots-upload-fill"></div></div>' +
          '<span class="shots-upload-pct"></span>' +
          '<button type="button" class="ghost icon-btn shots-upload-cancel" aria-label="' + t('project.cancelUpload', 'Cancel upload') + '" title="' + t('project.cancelUpload', 'Cancel upload') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'
        row.querySelector('.shots-upload-name').textContent = fileName // textContent — never innerHTML for names
        const sizeEl = row.querySelector('.shots-upload-size')
        if (sizeEl && fileSize != null) sizeEl.textContent = fmtBytes(fileSize)
        strip.appendChild(row)
        const fill = row.querySelector('.shots-upload-fill')
        const pctEl = row.querySelector('.shots-upload-pct')
        const cancelBtn = row.querySelector('.shots-upload-cancel')
        let abortFn = null
        const drop = () => {
          row.remove()
          if (strip && !strip.querySelector('.shots-upload-row')) { strip.remove(); strip = null }
        }
        cancelBtn.addEventListener('click', () => {
          if (row.dataset.state === 'done' || row.dataset.state === 'error' || row.dataset.state === 'canceled') return
          if (abortFn) abortFn()
          row.dataset.state = 'canceled'
          setTimeout(drop, 260)
        })
        return {
          onAbortable(fn) { abortFn = fn },
          setProgress(frac) {
            if (row.dataset.state === 'done' || row.dataset.state === 'error' || row.dataset.state === 'canceled') return
            row.dataset.state = 'active'
            const pct = Math.max(0, Math.min(100, Math.round((frac || 0) * 100)))
            fill.style.inlineSize = pct + '%'
            pctEl.textContent = pct > 0 ? faDig(pct + '%') : ''
          },
          done() {
            if (row.dataset.state === 'canceled') return
            row.dataset.state = 'done'
            fill.style.inlineSize = '100%'
            pctEl.textContent = '✓'
            setTimeout(drop, 650)
          },
          failed() {
            if (row.dataset.state === 'canceled') return
            row.dataset.state = 'error'
            pctEl.textContent = '✕'
            setTimeout(drop, 6000)
          },
        }
      },
    }
  }
  // { ok: true, shot } landed · { ok: false, canceled: true } user-cancelled
  // (neutral drop, no toast) · { ok: false } failed (red row) — callers aggregate.
  const uploadOne = async (file, strip) => {
    const row = strip.addRow(file.name, file.size)
    try {
      const shot = await uploadShotXHR(file, (f) => row.setProgress(f), (fn) => row.onAbortable(fn))
      row.done()
      return { ok: true, shot }
    } catch (err) {
      if (err && err.message === 'aborted') return { ok: false, canceled: true }
      row.failed()
      return { ok: false }
    }
  }
  const patchShot = (id, body) => api('/api/screenshots/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const deleteShot = (id) => api('/api/screenshots/' + id, { method: 'DELETE' })
  const listShots = async () => {
    const r = await api('/api/projects/' + state.projectId + '/screenshots')
    return (r && r.screenshots) || []
  }
  // S60/S118: the lightbox BROWSER — prev/next walk the sibling figures of the
  // SAME grid (wrap-around, live counter + caption, reading-direction arrows,
  // recordings join via their <video> src), Esc closes AND focus returns to the
  // trigger. S83: a zoom from inside an OPEN native <dialog> (the note dialog,
  // the pinned-pictures dialog) mounts the lightbox INTO that dialog's top
  // layer; from the db-modal (a plain z-90 div) a body-append paints above it
  // (.shot-lightbox is z-200). Esc precedence: this key handler is registered at
  // module load — BEFORE buildModal()'s editor-close listener — and
  // stopImmediatePropagation shields the modal from the same keystroke (the
  // modal's own !shotLightbox guard is the belt).
  let shotLightbox = null // { el, idx, items, lastTrigger, host, onCancel }
  const closeShotLightbox = () => {
    if (!shotLightbox) return
    const tr = shotLightbox.lastTrigger
    const vid = shotLightbox.el.querySelector('video.lb-video')
    if (vid) { try { vid.pause() } catch {} }
    if (shotLightbox.host && shotLightbox.onCancel) shotLightbox.host.removeEventListener('cancel', shotLightbox.onCancel)
    shotLightbox.el.remove()
    shotLightbox = null
    document.body.style.overflow = ''
    try { tr?.focus?.() } catch {} // keyboard users never land in the void
  }
  const lbShotStep = (delta) => {
    if (!shotLightbox || !shotLightbox.items.length) return
    const it = shotLightbox.items
    shotLightbox.idx = (shotLightbox.idx + delta + it.length) % it.length
    const r = it[shotLightbox.idx]
    const img = shotLightbox.el.querySelector('img')
    const vid = shotLightbox.el.querySelector('video.lb-video')
    if (vid && !vid.hidden && !r.video) { try { vid.pause() } catch {} }
    if (img) { img.hidden = !!r.video; if (!r.video) { img.src = r.src; img.alt = r.caption || t('project.shotZoom', 'Screenshot') } }
    if (vid) {
      vid.hidden = !r.video
      if (r.video && vid.getAttribute('src') !== r.src) vid.setAttribute('src', r.src)
    }
    const count = shotLightbox.el.querySelector('.lb-count')
    if (count) count.textContent = faDig(shotLightbox.idx + 1) + ' / ' + faDig(it.length)
    const cap = shotLightbox.el.querySelector('.lb-cap')
    if (cap) cap.textContent = r.caption || ''
    const st = shotLightbox.el.querySelector('.lb-state')
    if (st) {
      st.textContent = r.resolved ? '✓ ' + t('project.shotFixedLabel', 'fixed') : t('project.shotOpenLabel', 'open problem')
      st.classList.toggle('is-fixed', !!r.resolved)
    }
  }
  const openShotLightbox = (src, trigger, scopeGrid, video) => {
    closeShotLightbox()
    const figs = scopeGrid ? [...scopeGrid.querySelectorAll(':scope > .shot-card')] : []
    const items = figs.map((f) => {
      const vid = f.querySelector('video.shot-video')
      if (vid) return { src: vid.getAttribute('src') || '', caption: (f.querySelector('.shot-note')?.textContent || '').trim(), resolved: f.dataset.resolved === '1' || f.classList.contains('is-fixed'), video: true }
      return { src: f.querySelector('.shot-img-btn img')?.getAttribute('src') || '', caption: (f.querySelector('.shot-note')?.textContent || '').trim(), resolved: f.dataset.resolved === '1' || f.classList.contains('is-fixed'), video: false }
    }).filter((x) => x.src)
    let idx = items.findIndex((x) => x.src === src)
    if (idx < 0) { items.push({ src, caption: '', resolved: false, video: !!video }); idx = items.length - 1 }
    const el = document.createElement('div')
    el.className = 'shot-lightbox'
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    el.setAttribute('data-lb', '')
    el.setAttribute('aria-label', t('project.shotZoom', 'Screenshot'))
    el.innerHTML =
      '<button type="button" class="lb-nav lb-prev" aria-label="' + t('gallery.lbPrev', 'Previous picture') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
      '<img src="' + esc(src) + '" alt="' + t('project.shotZoom', 'Screenshot') + '"' + (video ? ' hidden' : '') + '>' +
      '<video class="shot-video lb-video" controls playsinline preload="metadata"' + (video ? ' src="' + esc(src) + '"' : ' hidden') + '></video>' +
      '<button type="button" class="lb-nav lb-next" aria-label="' + t('gallery.lbNext', 'Next picture') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
      '<button type="button" class="lb-close" aria-label="' + t('gallery.lbClose', 'Close') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<div class="lb-meta"><span class="lb-count" aria-live="polite"></span><span class="lb-state" dir="auto"></span><span class="lb-cap" dir="auto"></span></div>'
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.lb-nav')) { lbShotStep(ev.target.closest('.lb-prev') ? -1 : 1); return }
      if (ev.target.closest('.lb-close')) { closeShotLightbox(); return }
      if (!ev.target.closest('img, video')) closeShotLightbox()
    })
    const host = trigger instanceof Element ? trigger.closest('dialog[open]') : null
    ;(host || document.body).appendChild(el)
    if (!host) document.body.style.overflow = 'hidden'
    let onCancel = null
    if (host) {
      onCancel = (ev) => { if (shotLightbox) { ev.preventDefault(); closeShotLightbox() } }
      host.addEventListener('cancel', onCancel)
    }
    shotLightbox = { el, idx, items, lastTrigger: trigger, host, onCancel }
    lbShotStep(0)
    el.querySelector('.lb-close')?.focus()
  }
  document.addEventListener('keydown', (e) => {
    if (!shotLightbox) return
    if (e.key === 'Escape') {
      try { e.preventDefault() } catch {}
      try { e.stopImmediatePropagation() } catch {} // the modal under it must NOT close on this keystroke
      closeShotLightbox()
      return
    }
    const rtl = document.documentElement.dir === 'rtl'
    if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) lbShotStep(1)
    else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) lbShotStep(-1)
  })
  // S118/S119: a recording tile zooms on DOUBLE-click / Enter (single click and
  // Space stay the video's native controls); the tile player pauses when the big
  // one opens. S209 (kanban 1:1 parity): devboard.js now ALSO loads on
  // project.html (the label manager) — that page owns its OWN twin handlers for
  // the same tiles (project-page.js's S118/S119 pair), so these document-level
  // handlers must fire ONLY inside THIS module's own surfaces (the editor modal's
  // grids + the pinned-pictures dialog). Otherwise one dblclick would open TWO
  // stacked lightboxes — the module that owns the DOM owns its events.
  const inBoardSurface = (el) => !!(el && el.closest && el.closest('.db-modal, #db-taskshots, #db-shotnote, #db-labels-root'))
  document.addEventListener('dblclick', (e) => {
    const vid = e.target instanceof Element ? e.target.closest('video.shot-video') : null
    if (!vid) return
    if (!inBoardSurface(vid)) return
    const fig = vid.closest('.shot-card')
    if (!fig) return
    e.preventDefault()
    try { vid.pause() } catch {}
    openShotLightbox(vid.getAttribute('src') || '', vid, fig.parentElement, true)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const vid = e.target instanceof Element && e.target.matches('video.shot-video') ? e.target : null
    if (!vid) return
    if (!inBoardSurface(vid)) return
    const fig = vid.closest('.shot-card')
    if (!fig) return
    e.preventDefault()
    try { vid.pause() } catch {}
    openShotLightbox(vid.getAttribute('src') || '', vid, fig.parentElement, true)
  })
  // The shared tile: image → zoom button, video → inline player, doc → download
  // tile; caption note + Add/Edit-note + ✕ delete. mode 'staged' (new task) vs
  // 'task' (pinned) only swaps the data-* hooks so one delegated handler serves
  // both grids.
  const SHOT_RETRY_ATTR = ' onerror="(function(i){var n=+(i.dataset.r||0)+1;if(n<4){i.dataset.r=n;var s=i.src;i.onerror=null;setTimeout(function(){i.src=s},800*n)}})(this)"'
  const shotFigureHtml = (s, mode) => {
    const mime = String(s.mime_type || s.mime || '')
    const isVideo = mime.startsWith('video/')
    const caption = String(s.caption || '')
    const zoomAttr = mode === 'staged' ? 'data-db-staged-zoom' : 'data-db-shot-zoom'
    const noteAttr = mode === 'staged' ? 'data-db-staged-note' : 'data-db-shot-note'
    const delAttr = mode === 'staged' ? 'data-db-staged-del' : 'data-db-shot-del'
    return '<figure class="shot-card' + (isVideo ? ' is-video' : !isImageMime(mime) ? ' is-file' : '') + '" data-shot-id="' + esc(s.id) + '">' +
      (isImageMime(mime)
        ? '<button type="button" class="shot-img-btn" ' + zoomAttr + '="' + esc(s.id) + '"><img src="/api/media/screenshots/' + esc(s.id) + '/file" alt="" loading="lazy"' + SHOT_RETRY_ATTR + '></button>'
        : isVideo
          ? '<video class="shot-video" src="/api/media/screenshots/' + esc(s.id) + '/file" controls preload="metadata" playsinline tabindex="0" aria-label="' + esc(t('project.videoTileAria', 'Recording — press Enter to view full screen')) + '"></video>'
          : fileTileHtml(s)) +
      '<figcaption class="shot-body">' +
        (caption ? '<p class="shot-note muted small" dir="auto">' + esc(caption) + '</p>' : '') +
        '<div class="row spread shot-actions">' +
          '<button type="button" class="ghost small" ' + noteAttr + '="' + esc(s.id) + '" title="' + (caption ? t('notes.editNote', 'Edit note') : t('notes.addNote', 'Add note')) + '">' + (caption ? t('notes.editNote', 'Edit note') : t('notes.addNote', 'Add note')) + '</button>' +
          '<button type="button" class="ghost small danger" ' + delAttr + '="' + esc(s.id) + '" title="' + t('common.delete', 'Delete') + '" aria-label="' + t('common.delete', 'Delete') + '">✕</button>' +
        '</div>' +
      '</figcaption>' +
    '</figure>'
  }
  // The note editor — a small native <dialog> (the board's delete-confirm
  // recipe): caption ≤1000 chars, PATCH {caption}, onSaved(text) refreshes the
  // owning grid.
  const shotNoteDialog = (shotId, current, onSaved) => {
    const old = document.getElementById('db-shotnote')
    if (old) old.remove()
    const dlg = document.createElement('dialog')
    dlg.id = 'db-shotnote'
    dlg.className = 'dialog'
    dlg.innerHTML =
      '<form class="modal" method="dialog">' +
        // S233 (every modal carries a close on its top right): the note editor's
        // title row joins the task editor / labels / pinned-pictures grammar —
        // h3 on the inline start, the ✕ on the inline end (the Cancel twin).
        '<div class="row spread"><h3>' + esc(t('project.shotNoteTitle', 'Note — what & where to work')) + '</h3>' +
        '<button type="button" class="ghost" data-note-x aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>' +
        '<textarea class="pd-shot-note-ta" rows="6" maxlength="1000" dir="auto" placeholder="' + esc(t('project.shotNotePh', 'What is broken & where — the exact spot to work on…')) + '"></textarea>' +
        '<div class="row" style="justify-content:flex-end;gap:.5rem;margin-top:1rem">' +
          '<button type="button" class="ghost" data-note-cancel>' + esc(t('common.cancel', 'Cancel')) + '</button>' +
          '<button type="button" data-note-save>' + esc(t('common.save', 'Save')) + '</button>' +
        '</div>' +
      '</form>'
    document.body.appendChild(dlg)
    const ta = dlg.querySelector('textarea')
    ta.value = current || ''
    dlg.querySelector('[data-note-cancel]').onclick = () => dlg.close()
    dlg.querySelector('[data-note-x]').onclick = () => dlg.close()
    dlg.querySelector('[data-note-save]').onclick = async () => {
      try {
        await patchShot(shotId, { caption: ta.value.trim() })
        dlg.close()
        if (onSaved) onSaved(ta.value.trim())
      } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    }
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
    dlg.showModal()
    setTimeout(() => ta.focus(), 0)
  }
  // Staged shots for the NEW-task editor: uploaded immediately (POST, no
  // task_id), pinned on save, deleted on cancel.
  let modalStaged = []
  // The CURRENT editor's pinned list (cache for the note/delete handlers).
  let modalPinnedShots = []
  function renderStagedGrid() {
    if (!modalEl || !modalCtx || modalCtx.taskId) return
    const grid = modalEl.querySelector('[data-db-shots-grid]')
    if (!grid) return
    grid.innerHTML = modalStaged.map((s) => shotFigureHtml(s, 'staged')).join('')
    const cnt = modalEl.querySelector('[data-db-shots-count]')
    if (cnt) cnt.textContent = modalStaged.length ? t('project.shotsAttached', '{n} attached').replace('{n}', String(modalStaged.length)) : ''
  }
  async function renderPinnedGrid() {
    if (!modalEl || !modalCtx || !modalCtx.taskId) return
    const grid = modalEl.querySelector('[data-db-shots-grid]')
    if (!grid) return
    try {
      const all = await listShots()
      if (!modalCtx) return // closed meanwhile
      modalPinnedShots = all.filter((s) => s.task_id === modalCtx.taskId)
    } catch { return }
    if (!modalCtx || !modalEl || modalEl.hidden) return
    const g2 = modalEl.querySelector('[data-db-shots-grid]')
    if (g2) g2.innerHTML = modalPinnedShots.map((s) => shotFigureHtml(s, 'task')).join('')
  }
  // S46.4/S208: the PINNED-PICTURES dialog (the project page's taskShotsDialog)
  // — a native <dialog> grid of the task's pinned shots with zoom (the lightbox
  // mounts into this dialog's top layer) + unpin; onChanged lets the board
  // reload so the card's badge count stays true.
  async function openTaskShots(taskId, opts) {
    let shots = []
    try { shots = await listShots() } catch { /* offline — the empty dialog explains itself */ }
    const pinned = shots.filter((s) => s.task_id === taskId)
    const old = document.getElementById('db-taskshots')
    if (old) old.remove()
    const dlg = document.createElement('dialog')
    dlg.id = 'db-taskshots'
    dlg.className = 'dialog'
    const emptyText = '<p class="muted">' + esc(t('project.shotsNone', 'No pictures pinned to this item yet.')) + '</p>'
    const gridHtml = '<div class="pd-tshots-grid">' + pinned.map((s) => {
      const mime = String(s.mime_type || '')
      const isVideo = mime.startsWith('video/')
      return '<figure class="shot shot-card' + (s.resolved ? ' is-fixed' : '') + (isVideo ? ' is-video' : !isImageMime(mime) ? ' is-file' : '') + '" data-shot="' + esc(s.id) + '">' +
        (isImageMime(mime)
          ? '<button type="button" class="shot-img-btn" data-tshots-zoom="' + esc(s.id) + '"><img src="/api/media/screenshots/' + esc(s.id) + '/file" alt="" loading="lazy"' + SHOT_RETRY_ATTR + '></button>'
          : isVideo
            ? '<video class="shot-video" src="/api/media/screenshots/' + esc(s.id) + '/file" controls preload="metadata" playsinline tabindex="0" aria-label="' + esc(t('project.videoTileAria', 'Recording — press Enter to view full screen')) + '"></video>'
            : fileTileHtml(s)) +
        '<figcaption class="shot-body"><p class="shot-note muted small" dir="auto">' + (s.caption ? esc(s.caption) : '') + '</p>' +
        '<div class="row spread shot-actions"><span class="shot-state' + (s.resolved ? ' is-fixed' : '') + '">' + (s.resolved ? '✓ ' + t('project.shotFixedLabel', 'fixed') : t('project.shotOpenLabel', 'open problem')) + '</span>' +
        '<button type="button" class="ghost small danger" data-tshots-unpin="' + esc(s.id) + '" title="' + t('project.shotUnpin', 'Unpin') + '">✕</button></div></figcaption></figure>'
    }).join('') + '</div>'
    dlg.innerHTML =
      '<form class="modal" method="dialog">' +
        '<div class="row spread"><h3>' + esc(t('project.taskShotsTitle', 'Pinned pictures')) + '</h3>' +
        '<button type="button" class="ghost" data-tshots-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>' +
        '<div class="db-modal-body" style="max-block-size:60vh">' + (pinned.length ? gridHtml : emptyText) + '</div>' +
      '</form>'
    document.body.appendChild(dlg)
    dlg.querySelector('[data-tshots-close]').onclick = () => dlg.close()
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
    dlg.addEventListener('click', async (ev) => {
      const zoomBtn = ev.target.closest('[data-tshots-zoom]')
      if (zoomBtn) {
        ev.stopPropagation()
        const img = zoomBtn.querySelector('img')
        if (img) openShotLightbox(img.getAttribute('src'), zoomBtn, zoomBtn.closest('.shot-card')?.parentElement)
        return
      }
      const un = ev.target.closest('[data-tshots-unpin]')
      if (!un) return
      try {
        await patchShot(un.getAttribute('data-tshots-unpin'), { taskId: null })
        window.hibana && window.hibana.toast(t('project.shotUnpinned', 'Unpinned'), 'ok')
        dlg.close()
        if (opts && opts.onChanged) opts.onChanged()
      } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    })
    dlg.showModal()
  }

  // ---------------------------------------------------------------- editor modal
  let modalEl = null
  let modalCtx = null // { taskId | null, draft, onSaved }

  function buildModal() {
    if (modalEl) return modalEl
    modalEl = document.createElement('div')
    modalEl.className = 'db-modal'
    modalEl.setAttribute('role', 'dialog')
    modalEl.setAttribute('aria-modal', 'true')
    modalEl.hidden = true
    document.body.appendChild(modalEl)
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) exitFullscreenOrClose()
    })
    document.addEventListener('keydown', (e) => {
      // S208: an open lightbox eats Esc FIRST (its own document listener is older
      // by registration order and stopImmediatePropagation-shields this one) — this
      // guard is the belt: the lightbox must never close the editor under it.
      // S209 (kanban 1:1 parity): fullscreen writing exits FIRST (the project
      // editor's exitOrClose contract — Esc never discards the writing focus mode
      // AND the modal in one keypress).
      if (e.key === 'Escape' && !modalEl.hidden && !shotLightbox) exitFullscreenOrClose()
    })
    return modalEl
  }

  // hibana-sync-status-spec §10: the editor footer's detail badge (icon + label +
  // "Synced N minutes ago"). Built from the ONE tracker state so the footer shows
  // Pending → Syncing → Synced live while the save runs (sync-state.js repaints
  // every [data-sync-badge-detail] node on change).
  const modalSyncBadge = (taskId) => {
    const chips = window.HibanaChips
    if (!taskId || !chips || !chips.syncBadgeDetailHtml) return ''
    const ss = window.HibanaSyncState
    return chips.syncBadgeDetailHtml(taskId, ss ? ss.stateOf(taskId) : 'synced', false, ss ? ss.syncedAt(taskId) : null)
  }

  function openEditor(taskId, opts) {
    modalCtx = { taskId: taskId || null, onSaved: (opts && opts.onSaved) || null, defaults: (opts && opts.defaults) || {} }
    const task = taskId ? findTask(taskId) : null
    // S152: stash the task's CURRENT category row (resolves for enabled AND
    // referenced-later-disabled rows; an archived one falls back to the raw id so
    // an edit round-trips instead of silently clearing the value).
    modalCtx.editCat = task && task.category_id ? (findCategory(task.category_id) || { id: task.category_id, name: null }) : null
    modalCtx.draft = task
      ? { title: task.title, status: task.status, priority: task.priority, category_id: task.category_id, sprint_id: task.sprint_id, tags: (task.tags || []).slice() }
      : { title: '', status: modalCtx.defaults.status || 'idea', priority: 'medium', category_id: null, sprint_id: null, tags: [] }
    // S208: NEW tasks carry a STAGED tag list (the create body's tags[] — the
    // server find-or-creates them; the project composer's contract) and a fresh
    // staged-shots strip. Existing tasks keep their live tag add/remove.
    if (!task) modalCtx.draft.newTags = []
    modalStaged = []
    modalPinnedShots = []
    ensureImageResize() // warm the resize helper before a file gets picked
    renderModal()
    buildModal().hidden = false
    if (modalCtx.taskId) renderPinnedGrid() // S208: the task's pinned shots load under the button
    const focus = modalEl.querySelector('[name=title]')
    if (focus) { focus.focus(); focus.select() }
  }

  // S209 (kanban 1:1 parity — the owner: "the kanban in the hibana is 1:1 the same
  // as the kanban at projects.hibana.ir/kanban"): the FULLSCREEN WRITING toggle
  // joins the shared modal (the project editor's S46.7 contract — a focus mode that
  // grows the writing area to the viewport and hides the metadata rows). Esc, ✕,
  // Cancel and the backdrop EXIT FULLSCREEN FIRST, never the modal itself — the
  // user never loses the task definition by pressing one key too many.
  function modalCard() { return modalEl ? modalEl.querySelector('.db-modal-card') : null }
  function exitFullscreenOrClose() {
    const card = modalCard()
    if (card && card.classList.contains('db-fullscreen')) { card.classList.remove('db-fullscreen'); return }
    closeModal(false)
  }

  async function closeModal(saved) {
    if (modalEl) {
      modalEl.hidden = true
      const card = modalCard()
      if (card) card.classList.remove('db-fullscreen') // a re-open never starts in focus mode
    }
    const ctx = modalCtx
    modalCtx = null
    const cb = ctx && ctx.onSaved
    if (saved && cb) cb()
    // S208: a cancelled NEW-task editor deletes its STAGED shots (the composer's
    // contract — nothing orphans in the project's gallery). Saved editors pinned
    // theirs already (the save flow clears modalStaged after pinning); existing-
    // task uploads pinned live, they stay. The list is grabbed + cleared
    // synchronously so a fast re-open can't double-delete.
    if (!saved && ctx && !ctx.taskId && modalStaged.length) {
      const staged = [...modalStaged]
      modalStaged = []
      for (const s of staged) {
        try { await api('/api/screenshots/' + s.id, { method: 'DELETE' }) } catch { /* leave it — the gallery can clean later */ }
      }
    }
  }

  function renderModal() {
    const el = buildModal()
    const d = modalCtx.draft
    const isNew = !modalCtx.taskId
    const cats = state.categories
    const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
    el.innerHTML =
      '<div class="db-modal-card" dir="' + (lang === 'fa' ? 'rtl' : 'auto') + '">' +
        '<div class="row spread db-modal-head"><h3>' + (isNew ? esc(t('db.newTask', 'New task')) : esc(t('db.editTask', 'Edit task'))) + '</h3>' +
        '<div class="row" style="gap:.25rem">' +
          // S209 (kanban 1:1 parity): the fullscreen writing toggle — the SAME
          // affordance the project page's task editor carries (S46.7, owner: "add a
          // button for full screen writing to optimize focus"). Toggling grows the
          // title textarea to the viewport and hides the metadata rows (CSS
          // .db-fullscreen in devboard.css); Esc/✕/Cancel exit focus mode FIRST.
          '<button type="button" class="ghost" data-db-fullscreen aria-label="' + esc(t('pde.fullscreen', 'Full-screen writing')) + '" title="' + esc(t('pde.fullscreen', 'Full-screen writing')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6M4 4v6M14 4h6M20 4v6M4 20v-6M4 20h6M20 20h-6M20 20v-6"/></svg></button>' +
          '<button type="button" class="ghost" data-db-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div></div>' +
        // S89 (owner item: the task modal's scroll fix): ONE scroll region between
        // the sticky header and the sticky footer — fields live in .db-modal-body
        // (overflow-y auto); the header (title/✕) + footer (Delete/Cancel/Save)
        // never scroll away on long content. The card is an overflow:hidden flex
        // column capped at 90vh (was a whole-card overflow-y auto).
        '<div class="db-modal-body">' +
        // S209 (kanban 1:1 parity): the formatting toolbar carries the ORIGINAL
        // hibana task editor's FULL set (the project page's .pd-tb — bold /
        // underline / strikethrough | bullet list / ordered list | align ×4 | code)
        // so both editors produce the exact same markdown-lite vocabulary the
        // renderer understands (**bold**, __underline__, ~~strike~~, - bullets,
        // 1. ordered, {:left|center|right|justify}, ``` fences). Same buttons,
        // same icons, same separators as project.html's composer — the ops below
        // write the RAW markdown directly into the single title textarea (the
        // board's Session-22/23 single-field contract; the renderer is shared).
        '<div class="pd-tb" role="toolbar" aria-label="' + esc(t('pd.fmtToolbar', 'Formatting')) + '">' +
          '<button type="button" class="pd-tb-btn" data-tb="bold" title="' + esc(t('pd.fmtBold', 'Bold')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 1 1 0 7H7zM7 12h7a3.5 3.5 0 1 1 0 7H7z"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="underline" title="' + esc(t('pd.fmtUnderline', 'Underline')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v5a5 5 0 0 0 10 0V4"/><path d="M5 19h14"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="strikethrough" title="' + esc(t('pd.fmtStrike', 'Strikethrough')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M16 8a4 4 0 0 0-4-2c-2 0-3.5 1-3.5 2.5M8 16a4 4 0 0 0 4 2c2 0 3.5-1 3.5-2.5"/></svg></button>' +
          '<span class="pd-tb-sep" aria-hidden="true"></span>' +
          '<button type="button" class="pd-tb-btn" data-tb="list" title="' + esc(t('pd.fmtList', 'Bullet list')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="ordered-list" title="' + esc(t('pd.fmtOrderedList', 'Numbered list')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 5h.01M4 4.5v4M3.5 16h1a1 1 0 0 0 0-2h-.5a1 1 0 0 1 0-2H5" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
          '<span class="pd-tb-sep" aria-hidden="true"></span>' +
          '<button type="button" class="pd-tb-btn" data-tb="align-left" title="' + esc(t('pd.fmtAlignLeft', 'Align left')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="align-center" title="' + esc(t('pd.fmtAlignCenter', 'Align center')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M6 10h12M6 14h12M4 18h16"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="align-right" title="' + esc(t('pd.fmtAlignRight', 'Align right')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg></button>' +
          '<button type="button" class="pd-tb-btn" data-tb="align-justify" title="' + esc(t('pd.fmtAlignJustify', 'Justify')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg></button>' +
          '<span class="pd-tb-sep" aria-hidden="true"></span>' +
          '<button type="button" class="pd-tb-btn" data-tb="code" title="' + esc(t('pd.fmtCode', 'Code block')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg></button>' +
        '</div>' +
        '<label class="db-field"><span>' + esc(t('db.title', 'Title')) + '</span>' +
          // Session 22 (user request): TEXTAREA (was a single-line input with
          // maxlength=300) — unlimited, multi-line, 9rem min + resizable (app.css),
          // matching the project-page composer. Enter saves, Shift+Enter breaks the
          // line. Session 23 (user request): (a) dir follows the UI locale — fa → rtl
          // (dir="auto" let a Latin first char keep the editor LTR while writing
          // Farsi; rendered code blocks stay LTR islands via .t-code), (b) newlines are
          // PRESERVED on save (titles render multi-line with fenced code blocks).
          '<textarea name="title" rows="6" dir="' + (lang === 'fa' ? 'rtl' : 'auto') + '" placeholder="' + esc(t('db.titlePh', 'What needs to be built?')) + '">' + esc(d.title) + '</textarea></label>' +
        '<div class="db-field"><span>' + esc(t('db.status', 'Status')) + '</span>' +
          '<div class="db-seg" data-seg="status">' + STATUSES.map((s) =>
            '<button type="button" data-val="' + s + '" class="' + (d.status === s ? 'is-on' : '') + '">' + esc(statusLabel(s)) + '</button>').join('') + '</div></div>' +
        '<div class="db-field"><span>' + esc(t('db.priority', 'Priority')) + '</span>' +
          '<div class="db-seg" data-seg="priority">' + PRIORITIES.map((p) =>
            '<button type="button" data-val="' + p + '" class="prio-' + p + ' ' + (d.priority === p ? 'is-on' : '') + '">' + esc(prioLabel(p)) + '</button>').join('') + '</div></div>' +
        '<div class="db-two">' +
          '<label class="db-field"><span>' + esc(t('db.category', 'Category')) + '</span>' +
            '<select data-db-cat><option value="">' + esc(t('db.uncategorized', 'Uncategorized')) + '</option>' +
              cats.map((c) => '<option value="' + esc(c.id) + '" ' + (d.category_id === c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('') +
              // S152: a task carrying a DISABLED-later category keeps its option so an
              // edit round-trips instead of silently clearing the value.
              (d.category_id && !cats.some((c) => c.id === d.category_id) && modalCtx.editCat ? '<option value="' + esc(d.category_id) + '" selected>' + esc(modalCtx.editCat.name || t('cat.current', '(current category)')) + '</option>' : '') +
              '<option value="__new">' + '＋ ' + esc(t('db.newCategory', 'New category…')) + '</option>' +
            '</select></label>' +
          '<label class="db-field"><span>' + esc(t('db.sprint', 'Sprint')) + '</span>' +
            '<select data-db-sprint><option value="">' + esc(t('db.noSprint', 'No sprint')) + '</option>' +
              // S242 (spec §8 + Screen D): every sprint wears its identity glyph
              // (emoji or the default ◆) beside the name; COMPLETED sprints are not
              // new-assignment options — but the task's CURRENT completed sprint
              // stays as the selected value (historical association; the PATCH
              // re-assert the old edit-modal echo does is legal server-side).
              state.sprints.map((s) => {
                if (sprintCompleted(s) && d.sprint_id !== s.id) return ''
                return '<option value="' + esc(s.id) + '" ' + (d.sprint_id === s.id ? 'selected' : '') + '>' + esc(sprintGlyph(s) + ' ' + s.name) + (s.is_draft ? ' — ' + esc(t('db.draftTag', 'draft')) : '') + '</option>'
              }).join('') +
              '<option value="__new">' + '＋ ' + esc(t('db.newSprint', 'New sprint')) + '</option>' +
            '</select></label>' +
        '</div>' +
        '<div class="db-cat-new" data-db-cat-new hidden>' +
          '<input data-db-cat-name maxlength="80" dir="auto" placeholder="' + esc(t('db.categoryName', 'Category name (Feature Development…)')) + '">' +
          // S152 (block 5): the 16 curated fill+ink pairs — read from the --cat-sw-*
          // tokens (no free-form color picker anywhere).
          '<div class="pd-tag-colors pd-cat-swatches" data-db-cat-swatches></div>' +
        '</div>' +
        (isNew
          ? '<div class="db-field"><span>' + esc(t('db.tags', 'Tags')) + '</span>' +
            '<div class="db-tags-row" data-db-newtags>' +
              (d.newTags || []).map((name) => '<span dir="auto" class="chip db-tag" data-newtag="' + esc(name) + '">' + esc(name) + ' <button type="button" class="ghost danger" data-newtag-del="' + esc(name) + '" aria-label="✕">✕</button></span>').join('') +
              '<input data-db-newtag-in maxlength="60" dir="auto" placeholder="' + esc(t('db.addTag', 'Add tag + Enter')) + '">' +
            '</div></div>'
          : '<div class="db-field"><span>' + esc(t('db.tags', 'Tags')) + '</span>' +
          '<div class="db-tags-row" data-db-tags>' +
            d.tags.map((id) => { const tg = tagById(id); return tg ? '<span dir="auto" class="chip db-tag" data-tag="' + esc(id) + '" style="background:' + esc(tg.color) + '33"><span style="color:' + esc(tg.color) + '">●</span> ' + esc(tg.name) + ' <button type="button" class="ghost danger" data-untag="' + esc(id) + '" aria-label="✕">✕</button></span>' : '' }).join('') +
            '<input data-db-tag-in maxlength="60" dir="auto" placeholder="' + esc(t('db.addTag', 'Add tag + Enter')) + '">' +
          '</div></div>') +
        // S208: the Upload File button + the shots grid — for BOTH modes (the
        // owner's ask: creating a task must offer the picture upload the same way
        // established tasks do). New tasks stage; existing tasks pin immediately
        // and the grid below shows the task's pinned shots (zoom / note / delete).
        '<div class="pd-taskadd-shots" data-db-shots>' +
          '<input type="file" data-db-shots-input accept=".pdf,.csv,.xlsx,.docx,.md,.txt,image/png,image/jpeg,image/webp,image/gif,video/webm" multiple hidden>' +
          '<div class="row" style="gap:.5rem;align-items:center">' +
            '<button type="button" class="ghost" data-db-shots-add title="' + esc(t('pde.shotsAttachTitle', 'Upload a file — images, video (webm), PDF, Excel, Word, Markdown, text — pinned to this item')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21.2 11.2 12.6 19.8a5.4 5.4 0 0 1-7.6-7.6l8.5-8.5a3.6 3.6 0 0 1 5.1 5.1l-8.5 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/></svg> ' + esc(t('pde.shotsAttach', 'Upload File')) + '</button>' +
            (isNew ? '<span class="muted small" data-db-shots-count></span>' : '') +
          '</div>' +
          '<div class="pd-taskadd-shots-grid" data-db-shots-grid></div>' +
        '</div>' +
        '</div>' +
        '<div class="row spread db-modal-foot">' +
          (isNew ? '' : '<button type="button" class="btn ghost danger" data-db-del>' + esc(t('common.delete', 'Delete')) + '</button>') +
          // hibana-sync-status-spec §10: the same badge worn near the Save area of
          // the item editor — icon + label (+ the last confirmed sync time when
          // synced). data-sync-badge-detail lets sync-state.js's paint loop keep it
          // live while the save round-trip runs (modalSyncBadge above).
          '<div class="row" style="gap:.5rem;align-items:center">' + (isNew ? '' : modalSyncBadge(modalCtx.taskId)) + '<button type="button" class="ghost" data-db-close>' + esc(t('common.cancel', 'Cancel')) + '</button></div>' +
          // Session 23 (user request: "the ذخیره button must be green like other
          // buttons"): plain <button> = the system's green CTA fill (was .btn neutral).
          '<button type="button" data-db-save>' + esc(isNew ? t('common.add', 'Add') : t('common.save', 'Save')) + '</button></div></div>' +
        '</div>' +
      '</div>'

    // S152 (block 5): the inline quick-add's swatch grid — the 16 curated fill+ink
    // pairs read from the --cat-sw-* tokens; the first tile starts selected.
    const swWrap = el.querySelector('[data-db-cat-swatches]')
    if (swWrap && !swWrap.childElementCount) {
      const cs = getComputedStyle(document.documentElement)
      let tiles = ''
      for (let i = 1; i <= 16; i++) {
        const fill = cs.getPropertyValue('--cat-sw-' + i + '-fill').trim()
        const ink = cs.getPropertyValue('--cat-sw-' + i + '-ink').trim()
        if (!fill || !ink) continue
        tiles += '<button type="button" class="pd-cat-swatch-tile' + (i === 1 ? ' is-sel' : '') + '" data-db-cat-fill="' + fill + '" data-db-cat-ink="' + ink + '" style="background:' + fill + ';color:' + ink + '" aria-label="' + fill + '"><span aria-hidden="true">Aa</span></button>'
      }
      swWrap.innerHTML = tiles
      swWrap.onclick = (ev) => {
        const tile = ev.target.closest('.pd-cat-swatch-tile')
        if (!tile) return
        swWrap.querySelectorAll('.pd-cat-swatch-tile').forEach((x) => x.classList.remove('is-sel'))
        tile.classList.add('is-sel')
      }
    }
    // S209 (kanban 1:1 parity): the FULL toolbar wiring — every op writes RAW
    // markdown into the single title textarea (the board's editing model) using
    // the exact vocabulary chip-render.js + the server twin parse: inline wraps
    // (**bold**, __underline__, ~~strike~~), line-prefix ops (- bullets, 1.
    // ordered — numbered sequentially), paragraph alignment markers ({:left} /
    // {:center} / {:right} / {:justify} at line start, replacing an existing
    // marker so clicking another align SWITCHES it), and ``` fences on their own
    // lines. The project editor applies the same vocabulary through its
    // contenteditable + htmlToMd — both editors now produce the same language.
    el.querySelectorAll('.pd-tb [data-tb]').forEach((b) => {
      b.onclick = () => {
        const ta = el.querySelector('[name=title]')
        if (!ta) return
        const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart
        const en = ta.selectionEnd == null ? s : ta.selectionEnd
        const v = ta.value
        const sel = v.slice(s, en)
        const kind = b.dataset.tb
        if (kind === 'list' || kind === 'ordered-list' || kind.indexOf('align-') === 0) {
          // line-spanning ops — the full lines the selection touches (the bullet
          // contract; alignment marks the paragraph, chip-render reads it at ^\s*{:\n          // and toggles at the next non-aligned line)
          const ls = v.lastIndexOf('\n', s - 1) + 1
          let le = v.length
          if (sel.includes('\n')) { const n = v.indexOf('\n', Math.max(en, s)); if (n !== -1) le = n }
          const lines = v.slice(ls, le).split('\n')
          let marked
          if (kind === 'list') {
            marked = lines.map((l) => (l === '' || /^[-*]\s/.test(l)) ? l : '- ' + l).join('\n')
          } else if (kind === 'ordered-list') {
            let i = 0
            marked = lines.map((l) => (l === '' || /^\d+\.\s/.test(l)) ? l : (++i) + '. ' + l).join('\n')
          } else {
            const marker = '{:' + kind.slice(6) + '}' // align-left → {:left}
            marked = lines.map((l) => {
              if (!l.trim()) return l
              return marker + l.replace(/^\s*\{:(left|center|right|justify)\}/, '')
            }).join('\n')
          }
          ta.setRangeText(marked, ls, le, 'end')
          ta.focus()
          return
        }
        let before = '', after = ''
        if (kind === 'code') {
          const pre = s === 0 || v[s - 1] === '\n' ? '' : '\n'
          before = pre + '```\n'
          after = '\n```' + (en === v.length || v[en] === '\n' ? '' : '\n')
        } else if (kind === 'underline') {
          before = '__'; after = '__'
        } else if (kind === 'strikethrough') {
          before = '~~'; after = '~~'
        } else {
          before = '**'
          after = '**'
        }
        ta.setRangeText(before + sel + after, s, en, 'end')
        if (sel) ta.setSelectionRange(s + before.length, s + before.length + sel.length)
        else ta.setSelectionRange(s + before.length, s + before.length)
        ta.focus()
      }
    })
    // S209: the fullscreen writing toggle + the close family (✕ / Cancel) exit
    // fullscreen FIRST — the project editor's exitOrClose contract.
    const fsBtn = el.querySelector('[data-db-fullscreen]')
    if (fsBtn) {
      fsBtn.onclick = () => {
        const card = el.querySelector('.db-modal-card')
        if (card) card.classList.toggle('db-fullscreen')
      }
    }
    el.querySelectorAll('[data-db-close]').forEach((b) => { b.onclick = exitFullscreenOrClose })
    el.querySelectorAll('.db-seg button').forEach((b) => {
      b.onclick = () => {
        const seg = b.closest('[data-seg]').dataset.seg
        modalCtx.draft[seg] = b.dataset.val
        b.closest('.db-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('is-on', x === b))
      }
    })
    const catSel = el.querySelector('[data-db-cat]')
    catSel.onchange = () => {
      if (catSel.value === '__new') {
        el.querySelector('[data-db-cat-new]').hidden = false
        modalCtx.draft.category_id = '__pending'
      } else {
        el.querySelector('[data-db-cat-new]').hidden = true
        modalCtx.draft.category_id = catSel.value || null
      }
    }
    const sprintSel = el.querySelector('[data-db-sprint]')
    // The quick-create callbacks re-render the card — the typed title must survive
    // the repaint (the tag flows' syncTitleToDraft contract, same scope below).
    const sprintQRender = () => { syncTitleToDraft(); if (modalCtx) renderModal() }
    sprintSel.onchange = () => {
      if (sprintSel.value === '__new') {
        // S242 (spec §7.1/Screen D): ＋ New sprint opens the QUICK-CREATE dialog
        // (the S206 nameless createSprint() reuse is retired). The draft keeps the
        // PREVIOUS value while the dialog runs — cancel snaps the select back,
        // success pushes the new sprint + re-renders with it selected for this
        // task (the recommended default). draft.sprint_id never becomes '__new'.
        openSprintQuickCreate({
          onCreated: (sp) => {
            if (!modalCtx) return // the task modal closed meanwhile
            if (!state.sprints.some((x) => x.id === sp.id)) state.sprints.push(sp)
            modalCtx.draft.sprint_id = sp.id
            sprintQRender()
          },
          onCanceled: sprintQRender,
        })
        return
      }
      modalCtx.draft.sprint_id = sprintSel.value || null
    }
    // S208: renderModal() rebuilds the whole card — the TITLE textarea is the
    // one live-buffered field (status/priority/category/sprint sync their own
    // draft keys on change). Sync it before any mid-edit re-render (a tag chip
    // add/remove) so the typed title survives the repaint — a latent wipe the
    // existing-task tag flow carried too.
    const syncTitleToDraft = () => {
      const titleEl = el.querySelector('[name=title]')
      if (titleEl) modalCtx.draft.title = titleEl.value
    }
    const tagIn = el.querySelector('[data-db-tag-in]')
    if (tagIn) tagIn.onkeydown = async (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return
      ev.preventDefault()
      const name = tagIn.value.trim()
      if (!name) return
      try {
        const r = await addTaskTag(modalCtx.taskId, name)
        if (!modalCtx) return // closed meanwhile
        syncTitleToDraft()
        if (!d.tags.includes(r.id)) d.tags.push(r.id)
        if (!tagById(r.id)) state.tags.push({ id: r.id, name, color: '#8AB8F0' })
        tagIn.value = ''
        renderModal()
      } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    }
    el.querySelectorAll('[data-untag]').forEach((b) => {
      b.onclick = async () => {
        try {
          await removeTaskTag(modalCtx.taskId, b.dataset.untag)
          syncTitleToDraft()
          modalCtx.draft.tags = modalCtx.draft.tags.filter((x) => x !== b.dataset.untag)
          renderModal()
        } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
    })
    // S208: the NEW-task staged tags — Enter stages the name (chips with ✕),
    // they ride the create body's tags[] (the server find-or-creates them).
    const newTagIn = el.querySelector('[data-db-newtag-in]')
    if (newTagIn) newTagIn.onkeydown = (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return
      ev.preventDefault()
      const name = newTagIn.value.trim()
      if (!name) return
      if (!modalCtx.draft.newTags.includes(name)) modalCtx.draft.newTags.push(name)
      syncTitleToDraft()
      renderModal()
      const again = el.querySelector('[data-db-newtag-in]')
      if (again) again.focus()
    }
    el.querySelectorAll('[data-newtag-del]').forEach((b) => {
      b.onclick = () => {
        modalCtx.draft.newTags = modalCtx.draft.newTags.filter((n) => n !== b.dataset.newtagDel)
        syncTitleToDraft()
        renderModal()
        const again = el.querySelector('[data-db-newtag-in]')
        if (again) again.focus()
      }
    })
    // S208: the shots section — the Upload File button + staged/pinned grid.
    const shotsAdd = el.querySelector('[data-db-shots-add]')
    const shotsInput = el.querySelector('[data-db-shots-input]')
    if (shotsAdd && shotsInput) {
      shotsAdd.onclick = () => shotsInput.click()
      shotsInput.onchange = async () => {
        if (!modalCtx) return
        const files = [...(shotsInput.files || [])].filter(isAcceptedFile)
        shotsInput.value = ''
        if (!files.length) return
        await ensureImageResize()
        const wrap = el.querySelector('[data-db-shots]')
        const gridNow = el.querySelector('[data-db-shots-grid]')
        const strip = makeUploadStrip(wrap, gridNow)
        let ok = 0, fail = 0
        for (const file of files) {
          const r = await uploadOne(file, strip)
          if (!modalCtx) return // closed meanwhile — the pin/cleanup is not ours
          if (r.ok && r.shot && r.shot.id) {
            if (isNew) {
              modalStaged.push({ id: r.shot.id, mime: r.shot.mimeType, fileName: file.name, caption: '' })
              ok++
              renderStagedGrid()
            } else {
              try { await patchShot(r.shot.id, { taskId: modalCtx.taskId }); ok++ } catch { fail++ }
              await renderPinnedGrid()
            }
          } else if (!r.ok && !r.canceled) fail++
        }
        if (ok && !fail) window.hibana && window.hibana.toast(t('project.shotUploaded', 'Screenshot uploaded'), 'ok')
        else if (fail && !ok) window.hibana && window.hibana.toast(t('project.shotFailed', 'Upload failed'), 'err')
        else if (fail) window.hibana && window.hibana.toast(t('project.shotsMixed', '{ok} uploaded, {fail} failed').split('{ok}').join(faDig(ok)).split('{fail}').join(faDig(fail)), 'err')
      }
    }
    // S208: delegated grid handlers — zoom (the lightbox), edit-note (the PATCH
    // dialog), delete (the DELETE + grid refresh). One handler serves the staged
    // grid (new tasks) and the pinned grid (existing tasks).
    const shotsGrid = el.querySelector('[data-db-shots-grid]')
    if (shotsGrid) shotsGrid.onclick = async (ev) => {
      if (!modalCtx) return
      const zoom = ev.target.closest('[data-db-shot-zoom], [data-db-staged-zoom]')
      if (zoom) {
        const img = zoom.querySelector('img')
        if (img) openShotLightbox(img.getAttribute('src'), zoom, shotsGrid)
        return
      }
      const del = ev.target.closest('[data-db-shot-del], [data-db-staged-del]')
      if (del) {
        const sid = del.getAttribute('data-db-shot-del') || del.getAttribute('data-db-staged-del')
        try {
          await deleteShot(sid)
          window.hibana && window.hibana.toast(t('project.shotDeleted', 'File deleted'), 'ok')
        } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't delete"), 'err') }
        if (isNew) {
          modalStaged = modalStaged.filter((s) => s.id !== sid)
          renderStagedGrid()
        } else {
          await renderPinnedGrid()
        }
        return
      }
      const note = ev.target.closest('[data-db-shot-note], [data-db-staged-note]')
      if (note) {
        const sid = note.getAttribute('data-db-shot-note') || note.getAttribute('data-db-staged-note')
        const cur = isNew
          ? String((modalStaged.find((s) => s.id === sid) || {}).caption || '')
          : String((modalPinnedShots.find((s) => s.id === sid) || {}).caption || '')
        shotNoteDialog(sid, cur, (text) => {
          if (isNew) {
            const s = modalStaged.find((x) => x.id === sid)
            if (s) s.caption = text
            renderStagedGrid()
          } else renderPinnedGrid()
        })
      }
    }
    if (isNew) renderStagedGrid()
    const delBtn = el.querySelector('[data-db-del]')
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!await window.hibana.confirm(t('db.delConfirm', 'Delete this task?'), { title: 'Delete task', danger: true, confirmLabel: 'Delete' })) return
        try {
          await deleteTask(modalCtx.taskId)
          window.hibana && window.hibana.toast(t('db.taskDeleted', 'Task deleted'), 'ok')
          closeModal(true)
        } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
    }
    el.querySelector('[data-db-save]').onclick = async () => {
      const titleIn = el.querySelector('[name=title]')
      // Session 23 (user request): newlines PRESERVED (multi-line titles with fenced
      // code blocks / bullet lists) — only \r\n normalized + outer trim. Was collapsed
      // to single spaces ("titles are single-line", pre-Session-23 contract).
      const title = titleIn.value.replace(/\r\n/g, '\n').trim()
      if (!title) { titleIn.focus(); return }
      try {
        let categoryId = modalCtx.draft.category_id
        if (categoryId === '__pending') {
          const cname = el.querySelector('[data-db-cat-name]').value.trim()
          if (!cname) { el.querySelector('[data-db-cat-name]').focus(); return }
          const tile = el.querySelector('[data-db-cat-swatches] .pd-cat-swatch-tile.is-sel')
          if (!tile) { el.querySelector('[data-db-cat-name]').focus(); return }
          const r = await createCategory(cname, tile.dataset.dbCatFill, tile.dataset.dbCatInk)
          categoryId = r.id
        }
        // S242 (spec pack D2 — contract §12.4): ＋ New sprint resolves through the
        // quick-create dialog at SELECTION time (the onchange above) — by save time
        // the draft carries a real id or null. The belt covers the impossible
        // leftover. The S206 draft-reuse block is retired with the nameless create.
        let sprintId = modalCtx.draft.sprint_id
        if (sprintId === '__new') sprintId = null
        if (isNew) {
          // S208: the staged tags ride the create body (the server find-or-creates
          // them) and the staged shots PIN to the fresh task (the project
          // composer's PATCH loop). A failed pin leaves the shot in the project's
          // gallery unpinned (the same best-effort contract) — counted + toasted.
          const created = await createTask({
            title, status: modalCtx.draft.status, priority: modalCtx.draft.priority,
            category_id: categoryId || undefined,
            // S242 (D2): the create body always carries an EXPLICIT sprint_id —
            // null = No sprint (the old `|| undefined` tripped the server's legacy
            // draft/open auto-assign, so "No sprint" never really meant No sprint
            // from this modal; undefined stays reserved for old clients).
            sprint_id: sprintId ?? null,
            ...(modalCtx.draft.newTags && modalCtx.draft.newTags.length ? { tags: modalCtx.draft.newTags } : {}),
          })
          const stagedCount = modalStaged.length
          let pinFail = 0
          for (const s of [...modalStaged]) {
            try { await patchShot(s.id, { taskId: created.id }) } catch { pinFail++ }
          }
          modalStaged = []
          window.hibana && window.hibana.toast(t('db.taskAdded', 'Task added'), 'ok')
          if (pinFail) window.hibana && window.hibana.toast(t('project.shotsMixed', '{ok} uploaded, {fail} failed').split('{ok}').join(faDig(stagedCount - pinFail)).split('{fail}').join(faDig(pinFail)), 'err')
        } else {
          const body = { title, status: modalCtx.draft.status, priority: modalCtx.draft.priority, category_id: categoryId || null, sprint_id: sprintId || null }
          await patchTask(modalCtx.taskId, body)
          window.hibana && window.hibana.toast(t('sparks.saved', 'Saved'), 'ok')
        }
        closeModal(true)
      } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    }
    // Enter on the title saves (Shift+Enter = a real newline — Session 22)
    el.querySelector('[name=title]').onkeydown = (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); el.querySelector('[data-db-save]').click() }
    }
  }

  // ------------------------------------------------- sprint quick-create (S242)
  // Spec pack §7.1 + Screen D: the Add/Edit modal's ＋ New sprint opens this SMALL
  // dialog (replacing the S206 nameless createSprint() reuse). Required name;
  // optional emoji (the shared full-library picker — window.hibanaEmojiPicker, the
  // sparks-folder precedent); Add description + Set due date toggles OFF by default
  // (spec §4.2 — the form stays compact until asked). 409 duplicate → INLINE
  // case-insensitive error (never a silent rename); 409 draft_exists → inline error
  // (the draft is already in the dropdown); success → close + refresh the dropdown +
  // select the new sprint for the current task (the recommended default). The due
  // date uses the sprint define-popover's minimal <input type="date"> precedent
  // (UTC end-of-day parse, sprint-page.js's S206 twin) — Phase 5 swaps in the shared
  // Gregorian/Jalali deadline control.
  let sprintQEl = null
  // Capture-phase Esc shield: while the quick-create is open, Escape must close IT —
  // not the task modal underneath (the emoji picker's own S41 shield pattern).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sprintQEl && !sprintQEl.hidden) {
      e.preventDefault()
      e.stopPropagation()
      closeSprintQuickCreate(false)
    }
  }, true)
  function closeSprintQuickCreate(created) {
    if (!sprintQEl) return
    const ctx = sprintQEl._ctx
    sprintQEl._ctx = null
    sprintQEl.hidden = true
    if (ctx) {
      if (created && ctx.onCreated) ctx.onCreated(ctx._created)
      else if (!created && ctx.onCanceled) ctx.onCanceled()
    }
  }
  function openSprintQuickCreate(opts) {
    const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
    if (!sprintQEl) {
      sprintQEl = document.createElement('div')
      sprintQEl.className = 'db-modal db-sprintq'
      sprintQEl.setAttribute('role', 'dialog')
      sprintQEl.setAttribute('aria-modal', 'true')
      sprintQEl.hidden = true
      document.body.appendChild(sprintQEl)
      sprintQEl.addEventListener('click', (e) => { if (e.target === sprintQEl) closeSprintQuickCreate(false) })
    }
    sprintQEl._ctx = { onCreated: (opts && opts.onCreated) || null, onCanceled: (opts && opts.onCanceled) || null }
    let emoji = ''
    sprintQEl.innerHTML =
      '<div class="db-modal-card db-sprintq-card" dir="' + (lang === 'fa' ? 'rtl' : 'auto') + '">' +
        '<div class="row spread db-modal-head"><h3>' + esc(t('db.newSprint', 'New sprint')) + '</h3>' +
          '<button type="button" class="ghost" data-sq-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>' +
        '<form class="db-sprintq-body">' +
          '<label class="db-field"><span>' + esc(t('db.sprintName', 'Sprint name')) + '</span>' +
            '<input name="sq-name" data-sq-name maxlength="80" dir="auto" required placeholder="' + esc(t('db.sq.namePh', 'Security…')) + '" aria-required="true"></label>' +
          '<div class="db-field"><span>' + esc(t('db.sq.emoji', 'Emoji (optional)')) + '</span>' +
            '<div class="row db-sq-emoji-row">' +
              '<button type="button" class="ghost db-sq-emoji-btn" data-sq-emoji-btn><span class="db-sq-emoji-cur" data-sq-emoji-cur aria-hidden="true">◆</span> <span data-sq-emoji-label>' + esc(t('db.sq.chooseEmoji', 'Choose emoji')) + '</span></button>' +
              '<button type="button" class="ghost danger db-sq-emoji-clear" data-sq-emoji-clear hidden aria-label="' + esc(t('db.sq.clearEmoji', 'Back to the default icon')) + '" title="' + esc(t('db.sq.clearEmoji', 'Back to the default icon')) + '">✕</button>' +
            '</div></div>' +
          // Spec §4.2: description input hides behind an OFF-by-default toggle.
          '<label class="db-sq-toggle"><input type="checkbox" data-sq-desc-toggle><span>' + esc(t('db.sq.addDesc', 'Add description')) + '</span></label>' +
          '<textarea class="db-sq-desc" data-sq-desc maxlength="2000" dir="auto" hidden placeholder="' + esc(t('db.sq.descPh', 'What is this sprint about?')) + '"></textarea>' +
          // Spec §4.2: due-date controls hide behind an OFF-by-default toggle.
          '<label class="db-sq-toggle"><input type="checkbox" data-sq-due-toggle><span>' + esc(t('db.sq.setDue', 'Set due date')) + '</span></label>' +
          '<input type="date" class="db-sq-due" data-sq-due hidden>' +
          '<p class="db-sq-error" data-sq-error role="alert" hidden></p>' +
        '</form>' +
        '<div class="row spread db-modal-foot">' +
          '<span class="muted small"></span>' +
          '<div class="row" style="gap:.5rem">' +
            '<button type="button" class="ghost" data-sq-cancel>' + esc(t('common.cancel', 'Cancel')) + '</button>' +
            '<button type="button" data-sq-create>' + esc(t('db.sq.create', 'Create sprint')) + '</button>' +
          '</div></div>' +
      '</div>'
    const nameIn = sprintQEl.querySelector('[data-sq-name]')
    const emojiBtn = sprintQEl.querySelector('[data-sq-emoji-btn]')
    const emojiCur = sprintQEl.querySelector('[data-sq-emoji-cur]')
    const emojiLabel = sprintQEl.querySelector('[data-sq-emoji-label]')
    const emojiClear = sprintQEl.querySelector('[data-sq-emoji-clear]')
    const descToggle = sprintQEl.querySelector('[data-sq-desc-toggle]')
    const descTa = sprintQEl.querySelector('[data-sq-desc]')
    const dueToggle = sprintQEl.querySelector('[data-sq-due-toggle]')
    const dueIn = sprintQEl.querySelector('[data-sq-due]')
    const errEl = sprintQEl.querySelector('[data-sq-error]')
    const createBtn = sprintQEl.querySelector('[data-sq-create]')
    const showErr = (msg) => { errEl.textContent = msg; errEl.hidden = false }
    const hideErr = () => { errEl.hidden = true; errEl.textContent = '' }
    const paintEmoji = () => {
      emojiCur.textContent = emoji || '◆'
      emojiLabel.textContent = emoji ? t('db.sq.changeEmoji', 'Change') : t('db.sq.chooseEmoji', 'Choose emoji')
      emojiClear.hidden = !emoji
    }
    sprintQEl.querySelector('[data-sq-close]').onclick = () => closeSprintQuickCreate(false)
    sprintQEl.querySelector('[data-sq-cancel]').onclick = () => closeSprintQuickCreate(false)
    emojiBtn.onclick = () => {
      const picker = window.hibanaEmojiPicker
      if (!picker) { showErr(t('sparks.saveFailed', "Couldn't save")); return }
      picker.open({ anchor: emojiBtn, current: emoji, onPick: (e2) => { emoji = String(e2 || ''); paintEmoji(); hideErr() } })
    }
    emojiClear.onclick = () => { emoji = ''; paintEmoji() }
    descToggle.onchange = () => { descTa.hidden = !descToggle.checked }
    dueToggle.onchange = () => { dueIn.hidden = !dueToggle.checked }
    const doCreate = async () => {
      const name = nameIn.value.trim()
      if (!name) { showErr(t('db.sq.nameRequired', 'Enter a name for the sprint.')); nameIn.focus(); return }
      hideErr()
      createBtn.disabled = true
      createBtn.textContent = t('db.sq.creating', 'Creating…')
      try {
        const body = { name }
        if (emoji) body.emoji = emoji
        if (descToggle.checked) { const dv = descTa.value.trim(); if (dv) body.description = dv }
        if (dueToggle.checked && dueIn.value) body.due_at = new Date(dueIn.value + 'T23:59:59Z').toISOString()
        const r = await api('/api/projects/' + state.projectId + '/sprints', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        // The synthetic row for the dropdown until the next full reload (the task
        // save's onSaved re-pulls everything authoritative). A quick-create never
        // sends started_at → the sprint is born a DRAFT (planned, is_draft=1).
        sprintQEl._ctx._created = {
          id: r.id, project_id: state.projectId, name: r.name, version: r.version,
          is_draft: r.draft ? 1 : 0, status: r.draft ? 'planned' : 'active',
          emoji: emoji || null, due_at: body.due_at || null, due_origin_at: body.due_at || null,
          started_at: null, ended_at: null, updated_at: new Date().toISOString(),
        }
        closeSprintQuickCreate(true)
      } catch (err) {
        createBtn.disabled = false
        createBtn.textContent = t('db.sq.create', 'Create sprint')
        if (err && err.code === 'duplicate') showErr(t('db.sq.dupErr', 'A sprint with this name already exists in this project — names are case-insensitive.'))
        else if (err && err.code === 'draft_exists') showErr(t('db.draftExists', 'A sprint is already being defined — start it or delete it first'))
        else showErr(t('db.sq.failed', "Couldn't create the sprint — try again."))
      }
    }
    createBtn.onclick = doCreate
    sprintQEl.querySelector('form').onsubmit = (ev) => { ev.preventDefault(); doCreate() }
    sprintQEl.hidden = false
    paintEmoji()
    nameIn.focus()
  }

  // ------------------------------------------------- sprint lifecycle UI (S243)
  // Spec pack Phase 4 (§5/§6 + Screens H1/H2/H3/I): the lifecycle confirmation
  // dialogs + the shared start/resume conflict flow. Richer than the S210
  // hibana.confirm card (counts, sprint identity, multiple actions) — built the
  // S242 quick-create way: a .db-modal overlay + .db-modal-card, dir follows the
  // locale, a capture-phase Esc shield (Escape closes THIS dialog, never
  // whatever lives underneath), z-96 above the sprint popovers and the sprint
  // detail panel. Shared by every surface: sprint.html (the Sprints page rows,
  // draft card + toolbar), board-page.js (the compact Kanban overview) and
  // project-page.js (the embedded board's twin — the S242 parity decision,
  // SHIPPED). The H3 pause keeps the lightweight hibana.confirm card (Screen H3:
  // "a lightweight confirmation is appropriate") — pause is reversible.
  let sprintModEl = null
  let sprintModCtx = null
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sprintModEl && !sprintModEl.hidden) {
      e.preventDefault()
      e.stopPropagation()
      closeSprintModal()
    }
  }, true)
  function closeSprintModal() {
    if (!sprintModEl) return null
    const ctx = sprintModCtx
    sprintModCtx = null
    sprintModEl.hidden = true
    return ctx
  }
  function sprintModal(html, opts) {
    const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
    if (!sprintModEl) {
      sprintModEl = document.createElement('div')
      sprintModEl.className = 'db-modal db-sprintmod'
      sprintModEl.setAttribute('role', 'dialog')
      sprintModEl.setAttribute('aria-modal', 'true')
      sprintModEl.hidden = true
      document.body.appendChild(sprintModEl)
      sprintModEl.addEventListener('click', (e) => { if (e.target === sprintModEl) closeSprintModal() })
    }
    sprintModCtx = { onDone: (opts && opts.onDone) || null }
    sprintModEl.innerHTML =
      '<div class="db-modal-card db-sprintmod-card" dir="' + (lang === 'fa' ? 'rtl' : 'auto') + '">' + html + '</div>'
    sprintModEl.hidden = false
    return sprintModEl
  }
  const smHead = (title) =>
    '<div class="row spread db-modal-head"><h3>' + esc(title) + '</h3>' +
    '<button type="button" class="ghost" data-sm-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>'
  const smIdentity = (s, label) =>
    '<p class="db-sm-identity"><span class="db-sm-glyph" aria-hidden="true">' + esc(sprintGlyph(s)) + '</span>' +
    '<b dir="auto">' + esc(s.name || '') + '</b>' +
    (label ? '<span class="db-sm-role muted small">' + esc(label) + '</span>' : '') + '</p>'
  const smFoot = (cancelLabel, confirmAttrs, confirmLabel, danger) =>
    '<div class="row spread db-modal-foot"><span class="muted small"></span>' +
    '<div class="row" style="gap:.5rem">' +
    '<button type="button" class="ghost" data-sm-cancel>' + esc(cancelLabel) + '</button>' +
    '<button type="button" ' + confirmAttrs + (danger ? ' class="ghost danger"' : '') + '>' + esc(confirmLabel) + '</button>' +
    '</div></div>'
  const smWireCancel = (el) => {
    el.querySelector('[data-sm-close]').onclick = () => closeSprintModal()
    el.querySelector('[data-sm-cancel]').onclick = () => closeSprintModal()
  }

  // H2 (spec §5.3 + Screen H2): "Finish sprint?" — the sprint's identity, the
  // count of tasks in Implemented THAT WILL BE ARCHIVED (client fold of the loaded
  // payload), the count of unfinished tasks that stay put, the explicit
  // "No tasks will be deleted." Confirm → POST /finish → the toast quotes the
  // SERVER's additive archived count (the exact number, never the preview).
  function openSprintFinish(s, opts) {
    if (!s) return
    const o = opts || {}
    const done = o.onDone || null // captured up front: an Esc mid-flight must not swallow the reload (the mutation lands either way)
    const fold = sprintLaneCounts(s.id, o.taskRows)
    const doneN = fold.counts.done || 0
    const unfinished = fold.total - doneN
    const el = sprintModal(
      smHead(t('db.h2.title', 'Finish sprint?')) +
      '<div class="db-sprintmod-body">' +
        smIdentity(s) +
        '<p class="db-sm-line">' + esc(t('db.h2.willArchive', '{n} tasks in Implemented will be archived.').replace('{n}', faDig(doneN))) + '</p>' +
        '<p class="db-sm-line">' + esc(t('db.h2.unfinished', '{n} unfinished tasks stay in their columns and keep this sprint.').replace('{n}', faDig(unfinished))) + '</p>' +
        '<p class="db-sm-line db-sm-safe">' + esc(t('db.h2.noDelete', 'No tasks will be deleted.')) + '</p>' +
      '</div>' +
      smFoot(t('common.cancel', 'Cancel'), 'data-sm-finish', t('db.h2.confirm', 'Finish Sprint'), false),
    o)
    smWireCancel(el)
    const btn = el.querySelector('[data-sm-finish]')
    btn.onclick = async () => {
      btn.disabled = true
      try {
        const r = await finishSprint(s.id) // 200 {ok, archived:n} — the server's exact count
        window.hibana && window.hibana.toast(t('db.h2.done', 'Sprint finished — {n} tasks archived').replace('{n}', faDig(r && r.archived != null ? r.archived : doneN)), 'ok')
        closeSprintModal()
        if (done) done()
      } catch {
        btn.disabled = false
        window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
      }
    }
    btn.focus()
  }

  // Screen I (spec §6): the delete confirmation with EXACT impact counts. Active
  // sprints answer the "pause or finish first" guard inline (the 409's twin);
  // completed sprints are history and answer inline too (spec §5.4). Planned +
  // Paused delete through the modal: total associated tasks, non-archived that
  // become "No sprint", archived that keep the "Sprint: <name> (deleted)"
  // snapshot label (counted from the lazy archives list — the row's sprint_id,
  // added S243), and the explicit "No tasks will be deleted."
  async function openSprintDelete(s, opts) {
    if (!s) return
    const o = opts || {}
    const delDone = o.onDone || null // captured up front: an Esc mid-flight must not swallow the reload
    const status = sprintStatusOf(s)
    if (status === 'completed') {
      window.hibana && window.hibana.toast(t('db.del.completed', "Completed sprints are part of your history — they can't be deleted."), 'err')
      return
    }
    if (status === 'active') {
      window.hibana && window.hibana.toast(t('db.del.active', 'Pause or finish this sprint before deleting it.'), 'err')
      return
    }
    const fold = sprintLaneCounts(s.id, o.taskRows)
    // the archived count comes from the archives list (lazy, existing) — the
    // modal opens only when the fetch landed so every count it shows is EXACT;
    // a failed fetch refuses the modal (a miscounted destructive confirm is
    // worse than a retry). Ridden through the shared api() wrapper (no new
    // fetch site; the embedded board passes its own projectId via opts).
    let archivedN = 0
    try {
      const pid = (o.projectId != null ? o.projectId : state.projectId) || ''
      const r = await api('/api/projects/' + pid + '/archives')
      archivedN = ((r && r.archives) || []).filter((a) => a && a.sprint_id === s.id).length
    } catch {
      window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't load"), 'err')
      return
    }
    const total = fold.total + archivedN
    const el = sprintModal(
      smHead(t('db.del.title', 'Delete sprint?')) +
      '<div class="db-sprintmod-body">' +
        smIdentity(s) +
        '<p class="db-sm-line">' + esc(t('db.del.total', '{n} tasks are associated with this sprint.').replace('{n}', faDig(total))) + '</p>' +
        '<p class="db-sm-line">' + esc(t('db.del.unassign', '{n} non-archived tasks will become unassigned (No sprint).').replace('{n}', faDig(fold.total))) + '</p>' +
        '<p class="db-sm-line">' + esc(t('db.del.archived', '{n} archived tasks stay archived, labeled "Sprint: {name} (deleted)".').replace('{n}', faDig(archivedN)).replace('{name}', s.name || '')) + '</p>' +
        '<p class="db-sm-line db-sm-safe">' + esc(t('db.del.noDelete', 'No tasks will be deleted.')) + '</p>' +
      '</div>' +
      smFoot(t('common.cancel', 'Cancel'), 'data-sm-del', t('db.del.confirm', 'Delete Sprint'), true),
    o)
    smWireCancel(el)
    const btn = el.querySelector('[data-sm-del]')
    btn.onclick = async () => {
      btn.disabled = true
      try {
        await deleteSprint(s.id)
        window.hibana && window.hibana.toast(t('db.del.done', 'Sprint deleted'), 'ok')
        closeSprintModal()
        if (delDone) delDone()
      } catch (err) {
        btn.disabled = false
        // the server's twin guards answer inline (a race lost between load + click)
        if (err && err.code === 'sprint_active') window.hibana && window.hibana.toast(t('db.del.active', 'Pause or finish this sprint before deleting it.'), 'err')
        else if (err && err.code === 'sprint_completed') window.hibana && window.hibana.toast(t('db.del.completed', "Completed sprints are part of your history — they can't be deleted."), 'err')
        else window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
      }
    }
    btn.focus()
  }

  // H1 (spec §5.2 + Screen H1): start/resume hitting the one-active rule — show
  // BOTH identities and offer three EXPLICIT actions: pause current & start
  // selected, finish current & start selected (the archive count rides the button
  // so the user sees it BEFORE confirming), or cancel. The transition runs as
  // sequential calls (pause → start / finish → start) — atomic from the user's
  // perspective; a lost race re-answers the 409, which is SURFACED (never a
  // silent retry), and the board reloads so the landed partial state shows.
  function openSprintConflict(active, selected, opts) {
    if (!active || !selected || active.id === selected.id) return
    const o = opts || {}
    const armDone = o.onDone || null // captured up front: an Esc mid-flight must not swallow the reload
    const doneN = (sprintLaneCounts(active.id, o.taskRows).counts.done) || 0
    const el = sprintModal(
      smHead(t('db.h1.title', 'Another sprint is active')) +
      '<div class="db-sprintmod-body">' +
        '<p class="db-sm-line">' + esc(t('db.h1.explain', 'Only one sprint can be active in this project at a time.')) + '</p>' +
        '<p class="db-sm-role-lab muted small">' + esc(t('db.h1.current', 'Currently active')) + '</p>' +
        smIdentity(active) +
        '<p class="db-sm-role-lab muted small">' + esc(t('db.h1.starting', 'You are starting')) + '</p>' +
        smIdentity(selected) +
        '<button type="button" class="db-sm-action" data-sm-pause-start>' +
          '<span aria-hidden="true">⏸</span> ' +
          esc(t('db.h1.pauseStart', 'Pause {a} & Start {b}').replace('{a}', active.name || '').replace('{b}', selected.name || '')) +
        '</button>' +
        '<button type="button" class="db-sm-action" data-sm-finish-start>' +
          '<span aria-hidden="true">⏹</span> ' +
          esc(t('db.h1.finishStart', 'Finish {a} & Start {b}').replace('{a}', active.name || '').replace('{b}', selected.name || '')) +
        '</button>' +
        '<p class="db-sm-line muted small">' + esc(t('db.h1.finishNote', 'Finishing archives only tasks in Implemented — {n} will be archived.').replace('{n}', faDig(doneN))) + '</p>' +
      '</div>' +
      '<div class="row spread db-modal-foot"><span class="muted small"></span>' +
        '<div class="row" style="gap:.5rem"><button type="button" class="ghost" data-sm-cancel>' + esc(t('common.cancel', 'Cancel')) + '</button></div>' +
      '</div>',
    o)
    smWireCancel(el)
    const runArm = async (arm) => {
      try {
        if (arm === 'pause') {
          await pauseSprint(active.id)
        } else {
          const r = await finishSprint(active.id)
          if (r && r.archived != null && r.archived > 0) {
            window.hibana && window.hibana.toast(t('db.h2.done', 'Sprint finished — {n} tasks archived').replace('{n}', faDig(r.archived)), 'ok')
          }
          // S243 (the S235 day-window seam): /finish stamps ended_at = NOW (today)
          // and /start stamps started_at = NOW (the same day) — assertSprintWindowOk
          // keeps ONE sprint per day on the timeline, so the start would 400
          // invalid_input EVERY time without the trim. The system's own recorded
          // convention for exactly this case is the create-with-dates auto-close
          // (devboard.ts: closeMs = max(newStart - 1day, sibling.started_at)) — the
          // finish arm applies the SAME trim to the just-finished sprint's band
          // edge before promoting the selected one, so both arms resolve the way
          // the modal promises. The finished sprint's archive stamps stay honest
          // (archived_at keeps the real finish instant; only the BAND edge moves).
          const nowMs = Date.now()
          const startedMs = Date.parse(active.started_at || '') || nowMs
          const trimMs = Math.max(nowMs - 86400000, startedMs + 1) // strictly after its own start (the PATCH guard)
          if (trimMs < nowMs) {
            try { await patchSprint(active.id, { ended_at: new Date(trimMs).toISOString() }) } catch { /* the band keeps the finish stamp — the start below answers honestly */ }
          }
        }
        await startSprint(selected.id) // planned + paused both promote through /start
        window.hibana && window.hibana.toast(t('db.sprintStarted', 'Sprint started'), 'ok')
        closeSprintModal()
        if (armDone) armDone()
      } catch (err) {
        // never a silent retry: surface what the server said, close, and let the
        // caller's onDone reload so any PARTIAL landing (paused but not started)
        // renders honestly.
        if (err && err.code === 'sprint_active_exists') {
          window.hibana && window.hibana.toast(t('db.h1.stale', 'Another sprint became active just now — the board reloaded to show it.'), 'err')
        } else if (err && err.code === 'invalid_input') {
          // the S235 day-window rule (a same-day-started sprint still owns today —
          // the trim above cannot move its edge before its own start). Honest and
          // specific: the current sprint landed; the selected one needs a free day.
          window.hibana && window.hibana.toast(t('db.h1.dayBlocked', '{b} could not start — the timeline keeps one sprint per day and a sprint that started today still covers it. Start it on the next free day.').replace('{b}', selected.name || ''), 'err')
        } else {
          window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
        }
        closeSprintModal()
        if (armDone) armDone()
      }
    }
    el.querySelector('[data-sm-pause-start]').onclick = () => runArm('pause')
    el.querySelector('[data-sm-finish-start]').onclick = () => runArm('finish')
    el.querySelector('[data-sm-pause-start]').focus()
  }

  // The shared start/resume flow (spec §5.2): with no active sibling it is one
  // call; with one, the H1 conflict modal resolves it. The 409 belt reads the
  // server's active_id (err.body — S243) so a sprint started in ANOTHER client
  // still resolves by id, never by a stale local guess.
  async function startSprintWithConflict(id, opts) {
    if (!id) return
    const o = opts || {}
    const pool = o.sprints || state.sprints
    const selected = pool.find((x) => x && x.id === id) || null
    if (!selected) return
    const active = pool.find((x) => x && sprintStatusOf(x) === 'active') || null
    if (active && active.id !== id) { openSprintConflict(active, selected, o); return }
    try {
      const status = sprintStatusOf(selected)
      if (status === 'paused') await resumeSprint(id)
      else await startSprint(id)
      window.hibana && window.hibana.toast(t('db.sprintStarted', 'Sprint started'), 'ok')
      if (o.onDone) o.onDone()
    } catch (err) {
      if (err && err.code === 'sprint_active_exists') {
        const activeId = err.body && err.body.active_id
        const real = pool.find((x) => x && x.id === activeId) || pool.find((x) => x && sprintStatusOf(x) === 'active') || null
        if (real && real.id !== id) openSprintConflict(real, selected, o)
        else {
          // the active sprint is unknown to this payload (created after our load)
          // surface it + reload — never guess, never retry silently
          window.hibana && window.hibana.toast(t('db.h1.stale', 'Another sprint became active just now — the board reloaded to show it.'), 'err')
          if (o.onDone) o.onDone()
        }
      } else {
        window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
      }
    }
  }

  // H3 (spec §5.5 + Screen H3): pause stays a LIGHTWEIGHT confirm (hibana.confirm,
  // the app's action convention — reversible, no counts to preview): "tasks stay
  // where they are and keep this sprint."
  async function confirmSprintPause(s, opts) {
    if (!s) return
    const o = opts || {}
    const msg = t('db.pauseConfirm', 'Pause {name}? Tasks stay where they are and keep this sprint.').split('{name}').join(s.name || '')
    const label = t('db.pauseSprint', 'Pause sprint')
    if (!await window.hibana.confirm(msg, { title: label, confirmLabel: label })) return
    try {
      await pauseSprint(s.id)
      window.hibana && window.hibana.toast(t('db.sprintPaused', 'Sprint paused'), 'ok')
      if (o.onDone) o.onDone()
    } catch {
      window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
    }
  }

  // Reopen (spec §5.4): completed → active; the one-active 409 resolves through
  // the same H1 modal (the reopen's "Start" arm reads correctly — activation).
  async function reopenSprintFlow(id, opts) {
    if (!id) return
    const o = opts || {}
    const pool = o.sprints || state.sprints
    const selected = pool.find((x) => x && x.id === id) || null
    try {
      await reopenSprint(id)
      window.hibana && window.hibana.toast(t('db.sprintReopened', 'Sprint reopened'), 'ok')
      if (o.onDone) o.onDone()
    } catch (err) {
      if (err && err.code === 'sprint_active_exists') {
        const activeId = err.body && err.body.active_id
        const real = pool.find((x) => x && x.id === activeId) || pool.find((x) => x && sprintStatusOf(x) === 'active') || null
        if (selected && real && real.id !== id) openSprintConflict(real, selected, o)
        else {
          window.hibana && window.hibana.toast(t('db.h1.stale', 'Another sprint became active just now — the board reloaded to show it.'), 'err')
          if (o.onDone) o.onDone()
        }
      } else {
        window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err')
      }
    }
  }

  // ---------------------------------------------------------------- label manager
  // S30 batch 4 (user request — "rename/merge/recolor/delete-unused tags, powered by
  // fixing B2"): a dialog listing every user tag with its LIVE usage_count. Row actions:
  // rename (Enter; a colliding name MERGES onto the existing tag), recolor (8-swatch
  // palette), merge (a select of the other tags), delete. S232 (owner: "two labels
  // that can't be deleted") — delete is now on EVERY row: a used label confirms first
  // (the count rides the message) and sends ?force=1 so the server cascades the
  // unlink. Owned here so any surface can open it; board.html's toolbar is the first.
  let labelsEl = null
  let labelsCtx = null // open-flag ({ onChanged } shape kept for renderLabels' guard)
  // The changed-callback lives OUTSIDE the close lifecycle: Esc racing an in-flight
  // action (PATCH → refresh → reload) must not cancel the board's repaint — the chips
  // would silently keep the stale color until the next manual refresh.
  let labelsOnChanged = null

  async function fetchTags() {
    // S206 part 2: same no-store rule (see the api() note) — this reloads the same
    // URL after label edits; same class, same opt-out.
    const res = await fetch('/api/tags', { cache: 'no-store' })
    if (!res.ok) throw new Error('tags failed')
    return (await res.json()).tags || []
  }

  function renderLabels(tags) {
    const el = labelsEl
    if (!el || !labelsCtx) return
    const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
    const d = document.createElement('div')
    d.className = 'db-modal-card db-labels-card'
    d.dir = lang === 'fa' ? 'rtl' : 'auto'
    d.innerHTML =
      '<div class="row spread"><h3>' + esc(t('db.labelsTitle', 'Labels')) + '</h3>' +
        '<button type="button" class="ghost" data-lbl-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>' +
      '<p class="muted small">' + esc(t('db.labelsHint', 'Rename merges onto an existing name; colors are yours to pick; deleting a used label removes it from its tasks.')) + '</p>' +
      // S211 (owner: "the labels do not have an option to delete/create new label"):
      // the dialog had rename/merge/recolor/delete-unused but NO way to CREATE a new
      // label. A create row now sits at the top of the list: color swatch (click →
      // palette) + name input + Create button (or Enter). POST /api/tags {name,color}.
      '<div class="db-label-row db-label-create">' +
        '<span class="db-label-swatch" id="lbl-create-swatch" style="background:#f6d365" title="' + esc(t('db.labelsColor', 'Recolor')) + '"></span>' +
        '<input class="db-label-name" id="lbl-create-name" placeholder="' + esc(t('db.labelsCreatePh', 'New label name…')) + '" maxlength="60" dir="auto" aria-label="' + esc(t('db.labelsName', 'Label name')) + '">' +
        '<span class="db-label-actions">' +
          '<button type="button" class="ghost small" id="lbl-create-color" title="' + esc(t('db.labelsColor', 'Recolor')) + '" aria-label="' + esc(t('db.labelsColor', 'Recolor')) + '">🎨</button>' +
        '</span>' +
        '<button type="button" class="btn small" id="lbl-create-btn">' + esc(t('db.labelsCreate', 'Create')) + '</button>' +
        '<span class="pd-tag-colors db-label-palette" id="lbl-create-palette" hidden>' +
          ['#8AB8F0', '#E8B27D', '#E59AA5', '#8FD3A9', '#B3A5D6', '#7CC7C1', '#F2D58A', '#C9CDD2'].map(function (c) {
            return '<button type="button" class="pd-swatch" data-lbl-create-pick data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>'
          }).join('') +
        '</span>' +
      '</div>' +
      '<div class="db-labels-list">' + (tags.length ? tags.map(function (tg) {
        return '<div class="db-label-row" data-tag-id="' + esc(tg.id) + '">' +
          '<span class="db-label-swatch" style="background:' + esc(tg.color) + '"></span>' +
          '<input class="db-label-name" value="' + esc(tg.name) + '" maxlength="60" dir="auto" aria-label="' + esc(t('db.labelsName', 'Label name')) + '">' +
          '<span class="muted small db-label-usage">' + esc(t('db.usedTimes', 'used {n}×').split('{n}').join(String(tg.usage_count == null ? 0 : tg.usage_count))) + '</span>' +
          '<span class="db-label-actions">' +
            '<button type="button" class="ghost small" data-lbl-color title="' + esc(t('db.labelsColor', 'Recolor')) + '" aria-label="' + esc(t('db.labelsColor', 'Recolor')) + '">🎨</button>' +
            '<select class="db-label-merge" data-lbl-merge aria-label="' + esc(t('db.labelsMerge', 'Merge into…')) + '">' +
              '<option value="">' + esc(t('db.labelsMergePh', 'merge into…')) + '</option>' +
              tags.filter(function (o) { return o.id !== tg.id }).map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.name) + '</option>' }).join('') +
            '</select>' +
            // S232: the ✕ rides EVERY row — a used label deletes through the confirm
            // dialog (the count is in the message); an unused one deletes at once.
            '<button type="button" class="ghost small danger" data-lbl-del title="' + esc(t('db.labelsDel', 'Delete label')) + '" aria-label="' + esc(t('db.labelsDel', 'Delete label')) + '">✕</button>' +
          '</span>' +
          '<span class="pd-tag-colors db-label-palette" hidden>' +
            ['#8AB8F0', '#E8B27D', '#E59AA5', '#8FD3A9', '#B3A5D6', '#7CC7C1', '#F2D58A', '#C9CDD2'].map(function (c) {
              return '<button type="button" class="pd-swatch" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>'
            }).join('') +
          '</span>' +
        '</div>'
      }).join('') : '<p class="muted">' + esc(t('db.labelsEmpty', 'No labels yet — add one from a task.')) + '</p>') + '</div>'
    el.innerHTML = ''
    el.appendChild(d)

    const close = function () { el.hidden = true; labelsCtx = null }
    d.querySelector('[data-lbl-close]').onclick = close
    el.onclick = function (ev) { if (ev.target === el) close() }

    // S211: the create-new-label row — color swatch (palette toggle) + name input
    // (Enter creates) + Create button. POST /api/tags {name, color} → 201 {ok,id}
    // or 409 on duplicate name (the API's INSERT OR IGNORE refuses a dupe).
    var createName = d.querySelector('#lbl-create-name')
    var createSwatch = d.querySelector('#lbl-create-swatch')
    var createPaletteBtn = d.querySelector('#lbl-create-color')
    var createPalette = d.querySelector('#lbl-create-palette')
    var createBtn = d.querySelector('#lbl-create-btn')
    var createColor = '#f6d365'
    if (createPaletteBtn) createPaletteBtn.onclick = function () { if (createPalette) createPalette.hidden = !createPalette.hidden }
    if (createSwatch) createSwatch.onclick = function () { if (createPalette) createPalette.hidden = !createPalette.hidden }
    Array.prototype.slice.call(d.querySelectorAll('[data-lbl-create-pick]')).forEach(function (sw) {
      sw.onclick = function () {
        createColor = sw.dataset.color
        if (createSwatch) createSwatch.style.background = createColor
        if (createPalette) createPalette.hidden = true
      }
    })
    async function doCreate() {
      var name = createName ? createName.value.trim() : ''
      if (!name) { createName && createName.focus(); return }
      try {
        var res = await fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, color: createColor }) })
        if (res.status === 409) { window.hibana && window.hibana.toast(t('db.labelsExists', 'A label with that name already exists'), 'err'); return }
        if (!res.ok) throw new Error('create failed')
        window.hibana && window.hibana.toast(t('db.labelsCreated', 'Label created'), 'ok')
        refresh()
      } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    }
    if (createBtn) createBtn.onclick = doCreate
    if (createName) createName.onkeydown = function (ev) {
      if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); doCreate() }
    }

    const rows = Array.prototype.slice.call(d.querySelectorAll('.db-label-row[data-tag-id]'))
    rows.forEach(function (row) {
      const id = row.dataset.tagId
      // the row's OWN tag record (the confirm message quotes the real name + count)
      const tg = tags.find(function (x) { return x.id === id }) || { name: '', usage_count: 0 }
      // rename (Enter) — a colliding name merges (the API doubles as merge)
      const nameIn = row.querySelector('.db-label-name')
      nameIn.onkeydown = async function (ev) {
        if (ev.key !== 'Enter' || ev.isComposing) return
        ev.preventDefault()
        const name = nameIn.value.trim()
        if (!name) return
        try {
          const res = await fetch('/api/tags/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
          if (!res.ok) throw new Error('rename failed')
          const body = await res.json()
          if (body.merged_into) window.hibana && window.hibana.toast(t('db.labelsMerged', 'Merged into the existing label'))
          else window.hibana && window.hibana.toast(t('sparks.saved', 'Saved'), 'ok')
          refresh()
        } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
      // recolor palette toggle + pick
      row.querySelector('[data-lbl-color]').onclick = function () {
        const pal = row.querySelector('.db-label-palette')
        if (pal) pal.hidden = !pal.hidden
      }
      Array.prototype.slice.call(row.querySelectorAll('.db-label-palette [data-color]')).forEach(function (sw) {
        sw.onclick = async function () {
          try {
            const res = await fetch('/api/tags/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ color: sw.dataset.color }) })
            if (!res.ok) throw new Error('color failed')
            const swatch = row.querySelector('.db-label-swatch')
            if (swatch) swatch.style.background = sw.dataset.color
            const pal = row.querySelector('.db-label-palette')
            if (pal) pal.hidden = true
            window.hibana && window.hibana.toast(t('sparks.saved', 'Saved'), 'ok')
            refresh() // repaints the list + fires onChanged (the board reloads its chips)
          } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
        }
      })
      // merge select
      const mergeSel = row.querySelector('[data-lbl-merge]')
      mergeSel.onchange = async function () {
        const into = mergeSel.value
        if (!into) return
        const targetName = mergeSel.options[mergeSel.selectedIndex].textContent
        const msg = t('db.labelsMergeConfirm', 'Merge this label into {name}? Every link moves.').split('{name}').join(targetName)
        if (!await window.hibana.confirm(msg, { title: 'Merge label', confirmLabel: 'Merge' })) { mergeSel.value = ''; return }
        try {
          const res = await fetch('/api/tags/' + id + '/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ into: into }) })
          if (!res.ok) throw new Error('merge failed')
          window.hibana && window.hibana.toast(t('db.labelsMerged', 'Merged into the existing label'))
          refresh()
        } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
      // delete (S232) — every row carries the ✕. A USED label confirms first (the
      // count is in the message; danger grammar) and rides ?force=1 so the server
      // cascades the unlink from its tasks; an unused one deletes at once, as ever.
      // A 409 back means the tag came back into use between load and click — surface
      // it instead of the generic save-failed toast.
      const delBtn = row.querySelector('[data-lbl-del]')
      if (delBtn) delBtn.onclick = async function () {
        const used = (tg.usage_count == null ? 0 : tg.usage_count) > 0
        if (used) {
          const msg = t('db.labelsDelConfirm', 'Delete "{name}"? It is used by {n} tasks — the label will be removed from those tasks.')
            .split('{name}').join(tg.name)
            .split('{n}').join(String(tg.usage_count == null ? 0 : tg.usage_count))
          if (!await window.hibana.confirm(msg, { title: t('db.labelsDelTitle', 'Delete label'), danger: true })) return
        }
        try {
          const res = await fetch('/api/tags/' + id + (used ? '?force=1' : ''), { method: 'DELETE' })
          if (res.status === 409) { window.hibana && window.hibana.toast(t('db.labelsInUse', 'That label is in use — reopen Labels and try again'), 'err'); return }
          if (!res.ok) throw new Error('delete failed')
          window.hibana && window.hibana.toast(t('db.labelsDeleted', 'Label deleted'), 'ok')
          refresh()
        } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
    })
  }

  async function refresh() {
    // labelsOnChanged is close-proof (see its declaration) — the board reload fires
    // even when Esc beat the async chain.
    const cb = labelsOnChanged
    try {
      const tags = await fetchTags()
      renderLabels(tags)
    } catch (e) { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't load"), 'err') }
    if (cb) cb()
  }

  async function openLabels(opts) {
    labelsCtx = { open: true }
    labelsOnChanged = (opts && opts.onChanged) || null
    if (!labelsEl) {
      labelsEl = document.createElement('div')
      labelsEl.className = 'db-modal'
      labelsEl.setAttribute('role', 'dialog')
      labelsEl.setAttribute('aria-modal', 'true')
      labelsEl.hidden = true
      document.body.appendChild(labelsEl)
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && labelsEl && !labelsEl.hidden) { labelsEl.hidden = true; labelsCtx = null } })
    }
    labelsEl.hidden = false
    await refresh()
  }

  window.HibanaBoard = {
    state, load, api, t, esc, faDig,
    STATUSES, PRIORITIES, PRIO_CYCLE, cyclePriority, mdTaskLine, statusLabel, prioLabel, openLabels,
    DAY, dayIdx, todayIdx, calOf, monthLabel, dayLabel, fullLabel, weekdayIdx,
    findTask, findCategory, findSprint, tagById,
    createTask, patchTask, deleteTask, reorderTasks, addTaskTag, removeTaskTag,
    createCategory, patchCategory, deleteCategory, reorderCategories,
    createSprint, startSprint, patchSprint, renameSprint, finishSprint, reopenSprint, deleteSprint,
    // S243 (spec pack Phase 4): pause/resume wrappers + the lifecycle UI stack —
    // statusOf/laneCounts helpers, the H2 finish + Screen-I delete confirmations,
    // the H1 one-active conflict modal + the shared start/resume/reopen flows,
    // and the H3 lightweight pause confirm. Exported so sprint.html, board.html
    // and project.html share ONE implementation (spec §18 — no forking).
    pauseSprint, resumeSprint,
    sprintGlyph, sprintCompleted, sprintStatusOf, sprintLaneCounts,
    openSprintFinish, openSprintDelete, openSprintConflict,
    startSprintWithConflict, confirmSprintPause, reopenSprintFlow,
    openEditor, openTaskShots, // S208: the pinned-pictures dialog (the card badge)
  }
})()
