// Hibana dev-board shared client (0029 — user design 2026-08-29).
// One task pool per project rendered two ways: the 4-column progress board
// (board.html) and the sprint timeline (sprint.html). This module owns the DATA
// and the task editor modal so both surfaces stay in perfect sync; each page
// only renders its own view of window.HibanaBoard.state.
/* global window, document, fetch */
(function () {
  'use strict'

  const api = (path, opts) => fetch(path, opts).then((r) => {
    if (!r.ok) {
      // Carry the HTTP status on the thrown error so pages can tell a DELETED
      // project (404 — retry will never help) from a transient failure (retry does).
      const err = new Error(r.status + ' ' + path)
      err.status = r.status
      throw err
    }
    return r.status === 204 ? null : r.json()
  })

  const t = (key, fallback) => (window.hibanaI18n && window.hibanaI18n.t(key)) || fallback
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  // 0031: 'bug' closes the loop — a red Problems column on both boards.
  // Batch (p) 2026-09-06 terminology: planned = برنامه آتی (Upcoming Plan),
  // bug = مشکلات (Problems) — user renamed both terms everywhere.
  // Batch (s) 2026-09-08 position (Ali's 13-item list ⑩): مشکلات sits BETWEEN
  // «ایده‌های جدید» and «برنامه آتی» — second in reading order, not parked at the end.
  const STATUSES = ['idea', 'bug', 'planned', 'in_progress', 'done']
  const PRIORITIES = ['low', 'medium', 'high', 'urgent']

  const statusLabel = (s) => ({
    idea: t('db.st.idea', 'New Ideas'),
    planned: t('db.st.planned', 'Upcoming Plan'),
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

  const createTask = (body) => api('/api/projects/' + state.projectId + '/devtasks', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const patchTask = (id, body) => api('/api/devtasks/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const deleteTask = (id) => api('/api/devtasks/' + id, { method: 'DELETE' })
  const reorderTasks = (ids) => api('/api/projects/' + state.projectId + '/devtasks/reorder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })
  const addTaskTag = (id, name, color) => api('/api/devtasks/' + id + '/tags', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }),
  })
  const removeTaskTag = (id, tagId) => api('/api/devtasks/' + id + '/tags/' + tagId, { method: 'DELETE' })

  const createCategory = (name, color) => api('/api/projects/' + state.projectId + '/categories', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, color }),
  })
  const patchCategory = (id, body) => api('/api/categories/' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const deleteCategory = (id) => api('/api/categories/' + id, { method: 'DELETE' })

  const createSprint = (name) => api('/api/projects/' + state.projectId + '/sprints', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(name ? { name } : {}),
  })
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
  const reorderCategories = (ids) => api('/api/projects/' + state.projectId + '/categories/reorder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  })

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
      if (e.target === modalEl) closeModal(false)
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modalEl.hidden) closeModal(false)
    })
    return modalEl
  }

  function openEditor(taskId, opts) {
    modalCtx = { taskId: taskId || null, onSaved: (opts && opts.onSaved) || null, defaults: (opts && opts.defaults) || {} }
    const task = taskId ? findTask(taskId) : null
    modalCtx.draft = task
      ? { title: task.title, status: task.status, priority: task.priority, category_id: task.category_id, sprint_id: task.sprint_id, tags: (task.tags || []).slice() }
      : { title: '', status: modalCtx.defaults.status || 'idea', priority: 'medium', category_id: null, sprint_id: null, tags: [] }
    renderModal()
    buildModal().hidden = false
    const focus = modalEl.querySelector('input[name=title]')
    if (focus) { focus.focus(); focus.select() }
  }

  function closeModal(saved) {
    if (modalEl) modalEl.hidden = true
    const cb = modalCtx && modalCtx.onSaved
    modalCtx = null
    if (saved && cb) cb()
  }

  function renderModal() {
    const el = buildModal()
    const d = modalCtx.draft
    const isNew = !modalCtx.taskId
    const cats = state.categories
    const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
    el.innerHTML =
      '<div class="db-modal-card" dir="auto">' +
        '<div class="row spread"><h3>' + (isNew ? esc(t('db.newTask', 'New task')) : esc(t('db.editTask', 'Edit task'))) + '</h3>' +
        '<button type="button" class="ghost" data-db-close aria-label="' + esc(t('common.close', 'Close')) + '">✕</button></div>' +
        '<label class="db-field"><span>' + esc(t('db.title', 'Title')) + '</span>' +
          '<input name="title" maxlength="300" dir="auto" value="' + esc(d.title) + '" placeholder="' + esc(t('db.titlePh', 'What needs to be built?')) + '"></label>' +
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
              '<option value="__new">' + '＋ ' + esc(t('db.newCategory', 'New category…')) + '</option>' +
            '</select></label>' +
          '<label class="db-field"><span>' + esc(t('db.sprint', 'Sprint')) + '</span>' +
            '<select data-db-sprint><option value="">' + esc(t('db.noSprint', 'No sprint')) + '</option>' +
              state.sprints.map((s) => '<option value="' + esc(s.id) + '" ' + (d.sprint_id === s.id ? 'selected' : '') + '>' + esc(s.name) + (s.is_draft ? ' — ' + esc(t('db.draftTag', 'draft')) : '') + '</option>').join('') +
              '<option value="__new">' + '＋ ' + esc(t('db.newSprint', 'New sprint')) + '</option>' +
            '</select></label>' +
        '</div>' +
        '<div class="db-cat-new" data-db-cat-new hidden>' +
          '<input data-db-cat-name maxlength="80" dir="auto" placeholder="' + esc(t('db.categoryName', 'Category name (Feature Development…)')) + '">' +
          '<div class="pd-tag-colors">' + ['#8AB8F0', '#E8B27D', '#E59AA5', '#8FD3A9', '#B3A5D6', '#7CC7C1', '#F2D58A', '#C9CDD2'].map((c, i) =>
            '<label class="pd-swatch"><input type="radio" name="dbcatcolor" value="' + c + '" ' + (i === 0 ? 'checked' : '') + '><span style="background:' + c + '"></span></label>').join('') + '</div>' +
        '</div>' +
        (isNew ? '' :
        '<div class="db-field"><span>' + esc(t('db.tags', 'Tags')) + '</span>' +
          '<div class="db-tags-row" data-db-tags>' +
            d.tags.map((id) => { const tg = tagById(id); return tg ? '<span class="chip db-tag" data-tag="' + esc(id) + '" style="background:' + esc(tg.color) + '33"><span style="color:' + esc(tg.color) + '">●</span> ' + esc(tg.name) + ' <button type="button" class="ghost danger" data-untag="' + esc(id) + '" aria-label="✕">✕</button></span>' : '' }).join('') +
            '<input data-db-tag-in maxlength="60" dir="auto" placeholder="' + esc(t('db.addTag', 'Add tag + Enter')) + '">' +
          '</div></div>') +
        '<div class="row spread" style="margin-block-start:1rem">' +
          (isNew ? '' : '<button type="button" class="btn ghost danger" data-db-del>' + esc(t('common.delete', 'Delete')) + '</button>') +
          '<div class="row"><button type="button" class="ghost" data-db-close>' + esc(t('common.cancel', 'Cancel')) + '</button>' +
          '<button type="button" class="btn" data-db-save>' + esc(isNew ? t('common.add', 'Add') : t('common.save', 'Save')) + '</button></div>' +
        '</div>' +
      '</div>'

    el.querySelectorAll('[data-db-close]').forEach((b) => { b.onclick = () => closeModal(false) })
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
    sprintSel.onchange = () => {
      modalCtx.draft.sprint_id = sprintSel.value === '__new' ? '__new' : (sprintSel.value || null)
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
          modalCtx.draft.tags = modalCtx.draft.tags.filter((x) => x !== b.dataset.untag)
          renderModal()
        } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
    })
    const delBtn = el.querySelector('[data-db-del]')
    if (delBtn) {
      delBtn.onclick = async () => {
        if (!window.confirm(t('db.delConfirm', 'Delete this task?'))) return
        try {
          await deleteTask(modalCtx.taskId)
          window.hibana && window.hibana.toast(t('db.taskDeleted', 'Task deleted'))
          closeModal(true)
        } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
      }
    }
    el.querySelector('[data-db-save]').onclick = async () => {
      const titleIn = el.querySelector('input[name=title]')
      const title = titleIn.value.trim()
      if (!title) { titleIn.focus(); return }
      try {
        let categoryId = modalCtx.draft.category_id
        if (categoryId === '__pending') {
          const cname = el.querySelector('[data-db-cat-name]').value.trim()
          if (!cname) { el.querySelector('[data-db-cat-name]').focus(); return }
          const ccolor = el.querySelector('input[name=dbcatcolor]:checked')?.value
          const r = await createCategory(cname, ccolor)
          categoryId = r.id
        }
        let sprintId = modalCtx.draft.sprint_id
        if (sprintId === '__new') {
          const r = await createSprint()
          sprintId = r.id
        }
        if (isNew) {
          await createTask({ title, status: modalCtx.draft.status, priority: modalCtx.draft.priority, category_id: categoryId || undefined, sprint_id: sprintId || undefined })
          window.hibana && window.hibana.toast(t('db.taskAdded', 'Task added'))
        } else {
          const body = { title, status: modalCtx.draft.status, priority: modalCtx.draft.priority, category_id: categoryId || null, sprint_id: sprintId || null }
          await patchTask(modalCtx.taskId, body)
          window.hibana && window.hibana.toast(t('sparks.saved', 'Saved'))
        }
        closeModal(true)
      } catch { window.hibana && window.hibana.toast(t('sparks.saveFailed', "Couldn't save"), 'err') }
    }
    // Enter on the title saves
    el.querySelector('input[name=title]').onkeydown = (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); el.querySelector('[data-db-save]').click() }
    }
  }

  window.HibanaBoard = {
    state, load, api, t, esc, faDig,
    STATUSES, PRIORITIES, statusLabel, prioLabel,
    DAY, dayIdx, todayIdx, calOf, monthLabel, dayLabel, fullLabel, weekdayIdx,
    findTask, findCategory, findSprint, tagById,
    createTask, patchTask, deleteTask, reorderTasks, addTaskTag, removeTaskTag,
    createCategory, patchCategory, deleteCategory, reorderCategories,
    createSprint, startSprint, patchSprint, renameSprint, finishSprint, reopenSprint, deleteSprint,
    openEditor,
  }
})()
