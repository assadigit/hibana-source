    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'project',
      mount(ctx) {
        // The static page carries the id in the query (no build step — inline replace).
        const id = new URLSearchParams(location.search).get('id')
        // Guarded lookup — hibanaI18n.t returns the KEY itself when missing; never leak it.
        const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
        const body = document.getElementById('project-body')
        if (body && id) body.setAttribute('hx-get', `/api/projects/${id}`)

        // R4.2: Record this project visit for the command palette's "Recent" section.
        // Fires after the htmx swap renders the project HTML (title lives in the <h1>).
        if (id) {
          ctx.on('htmx:afterSwap', (e) => {
            if (e.target?.id !== 'project-body' && e.detail?.target?.id !== 'project-body') return
            const h1 = document.querySelector('#project-body header h1')
            const status = document.querySelector('#project-body [data-status]')?.dataset.status
            if (h1 && h1.textContent) {
              window.hibanaCmdK?.recordRecent?.(id, h1.textContent.trim(), status || '')
            }
          })
          // A deleted/missing project 404s — htmx would just leave the skeleton spinning
          // forever. Say what happened and offer the way back (same pattern as board/sprint).
          ctx.on('htmx:responseError', (e) => {
            if (e.target?.id !== 'project-body') return
            if (e.detail?.xhr?.status !== 404) return
            const escS = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
            body.innerHTML = '<div class="card" style="padding:2rem;text-align:center">' +
              '<p style="margin:0 0 1rem">' + escS(_t('db.projectGone', "This project doesn't exist or was deleted")) + '</p>' +
              '<a class="btn small" href="/projects.html">' + escS(_t('db.backToProjects', 'Back to projects')) + '</a></div>'
          })
        }

        // Screenshot gallery upload (drag-drop/paste/file-picker — spec §4.6).
        // S35: shots upload IMMEDIATELY (no caption prompt) — each lands as an OPEN
        // problem card; the note ("what & where to work") is written on the card after.
        const upload = async (files) => {
          for (const file of files) {
            const b64 = await new Promise((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(String(r.result).split(',')[1])
              r.onerror = reject
              r.readAsDataURL(file)
            })
            const res = await fetch(`/api/projects/${id}/screenshots`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64, caption: '' }),
            })
            const toastOk = res.ok
            window.hibana?.toast(toastOk ? _t('project.shotUploaded', 'Screenshot uploaded') : _t('project.shotFailed', 'Upload failed'), toastOk ? 'info' : 'err')
            // 2026-09-05 repair: #shots carries no hx-get, so the old
            // `htmx.trigger('#shots','load')` was a no-op and fresh uploads never
            // showed. Pull the server-rendered grid fragment instead.
            if (toastOk && window.htmx) window.htmx.ajax('GET', `/api/projects/${id}/screenshots`, { target: '#shots', swap: 'innerHTML' })
          }
        }
        // 2026-09-05 repair: #shot-input renders INSIDE the htmx project fragment, so the
        // old mount-time getElementById bound nothing (the fragment hadn't loaded yet) —
        // the picker opened but no change listener existed and nothing uploaded.
        // Delegated on ctx so it survives every re-render of #project-body; value resets
        // so picking the same file twice still fires change.
        ctx.on('change', (e) => {
          if (e.target?.id !== 'shot-input') return
          const files = [...e.target.files]
          e.target.value = ''
          if (files.length) upload(files)
        })
        // S46: live "N attached" count on the task composer's screenshot picker
        // S46.3: now uploads IMMEDIATELY on pick (POST, no task_id) + renders inline
        // thumbnails in #pd-taskadd-shots-grid (each with delete ✕ + edit-note). The
        // shots stay unattached until the task is saved (then PATCHed to pin) OR the
        // modal is cancelled (then DELETEd for cleanup).
        ctx.on('change', async (e) => {
          if (e.target?.id !== 'pd-taskadd-shots') return
          const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'))
          e.target.value = ''
          if (!files.length) return
          // S46.4: show «در حال اپلود تصویر ...» during the upload
          const upl = document.getElementById('pd-taskadd-shots-uploading')
          if (upl) upl.hidden = false
          let ok = 0, fail = 0
          for (const file of files) {
            try {
              const b64 = await new Promise((resolve, reject) => {
                const r = new FileReader()
                r.onload = () => resolve(String(r.result).split(',')[1])
                r.onerror = reject
                r.readAsDataURL(file)
              })
              const upRes = await fetch('/api/projects/' + id + '/screenshots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64, caption: '' }),
              })
              if (!upRes.ok) throw new Error('status ' + upRes.status)
              const shot = await upRes.json().catch(() => ({}))
              if (shot.id) { stagedShots.push({ id: shot.id, fileName: file.name, caption: '' }); ok++ }
              else throw new Error('no id')
            } catch { fail++ }
          }
          if (upl) upl.hidden = true
          renderTaskAddShots()
          if (ok && !fail) window.hibana?.toast(_t('project.shotUploaded', 'Screenshot uploaded'), 'info')
          else if (fail && !ok) window.hibana?.toast(_t('project.shotFailed', 'Upload failed'), 'err')
          else if (fail) window.hibana?.toast(String(ok) + ' ok, ' + String(fail) + ' failed', 'err')
        })
        // S46.3: delegated handlers on the staged-shot grid — zoom / delete / edit-note
        ctx.on('click', async (e) => {
          const zoom = e.target.closest('[data-staged-zoom]')
          if (zoom) {
            const img = zoom.querySelector('img')
            if (img) openShotLightbox(img.src)
            return
          }
          const del = e.target.closest('[data-staged-del]')
          if (del) {
            const sid = del.getAttribute('data-staged-del')
            // S46.8 (owner: "make sure the photo is deleted from database not just invisible"):
            // check res.ok + toast on success/failure — the DELETE removes the DB row +
            // the KV bytes (core.ts:468). If the DELETE fails, don't remove from stagedShots.
            try {
              const r = await fetch('/api/screenshots/' + sid, { method: 'DELETE' })
              if (!r.ok) throw new Error('status ' + r.status)
              stagedShots = stagedShots.filter((s) => s.id !== sid)
              renderTaskAddShots()
              window.hibana?.toast(_t('project.shotDeleted', 'Screenshot deleted'), 'info')
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't delete"), 'err')
            }
            return
          }
          const note = e.target.closest('[data-staged-note]')
          if (note) {
            const sid = note.getAttribute('data-staged-note')
            const s = stagedShots.find((x) => x.id === sid)
            // reuse makeDialog for a small note editor
            const { dlg, body } = makeDialog(_t('project.shotNoteTitle', 'Note — what & where to work'), 'pd-tashot-title')
            const escXml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            body.innerHTML =
              '<textarea class="pd-shot-note-ta" rows="6" maxlength="1000" dir="auto" data-no-fa-digits="" placeholder="' + escXml(_t('project.shotNotePh', 'What is broken & where — the exact spot to work on…')) + '">' + escXml(s?.caption || '') + '</textarea>' +
              '<div class="pd-shot-note-actions"><button type="button" class="ghost small" data-tashot-cancel>' + _t('common.cancel', 'Cancel') + '</button><button type="button" class="btn small" data-tashot-save>' + _t('common.save', 'Save') + '</button></div>'
            const ta2 = body.querySelector('.pd-shot-note-ta')
            body.querySelector('[data-tashot-cancel]').addEventListener('click', () => dlg.close())
            body.querySelector('[data-tashot-save]').addEventListener('click', async () => {
              const cap = ta2.value.trim()
              try {
                await patchShot(sid, { caption: cap })
                if (s) s.caption = cap
                renderTaskAddShots()
                dlg.close()
              } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
            })
            dlg.showModal()
            setTimeout(() => ta2.focus(), 0)
            return
          }
        })
        ctx.on('dragover', (e) => e.preventDefault())
        ctx.on('dragenter', (e) => e.preventDefault())
        ctx.on('drop', (e) => {
          e.preventDefault()
          if (e.target.closest('#project-body')) {
            const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
            if (files.length) upload(files)
          }
        })

        // --- S35: the ARCHIVE — park an idea/project (not delete, not halted) ------
        // POST /:id/archive sets archived_state='offline': the row leaves the projects
        // list, the glance counts and the ideas shelf, and rests on /archive.html.
        // Restore flips it back ('online'). Both re-render the project fragment so the
        // head swaps between the Archive button and the archived banner honestly.
        const pdArchiveToggle = async (e) => {
          const btn = e.target.closest('[data-pd-archive],[data-pd-unarchive]')
          if (!btn) return
          e.preventDefault()
          const pid = btn.getAttribute('data-project-id') || id
          const archiving = !!btn.closest('[data-pd-archive]')
          if (archiving && !window.confirm(_t('pd.archiveConfirm', 'Park this for later? It leaves your lists but stays safe under Archive — restorable any time.'))) return
          btn.disabled = true
          try {
            const res = await fetch('/api/projects/' + pid + (archiving ? '/archive' : '/unarchive'), { method: 'POST' })
            if (!res.ok) throw new Error('status ' + res.status)
            window.hibana?.toast(archiving
              ? _t('pd.archived', 'Archived — find it under Archive')
              : _t('pd.unarchived', 'Restored from archive'), 'info')
            if (window.htmx) window.htmx.ajax('GET', '/api/projects/' + pid, { target: '#project-body', swap: 'innerHTML' })
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            btn.disabled = false
          }
        }
        ctx.on('click', pdArchiveToggle)

        // --- S35: the screenshot PROBLEM CARDS -------------------------------------
        // Each shot = a broken-UI/UX report: [image] + note + open/fixed. Delegated on
        // ctx (the grid re-renders after every change). Interactions: zoom (lightbox
        // overlay), note edit (the caption becomes a textarea + save/cancel), resolve
        // toggle, delete (confirm). Every mutation PATCHes then re-pulls the fragment.
        const shotsRefresh = () => { if (window.htmx) window.htmx.ajax('GET', `/api/projects/${id}/screenshots`, { target: '#shots', swap: 'innerHTML' }) }
        let shotLightbox = null
        const closeShotLightbox = () => { if (shotLightbox) { shotLightbox.remove(); shotLightbox = null; document.body.style.overflow = '' } }
        const openShotLightbox = (src) => {
          closeShotLightbox()
          shotLightbox = document.createElement('div')
          shotLightbox.className = 'shot-lightbox'
          shotLightbox.setAttribute('role', 'dialog')
          shotLightbox.setAttribute('aria-label', _t('project.shotZoom', 'Screenshot'))
          shotLightbox.innerHTML = '<img src="' + src + '" alt="' + _t('project.shotZoom', 'Screenshot') + '">'
          shotLightbox.addEventListener('click', closeShotLightbox)
          document.body.appendChild(shotLightbox)
          document.body.style.overflow = 'hidden'
        }
        ctx.on('keydown', (e) => { if (e.key === 'Escape' && shotLightbox) closeShotLightbox() })

        const shotNoteForm = (figure) => {
          const noteEl = figure.querySelector('.shot-note')
          if (!noteEl) return
          const current = figure.dataset.note || noteEl.textContent.trim() || ''
          const isPlaceholder = !!noteEl.querySelector('.shot-note-empty')
          const shotId = figure.dataset.shot
          // S46 (user request 2026-09-14): the note editor is now a MODAL (was a tiny
          // 2-row inline textarea — unusable for a real "what & where" note). Reuses
          // makeDialog (the same shell as the pin picker). Also adds a "create bug/idea
          // from this screenshot" path: the note text becomes a new dev_task title
          // (status bug|idea) AND the screenshot is pinned to it via the 0054
          // screenshots.task_id link — so it lands in the project progress box (مشکلات
          // or ایده‌های جدید) with a 📌 badge + proof.
          const { dlg, body } = makeDialog(_t('project.shotNoteTitle', 'Note — what & where to work'), 'pd-shotnote-title')
          const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          body.innerHTML =
            '<textarea class="pd-shot-note-ta" rows="6" maxlength="1000" dir="auto" data-no-fa-digits="" placeholder="' + escXml(_t('project.shotNotePh', 'What is broken & where — the exact spot to work on…')) + '">' + (isPlaceholder ? '' : escXml(current)) + '</textarea>' +
            '<div class="pd-shot-note-actions">' +
              '<button type="button" class="ghost small" data-shot-note-cancel>' + escXml(_t('common.cancel', 'Cancel')) + '</button>' +
              '<button type="button" class="btn small" data-shot-note-save>' + escXml(_t('common.save', 'Save')) + '</button>' +
            '</div>' +
            '<div class="pd-shot-note-create">' +
              '<span class="muted small">' + escXml(_t('project.shotNoteCreateHint', 'Turn this into a tracked item:')) + '</span>' +
              '<span class="pd-shot-note-create-btns">' +
                '<button type="button" class="ghost small" data-shot-note-create="bug">' + escXml(_t('project.shotNoteCreateBug', 'Create problem')) + '</button>' +
                '<button type="button" class="ghost small" data-shot-note-create="idea">' + escXml(_t('project.shotNoteCreateIdea', 'Create idea')) + '</button>' +
              '</span>' +
            '</div>'
          const ta = body.querySelector('.pd-shot-note-ta')
          const saveNote = async () => {
            try {
              const res = await fetch('/api/screenshots/' + shotId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ caption: ta.value.trim() }),
              })
              if (!res.ok) throw new Error('status ' + res.status)
              figure.dataset.note = ta.value.trim()
              dlg.close()
              shotsRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          }
          const createFromShot = async (status) => {
            const title = ta.value.trim()
            if (!title) { window.hibana?.toast(_t('project.shotNoteNeedText', 'Write what & where first'), 'err'); ta.focus(); return }
            try {
              // 1. save the caption first (the screenshot carries the note regardless)
              await patchShot(shotId, { caption: title })
              // 2. create the dev_task (bug|idea) with the note as its title; bugs default
              //    to high priority (a UI/UX problem worth tracking), ideas to medium
              const res = await fetch('/api/projects/' + id + '/devtasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, status, priority: status === 'bug' ? 'high' : 'medium', tags: [] }),
              })
              if (!res.ok) throw new Error('add failed')
              const data = await res.json()
              // 3. pin THIS screenshot to the new task (0054 screenshots.task_id)
              await patchShot(shotId, { taskId: data.id })
              window.hibana?.toast(_t(status === 'bug' ? 'project.shotBugCreated' : 'project.shotIdeaCreated', status === 'bug' ? 'Problem added' : 'Idea added'), 'info')
              dlg.close()
              bodyRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          }
          body.querySelector('[data-shot-note-cancel]').addEventListener('click', () => dlg.close())
          body.querySelector('[data-shot-note-save]').addEventListener('click', saveNote)
          body.querySelectorAll('[data-shot-note-create]').forEach((b) => {
            b.addEventListener('click', () => createFromShot(b.dataset.shotNoteCreate))
          })
          dlg.showModal()
          setTimeout(() => ta.focus(), 0)
        }

        // --- S39: STICK a shot to a progress-box item (the user's exact ask: "a UI bug
        // screenshot, sticky to Problems box in project progress, so there is note +
        // picture proof, and how it's categorized in the project"). PATCH
        // /api/screenshots/:id {taskId} (0054) — the pin line on the card + the pin
        // badge on the task chip render server-side; every mutation re-renders the
        // whole #project-body so BOTH sides (shots grid + board badges) stay true. ---
        const bodyRefresh = () => { if (window.htmx) window.htmx.ajax('GET', '/api/projects/' + id, { target: '#project-body', swap: 'innerHTML' }) }
        const patchShot = async (shotId, payload) => {
          const res = await fetch('/api/screenshots/' + shotId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) throw new Error('status ' + res.status)
        }
        // Box labels: lockstep with the server COLS map (detail-helpers.ts) — the five
        // boxes in the SAME order the board above shows them.
        const pinBoxLabel = (k) => {
          const map = { idea: ['New Ideas', 'ایده‌های جدید'], bug: ['Problems', 'مشکلات'], planned: ['Upcoming Plan', 'برنامه آتی'], in_progress: ['In Progress', 'در حال انجام'], done: ['Done', 'انجام‌شده'] }
          const p = map[k] || map.idea
          return document.documentElement.lang === 'fa' ? p[1] : p[0]
        }
        const PIN_BOX_ORDER = ['idea', 'bug', 'planned', 'in_progress', 'done']
        const makeDialog = (title, labelId) => {
          const dlg = document.createElement('dialog')
          dlg.className = 'dialog pd-pin-modal'
          if (labelId) dlg.setAttribute('aria-labelledby', labelId)
          dlg.innerHTML = '<div class="modal pd-pin-inner">' +
            '<div class="row spread pd-pin-head"><h3 id="' + (labelId || '') + '"></h3>' +
            '<button type="button" class="ghost" data-pin-close aria-label="' + _t('common.close', 'Close') + '">✕</button></div>' +
            '<div class="pd-pin-body"></div></div>'
          dlg.querySelector('h3').textContent = title
          document.body.appendChild(dlg)
          dlg.querySelector('[data-pin-close]').addEventListener('click', () => dlg.close())
          // self-cleaning: closed dialogs leave the DOM (no id duplication, no pile-up
          // across repeated picker opens)
          dlg.addEventListener('close', () => dlg.remove())
          return { dlg, body: dlg.querySelector('.pd-pin-body') }
        }
        const shotPinPicker = async (figure) => {
          const shotId = figure.dataset.shot
          const current = figure.dataset.task || ''
          // fresh task truth — tasks move between boxes while the page sits open
          let devTasks = []
          try {
            const res = await fetch('/api/projects/' + id)
            if (res.ok) {
              const data = await res.json()
              devTasks = (data.project ? data.project.devTasks : data.devTasks) || []
            }
          } catch { /* offline — the picker still opens with the DOM-only truth */ }
          for (const wrap of document.querySelectorAll('.pd-task-wrap')) {
            if (wrap.dataset.pdTask && !devTasks.some((t) => t.id === wrap.dataset.pdTask)) {
              const title = wrap.querySelector('.pd-task-title')
              devTasks.push({ id: wrap.dataset.pdTask, title: title ? title.textContent : '', status: wrap.dataset.pdStatus })
            }
          }
          const { dlg, body } = makeDialog(_t('project.shotPinPickerTitle', 'Stick this picture to a progress-box item'), 'pd-pin-title')
          if (!devTasks.length) {
            body.innerHTML = '<p class="muted">' + _t('project.shotPinNone', 'No tasks yet — add tasks in the progress boxes first.') + '</p>'
            dlg.showModal()
            return
          }
          const clamp = (s) => (s.length > 90 ? s.slice(0, 87) + '…' : s)
          const row = (t) => '<button type="button" class="pd-pin-row" dir="auto" data-pin-task="' + t.id + '"' + (t.id === current ? ' aria-current="true"' : '') + '>' +
            '<span class="chip pd-pin-box pd-pin-box-' + t.status + '">' + pinBoxLabel(t.status) + '</span>' +
            '<span class="pd-pin-title">' + clamp(String(t.title || '').replace(/\s+/g, ' ')) + '</span>' +
            (t.id === current ? ' <span class="pd-pin-cur">✓</span>' : '') +
            '</button>'
          const groups = () => PIN_BOX_ORDER
            .map((k) => {
              const items = devTasks.filter((t) => t.status === k)
              if (!items.length) return ''
              return '<div class="pd-pin-group"><span class="muted small pd-pin-grouplabel">' + pinBoxLabel(k) + '</span>' + items.map(row).join('') + '</div>'
            })
            .join('')
          body.innerHTML =
            (current ? '<button type="button" class="pd-pin-row pd-pin-unrow" data-pin-task=""><span class="chip pd-pin-box">✕</span><span class="pd-pin-title">' + _t('project.shotUnpin', 'Unpin — keep the picture, just detach it') + '</span></button>' : '') +
            '<input type="search" class="pd-pin-search" dir="auto" placeholder="' + _t('project.shotPinSearch', 'Search tasks…') + '" aria-label="' + _t('project.shotPinSearch', 'Search tasks…') + '">' +
            '<div class="pd-pin-list">' + groups() + '</div>'
          const search = body.querySelector('.pd-pin-search')
          search.addEventListener('input', () => {
            const q = search.value.trim().toLowerCase()
            body.querySelectorAll('.pd-pin-row').forEach((r) => {
              r.hidden = q && !r.textContent.toLowerCase().includes(q)
            })
          })
          dlg.showModal()
          search.focus()
          dlg.addEventListener('click', async (ev) => {
            const btn = ev.target.closest('[data-pin-task]')
            if (!btn) return
            const target = btn.getAttribute('data-pin-task')
            try {
              await patchShot(shotId, target ? { taskId: target } : { taskId: null })
              window.hibana?.toast(target ? _t('project.shotPinned', 'Pinned') : _t('project.shotUnpinned', 'Unpinned'), 'info')
              dlg.close()
              bodyRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          })
        }
        const taskShotsDialog = async (taskId) => {
          let shots = []
          try {
            const res = await fetch('/api/projects/' + id + '/screenshots')
            if (res.ok) shots = ((await res.json()).screenshots) || []
          } catch { /* offline — the empty dialog explains itself */ }
          const pinned = shots.filter((s) => s.task_id === taskId)
          const { dlg, body } = makeDialog(_t('project.taskShotsTitle', 'Pinned pictures'), 'pd-tshots-title')
          if (!pinned.length) {
            body.innerHTML = '<p class="muted">' + _t('project.shotsNone', 'No pictures pinned to this item yet.') + '</p>'
            dlg.showModal()
            return
          }
          body.innerHTML = '<div class="pd-tshots-grid">' + pinned.map((s) =>
            '<figure class="shot shot-card' + (s.resolved ? ' is-fixed' : '') + '" data-shot="' + s.id + '">' +
            '<button type="button" class="shot-img-btn" data-tshots-zoom="' + s.id + '"><img src="/api/media/screenshots/' + s.id + '/file" alt="" loading="lazy"></button>' +
            '<figcaption class="shot-body"><p class="shot-note muted small" dir="auto">' + (s.caption ? String(s.caption).replace(/[&<>]/g, (c2) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c2]) : '') + '</p>' +
            '<div class="row spread shot-actions"><span class="shot-state' + (s.resolved ? ' is-fixed' : '') + '">' + (s.resolved ? '✓ ' + _t('project.shotFixedLabel', 'fixed') : _t('project.shotOpenLabel', 'open problem')) + '</span>' +
            '<button type="button" class="ghost small danger" data-tshots-unpin="' + s.id + '" title="' + _t('project.shotUnpin', 'Unpin') + '">✕</button></div></figcaption></figure>',
          ).join('') + '</div>'
          dlg.showModal()
          dlg.addEventListener('click', async (ev) => {
            const zoomBtn = ev.target.closest('[data-tshots-zoom]')
            if (zoomBtn) {
              // stopPropagation: without it this click keeps bubbling to the document
              // handler, whose trailing "click outside the lightbox closes it" check
              // would kill the lightbox in the SAME event that opened it. And the
              // dialog closes FIRST — a modal <dialog> sits in the top layer ABOVE any
              // z-index, so a lightbox opened behind it would be invisible.
              ev.stopPropagation()
              const img = zoomBtn.querySelector('img')
              if (img) { dlg.close(); openShotLightbox(img.src) }
              return
            }
            const un = ev.target.closest('[data-tshots-unpin]')
            if (!un) return
            try {
              await patchShot(un.getAttribute('data-tshots-unpin'), { taskId: null })
              window.hibana?.toast(_t('project.shotUnpinned', 'Unpinned'), 'info')
              dlg.close()
              bodyRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          })
        }

        ctx.on('click', async (e) => {
          const zoom = e.target.closest('[data-shot-zoom]')
          if (zoom) {
            const img = zoom.querySelector('img')
            if (img) openShotLightbox(img.src)
            return
          }
          // S39: the note AREA itself is the edit trigger (role=button, tabindex=0 — the
          // tiny pencil alone was undiscoverable; the owner read it as "you can't add a
          // note"). Checked BEFORE the note button so both paths work.
          const noteArea = e.target.closest('[data-shot-note-edit]')
          if (noteArea) { shotNoteForm(noteArea.closest('.shot-card')); return }
          const noteBtn = e.target.closest('[data-shot-note]')
          if (noteBtn) { shotNoteForm(noteBtn.closest('.shot-card')); return }
          const pinBtn = e.target.closest('[data-shot-pin]')
          if (pinBtn) { const f = pinBtn.closest('.shot-card'); if (f) shotPinPicker(f); return }
          const unpin = e.target.closest('[data-shot-unpin]')
          if (unpin) {
            try {
              await patchShot(unpin.getAttribute('data-shot-unpin'), { taskId: null })
              window.hibana?.toast(_t('project.shotUnpinned', 'Unpinned'), 'info')
              bodyRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
            return
          }
          const taskShots = e.target.closest('[data-pd-shots]')
          if (taskShots) { e.preventDefault(); taskShotsDialog(taskShots.getAttribute('data-pd-shots')); return }
          const toggle = e.target.closest('[data-shot-toggle]')
          if (toggle) {
            const figure = toggle.closest('.shot-card')
            if (!figure) return
            const next = figure.dataset.resolved === '1' ? 0 : 1
            try {
              const res = await fetch('/api/screenshots/' + figure.dataset.shot, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolved: next }),
              })
              if (!res.ok) throw new Error('status ' + res.status)
              window.hibana?.toast(next ? _t('project.shotFixed', 'Marked fixed') : _t('project.shotReopened', 'Back to open'), 'info')
              shotsRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
            return
          }
          const del = e.target.closest('[data-shot-del]')
          if (del) {
            if (!window.confirm(_t('project.shotDelConfirm', 'Delete this screenshot?'))) return
            try {
              const res = await fetch('/api/screenshots/' + del.getAttribute('data-shot-del'), { method: 'DELETE' })
              if (!res.ok) throw new Error('status ' + res.status)
              shotsRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
            return
          }
          if (shotLightbox && !e.target.closest('.shot-lightbox img')) closeShotLightbox()
        })
        // keyboard parity for the click-to-edit note (role="button" needs Enter/Space)
        ctx.on('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          const noteArea = e.target.closest && e.target.closest('[data-shot-note-edit]')
          if (noteArea) { e.preventDefault(); shotNoteForm(noteArea.closest('.shot-card')) }
        })

        // --- batch q 2026-09-07: the STAGE select finally persists. The old htmx wiring
        // (hx-patch + js hx-vals) evaluated "this.value" in GLOBAL scope — the PATCH
        // shipped status=undefined, zod 400'd, and the stage silently never changed.
        // Now: change → PATCH → swap #pd-stage-badge in place (no full re-render, so an
        // in-progress description edit is never lost) + toast. The ذخیره button re-sends
        // the current value (idempotent — covers a failed change-save) and then navigates
        // back to the projects list, matching the user's mental model of "save".
        const patchStage = async (projectId, status) => {
          const res = await fetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          })
          if (!res.ok) throw new Error(String(res.status))
          return res
        }
        ctx.on('change', (e) => {
          if (e.target?.id !== 'pd-stage') return
          const sel = e.target
          const projectId = sel.dataset.projectId || id
          const badge = document.getElementById('pd-stage-badge')
          patchStage(projectId, sel.value)
            .then(() => {
              // swap the badge with the freshly-rendered select's sibling? simplest robust:
              // re-render just the badge from the server's project payload (rule: server is
              // the authority for the label/icon pairing).
              return fetch(`/api/projects/${projectId}`).then((r) => r.json())
            })
            .then((body) => {
              const p = body?.project
              if (badge && p?.status) {
                // rebuild the badge span from the project row: same classes the server uses
                const ICONS = {
                  spark: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>',
                  unreviewed: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
                  investigating: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
                  awaiting: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
                  doing: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>',
                  halted: '<path d="M9 5.5v13M15 5.5v13"/>',
                  operational: '<path d="M12 2.5s4.5 3 4.5 8c0 2.6-1.6 4.6-1.6 6.5h-5.8c0-1.9-1.6-3.9-1.6-6.5 0-5 4.5-8 4.5-8Z"/><circle cx="12" cy="9.5" r="1.8"/><path d="M9.5 20.5h5"/>',
                }
                const label = sel.querySelector(`option[value="${p.status}"]`)?.textContent || p.status
                badge.innerHTML = `<span class="badge badge-${p.status}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[p.status] || ''}</svg>${label}</span>`
              }
              window.hibana?.toast(_t('project.stageSaved', 'Stage saved'), 'info', 3000)
            })
            .catch(() => {
              window.hibana?.toast(_t('dashboard.moveFailed', "Couldn't move it — try again"), 'err')
            })
        })
        ctx.on('click', (e) => {
          const save = e.target.closest('#pd-stage-save')
          if (!save) return
          e.preventDefault()
          const sel = document.getElementById('pd-stage')
          const projectId = save.dataset.projectId || id
          const finish = () => { window.hibanaNav ? window.hibanaNav.go('/projects.html') : (window.location.href = '/projects.html') }
          if (!sel) return finish()
          patchStage(projectId, sel.value).then(finish).catch(finish)
        })

        // --- S30 (user request 2026-09-12: "remove the whole thing"): the interactive
        // progress box (slider + milestone chips + Auto/Manual + note) is REMOVED, with
        // every handler. Progress is a read-only computed number: the header strip +
        // its sr-only % label, repainted by the task-board handlers through the shared
        // painter below (no more Auto/Manual split — there is only the computed value). ---
        const pdBoxDig = (n) => (document.documentElement.lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n))
        const paintProgress = (pct) => {
          const bar = document.querySelector('[data-pd-bar]')
          if (bar) bar.style.inlineSize = Math.max(0, Math.min(100, pct)) + '%'
          const sr = document.querySelector('[data-pd-pct-sr]')
          if (sr) sr.textContent = pdBoxDig(Math.max(0, Math.min(100, Math.round(pct)))) + '%'
        }
        // The shared repaint the task-board handlers call — now ALWAYS the computed pct.
        window.__pdPaintAutoProgress = (pct) => paintProgress(pct)

        // --- Hurdles drag-reorder (spec §4.3): delegated on the document so htmx fragment swaps
        // (toggle/add/delete re-render #hurdles) never need re-binding. ctx.on keeps the
        // listeners mounted — nav.js removes them when this page unmounts. ---
        let hurdleDrag = null
        let hurdleOver = null
        const clearHurdleOver = () => {
          if (hurdleOver) { hurdleOver.classList.remove('drag-over'); hurdleOver = null }
        }
        ctx.on('dragstart', (e) => {
          const h = e.target.closest('#hurdles [data-hurdle-id]')
          if (!h) return
          hurdleDrag = h
          e.dataTransfer.effectAllowed = 'move'
          h.classList.add('dragging')
        })
        ctx.on('dragover', (e) => {
          if (!hurdleDrag) return
          e.preventDefault()
          const h = e.target.closest('#hurdles [data-hurdle-id]')
          clearHurdleOver()
          if (!h || h === hurdleDrag) return
          const r = h.getBoundingClientRect()
          const after = e.clientY > r.top + r.height / 2
          h.parentElement.insertBefore(hurdleDrag, after ? h.nextSibling : h)
          hurdleOver = h
          h.classList.add('drag-over')
        })
        ctx.on('drop', async (e) => {
          if (!hurdleDrag) return
          e.preventDefault()
          const ids = [...document.querySelectorAll('#hurdles [data-hurdle-id]')].map((x) => x.dataset.hurdleId)
          try {
            if (ids.length > 1) {
              const res = await fetch(`/api/projects/${id}/hurdles/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
              })
              if (!res.ok) throw new Error('reorder failed')
            }
          } catch (err) {
            window.hibana?.toast(_t('list.reorderFailed', 'Reorder failed — try again'), 'err')
          } finally {
            clearHurdleOver()
            if (hurdleDrag) hurdleDrag.classList.remove('dragging')
            hurdleDrag = null
          }
        })
        ctx.on('dragend', () => {
          clearHurdleOver()
          if (hurdleDrag) hurdleDrag.classList.remove('dragging')
          hurdleDrag = null
        })

        // --- Where-I-left-off AUTOSAVE (user request: typing saves itself, no button) -----
        // Debounced while typing, flushed on blur; delegated so htmx swaps of #project-body
        // (drag reorder, hurdle actions target only their lists, but the header status select
        // re-renders the body) never lose the behavior. ctx.on unmounts it on navigation.
        let noteBase = null // the value the field had when the user first touched it
        let noteValue = '' // the last value actually saved
        let noteTimer = null
        const noteStatus = (text) => {
          const el = document.getElementById('note-status')
          if (!el) return
          el.hidden = !text
          el.textContent = text || ''
        }
        const isNoteField = (el) => el instanceof HTMLTextAreaElement && el.matches('#project-body textarea[name="note"]')
        const saveNoteNow = async () => {
          noteTimer = null
          const ta = document.querySelector('#project-body textarea[name="note"]')
          if (!ta) return
          const value = ta.value
          if (value === noteValue) { noteStatus(''); return }
          if (noteValue === '' && value === noteBase) { noteStatus(''); return } // never modified
          try {
            const res = await fetch(`/api/projects/${id}/note`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: value }),
            })
            if (!res.ok) throw new Error('save failed')
            noteValue = value
            if (noteBase === null) noteBase = value
            noteStatus('✓ ' + _t('project.noteSaved', 'saved'))
            setTimeout(() => { if (ta.value === noteValue) noteStatus('') }, 1600)
          } catch {
            noteStatus('')
            window.hibana?.toast(_t('project.noteSaveFailed', "Couldn't auto-save — press Save note"), 'err')
          }
        }
        ctx.on('focusin', (e) => {
          if (!isNoteField(e.target)) return
          if (noteBase === null) noteBase = e.target.value
        })
        ctx.on('input', (e) => {
          if (!isNoteField(e.target)) return
          if (noteBase === null) noteBase = e.target.value
          clearTimeout(noteTimer)
          if (e.target.value !== noteValue) noteStatus('…')
          noteTimer = setTimeout(saveNoteNow, 800)
        })
        ctx.on('blur', (e) => {
          if (!isNoteField(e.target)) return
          clearTimeout(noteTimer)
          saveNoteNow()
        }, true) // blur doesn't bubble — capture phase

        // --- Hurdles composer (Quick-Notebook feel, user request) ---
        // Enter adds the current text (Shift+Enter = newline); the server splits pasted
        // multi-line blocks into one hurdle per line. Same htmx path as the ＋ button.
        ctx.on('keydown', (e) => {
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
          const ta = e.target
          if (!(ta instanceof HTMLTextAreaElement) || !ta.classList.contains('hurdle-compose-text')) return
          e.preventDefault()
          const text = ta.value.trim()
          if (!text || !window.htmx) return
          ta.value = ''
          window.htmx.ajax('POST', `/api/projects/${id}/hurdles`, {
            target: '#hurdles',
            swap: 'innerHTML',
            values: { text },
          })
        })

        // --- Hurdle hover-pen editing (user request 2026-09-05 — picked over dblclick) ---
        // Hover a hurdle → the pen appears (CSS); click it → the text becomes an input.
        // Enter/blur saves (PATCH /api/hurdles/:id {text}), Esc cancels; the list then
        // re-renders from the server so the markup stays single-sourced. Delegated so
        // htmx swaps of #hurdles (add/toggle/delete) never lose the behavior.
        ctx.on('click', (e) => {
          const pen = e.target.closest('[data-hurdle-edit]')
          if (!pen) return
          const li = pen.closest('[data-hurdle-id]')
          const span = li?.querySelector('.hurdle-text')
          if (!li || !span || li.querySelector('.hurdle-edit-input')) return
          const hurdleId = li.dataset.hurdleId
          const orig = span.textContent
          const refreshList = () => {
            if (window.htmx) window.htmx.ajax('GET', `/api/projects/${id}/hurdles`, { target: '#hurdles', swap: 'innerHTML' })
          }
          const input = document.createElement('input')
          input.className = 'hurdle-edit-input'
          input.maxLength = 500
          input.dir = 'auto'
          input.setAttribute('aria-label', _t('project.hurdleText', 'Hurdle text'))
          input.value = orig
          span.replaceWith(input)
          input.focus()
          input.select()
          let done = false
          const finish = async (save) => {
            if (done) return
            done = true
            const value = input.value.trim()
            input.remove()
            if (!save || !value || value === orig) { refreshList(); return }
            try {
              const res = await fetch(`/api/hurdles/${hurdleId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: value }),
              })
              if (!res.ok) throw new Error('save failed')
              window.hibana?.toast(_t('sparks.saved', 'Saved'))
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            }
            refreshList()
          }
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true) }
            if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
          })
          input.addEventListener('blur', () => finish(true))
        })

        // --- B3.3: Project detail tabs (Overview / Hurdles / Media / Links / Activity) ---
        // Delegated click handler so htmx swaps that re-render #project-body keep working.
        // Also supports keyboard arrow nav between tabs (WCAG tablist pattern).
        let pdActiveTab = 'notes' // batch (p): remember the open tab across htmx re-renders
        function switchTab(name) {
          pdActiveTab = name
          const root = document.getElementById('project-body')
          if (!root) return
          root.querySelectorAll('[data-detail-tab]').forEach((b) => {
            const on = b.dataset.detailTab === name
            b.classList.toggle('is-active', on)
            b.setAttribute('aria-selected', on ? 'true' : 'false')
            b.tabIndex = on ? 0 : -1
          })
          root.querySelectorAll('[data-detail-panel]').forEach((p) => {
            const on = p.dataset.detailPanel === name
            p.hidden = !on
            p.classList.toggle('is-active', on)
          })
        }
        ctx.on('click', (e) => {
          const tab = e.target.closest('[data-detail-tab]')
          if (tab && tab.closest('#project-body')) switchTab(tab.dataset.detailTab)
        })
        ctx.on('keydown', (e) => {
          const tab = e.target.closest('[data-detail-tab]')
          if (!tab || !e.target.closest('#project-body')) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault()
            const tabs = [...document.querySelectorAll('[data-detail-tab]')]
            const idx = tabs.indexOf(tab)
            const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length
            tabs[next].focus()
            switchTab(tabs[next].dataset.detailTab)
          }
        })
        // Re-select the tab that was OPEN before htmx swaps #project-body (status change
        // re-renders). The old code always forced Notes — a save from any other tab yanked
        // the user's view back. Default stays Notes (first tab in the (p) order).
        for (const evt of ['htmx:afterSwap', 'afterSwap']) {
          ctx.on(evt, (e) => {
            if (e.target?.id === 'project-body' || e.detail?.target?.id === 'project-body') {
              switchTab(pdActiveTab)
            }
          })
        }

        // --- Redesigned header (user sketch 2026-08-29) ---------------------------------

        // Title: click the h1 (or its ✎ pen) → inline input; Enter/blur saves, Esc cancels.
        const refreshBody = () => {
          if (window.htmx) window.htmx.ajax('GET', `/api/projects/${id}`, { target: '#project-body', swap: 'innerHTML' })
        }
        const startTitleEdit = (h1) => {
          if (document.getElementById('pd-title-input')) return
          const input = document.createElement('input')
          input.id = 'pd-title-input'
          input.value = h1.textContent.trim()
          input.maxLength = 200
          input.dir = 'auto'
          h1.replaceChildren(input)
          input.focus()
          input.select()
          let done = false
          const finish = async (save) => {
            if (done) return
            done = true
            const value = input.value.trim()
            input.remove()
            if (!save || !value || value === h1.dataset.orig) { refreshBody(); return }
            try {
              const res = await fetch(`/api/projects/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: value }),
              })
              if (!res.ok) throw new Error('save failed')
              window.hibana?.toast(_t('sparks.saved', 'Saved'))
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            }
            refreshBody()
          }
          h1.dataset.orig = input.value
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); finish(true) }
            if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
          })
          input.addEventListener('blur', () => finish(true))
        }
        ctx.on('click', (e) => {
          const h1 = e.target.closest('#pd-title')
          if (!h1) return
          if (e.target.closest('[data-edit-title]') || e.target === h1) startTitleEdit(h1)
        })

        // Description: always-editable box, debounced autosave like the note field.
        let descTimer = null
        let descValue = null
        const descStatus = (txt) => {
          const el = document.getElementById('pd-desc-status')
          if (el) el.textContent = txt || ''
        }
        const saveDescNow = async () => {
          descTimer = null
          const ta = document.getElementById('pd-desc')
          if (!ta) return
          if (descValue === null) descValue = ta.value
          if (ta.value === descValue) { descStatus(''); return }
          try {
            const res = await fetch(`/api/projects/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ description: ta.value }),
            })
            if (!res.ok) throw new Error('save failed')
            descValue = ta.value
            descStatus('✓ ' + _t('project.noteSaved', 'saved'))
            setTimeout(() => { if (ta.value === descValue) descStatus('') }, 1600)
          } catch {
            descStatus('')
            window.hibana?.toast(_t('project.noteSaveFailed', "Couldn't auto-save"), 'err')
          }
        }
        ctx.on('input', (e) => {
          if (e.target?.id !== 'pd-desc') return
          descStatus('…')
          clearTimeout(descTimer)
          descTimer = setTimeout(saveDescNow, 800)
        })
        ctx.on('blur', (e) => {
          if (e.target?.id !== 'pd-desc') return
          clearTimeout(descTimer)
          saveDescNow()
        }, true)

        // Tags: ＋ opens the popover; submit find-or-creates + attaches; × detaches.
        const tagPop = () => document.querySelector('[data-tag-pop]')
        ctx.on('click', (e) => {
          const pop = tagPop()
          if (!pop) return
          if (e.target.closest('[data-tag-add]')) {
            pop.hidden = false
            pop.querySelector('input[name=name]').focus()
            return
          }
          if (e.target.closest('[data-tag-cancel]') || !e.target.closest('[data-tag-pop]')) pop.hidden = true
        })
        ctx.on('submit', async (e) => {
          const pop = tagPop()
          if (!pop || e.target !== pop) return
          e.preventDefault()
          const name = pop.querySelector('input[name=name]').value.trim()
          if (!name) return
          try {
            const res = await fetch(`/api/projects/${id}/tags`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // Phase 5 item 17: no color is sent — labels are the consistent grey now.
              body: JSON.stringify({ name }),
            })
            if (!res.ok) throw new Error('tag failed')
            const data = await res.json()
            pop.hidden = true
            pop.querySelector('input[name=name]').value = ''
            // local chip insert (no full reload — keeps the composer state). The chip
            // goes in BEFORE the ＋ برچسب button, so the add button keeps its fixed
            // position (Phase 5 item 5 — chips never push it around, whatever the user
            // does: adding, removing, re-adding).
            const holder = document.getElementById('pd-tags')
            const chip = document.createElement('span')
            chip.className = 'chip pd-tag-chip'
            chip.dir = 'auto' // S32: a Latin label chip reads LTR (dot/✕ order follows)
            chip.dataset.tagChip = data.id
            chip.textContent = name
            const x = document.createElement('button')
            x.type = 'button'
            x.className = 'ghost danger pd-tag-x'
            x.dataset.tagRemove = data.id
            x.setAttribute('aria-label', 'x')
            x.textContent = '✕'
            chip.appendChild(x)
            const addBtn = holder.querySelector('.pd-tag-add')
            if (addBtn) holder.insertBefore(chip, addBtn)
            else holder.appendChild(chip)
            window.hibana?.toast(_t('sparks.saved', 'Saved'))
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
          }
        })
        ctx.on('click', async (e) => {
          const btn = e.target.closest('[data-tag-remove]')
          if (!btn) return
          const tagId = btn.dataset.tagRemove
          try {
            const res = await fetch(`/api/projects/${id}/tags/${tagId}`, { method: 'DELETE' })
            if (!res.ok) throw new Error('detach failed')
            const chip = document.querySelector(`[data-tag-chip="${tagId}"]`)
            if (chip) chip.remove()
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
          }
        })

        // --- Dev-task quick add (user request 2026-08-29, modal since 2026-09-15): adding
        // a task happens DIRECTLY in the project page's progress boxes — no trip to
        // board.html. Each column's «＋ Add task» opens the #pd-taskadd-modal dialog (see
        // the wiring below — wide textarea, long sentences fully visible); Enter creates
        // the task in that status and the chip/count/progress update in place. All
        // delegated so htmx re-renders of #project-body (status select etc.) keep working.
        const pdEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
        const pdLang = () => (window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en')
        const pdDig = (s) => (pdLang() === 'fa' ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s))
        const pdTasksLine = (done, total) => {
          let s = window.hibanaI18n?.t('pd.tasksDone')
          if (!s || s === 'pd.tasksDone') s = '{n} of {m} tasks done'
          return s.replace('{n}', pdDig(done)).replace('{m}', pdDig(total))
        }
        // Meta line under a task title (user request 2026-09-03): date + CLOCK — Jalali +
        // FA digits when fa (Intl persian calendar; project.html never loads the jalaali
        // vendor), Gregorian + 12h clock when en. UTC edge — twin of the server-side
        // taskMetaLabel() in routes/projects.ts.
        const PD_G_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        const pdMetaLine = (iso, done) => {
          const d = new Date(iso)
          const hh = d.getUTCHours()
          const mm = String(d.getUTCMinutes()).padStart(2, '0')
          const clock = pdLang() === 'fa'
            ? pdDig(String(hh).padStart(2, '0')) + ':' + pdDig(mm)
            : ((hh % 12) || 12) + ':' + mm + ' ' + (hh < 12 ? 'AM' : 'PM')
          let date
          if (pdLang() === 'fa') {
            try {
              date = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(d)
            } catch {
              date = d.toISOString().slice(0, 10)
            }
          } else {
            date = d.getUTCDate() + ' ' + PD_G_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear()
          }
          return (done ? '✓ ' : '') + date + ' · ' + clock
        }

        // --- S29 follow-up (user request 2026-09-12): priorities + labels on tasks ----
        // The four priorities as the owner worded them (Urgent / High Priority /
        // Medium Priority / Low Priority), color-coded. The RANK drives the boxes'
        // AUTO-SORT (urgent first); the label rides the card meta + both modals' chips.
        const PD_PRIO_LABEL = {
          urgent: { en: 'Urgent', fa: 'فوری' },
          high: { en: 'High Priority', fa: 'اولویت بالا' },
          medium: { en: 'Medium Priority', fa: 'اولویت متوسط' },
          low: { en: 'Low Priority', fa: 'اولویت کم' },
        }
        const pdPrioLabel = (p) => {
          const e = PD_PRIO_LABEL[p] || PD_PRIO_LABEL.medium
          return pdLang() === 'fa' ? e.fa : e.en
        }
        const PD_PRIO_RANK = { urgent: 0, high: 1, medium: 2, low: 3 }
        const pdPrioRank = (p) => PD_PRIO_RANK[p] ?? 2
        // Meta line HTML with the leading priority label (twin of the server's render).
        const pdMetaHtml = (prio, iso, done) =>
          '<span class="pd-meta-prio prio-' + pdEsc(prio || 'medium') + '">' + pdEsc(pdPrioLabel(prio || 'medium')) + '</span> · ' + pdEsc(pdMetaLine(iso, done))
        // Label chips on a card — list = [{name, color}] (mirror of the server's
        // taskTagChips; the chip color is the tag's palette color).
        // S30 batch 5: the chip markup is the shared HibanaChips.tagChipsRow.
        const pdTagChipsHtml = (list) => window.HibanaChips.tagChipsRow(list)
        // Comma-separated labels input → names (Latin, Persian and Arabic separators).
        const pdParseTags = (raw) => (raw || '').split(/[,،؛]/).map((s) => s.trim()).filter(Boolean)
        // Live color preview chip next to a priority <select> (options styling varies
        // by browser; the chip is the guaranteed color signal).
        const pdSyncPrioChip = (chipId, prio) => {
          const chip = document.getElementById(chipId)
          if (!chip) return
          chip.className = 'pd-prio-chip prio-' + (prio || 'medium')
          const dot = chip.querySelector('.prio-dot')
          if (dot) dot.className = 'prio-dot prio-' + (prio || 'medium')
          const label = chip.querySelector('.pd-prio-chip-label')
          if (label) label.textContent = pdPrioLabel(prio)
        }
        // --- S30 batch 2 (user request): the board-preview FILTER BAR (priority × labels) ---
        // Twin of board.html's db-filter, adapted to the server-rendered preview: the
        // bar is client-built into [data-pd-filter] (the server mounts an empty div)
        // from the TRUTH payload (GET /api/projects/:id — the DOM renders only 5 per
        // column, so the label list cannot come from markup), and filtering HIDES wraps
        // in place instead of re-rendering — the htmx-swapped server markup survives.
        // Clicking a card's label chip toggles the same filter (GitHub behavior); the
        // priority DOT cycles priority without opening the editor.
        // S30 batch 4 (user request: "hover the project header strip → '3 urgent ·
        // 2 high · 5 medium'"): the computed bar carries a per-tier tooltip. The truth
        // rides pdTaskTruth (the full task list from the filter-bar fetch); every
        // add/move/delete/cycle keeps it in step and repaints the [data-pd-bar] title.
        // S33: sprint truth rides the SAME fetch (the project JSON carries the devboard
        // payload — sprints included). The «اسپرینت جدید» CTA + the deep-link
        // (?sprint=<id> from the sprint page's draft card) both read it from here.
        let pdSprintTruth = [] // [{id, name, version, description, is_draft, ended_at}]
        let pdSdDeepLinked = false
        let pdTaskTruth = [] // [{id, priority}]
        const pdTierLabel = (p) => {
          const map = { urgent: ['urgent', 'فوری'], high: ['high', 'اولویت بالا'], medium: ['medium', 'اولویت متوسط'], low: ['low', 'اولویت کم'] }
          const e = map[p] || map.medium
          return document.documentElement.lang === 'fa' ? e[1] : e[0]
        }
        const pdPaintBarTooltip = () => {
          const bar = document.querySelector('[data-pd-bar]')
          if (!bar) return
          const counts = { urgent: 0, high: 0, medium: 0, low: 0 }
          for (const t of pdTaskTruth) counts[t.priority || 'medium'] = (counts[t.priority || 'medium'] || 0) + 1
          const parts = ['urgent', 'high', 'medium', 'low'].filter((p) => counts[p] > 0)
            .map((p) => pdDig(counts[p]) + ' ' + pdTierLabel(p))
          bar.setAttribute('title', parts.join(' · '))
        }
        const pdTierTrack = (taskId, priority) => {
          const row = pdTaskTruth.find((t) => t.id === taskId)
          if (row) row.priority = priority || 'medium'
          else pdTaskTruth.push({ id: taskId, priority: priority || 'medium' })
          pdPaintBarTooltip()
        }
        const pdTierForget = (taskId) => {
          pdTaskTruth = pdTaskTruth.filter((t) => t.id !== taskId)
          pdPaintBarTooltip()
        }

        const pdFilterPrios = new Set()
        const pdFilterTags = new Set()
        let pdFilterKnown = [] // [{name, color}] — distinct labels across the project
        const pdTaskTagNames = (wrap) => {
          try {
            return (JSON.parse(wrap.dataset.pdTags || '[]') || []).map((tg) => String((tg && tg.name) || '').toLowerCase()).filter(Boolean)
          } catch { return [] }
        }
        const pdFilterMatches = (wrap) => {
          if (pdFilterPrios.size && !pdFilterPrios.has(wrap.dataset.pdPriority || 'medium')) return false
          if (pdFilterTags.size) {
            const names = pdTaskTagNames(wrap)
            if (!names.some((n) => pdFilterTags.has(n))) return false
          }
          return true
        }
        const pdFilterApply = () => {
          let shown = 0
          const wraps = document.querySelectorAll('.pd-task-wrap')
          wraps.forEach((w) => { const ok = pdFilterMatches(w); w.hidden = !ok; if (ok) shown++ })
          document.querySelectorAll('[data-pd-filter] [data-fp]').forEach((b) => {
            b.setAttribute('aria-pressed', pdFilterPrios.has(b.dataset.fp) ? 'true' : 'false')
            b.classList.toggle('is-on', pdFilterPrios.has(b.dataset.fp))
          })
          document.querySelectorAll('[data-pd-filter] [data-ft]').forEach((b) => {
            b.setAttribute('aria-pressed', pdFilterTags.has(b.dataset.ft) ? 'true' : 'false')
            b.classList.toggle('is-on', pdFilterTags.has(b.dataset.ft))
          })
          const any = pdFilterPrios.size > 0 || pdFilterTags.size > 0
          const clearBtn = document.querySelector('[data-pd-filter-clear]')
          if (clearBtn) clearBtn.hidden = !any
          const hint = document.querySelector('[data-pd-filter-shown]')
          if (hint) {
            hint.hidden = !any
            hint.textContent = _t('db.filterShown', '{n} of {m} shown').replace('{n}', pdDig(shown)).replace('{m}', pdDig(wraps.length))
          }
        }
        const pdFilterBuild = async () => {
          // S32 flake fix (caught by the FA-locale guard under full-suite load): the bar
          // builds on the FIRST htmx afterSwap, which can beat ensureFaDict — the prio
          // BUTTONS read pdLang() (immediate, server-set) but the group labels + clear
          // button read _t() (needs the fetched dict) — the mixed EN-labels/Farsi-buttons
          // state the guard flagged. Await the dict promise (resolved → instant no-op on
          // every later swap); a failed fetch falls through to the EN fallbacks.
          try { await window.hibanaI18n?.ready } catch { /* dict unavailable — EN fallbacks */ }
          const bar = document.querySelector('[data-pd-filter]')
          const grid = document.querySelector('.pd-board-grid')
          if (!bar || !grid) return
          if (bar.childElementCount) return // already built (idempotent)
          // label truth from the API (once — the bar re-renders from pdFilterKnown)
          try {
            const res = await fetch('/api/projects/' + id)
            if (res.ok) {
              const data = await res.json()
              // S30 batch 4: the tier-tooltip truth (every task's priority).
              pdTaskTruth = ((data.project ? data.project.devTasks : data.devTasks) || []).map((t) => ({ id: t.id, priority: t.priority || 'medium' }))
              // S33: the sprint truth (draft detection + deep-link targets).
              pdSprintTruth = (data.project ? data.project.sprints : data.sprints) || []
              if (!pdSdDeepLinked) {
                const sp = new URLSearchParams(location.search).get('sprint')
                if (sp) { pdSdDeepLinked = true; pdSprintOpenDoc(sp) }
              }
              pdPaintBarTooltip()
              const rows = (data.project ? data.project.devTaskTags : data.devTaskTags) || []
              const seen = new Set()
              pdFilterKnown = []
              for (const r of rows) {
                const k = String(r.name || '').toLowerCase()
                if (k && !seen.has(k)) { seen.add(k); pdFilterKnown.push({ name: r.name, color: r.color }) }
              }
              pdFilterKnown.sort((a, b) => String(a.name).localeCompare(String(b.name)))
            }
          } catch { /* offline — the bar still renders with the priority toggles */ }
          const prioBtn = (p) => '<button type="button" class="chip db-filter-prio prio-' + p + '" data-fp="' + p + '" aria-pressed="false" title="' + pdEsc(_t('db.filterPrioHint', 'Show only {p} tasks').replace('{p}', pdPrioLabel(p))) + '"><span class="prio-dot prio-' + p + '"></span>' + pdEsc(pdPrioLabel(p)) + '</button>'
          bar.innerHTML =
            '<span class="db-filter-label muted small">' + pdEsc(_t('db.filterPrio', 'Priority')) + '</span>' +
            ['urgent', 'high', 'medium', 'low'].map(prioBtn).join('') +
            (pdFilterKnown.length
              ? '<span class="db-filter-label muted small">' + pdEsc(_t('db.filterLabels', 'Labels')) + '</span>' +
                pdFilterKnown.map((tg) =>
                  '<button type="button" dir="auto" class="chip db-filter-tag" data-ft="' + pdEsc(String(tg.name).toLowerCase()) + '" style="color:' + pdEsc(tg.color || '#8AB8F0') + '" aria-pressed="false" title="' + pdEsc(_t('db.filterTagHint', 'Click to filter by this label')) + '"><span style="color:' + pdEsc(tg.color || '#8AB8F0') + '">●</span> ' + pdEsc(tg.name) + '</button>'
                ).join('')
              : '') +
            '<button type="button" class="chip db-filter-clear" data-pd-filter-clear hidden>✕ ' + pdEsc(_t('db.filterClear', 'Clear filter')) + '</button>' +
            '<span class="muted small db-filter-shown" data-pd-filter-shown hidden></span>'
          bar.hidden = false
          // re-sync pressed states + the hidden wraps (a fresh server render came in)
          pdFilterApply()
        }
        // filter-bar toggles (delegated — the bar is rebuilt on every htmx swap of
        // #project-body, so no cached refs; the sets survive because they live here).
        ctx.on('click', (e) => {
          const fp = e.target.closest('[data-pd-filter] [data-fp]')
          if (fp) {
            e.preventDefault()
            const v = fp.dataset.fp
            if (pdFilterPrios.has(v)) pdFilterPrios.delete(v); else pdFilterPrios.add(v)
            pdFilterApply()
            return
          }
          const ft = e.target.closest('[data-pd-filter] [data-ft]')
          if (ft) {
            e.preventDefault()
            const v = ft.dataset.ft
            if (pdFilterTags.has(v)) pdFilterTags.delete(v); else pdFilterTags.add(v)
            pdFilterApply()
            return
          }
          if (e.target.closest('[data-pd-filter-clear]')) {
            e.preventDefault()
            pdFilterPrios.clear(); pdFilterTags.clear()
            pdFilterApply()
            return
          }
          // a card's label chip toggles the same label filter (GitHub behavior)
          const tagChip = e.target.closest('.pd-task .pd-tag[data-pd-tag-name]')
          if (tagChip) {
            e.preventDefault()
            const v = String(tagChip.dataset.pdTagName || '').toLowerCase()
            if (!v) return
            if (pdFilterTags.has(v)) pdFilterTags.delete(v); else pdFilterTags.add(v)
            pdFilterApply()
            return
          }
          // the prio-dot: cycle low → medium → high → urgent WITHOUT opening the editor
          const cycleDot = e.target.closest('[data-pd-cycle-prio]')
          if (cycleDot) {
            e.preventDefault()
            const wrap = cycleDot.closest('.pd-task-wrap')
            const tid = wrap && wrap.dataset.pdTask
            if (!wrap || !tid) return
            const order = ['low', 'medium', 'high', 'urgent']
            const cur = wrap.dataset.pdPriority || 'medium'
            const next = order[(order.indexOf(cur) + 1 + order.length) % order.length] || 'medium'
            wrap.dataset.pdPriority = next
            pdTierTrack(tid, next)
            const dot = wrap.querySelector('.prio-dot')
            if (dot) dot.className = 'prio-dot prio-' + next
            const btn = wrap.querySelector('[data-pd-cycle-prio]')
            if (btn) {
              const hint = _t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', pdPrioLabel(next))
              btn.setAttribute('title', hint)
              btn.setAttribute('aria-label', hint)
            }
            const meta = wrap.querySelector('.pd-meta-prio')
            if (meta) { meta.className = 'pd-meta-prio prio-' + next; meta.textContent = pdPrioLabel(next) }
            const col = wrap.closest('[data-pd-tasks]')
            if (col) pdSortWrap(col, wrap)
            fetch('/api/devtasks/' + tid, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ priority: next }),
            }).catch(() => {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
              location.reload()
            })
          }
        })
        // Build the bar once the body is here — the page boots with an EMPTY
        // #project-body (hx-get on load), so the first build lands on htmx:afterSwap;
        // every later swap re-renders the server markup (the bar div comes back empty)
        // and the rebuild restores the toggles from the LIVE filter sets.
        ctx.on('htmx:afterSwap', () => { pdFilterBuild() })
        pdFilterBuild()

        // --- S33 (user request 2026-09-13): «اسپرینت جدید» → modal → «ورود به اسپرینت»
        //     → the FULL-SCREEN sprint editor with code blocks -------------------------
        // Flow: the board head's [data-pd-new-sprint] CTA opens #pd-sprintnew-modal
        // (name + version + description). Create POSTs a DRAFT (0034); a 409
        // draft_exists flips the SAME form into edit-the-draft mode (prefill + PATCH).
        // The created view's big button ENTERS the sprint: #pd-sprintdoc-modal — a true
        // full-bleed editor (H2/H3 · bold · italic · bullet/numbered list · quote ·
        // inline code · CODE BLOCKS · link · divider) with live preview + AUTOSAVE
        // (debounced PATCH /api/sprints/:id {description}). ?sprint=<id> deep-links in
        // (the sprint page's draft card links here). The bidi law applies: the textarea
        // keeps the locale dir as the typing default while polish-batch.css gives it
        // per-line plaintext; fenced blocks render as LTR .t-code islands in preview.
        const pdSprintNewModal = () => document.getElementById('pd-sprintnew-modal')
        const pdSdModal = () => document.getElementById('pd-sprintdoc-modal')
        let pdSprintNewMode = 'create' // 'create' | 'edit' (an existing draft)
        let pdSprintEditId = '' // the draft being edited / the sprint just created
        let sdSprint = null // the open editor's subject {id, name, version}
        let sdTimer = null // autosave debounce
        let sdPreviewTimer = null
        let sdStatusTimer = null
        let sdDirty = false
        let sdSaving = false

        // -- new-sprint modal plumbing --------------------------------------------------
        const pdSprintShowView = (which) => { // 'fields' | 'done'
          const fields = document.getElementById('pd-sprintnew-fields')
          const actions = document.getElementById('pd-sprintnew-actions')
          const done = document.getElementById('pd-sprintnew-done')
          const err = document.getElementById('pd-sprintnew-error')
          if (fields) fields.hidden = which !== 'fields'
          if (actions) actions.hidden = which !== 'fields'
          if (done) done.hidden = which !== 'done'
          if (err) { err.hidden = true; err.textContent = '' }
        }
        const pdSprintSetMode = (mode, draft) => {
          pdSprintNewMode = mode
          pdSprintEditId = mode === 'edit' && draft ? draft.id : ''
          const nameIn = document.getElementById('pd-sprintnew-name')
          const verIn = document.getElementById('pd-sprintnew-version')
          const descIn = document.getElementById('pd-sprintnew-desc')
          const hint = document.getElementById('pd-sprintnew-hint')
          const label = document.getElementById('pd-sprintnew-save-label')
          if (nameIn) nameIn.value = mode === 'edit' && draft ? (draft.name || '') : ''
          if (verIn) verIn.value = mode === 'edit' && draft ? (draft.version || '') : ''
          if (descIn) descIn.value = mode === 'edit' && draft ? (draft.description || '') : ''
          if (hint) hint.textContent = mode === 'edit'
            ? _t('sprint.draftExists', 'A draft sprint is already open here — you are editing it.')
            : _t('sprint.draftHint', 'Born as a draft — start it later from the sprint timeline.')
          if (label) label.textContent = mode === 'edit'
            ? _t('sprint.update', 'Update draft')
            : _t('sprint.create', 'Create sprint')
        }
        const pdSprintPaintCount = () => {
          // keep the «اسپرینت‌ها n» badge honest after a create
          const link = document.querySelector('.pd-board-head a[href^="/sprint.html"]')
          if (!link) return
          let span = link.querySelector('.pd-sprint-count')
          if (!span) { span = document.createElement('span'); span.className = 'pd-sprint-count'; link.appendChild(span) }
          span.textContent = pdDig(String(pdSprintTruth.length))
        }
        const pdSprintTruthTrack = (s) => {
          const i = pdSprintTruth.findIndex((x) => x && x.id === s.id)
          if (i >= 0) pdSprintTruth[i] = { ...pdSprintTruth[i], ...s }
          else pdSprintTruth.push(s)
          pdSprintPaintCount()
        }
        const pdSprintDoneView = (name, version) => {
          pdSprintShowView('done')
          const nameEl = document.getElementById('pd-sprintnew-done-name')
          if (nameEl) nameEl.textContent = version ? name + ' · ' + version : (name || '')
          window.hibana?.toast(_t('sprint.created', 'Sprint created'))
        }
        // CTA click → open the modal (create mode, or prefill the existing draft)
        ctx.on('click', (e) => {
          const cta = e.target.closest('[data-pd-new-sprint]')
          if (!cta) return
          e.preventDefault()
          const m = pdSprintNewModal()
          if (!m) return
          pdSprintShowView('fields')
          const draft = pdSprintTruth.find((s) => s && s.is_draft)
          pdSprintSetMode(draft ? 'edit' : 'create', draft)
          m.showModal()
          setTimeout(() => { const n = document.getElementById('pd-sprintnew-name'); if (n) n.focus() }, 30)
        })
        // close paths + the ENTER button (the reason this modal exists)
        ctx.on('click', (e) => {
          if (e.target.closest('#pd-sprintnew-close') || e.target.closest('#pd-sprintnew-cancel') || e.target.closest('#pd-sprintnew-done-close')) {
            const m = pdSprintNewModal()
            if (m && m.open) m.close()
            return
          }
          const enter = e.target.closest('#pd-sprintnew-enter')
          if (enter) {
            e.preventDefault()
            const m = pdSprintNewModal()
            if (m && m.open) m.close()
            pdSprintOpenDoc(pdSprintEditId)
          }
        })
        // create / update-draft
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('#pd-sprintnew-form') : null
          if (!form) return
          e.preventDefault()
          const nameIn = document.getElementById('pd-sprintnew-name')
          const verIn = document.getElementById('pd-sprintnew-version')
          const descIn = document.getElementById('pd-sprintnew-desc')
          const err = document.getElementById('pd-sprintnew-error')
          const save = document.getElementById('pd-sprintnew-save')
          if (!nameIn || !verIn || !descIn) return
          const body = { description: descIn.value }
          const name = nameIn.value.trim()
          if (name) body.name = name
          const version = verIn.value.trim()
          if (version) body.version = version
          if (save) save.disabled = true
          const fail = () => { if (err) { err.hidden = false; err.textContent = _t('sparks.saveFailed', "Couldn't save") } }
          try {
            if (pdSprintNewMode === 'edit' && pdSprintEditId) {
              const res = await fetch('/api/sprints/' + pdSprintEditId, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
              })
              if (!res.ok) throw new Error('save failed')
              const row = pdSprintTruth.find((x) => x.id === pdSprintEditId)
              pdSprintTruthTrack({ ...body, id: pdSprintEditId, name: name || (row ? row.name : ''), version: version || (row ? row.version : '') })
              pdSprintDoneView(name || (row ? row.name : ''), version || (row ? row.version : ''))
            } else {
              let res = await fetch('/api/projects/' + id + '/sprints', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
              })
              if (res.status === 409) {
                // A draft already exists (truth was stale — another tab, or the page sat
                // open): flip into PATCH mode against the returned draft_id.
                const j = await res.json().catch(() => ({}))
                if (!j.draft_id) throw new Error('save failed')
                res = await fetch('/api/sprints/' + j.draft_id, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                })
                if (!res.ok) throw new Error('save failed')
                pdSprintNewMode = 'edit'
                pdSprintEditId = j.draft_id
                const row = pdSprintTruth.find((x) => x.id === j.draft_id)
                pdSprintTruthTrack({ ...body, id: j.draft_id, name: name || (row ? row.name : ''), version: version || (row ? row.version : '') })
                pdSprintDoneView(name || (row ? row.name : ''), version || (row ? row.version : ''))
              } else {
                if (!res.ok) throw new Error('save failed')
                const j = await res.json()
                pdSprintEditId = j.id
                pdSprintTruthTrack({ id: j.id, name: j.name, version: j.version ?? null, description: descIn.value, is_draft: 1 })
                pdSprintDoneView(j.name, j.version)
              }
            }
          } catch { fail() } finally { if (save) save.disabled = false }
        })

        // -- the full-screen editor -----------------------------------------------------
        // MARKDOWN → HTML for the live preview (a client twin of src/lib/markdown.ts's
        // renderMarkdown + the task-title .t-code treatment): escape FIRST, then
        // line-level blocks (fences → LTR .t-code islands with data-lang labels,
        // self-healing when unclosed; headings; grouped ul/ol/TASK lists; blockquote;
        // TABLES (S34); hr; paragraphs) and inline marks (S34 private comments
        // ==…== %%…%%, images, links http(s) only, bold, strike, italic, inline code).
        // S34: the task list's checkboxes carry data-sdl (the RAW line index) so the
        // preview click handler can toggle [ ]→[x] straight into the source.
        const pdSdInline = (t) => t
          // PRIVATE COMMENTS (user request 2026-09-13: "add comments to any part of text
          // i want which are only visible for myself — a reminder of rationale"):
          // ==anchor== %%note%% → an amber dashed-underline anchor with a hover/tap
          // popover. Runs FIRST so the anchor's + note's inner text still receives the
          // inline marks below. Only ever rendered in THIS author's preview.
          .replace(/==([^=\n]+)==\s*%%((?:[^%\n]|%(?!%))+)%%/g,
            '<span class="sd-note" tabindex="0">$1<span class="sd-note-pop" role="note"><svg class="icon sd-note-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg><span class="sd-note-txt">$2</span></span></span>')
          // images before links — ![alt](url) would otherwise match the link pattern
          .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img class="sd-img" src="$2" alt="$1" loading="lazy">')
          .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/~~([^~]+)~~/g, '<del>$1</del>')
          .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
          .replace(/`([^`]+)`/g, '<code>$1</code>')
        // table rows: split on | (dropping the outer pipes), trim each cell
        const pdSdCells = (row) => {
          let t = row.trim()
          if (t.startsWith('|')) t = t.slice(1)
          if (t.endsWith('|')) t = t.slice(0, -1)
          return t.split('|').map((c) => c.trim())
        }
        // the | --- | --- | separator row (optional colons)
        const pdSdIsSep = (row) => {
          const cells = pdSdCells(row)
          return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.replace(/\s/g, '')))
        }
        const pdSdTable = (rows) => {
          const grid = rows.map(pdSdCells)
          const hasSep = grid.length > 1 && pdSdIsSep(rows[1])
          const head = hasSep ? grid[0] : null
          const body = hasSep ? grid.slice(2) : grid
          let html = '<table>'
          if (head) html += '<thead><tr>' + head.map((c) => '<th>' + pdSdInline(c) + '</th>').join('') + '</tr></thead>'
          if (body.length) html += '<tbody>' + body.map((r) => '<tr>' + r.map((c) => '<td>' + pdSdInline(c) + '</td>').join('') + '</tr>').join('') + '</tbody>'
          return html + '</table>'
        }
        const pdSdRender = (raw) => {
          const lines = pdEsc(String(raw ?? '')).split('\n')
          const out = []
          let inCode = false
          let list = null // 'ul' | 'ol' | 'tasks'
          let quote = false
          let para = []
          const closeList = () => { if (list) { out.push(list === 'ol' ? '</ol>' : '</ul>'); list = null } }
          const closeQuote = () => { if (quote) { out.push('</blockquote>'); quote = false } }
          const flush = () => { closeList(); closeQuote(); if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = [] } }
          let i = 0
          while (i < lines.length) {
            const line = lines[i]
            if (!inCode && /^\s*```/.test(line)) {
              flush()
              inCode = true
              const codeLang = line.trim().slice(3).trim()
              out.push('<code class="t-code"' + (codeLang ? ' data-lang="' + pdEsc(codeLang) + '"' : '') + ' dir="ltr">')
              i++
              continue
            }
            if (inCode) {
              if (line.trim() === '```') { inCode = false; out.push('</code>') }
              else out.push(line) // verbatim (already escaped) — no inline transforms in code
              i++
              continue
            }
            const t = line.trim()
            if (t === '') { flush(); i++; continue }
            // S34 tables: a run of |-led lines renders as ONE table (header + separator
            // + body). Unclosed/separatorless runs degrade to all-body rows.
            if (/^\|/.test(t)) {
              flush()
              const tbl = []
              while (i < lines.length && lines[i].trim() !== '' && /^\|/.test(lines[i].trim())) { tbl.push(lines[i]); i++ }
              if (tbl.length) out.push(pdSdTable(tbl))
              continue
            }
            let m
            if ((m = t.match(/^(#{1,3})\s+(.*)$/))) { flush(); out.push('<h' + m[1].length + '>' + pdSdInline(m[2]) + '</h' + m[1].length + '>'); i++; continue }
            if (/^---+$/.test(t)) { flush(); out.push('<hr>'); i++; continue }
            if ((m = t.match(/^&gt;\s?(.*)$/))) {
              closeList()
              if (!quote) { out.push('<blockquote>'); quote = true }
              out.push('<p>' + pdSdInline(m[1]) + '</p>')
              i++
              continue
            }
            // S34 task items BEFORE the plain bullet match (- [ ] also starts with "- ").
            // data-sdl = the raw line index — the preview's checkbox toggle writes back.
            if ((m = t.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/))) {
              closeQuote()
              if (list !== 'tasks') { closeList(); out.push('<ul class="sd-tasklist">'); list = 'tasks' }
              out.push('<li class="sd-task"><input type="checkbox" data-sdl="' + i + '"' + (m[1] === ' ' ? '' : ' checked') + ' aria-label="' + pdEsc(_t('sprint.toggleTask', 'Toggle task')) + '"><span class="sd-task-txt">' + pdSdInline(m[2]) + '</span></li>')
              i++
              continue
            }
            if ((m = t.match(/^[-*]\s+(.*)$/))) {
              closeQuote()
              if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
              out.push('<li>' + pdSdInline(m[1]) + '</li>')
              i++
              continue
            }
            if ((m = t.match(/^\d+\.\s+(.*)$/))) {
              closeQuote()
              if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
              out.push('<li>' + pdSdInline(m[1]) + '</li>')
              i++
              continue
            }
            closeList(); closeQuote()
            para.push(pdSdInline(line))
            i++
          }
          if (inCode) out.push('</code>') // self-healing: unclosed fence renders as code
          flush()
          return out.join('\n')
        }
        const pdSdPaintPreview = (v) => {
          const pv = document.getElementById('pd-sd-preview')
          if (!pv) return
          pv.innerHTML = v ? pdSdRender(v) : '<p class="muted">' + pdEsc(_t('sprint.emptyPreview', 'Nothing to preview yet.')) + '</p>'
          // S34: the foot's comments toggle carries the live count of ==…== %%…%% pairs
          const n = (String(v ?? '').match(/==[^=\n]+==\s*%%(?:[^%\n]|%(?!%))+%%/g) || []).length
          const lb = document.getElementById('pd-sd-notes-label')
          if (lb) {
            const base = _t('sprint.notesLabel', 'comments')
            lb.textContent = n > 0 ? base + ' (' + pdDig(String(n)) + ')' : base
          }
        }
        const pdSdPaintCount = () => {
          const ta = document.getElementById('pd-sd-text')
          const el = document.getElementById('pd-sd-count')
          if (ta && el) el.textContent = pdDig(String(ta.value.length)) + ' ' + _t('sprint.chars', 'chars')
        }
        const pdSdSetStatus = (kind) => {
          const st = document.getElementById('pd-sd-status')
          if (!st) return
          clearTimeout(sdStatusTimer)
          st.classList.remove('pd-sd-err')
          if (kind === 'saving') st.textContent = _t('sprint.saving', 'Saving…')
          else if (kind === 'saved') {
            st.textContent = '✓ ' + _t('sprint.saved', 'Saved')
            sdStatusTimer = setTimeout(() => { if (st) st.textContent = '' }, 2500)
          } else if (kind === 'error') {
            st.textContent = _t('sprint.saveFailed', "Couldn't save — will retry")
            st.classList.add('pd-sd-err')
          } else st.textContent = ''
        }
        const pdSdSave = async () => {
          if (!sdSprint || sdSaving) return
          const ta = document.getElementById('pd-sd-text')
          if (!ta) return
          sdSaving = true
          pdSdSetStatus('saving')
          try {
            const res = await fetch('/api/sprints/' + sdSprint.id, {
              method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: ta.value }),
            })
            if (!res.ok) throw new Error('save failed')
            sdDirty = false
            pdSdSetStatus('saved')
            const row = pdSprintTruth.find((x) => x && x.id === sdSprint.id)
            if (row) row.description = ta.value
          } catch {
            sdDirty = true
            pdSdSetStatus('error')
            sdTimer = setTimeout(pdSdSave, 6000) // retry — the doc must never silently lose edits
          } finally { sdSaving = false }
        }
        const pdSdSchedule = () => {
          sdDirty = true
          clearTimeout(sdTimer)
          sdTimer = setTimeout(pdSdSave, 1200)
        }
        const pdSdSetView = (v) => {
          const main = document.getElementById('pd-sd-main')
          if (main) main.dataset.view = v
          const w = document.getElementById('pd-sd-tab-write')
          const p = document.getElementById('pd-sd-tab-preview')
          if (w) w.setAttribute('aria-pressed', v === 'write' ? 'true' : 'false')
          if (p) p.setAttribute('aria-pressed', v === 'preview' ? 'true' : 'false')
        }
        const pdSprintOpenDoc = async (sid) => {
          const m = pdSdModal()
          if (!m || !sid) return
          let s = pdSprintTruth.find((x) => x && x.id === sid)
          if (!s) {
            // stale truth (created in another tab / old page state) — refresh once
            try {
              const res = await fetch('/api/projects/' + id)
              if (res.ok) {
                const data = await res.json()
                pdSprintTruth = (data.project ? data.project.sprints : data.sprints) || []
                pdSprintPaintCount()
                s = pdSprintTruth.find((x) => x && x.id === sid)
              }
            } catch { /* offline — fall through to the not-found toast */ }
          }
          if (!s) { window.hibana?.toast(_t('sprint.gone', "Couldn't open this sprint"), 'err'); return }
          sdSprint = { id: s.id, name: s.name, version: s.version || '' }
          const title = document.getElementById('pd-sd-title')
          if (title) title.textContent = s.name || ''
          const ver = document.getElementById('pd-sd-ver')
          if (ver) {
            if (s.version) { ver.hidden = false; ver.textContent = s.version }
            else { ver.hidden = true; ver.textContent = '' }
          }
          const proj = document.getElementById('pd-sd-project')
          if (proj) proj.textContent = (document.getElementById('pd-title')?.textContent || '').trim()
          const ta = document.getElementById('pd-sd-text')
          if (ta) { ta.value = s.description || ''; ta.dir = pdLang() === 'fa' ? 'rtl' : 'auto' }
          clearTimeout(sdTimer); clearTimeout(sdPreviewTimer)
          sdDirty = false
          pdSdSetView('write')
          pdSdPaintPreview(ta ? ta.value : '')
          pdSdPaintCount()
          pdSdSetStatus('')
          m.showModal()
          setTimeout(() => { const t = document.getElementById('pd-sd-text'); if (t) t.focus() }, 30)
        }
        const pdSdClose = async () => {
          const m = pdSdModal()
          if (!m || !m.open) return
          if (sdDirty) {
            await pdSdSave()
            if (sdDirty) { // the save failed — refuse to close, the edits still live here
              window.hibana?.toast(_t('sprint.saveFailed', "Couldn't save — check your connection"), 'err')
              return
            }
          }
          m.close()
        }
        ctx.on('click', (e) => {
          if (e.target.closest('#pd-sd-close') || e.target.closest('#pd-sd-done')) { e.preventDefault(); pdSdClose(); return }
          const w = e.target.closest('#pd-sd-tab-write')
          if (w) { e.preventDefault(); pdSdSetView('write'); const t = document.getElementById('pd-sd-text'); if (t) t.focus(); return }
          const p = e.target.closest('#pd-sd-tab-preview')
          if (p) {
            e.preventDefault()
            const t = document.getElementById('pd-sd-text')
            pdSdPaintPreview(t ? t.value : '')
            pdSdSetView('preview')
            return
          }
          // S34: the foot's comments show/hide — off = the clean read (anchors render
          // as plain text, popovers vanish); the state rides the #pd-sd.nonotes class.
          const nb = e.target.closest('#pd-sd-notes')
          if (nb) {
            e.preventDefault()
            const wrap = document.getElementById('pd-sd')
            if (!wrap) return
            const hidden = wrap.classList.toggle('nonotes')
            nb.setAttribute('aria-pressed', hidden ? 'false' : 'true')
            return
          }
          // S34: task checkboxes TOGGLE straight from the preview — data-sdl is the RAW
          // line index, so the click writes [x]/[ ] back into the source + autosaves.
          // (The browser toggles input.checked BEFORE dispatching this click.)
          const cb = e.target.closest ? e.target.closest('.sd-task input[type="checkbox"]') : null
          if (cb && pdSdModal()?.open) {
            const ta = document.getElementById('pd-sd-text')
            if (ta) {
              const li = Number(cb.dataset.sdl)
              const ls = ta.value.split('\n')
              if (ls[li] && /^(\s*[-*]\s+)\[[ xX]\]/.test(ls[li])) {
                ls[li] = ls[li].replace(/^(\s*[-*]\s+)\[[ xX]\]/, (m0, p1) => p1 + (cb.checked ? '[x]' : '[ ]'))
                ta.value = ls.join('\n')
                pdSdSchedule()
                pdSdPaintCount()
                pdSdPaintPreview(ta.value)
              }
            }
            return
          }
          // S34: tap/click on a comment anchor PINS its popover (touch has no hover);
          // a click anywhere else in the preview clears the pin.
          const note = e.target.closest ? e.target.closest('.sd-note') : null
          if (note) {
            const was = note.classList.contains('sd-note-open')
            const pv = document.getElementById('pd-sd-preview')
            if (pv) pv.querySelectorAll('.sd-note-open').forEach((n) => n.classList.remove('sd-note-open'))
            if (!was) note.classList.add('sd-note-open')
            return
          }
          if (e.target.closest && e.target.closest('#pd-sd-preview')) {
            const pv = document.getElementById('pd-sd-preview')
            if (pv) pv.querySelectorAll('.sd-note-open').forEach((n) => n.classList.remove('sd-note-open'))
          }
        })
        // Esc on the editor dialog: flush the pending autosave BEFORE closing (the
        // 'cancel' event bubbles — catch it at the document, target = the dialog).
        ctx.on('cancel', (e) => {
          const m = pdSdModal()
          if (e.target !== m || !m || !m.open) return
          e.preventDefault()
          pdSdClose()
        })
        // typing → autosave + live preview + count
        ctx.on('input', (e) => {
          if (e.target?.id !== 'pd-sd-text') return
          // CODE PROTECTION: hib-init's Session-19 converter (typed Latin digits →
          // Persian when the preceding char is Farsi/space/nothing) would corrupt CODE —
          // inside a ``` fence, "= 12" is a space before the digit → "۱۲". This listener
          // registers BEFORE hib-init's DOMContentLoaded one (defer order), so stopping
          // propagation here keeps fence digits Latin. Prose OUTSIDE fences keeps the
          // conversion — the app's FA-numeral policy applies to the plan's prose, not its code.
          if (pdSdInFence(e.target)) e.stopImmediatePropagation()
          pdSdSchedule()
          pdSdPaintCount()
          clearTimeout(sdPreviewTimer)
          sdPreviewTimer = setTimeout(() => pdSdPaintPreview(e.target.value), 250)
        })
        // -- the rich-text toolbar ------------------------------------------------------
        // Markdown-in-textarea (same philosophy as the task composer's [data-tb]): every
        // button edits the RAW text around the selection so the value round-trips
        // verbatim. Line-prefix kinds (h2/h3/list/num/quote) operate per line and
        // TOGGLE; wrap kinds (bold/italic/inline/code/link) wrap the selection; hr
        // drops a rule on its own line. Fences always land on their OWN lines (the
        // renderer + the API's round-trip contract).
        const pdSdApply = (ta, kind) => {
          if (!ta) return
          const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart
          const e = ta.selectionEnd == null ? s : ta.selectionEnd
          const v = ta.value
          const sel = v.slice(s, e)
          const after = () => { ta.focus(); pdSdSchedule(); pdSdPaintCount() }
          if (kind === 'bold' || kind === 'italic' || kind === 'strike' || kind === 'inline') {
            const w = kind === 'bold' ? '**' : kind === 'italic' ? '*' : kind === 'strike' ? '~~' : '`'
            ta.setRangeText(w + sel + w, s, e, 'end')
            if (sel) ta.setSelectionRange(s + w.length, s + w.length + sel.length)
            else ta.setSelectionRange(s + w.length, s + w.length) // caret inside the pair
            after()
            return
          }
          // S34: PRIVATE COMMENT — ==selection== %%note%%; the note placeholder lands
          // SELECTED so the very next keystroke types the rationale over it.
          if (kind === 'note') {
            const anchor = sel || _t('sprint.noteText', 'text')
            const ph = _t('sprint.notePh', 'comment…')
            ta.setRangeText('==' + anchor + '== %%' + ph + '%%', s, e, 'end')
            const ns = s + anchor.length + 2 + 3 // first char of the note placeholder
            ta.setSelectionRange(ns, ns + ph.length)
            after()
            return
          }
          // S34: image — selection becomes the alt text, the URL placeholder selected
          if (kind === 'img') {
            const alt = sel || _t('sprint.imgAlt', 'image')
            ta.setRangeText('![' + alt + '](https://)', s, e, 'end')
            const us = s + 2 + alt.length + 3 // 'h' of the https:// placeholder
            ta.setSelectionRange(us, us + 8) // type to replace
            after()
            return
          }
          // S34: table skeleton — header + separator + one body row, first cell selected
          if (kind === 'table') {
            const pre = s === 0 || v[s - 1] === '\n' ? '' : '\n'
            const post = e === v.length || v[e] === '\n' ? '' : '\n'
            const cA = _t('sprint.tColA', 'Column A')
            const cB = _t('sprint.tColB', 'Column B')
            const row = _t('sprint.tRow', 'Row 1')
            ta.setRangeText(pre + '| ' + cA + ' | ' + cB + ' |\n| --- | --- |\n| ' + row + ' |  |' + post, s, e, 'end')
            const cs = s + pre.length + 2 // first header cell's text
            ta.setSelectionRange(cs, cs + cA.length)
            after()
            return
          }
          if (kind === 'code') {
            const pre = s === 0 || v[s - 1] === '\n' ? '' : '\n'
            const post = e === v.length || v[e] === '\n' ? '' : '\n'
            ta.setRangeText(pre + '```\n' + sel + '\n```' + post, s, e, 'end')
            const caret = s + pre.length + 4 // first code line — start typing code right away
            ta.setSelectionRange(caret, caret)
            after()
            return
          }
          if (kind === 'link') {
            const text = sel || _t('sprint.linkText', 'link')
            ta.setRangeText('[' + text + '](https://)', s, e, 'end')
            const us = s + 1 + text.length + 3 // 'h' of https://
            ta.setSelectionRange(us, us + 8) // the placeholder URL selected — type to replace
            after()
            return
          }
          if (kind === 'hr') {
            const pre = s === 0 || v[s - 1] === '\n' ? '' : '\n'
            const post = e === v.length || v[e] === '\n' ? '' : '\n'
            ta.setRangeText(pre + '---\n' + post, s, e, 'end')
            after()
            return
          }
          // line-prefix kinds: h2 / h3 / list / num / task / quote — operate on the whole
          // selected line block; toggling strips the same prefix, and list/num/task
          // conversions replace whichever block prefix was there.
          const ls = v.lastIndexOf('\n', s - 1) + 1
          let le = v.indexOf('\n', Math.max(e, s))
          if (le === -1) le = v.length
          const block = v.slice(ls, le)
          const lines = block.split('\n')
          // the task marker strips FIRST (a "- [ ] x" line would otherwise re-stack)
          const stripAny = (l) => l.replace(/^\s*(?:#{1,3}\s+|[-*]\s+\[[ xX]\]\s*|[-*]\s+|\d+\.\s+|>\s+)/, '')
          // A bare click on an EMPTY field must INSERT the prefix (the vacuous toggle
          // check would read "already prefixed" and do nothing); blank SEPARATOR lines
          // inside a multi-line block stay blank (only the line the caret is on — or
          // was last on — receives the prefix when the block is otherwise empty).
          const loneEmpty = lines.length === 1 && lines[0].trim() === ''
          let out
          if (kind === 'list' || kind === 'num' || kind === 'task') {
            out = lines.map((l, i) => {
              if (loneEmpty) return kind === 'list' ? '- ' : kind === 'task' ? '- [ ] ' : '1. '
              const bare = stripAny(l)
              if (bare.trim() === '') return l
              if (kind === 'list') return '- ' + bare
              if (kind === 'task') return '- [ ] ' + bare
              return (i + 1) + '. ' + bare
            }).join('\n')
          } else {
            const p = kind === 'h2' ? '## ' : kind === 'h3' ? '### ' : '> '
            const re = new RegExp('^(\\s*)' + p.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&'))
            const nonEmpty = lines.filter((l) => l.trim() !== '')
            const has = nonEmpty.length > 0 && nonEmpty.every((l) => re.test(l))
            out = lines.map((l) => {
              if (loneEmpty) return p
              if (l.trim() === '') return l
              return has ? l.replace(re, '$1') : p + l
            }).join('\n')
          }
          ta.setRangeText(out, ls, le, 'end')
          after()
        }
        ctx.on('click', (e) => {
          const btn = e.target.closest('[data-sb]')
          if (!btn || !pdSdModal()?.open) return
          e.preventDefault()
          pdSdApply(document.getElementById('pd-sd-text'), btn.dataset.sb)
        })
        // keyboard: Ctrl/Cmd+B / Ctrl/Cmd+I shortcuts; Ctrl/Cmd+M drops a PRIVATE
        // COMMENT (the S34 ask); Tab indents (2 spaces) when the caret sits inside a
        // ``` fence — the code-block writing experience.
        const pdSdInFence = (ta) => {
          const upto = ta.value.slice(0, ta.selectionStart)
          const fences = upto.split('\n').filter((l) => /^\s*```/.test(l)).length
          return fences % 2 === 1
        }
        ctx.on('keydown', (e) => {
          const ta = e.target
          if (ta?.id !== 'pd-sd-text') return
          const mod = e.ctrlKey || e.metaKey
          if (mod && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); pdSdApply(ta, 'bold'); return }
          if (mod && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); pdSdApply(ta, 'italic'); return }
          if (mod && (e.key === 'm' || e.key === 'M')) { e.preventDefault(); pdSdApply(ta, 'note'); return }
          if (e.key === 'Tab' && !e.shiftKey && pdSdInFence(ta)) {
            e.preventDefault()
            ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end')
            pdSdSchedule()
            pdSdPaintCount()
          }
        })

        // AUTO-SORT placement (user request): a wrap sits BEFORE the first card whose
        // priority ranks below it (equal ranks keep arrival/drag order).
        const pdSortWrap = (colTasks, wrap) => {
          const prio = wrap.dataset.pdPriority || 'medium'
          for (const w of colTasks.querySelectorAll('.pd-task-wrap')) {
            if (w === wrap) continue
            if (pdPrioRank(w.dataset.pdPriority || 'medium') > pdPrioRank(prio)) {
              colTasks.insertBefore(wrap, w)
              return
            }
          }
          colTasks.insertBefore(wrap, colTasks.querySelector('[data-pd-more]') || null)
        }

        // --- Session 22 (user request): unlimited task titles, clamped at 150 CHARS in
        // the progress boxes. The rest of the title lives in a hidden .pd-title-rest
        // span INSIDE the title element — textContent still reads the FULL title (the
        // magic wand, inline editors, copy/export, undo all consume textContent).
        // [data-task-read-more] toggles it; the delegated handler lives below.
        //
        // Session 23 (user request): titles may carry fenced ``` CODE blocks, **bold**
        // and manual line breaks — SAME renderer as the server (routes/projects.ts
        // renderTitle): fence lines open/close a <code class="t-code" dir="ltr"> mono
        // container with the fence LINES kept in <span hidden class="t-fence"> markers
        // INSIDE it, so textContent round-trips the RAW title exactly. Prose lines get
        // **pair** → <strong>. Unclosed fences render as code till end (self-healing).
        // S30 batch 5 (the W3 first slice): the title-clamp renderer is the SHARED
        // HibanaChips module (chip-render.js) — byte-identical twins of this code
        // lived in board-page.js too. Local names stay so the render call-sites are
        // untouched; the wand listener below uses HibanaChips.applyTitle.
        const PD_TITLE_CLAMP = window.HibanaChips.TITLE_CLAMP
        const pdRenderTitle = (raw) => window.HibanaChips.renderTitle(raw)
        const pdTitleHtml = (title) => window.HibanaChips.titleHtml(title)
        const pdTitleAttrs = (title) => window.HibanaChips.titleAttrs(title)
        const pdReadMoreBtn = (title) => window.HibanaChips.readMoreBtn(title)
        // Re-clamp an existing title element in place (after edits / wand writes) and
        // keep its read-more button in sync — the shared HibanaChips.applyTitle.
        const pdApplyTitle = (el, text) => window.HibanaChips.applyTitle(el, text)
        // read-more / read-less toggle (delegated — cards re-render on every swap).
        // NOTE: ctx.on handlers are separate document-level listeners, so
        // stopPropagation can't stop the card-click editor handler — the card-click
        // handler below also guards on [data-task-read-more] (belt + suspenders).
        ctx.on('click', (e) => {
          const btn = e.target.closest('[data-task-read-more]')
          if (!btn) return
          e.preventDefault()
          e.stopPropagation()
          const holder = btn.closest('.pd-task-body')
          const title = holder ? holder.querySelector('.pd-task-title') : null
          const rest = title ? title.querySelector('.pd-title-rest') : null
          if (!title || !rest) return
          if (rest.hidden) {
            rest.hidden = false
            title.removeAttribute('data-clamped')
            btn.textContent = _t('pd.readLess', 'read less')
            btn.setAttribute('aria-expanded', 'true')
          } else {
            rest.hidden = true
            title.setAttribute('data-clamped', '')
            btn.textContent = _t('pd.readMore', 'read more')
            btn.setAttribute('aria-expanded', 'false')
          }
        })
        // The magic wand writes plain textContent into titles (magic-wand.js) — that
        // wipes the hidden-rest structure. Re-clamp whenever it writes one.
        document.addEventListener('hibana:title-written', (e) => {
          const el = e.target
          if (el && (el.classList.contains('pd-task-title') || el.classList.contains('db-card-title'))) {
            pdApplyTitle(el, el.textContent || '')
          }
        })

        const insertTaskChip = (status, task) => {
          const colTasks = document.querySelector(`[data-pd-tasks="${status}"]`)
          const countEl = document.querySelector(`[data-pd-count="${status}"]`)
          if (!colTasks || !countEl) return
          const n = Number(countEl.dataset.n || '0') + 1
          countEl.dataset.n = String(n)
          countEl.textContent = pdDig(n)

          const wrap = document.createElement('div')
          wrap.className = 'pd-task-wrap'
          wrap.dataset.pdTask = String(task.id)
          wrap.dataset.pdStatus = status
          wrap.dataset.pdCreated = task.created_at || new Date().toISOString()
          // S29 follow-up: the card CARRIES its priority + labels (data-pd-tags) — the
          // inline editor pre-fills from these (the old editor always defaulted to
          // medium and silently reset an urgent task's priority on save).
          const prio = task.priority || 'medium'
          const tags = Array.isArray(task.tags) ? task.tags : []
          wrap.dataset.pdPriority = prio
          pdTierTrack(String(task.id), prio)
          wrap.dataset.pdTags = JSON.stringify(tags)
          // Session 22: div + role=button (matches the server-rendered cards) — click
          // opens the inline editor everywhere; the old <a href="/board.html"> made
          // freshly-added tasks navigate instead. Title clamped at 150 chars with the
          // hidden rest + read-more button.
          wrap.innerHTML = `<div class="pd-task st-${status}" draggable="true" role="button" tabindex="0" aria-label="${pdEsc(task.title)}"><span class="pd-task-body"><span class="pd-task-title-row" dir="auto"><button type="button" class="prio-dot-btn" data-pd-cycle-prio title="${pdEsc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', pdPrioLabel(prio)))}" aria-label="${pdEsc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', pdPrioLabel(prio)))}"><span class="prio-dot prio-${pdEsc(prio)}"></span></button><span class="pd-task-title"${pdTitleAttrs(task.title)}>${pdTitleHtml(task.title)}</span></span>${pdReadMoreBtn(task.title)}${pdTagChipsHtml(tags)}<span class="pd-task-meta">${pdMetaHtml(prio, wrap.dataset.pdCreated, false)}</span></span></div>`

          // AUTO-SORT (user request 2026-09-12): the card lands BEFORE the first card
          // whose priority ranks below it — urgent tasks jump to the top of their box.
          // A full column only shows the newcomer when it OUTRANKS the last visible
          // card (exactly what a reload renders); otherwise it grows the more-count.
          const wraps = [...colTasks.querySelectorAll('.pd-task-wrap')]
          const shown = wraps.length
          const MAX_VISIBLE = 5 // Session 19 (user request): was 3
          if (shown < MAX_VISIBLE) {
            pdSortWrap(colTasks, wrap)
          } else {
            const last = wraps[wraps.length - 1]
            if (last && pdPrioRank(prio) < pdPrioRank(last.dataset.pdPriority || 'medium')) {
              pdSortWrap(colTasks, wrap)
              last.remove() // displaced below the visible five
            }
          }
          // The +N more link always reflects n − visible (stays correct through
          // displacements — the old text was only patched on the plain-append path).
          const visibleNow = colTasks.querySelectorAll('.pd-task-wrap').length
          const hidden = n - visibleNow
          if (hidden > 0) {
            const moreEl = colTasks.querySelector('[data-pd-more]')
            if (moreEl) {
              moreEl.textContent = '+' + pdDig(hidden) + ' ' + _t('pd.more', 'more')
            } else {
              const el = document.createElement('button')
              el.type = 'button'
              el.className = 'pd-more-link'
              el.dataset.pdMore = status
              el.textContent = '+' + pdDig(hidden) + ' ' + _t('pd.more', 'more')
              colTasks.appendChild(el)
            }
          }

          // S30 batch 2: an active filter applies to the newcomer too (a hidden card
          // beats a filter-breaking one).
          pdFilterApply()

          // Header meta + progress bar (data hooks come from detailHtml).
          const board = document.getElementById('pd-board')
          if (board) {
            board.dataset.total = String(Number(board.dataset.total || '0') + 1)
            if (status === 'done') board.dataset.done = String(Number(board.dataset.done || '0') + 1)
            const total = Number(board.dataset.total)
            const done = Number(board.dataset.done || '0')
            const pct = total ? Math.round((done / total) * 100) : 0
            const line = document.querySelector('[data-pd-tasks-line]')
            if (line) { line.hidden = false; line.textContent = ' · ' + pdTasksLine(done, total) }
            // S29: the task math drives the AUTO display only — in Manual mode the
            // progress_percent override stays (0002's contract), via the shared painter.
            window.__pdPaintAutoProgress?.(pct)
          }
          const empty = document.querySelector('[data-pd-empty]')
          if (empty) empty.remove()
          // S46 (user request 2026-09-14): inject the ⋯ menu + [data-magic] attrs
          // into the freshly-added card NOW. Before this, a newly-added task showed
          // NO ⋯ menu and NO magic-wand until a page refresh — injectPdTaskMenus was
          // only wired to htmx swap/load events, and insertTaskChip builds the DOM
          // directly (no swap fires). Idempotent: the :not([data-menu-ok]) guard in
          // injectPdTaskMenus means only the new card (which lacks data-menu-ok) is
          // touched; already-injected cards are skipped.
          injectPdTaskMenus()
        }

        // --- Dev-task composer modal (user request 2026-09-15): the «افزودن» button in
        // each progress box used to reveal a one-line inline input — a long sentence
        // only showed a few words while typing. It now opens the #pd-taskadd-modal
        // dialog (server-rendered with #project-body): a wide multi-row textarea with
        // the whole sentence visible. Session 22 (user request): the title is now
        // UNLIMITED — the old "۰ / ۳۰۰" char counter is gone (the 300 cap was lifted
        // end-to-end; the server keeps only a 100k sanity guard). Enter adds (the title
        // is single-line — Shift+Enter newlines are collapsed to spaces on submit), Esc
        // / Cancel / ✕ close. Same POST + insertTaskChip path as the old composer, so
        // chip/count/progress still update in place. All delegated through ctx with
        // click-time lookups — the dialog markup re-renders on every htmx swap of
        // #project-body, so nothing can be cached at mount time.
        const taskAddEl = () => document.getElementById('pd-taskadd-modal')
        let taskAddStatus = null
        // S46.3: staged screenshots — uploaded immediately on pick (POST, no task_id),
        // rendered as inline thumbnails in #pd-taskadd-shots-grid. Pinned to the new
        // task on submit (PATCH taskId); deleted on cancel/close (cleanup). Each entry:
        // { id, fileName, caption }.
        let stagedShots = []
        const renderTaskAddShots = () => {
          const grid = document.getElementById('pd-taskadd-shots-grid')
          const cnt = document.getElementById('pd-taskadd-shots-count')
          if (cnt) cnt.textContent = stagedShots.length ? _t('project.shotsAttached', '{n} attached').replace('{n}', String(stagedShots.length)) : ''
          if (!grid) return
          if (!stagedShots.length) { grid.innerHTML = ''; return }
          const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
          // S46.6: IMG onerror retries up to 4× (KV read-after-write propagation delay)
          const retryAttr = ' onerror="(function(i){var n=+(i.dataset.r||0)+1;if(n<4){i.dataset.r=n;var s=i.src;i.onerror=null;setTimeout(function(){i.src=s},800*n)}})(this)"'
          grid.innerHTML = stagedShots.map((s) =>
            '<figure class="shot-card pd-staged-shot" data-staged="' + esc(s.id) + '">' +
              '<button type="button" class="shot-img-btn" data-staged-zoom="' + esc(s.id) + '"><img src="/api/media/screenshots/' + esc(s.id) + '/file" alt="" loading="lazy"' + retryAttr + '></button>' +
              '<figcaption class="shot-body">' +
                (s.caption ? '<p class="shot-note muted small" dir="auto">' + esc(s.caption) + '</p>' : '') +
                '<div class="row spread shot-actions">' +
                  '<button type="button" class="ghost small" data-staged-note="' + esc(s.id) + '" title="' + (s.caption ? _t('notes.editNote', 'Edit note') : _t('notes.addNote', 'Add note')) + '">' + (s.caption ? _t('notes.editNote', 'Edit note') : _t('notes.addNote', 'Add note')) + '</button>' +
                  '<button type="button" class="ghost small danger" data-staged-del="' + esc(s.id) + '" title="' + _t('common.delete', 'Delete') + '" aria-label="' + _t('common.delete', 'Delete') + '">✕</button>' +
                '</div>' +
              '</figcaption>' +
            '</figure>'
          ).join('')
        }
        const cleanupStagedShots = async () => {
          // S46.3: on cancel/close, delete every staged (unattached) screenshot so they
          // don't orphan in the project's gallery. Best-effort — silent on per-shot failure.
          for (const s of [...stagedShots]) {
            try { await fetch('/api/screenshots/' + s.id, { method: 'DELETE' }) } catch { /* leave it — gallery can clean later */ }
          }
          stagedShots = []
          renderTaskAddShots()
        }
        ctx.on('click', (e) => {
          const btn = e.target.closest('[data-pd-add]')
          if (!btn) return
          e.preventDefault()
          const m = taskAddEl()
          const ta = document.getElementById('pd-taskadd-textarea')
          if (!m || !ta) return
          taskAddStatus = btn.dataset.pdAdd || null
          ta.value = ''
          stagedShots = []
          renderTaskAddShots()
          // S29 follow-up: reset the priority dropdown (+ its preview chip) and the
          // labels input — every open starts clean at Medium.
          const prioSel = document.getElementById('pd-taskadd-priority')
          if (prioSel) { prioSel.value = 'medium'; pdSyncPrioChip('pd-taskadd-prio-chip', 'medium') }
          const tagsIn = document.getElementById('pd-taskadd-tags')
          if (tagsIn) tagsIn.value = ''
          // S46.3: the Status dropdown defaults to the clicked column (taskAddStatus) +
          // the "Lands in" chip mirrors it. The user can change the dropdown to land the
          // task in a different column than the one whose + they clicked.
          const statusSel = document.getElementById('pd-taskadd-status')
          if (statusSel && taskAddStatus) statusSel.value = taskAddStatus
          const err = document.getElementById('pd-taskadd-error')
          if (err) { err.hidden = true; err.textContent = '' }
          const chip = document.getElementById('pd-taskadd-col-chip')
          if (chip) {
            const label = document.querySelector(`.pd-col[data-status="${taskAddStatus}"] .pd-col-title`)
            chip.textContent = label ? label.textContent.trim() : (taskAddStatus || '')
          }
          m.showModal()
          setTimeout(() => ta.focus(), 10)
        })
        // S46.3: the Status dropdown updates the "Lands in" chip live (so the user sees
        // which column the task will land in before they save).
        ctx.on('change', (e) => {
          if (e.target?.id !== 'pd-taskadd-status') return
          const chip = document.getElementById('pd-taskadd-col-chip')
          if (!chip) return
          const label = document.querySelector(`.pd-col[data-status="${e.target.value}"] .pd-col-title`)
          chip.textContent = label ? label.textContent.trim() : (e.target.value || '')
        })
        // ✕ / لغو — Esc is native dialog cancel, no handler needed
        ctx.on('click', async (e) => {
          if (e.target.closest('#pd-taskadd-close') || e.target.closest('#pd-taskadd-cancel')) {
            const m = taskAddEl()
            if (m && m.open) {
              // S46.3: cleanup any staged (unattached) screenshots so they don't orphan
              await cleanupStagedShots()
              m.close()
            }
          }
        })
        // S46.3: Esc (native dialog cancel) ALSO needs cleanup — listen for the 'close'
        // event so both the ✕/لغو click + the Esc key clean up staged shots.
        document.addEventListener('close', (e) => {
          const d = e.target
          if (!(d instanceof Element) || d.id !== 'pd-taskadd-modal') return
          if (stagedShots.length) cleanupStagedShots()
        })
        // S29 follow-up: the priority selects' live color chips (add composer + inline
        // editor) — delegated because both dialogs re-render with every htmx swap.
        ctx.on('change', (e) => {
          if (e.target?.id === 'pd-taskadd-priority') pdSyncPrioChip('pd-taskadd-prio-chip', e.target.value)
        })
        // Session 19 (user request): clicking a task card opens the inline edit modal
        // (no more redirect to board.html). The ⋯ menu's Edit button already does this;
        // now the whole card is clickable. Skips if the click was on the ⋯ menu, the
        // prio-dot, or the read-more toggle (Session 22 — that expands the title).
        ctx.on('click', (e) => {
          const task = e.target.closest('.pd-task[role="button"]')
          if (!task) return
          // Don't hijack clicks on the ⋯ menu or its popover
          if (e.target.closest('.spark-menu, .spark-menu-pop, [data-menu-open]')) return
          // Don't open the editor when the read-more button was clicked
          if (e.target.closest('[data-task-read-more]')) return
          // S30 batch 2: the prio-dot (cycle priority) + label chips (filter) are their
          // own actions — never open the editor from them.
          if (e.target.closest('[data-pd-cycle-prio], .pd-tag')) return
          const wrap = task.closest('.pd-task-wrap')
          if (!wrap) return
          const tid = wrap.dataset.pdTask
          if (!tid) return
          e.preventDefault()
          openPdTaskEditor(tid, wrap)
        })
        // Session 19 (user request): the "بیشتر" (more) button expands the full list inline
        // instead of navigating to board.html. Fetches all devtasks for the project,
        // renders the hidden ones (beyond the 5 visible), and toggles to "show less".
        ctx.on('click', async (e) => {
          const moreBtn = e.target.closest('[data-pd-more]')
          if (!moreBtn) return
          e.preventDefault()
          const status = moreBtn.dataset.pdMore
          const tasksEl = document.querySelector(`[data-pd-tasks="${status}"]`)
          if (!tasksEl) return
          const isExpanded = tasksEl.dataset.expanded === '1'
          if (isExpanded) {
            // Collapse: remove all items beyond the first 5 + restore the more button
            const all = [...tasksEl.querySelectorAll('.pd-task-wrap')]
            const MAX = 5
            all.slice(MAX).forEach((el) => el.remove())
            const total = Number(tasksEl.dataset.pdTotal || '0')
            const hidden = total - MAX
            if (hidden > 0) {
              moreBtn.textContent = '+' + pdDig(hidden) + ' ' + _t('pd.more', 'more')
              moreBtn.style.display = ''
            } else {
              moreBtn.remove()
            }
            tasksEl.dataset.expanded = '0'
          } else {
            // Expand: fetch all tasks for this project + render the ones not yet shown
            try {
              const res = await fetch('/api/projects/' + id)
              if (!res.ok) return
              const data = await res.json()
              // The JSON endpoint returns { project: { ...p, ...d } } — devTasks is nested
              const allTasks = ((data.project ? data.project.devTasks : data.devTasks) || []).filter((t) => t.status === status)
              // S29 follow-up: labels come down as a flat devTaskTags join — group once.
              const tagRows = (data.project ? data.project.devTaskTags : data.devTaskTags) || []
              const tagsBy = {}
              for (const r of tagRows) (tagsBy[r.task_id] = tagsBy[r.task_id] || []).push({ name: r.name, color: r.color })
              const shownIds = new Set([...tasksEl.querySelectorAll('.pd-task-wrap')].map((w) => w.dataset.pdTask))
              const hiddenTasks = allTasks.filter((t) => !shownIds.has(t.id))
              for (const t of hiddenTasks) {
                const wrap = document.createElement('div')
                wrap.className = 'pd-task-wrap'
                wrap.dataset.pdTask = t.id
                wrap.dataset.pdStatus = status
                wrap.dataset.pdCreated = t.created_at
                if (t.done_at) wrap.dataset.pdDone = t.done_at
                const tp = t.priority || 'medium'
                const tt = tagsBy[t.id] || []
                wrap.dataset.pdPriority = tp
                wrap.dataset.pdTags = JSON.stringify(tt)
                // Session 22: div + role=button + 150-char clamp — same as insertTaskChip.
                wrap.innerHTML = `<div class="pd-task st-${status}" draggable="true" role="button" tabindex="0" aria-label="${pdEsc(t.title)}"><span class="pd-task-body"><span class="pd-task-title-row" dir="auto"><button type="button" class="prio-dot-btn" data-pd-cycle-prio title="${pdEsc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', pdPrioLabel(tp)))}" aria-label="${pdEsc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', pdPrioLabel(tp)))}"><span class="prio-dot prio-${pdEsc(tp)}"></span></button><span class="pd-task-title"${pdTitleAttrs(t.title)}>${pdTitleHtml(t.title)}</span></span>${pdReadMoreBtn(t.title)}${pdTagChipsHtml(tt)}<span class="pd-task-meta">${pdMetaHtml(tp, t.created_at, status === 'done')}</span></span></div>`
                tasksEl.insertBefore(wrap, moreBtn)
              }
              // Session 24 (root-cause fix): wire data-magic + ⋯ menu on the newly
              // inserted items (6+) so the magic wand + edit/delete actions work on
              // ALL items, not just the first 5 the server rendered. Idempotent —
              // :not([data-menu-ok]) skips already-processed cards.
              injectPdTaskMenus()
              moreBtn.textContent = _t('pd.showLess', 'show less')
              tasksEl.dataset.expanded = '1'
              // S30 batch 2: the expanded wraps respect the active filter.
              pdFilterApply()
            } catch { /* fetch failed — keep the more button as-is */ }
          }
        })
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('#pd-taskadd-form') : null
          if (!form) return
          e.preventDefault()
          const m = taskAddEl()
          const ta = document.getElementById('pd-taskadd-textarea')
          const save = document.getElementById('pd-taskadd-save')
          const err = document.getElementById('pd-taskadd-error')
          if (!m || !ta || !taskAddStatus) return
          // Session 22: the title is UNLIMITED — the old 300 maxlength + counter are
          // gone; the server's Zod schema keeps only a 100k sanity guard.
          // Session 23 (user request): newlines are PRESERVED now — titles render
          // multi-line (code blocks, bullet lists). Only \r\n is normalized (browsers
          // on Windows paste) + outer trim. The 100k server guard still applies.
          const title = ta.value.replace(/\r\n/g, '\n').trim()
          if (!title) { m.close(); return }
          if (save) save.disabled = true
          if (err) { err.hidden = true; err.textContent = '' }
          try {
            // S29 follow-up: the composer's priority dropdown + labels ride the create
            // POST (find-or-create + link server-side) — the task lands in its box
            // already prioritized and labeled, then auto-sorts into place.
            // S46.3: the Status dropdown (#pd-taskadd-status) lets the user land the task
            // in a DIFFERENT column than the one whose + they clicked. Defaults to the
            // clicked column (taskAddStatus) but the user can change it in the modal.
            const prioSel = document.getElementById('pd-taskadd-priority')
            const priority = prioSel ? prioSel.value : 'medium'
            const statusSel = document.getElementById('pd-taskadd-status')
            const finalStatus = (statusSel && statusSel.value) || taskAddStatus
            const tagNames = pdParseTags((document.getElementById('pd-taskadd-tags') || {}).value || '')
            const res = await fetch(`/api/projects/${id}/devtasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, status: finalStatus, priority, tags: tagNames }),
            })
            if (!res.ok) throw new Error('add failed')
            const data = await res.json()
            // S46.3: the staged screenshots (already uploaded, unattached) are now PINNED
            // to the new task (PATCH taskId via the 0054 link). Clear stagedShots BEFORE
            // m.close() so the dialog's 'close' listener doesn't double-delete them.
            if (stagedShots.length) {
              for (const s of [...stagedShots]) {
                try { await patchShot(s.id, { taskId: data.id }) } catch { /* per-shot pin failure — the shot stays in the gallery unattached */ }
              }
              stagedShots = []
              renderTaskAddShots()
              bodyRefresh()
            } else {
              insertTaskChip(finalStatus, { id: data.id, title, priority, tags: (data.tags || []).map((tg) => ({ name: tg.name, color: tg.color })) })
            }
            ta.value = ''
            const tagsClear = document.getElementById('pd-taskadd-tags')
            if (tagsClear) tagsClear.value = ''
            // S46.3: stagedShots already cleared + grid re-rendered above (pin path);
            // renderTaskAddShots keeps the count in sync. No separate file-input clear
            // (the change handler already resets e.target.value after each pick).
            m.close()
            window.hibana?.toast(_t('db.taskAdded', 'Task added'))
          } catch {
            // Inline error (NOT a toast): the dialog sits in the top layer, so a toast
            // fired while it is open would render behind the veil and never be seen.
            if (err) { err.hidden = false; err.textContent = _t('sparks.saveFailed', "Couldn't save") }
          } finally {
            if (save) save.disabled = false
          }
        })
        // Enter adds the task — the field is a textarea only so long sentences stay
        // visible; plain Enter must behave like the old composer's input.
        ctx.on('keydown', (e) => {
          if (e.target?.id !== 'pd-taskadd-textarea') return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            document.getElementById('pd-taskadd-form')?.requestSubmit()
          }
        })

        // --- Session 23 (user request): composer formatting toolbar (Code / Bold / Bullet) ---
        // ONE delegated handler serves BOTH composers: the server-rendered add dialog
        // (re-rendered on every htmx swap of #project-body) and the JS-built inline edit
        // dialog — the button looks up the editable textarea in its own <form>. Code
        // wraps the selection in ``` fences (or drops an empty block at the cursor and
        // puts the caret inside it); Bold wraps in **pairs**; Bullet prefixes every
        // selected line with "- ". Fences always land on their OWN lines so the renderer
        // (pdRenderTitle / renderTitle) recognizes them.
        // S48d (owner: "fullscreen editor needs underline/strikethrough/ordered-list/
        // alignment"): extended with __underline__, ~~strikethrough~~, 1. ordered list,
        // and {:left}/{:center}/{:right}/{:justify} paragraph-alignment markers.
        const pdApplyTb = (ta, kind) => {
          if (!ta) return
          const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart
          const e = ta.selectionEnd == null ? s : ta.selectionEnd
          const v = ta.value
          const sel = v.slice(s, e)
          if (kind === 'list' || kind === 'ordered-list') {
            const bullet = kind === 'list' ? '- ' : '1. '
            const ls = v.lastIndexOf('\n', s - 1) + 1
            let le = v.length
            if (sel.includes('\n')) { const n = v.indexOf('\n', Math.max(e, s)); if (n !== -1) le = n }
            const lines = v.slice(ls, le).split('\n')
            const marked = lines.map((l, i) => {
              if (l === '' || l.startsWith('- ') || l.startsWith(/^\d+\.\s/)) return l
              if (kind === 'ordered-list') return (i + 1) + '. ' + l
              return '- ' + l
            }).join('\n')
            ta.setRangeText(marked, ls, le, 'end')
            ta.focus()
            return
          }
          // paragraph-level alignment markers — prefixed at the start of the paragraph
          if (kind === 'align-left' || kind === 'align-center' || kind === 'align-right' || kind === 'align-justify') {
            const dir = kind.replace('align-', '')
            const marker = '{:' + dir + '}'
            const ls = v.lastIndexOf('\n', s - 1) + 1
            const already = v.slice(ls, ls + marker.length) === marker
            if (already) {
              // toggle off — remove the marker
              ta.setRangeText('', ls, ls + marker.length, 'end')
            } else {
              // strip any existing alignment marker on this paragraph first
              const existing = v.slice(ls).match(/^\{:(?:left|center|right|justify)\}/)
              const stripTo = existing ? ls + existing[0].length : ls
              ta.setRangeText(marker + (stripTo > ls ? '' : ''), ls, stripTo, 'end')
            }
            ta.focus()
            return
          }
          let before = '', after = ''
          if (kind === 'code') {
            const pre = s === 0 || v[s - 1] === '\n' ? '' : '\n'
            before = pre + '```\n'
            after = '\n```' + (e === v.length || v[e] === '\n' ? '' : '\n')
          } else if (kind === 'underline') {
            before = '__'; after = '__'
          } else if (kind === 'strikethrough') {
            before = '~~'; after = '~~'
          } else { // bold
            before = '**'
            after = '**'
          }
          ta.setRangeText(before + sel + after, s, e, 'end')
          if (sel) ta.setSelectionRange(s + before.length, s + before.length + sel.length)
          else ta.setSelectionRange(s + before.length, s + before.length) // caret inside the pair/fence
          ta.focus()
        }
        ctx.on('click', (e) => {
          const btn = e.target.closest('[data-tb]')
          if (!btn) return
          e.preventDefault()
          const form = btn.closest('form')
          pdApplyTb(form ? form.querySelector('textarea') : null, btn.dataset.tb)
        })

        // --- ⋯ hover menu on .pd-task items (Edit + Delete) — user request 2026-09 ----
        // Injects a 3-dot menu into each .pd-task card. Edit navigates to board.html (the
        // existing task editor); Delete calls DELETE /api/devtasks/:id + removes the card
        // with an Undo toast. Also marks .pd-task-title with [data-magic] so the magic wand
        // can polish/translate it. Re-runs on every htmx swap (cards are re-rendered).
        function injectPdTaskMenus() {
          // Target .pd-task-wrap (the wrapper OUTSIDE the <a>) so menu clicks don't
          // bubble into the <a>'s navigation. Falls back to .pd-task for back-compat.
          const tasks = document.querySelectorAll('.pd-task-wrap:not([data-menu-ok]), .pd-task:not([data-menu-ok])')
          tasks.forEach((task) => {
            const tid = task.dataset.pdTask
            if (!tid) return
            // Mark the title for the magic wand (polish/translate). Session 22: the
            // 3-line line-clamp + ::after data-more hint is GONE — replaced by the
            // 150-char hidden-rest split (rendered server-side / by the client
            // renderers) + the [data-task-read-more] button; the delegated handler
            // above toggles it.
            const title = task.querySelector('.pd-task-title')
            if (title) {
              title.setAttribute('data-magic', '')
              title.setAttribute('data-magic-save', '/api/devtasks/' + tid)
              title.setAttribute('data-magic-field', 'title')
            }
            // Inject the ⋯ menu (spark-menu pattern, same as sparks/projects pages)
            const menu = document.createElement('div')
            menu.className = 'spark-menu pd-task-menu'
            menu.innerHTML =
              '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + _t('sparks.more', 'More actions') + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>' +
              '</button>' +
              '<div class="spark-menu-pop" hidden>' +
                '<button type="button" data-pd-task-edit="' + tid + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>' + _t('common.edit', 'Edit') + '</span></button>' +
                '<button type="button" class="danger" data-pd-task-delete="' + tid + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>' + _t('common.delete', 'Delete') + '</span></button>' +
              '</div>'
            task.appendChild(menu)
            task.setAttribute('data-menu-ok', '')
            // Direct click handlers on the menu buttons — preventDefault stops the parent <a>
            // from navigating. Document-level delegation was too late (the <a> navigated first).
            const openBtn = menu.querySelector('[data-menu-open]')
            openBtn.addEventListener('click', (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              const pop = menu.querySelector('.spark-menu-pop')
              if (!pop) return
              const willOpen = pop.hidden
              closePdTaskMenus()
              pop.hidden = !willOpen
              if (willOpen) openBtn.setAttribute('data-open', '')
              else openBtn.removeAttribute('data-open')
            })
            menu.querySelector('[data-pd-task-edit]').addEventListener('click', (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              closePdTaskMenus()
              openPdTaskEditor(tid, task)
            })
            menu.querySelector('[data-pd-task-delete]').addEventListener('click', (ev) => {
              ev.preventDefault()
              ev.stopPropagation()
              closePdTaskMenus()
              const card = task
              const status = card.dataset.pdStatus || 'idea'
              const titleText = card.querySelector('.pd-task-title')?.textContent || ''
              // Optimistic removal
              card.remove()
              // Decrement the column count
              const countEl = document.querySelector('[data-pd-count="' + status + '"]')
              if (countEl) {
                const n = Math.max(0, Number(countEl.dataset.n || '0') - 1)
                countEl.dataset.n = String(n)
                countEl.textContent = pdDig(n)
              }
              window.hibana?.toast(_t('db.taskDeleted', 'Task deleted'), 'info', 6000, [{
                label: _t('common.undo', 'Undo'),
                onClick: () => {
                  fetch('/api/projects/' + id + '/devtasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: titleText, status: status }),
                  }).then((r) => r.ok ? window.location.reload() : null).catch(() => {})
                },
              }])
              fetch('/api/devtasks/' + tid, { method: 'DELETE' })
                .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't delete"), 'err'))
            })
          })
        }
        function closePdTaskMenus() {
          document.querySelectorAll('.pd-task .spark-menu-pop:not([hidden])').forEach((pop) => {
            pop.hidden = true
            const btn = pop.parentElement && pop.parentElement.querySelector('[data-menu-open]')
            if (btn) btn.removeAttribute('data-open')
          })
        }
        // Outside click → close (kept as document-level for outside-click only)
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePdTaskMenus() })
        for (const evt of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
          document.addEventListener(evt, injectPdTaskMenus)
        }
        if (document.readyState !== 'loading') injectPdTaskMenus()

        // --- Inline task editor modal (user request 2026-09) — no navigation, opens in-place ---
        // The Edit button on .pd-task cards opens this modal directly (no board.html redirect).
        // Fetches the task's current data via GET /api/projects/:id/devtasks (filtered by id),
        // then PATCHes /api/devtasks/:id on save. Fields: title, status, priority.
        // The card's data-pd-status + the title text are the initial values (no fetch needed
        // for those); priority isn't on the card, so we default to 'medium' if unknown.
        let pdTaskEditDlg = null
        function openPdTaskEditor(tid, cardEl) {
          if (!pdTaskEditDlg) {
            pdTaskEditDlg = document.createElement('dialog')
            pdTaskEditDlg.id = 'pd-task-edit-modal'
            // Session 22 (user request): the big-editor recipe (78rem, was the 26rem
            // dialog.dialog cap) — the edit dialog now matches the add composer.
            pdTaskEditDlg.className = 'dialog pd-taskedit-modal'
            pdTaskEditDlg.innerHTML =
              '<form class="modal" id="pde-form" novalidate>' +
                '<div class="row spread"><h3 id="pde-title">' + _t('pde.title', 'Create a new task') + '</h3>' +
                '<div class="row" style="gap:.25rem">' +
                  '<button type="button" class="ghost icon-btn" id="pde-fullscreen" aria-label="' + _t('pde.fullscreen', 'Full-screen writing') + '" title="' + _t('pde.fullscreen', 'Full-screen writing') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6M4 4v6M14 4h6M20 4v6M4 20v-6M4 20h6M20 20h-6M20 20v-6"/></svg></button>' +
                  '<button type="button" class="ghost icon-btn" id="pde-close" aria-label="' + _t('common.close', 'Close') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div></div>' +
                '<label>' + _t('db.title', 'Title') + ' <textarea id="pde-input" rows="5" dir="' + (pdLang() === 'fa' ? 'rtl' : 'auto') + '" required></textarea></label>' +
                '<div class="pd-tb" role="toolbar" aria-label="' + _t('pd.fmtToolbar', 'Formatting') + '">' +
                  // Format group: Bold, Underline, Strikethrough
                  '<button type="button" class="pd-tb-btn" data-tb="bold" title="' + _t('pd.fmtBold', 'Bold') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a3.5 3.5 0 1 1 0 7H7zM7 12h7a3.5 3.5 0 1 1 0 7H7z"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="underline" title="' + _t('pd.fmtUnderline', 'Underline') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v5a5 5 0 0 0 10 0V4"/><path d="M5 19h14"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="strikethrough" title="' + _t('pd.fmtStrike', 'Strikethrough') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M16 8a4 4 0 0 0-4-2c-2 0-3.5 1-3.5 2.5M8 16a4 4 0 0 0 4 2c2 0 3.5-1 3.5-2.5"/></svg></button>' +
                  '<span class="pd-tb-sep" aria-hidden="true"></span>' +
                  // List group: Bullet list, Ordered list
                  '<button type="button" class="pd-tb-btn" data-tb="list" title="' + _t('pd.fmtList', 'Bullet list') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="ordered-list" title="' + _t('pd.fmtOrderedList', 'Numbered list') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 5h.01M4 4.5v4M3.5 16h1a1 1 0 0 0 0-2h-.5a1 1 0 0 1 0-2H5" stroke-width="1.5" stroke-linecap="round"/></svg></button>' +
                  '<span class="pd-tb-sep" aria-hidden="true"></span>' +
                  // Alignment group
                  '<button type="button" class="pd-tb-btn" data-tb="align-left" title="' + _t('pd.fmtAlignLeft', 'Align left') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="align-center" title="' + _t('pd.fmtAlignCenter', 'Align center') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M6 10h12M6 14h12M4 18h16"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="align-right" title="' + _t('pd.fmtAlignRight', 'Align right') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg></button>' +
                  '<button type="button" class="pd-tb-btn" data-tb="align-justify" title="' + _t('pd.fmtAlignJustify', 'Justify') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg></button>' +
                  '<span class="pd-tb-sep" aria-hidden="true"></span>' +
                  // Code block
                  '<button type="button" class="pd-tb-btn" data-tb="code" title="' + _t('pd.fmtCode', 'Code block') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 6-6 6 6 6M16 6l6 6-6 6"/></svg></button>' +
                '</div>' +
                '<div class="row" style="gap:1rem;margin-top:.4rem">' +
                  '<label style="flex:1">' + _t('db.status', 'Status') + ' <select id="pde-status">' +
                    [['idea','db.st.idea'],['planned','db.st.planned'],['in_progress','db.st.inprog'],['done','db.st.done'],['bug','db.st.bug']].map(function(pair){return '<option value="'+pair[0]+'">'+_t(pair[1], pair[0])+'</option>'}).join('') +
                  '</select></label>' +
                  // S46.7 (owner: "remove the preview chip from defining task"): the
                  // .pd-prio-chip live-color preview is GONE — the select alone is the
                  // priority signal (the chip was redundant + crowded the row).
                  '<label style="flex:1">' + _t('db.priority', 'Priority') + ' <select id="pde-priority" class="pd-prio-select">' +
                    [['urgent','pd.pr.urgent','Urgent'],['high','pd.pr.high','High Priority'],['medium','pd.pr.medium','Medium Priority'],['low','pd.pr.low','Low Priority']].map(function(trio){return '<option value="'+trio[0]+'" class="prio-'+trio[0]+'">'+_t(trio[1], trio[2])+'</option>'}).join('') +
                  '</select></label>' +
                '</div>' +
                '<label class="pd-opt" style="margin-top:.5rem">' + _t('pd.labels', 'Labels') +
                  ' <input id="pde-tags" dir="auto" autocomplete="off" maxlength="480" placeholder="' + _t('pd.labelsPh', 'e.g. UI/UX, Security') + '" aria-label="' + _t('pd.labels', 'Labels') + '" />' +
                  '<span class="muted small">' + _t('pd.labelsHint', 'Comma-separated — a chip per label') + '</span>' +
                '</label>' +
                // S46.2 (owner: "add ability to upload a screenshot directly in this page,
                // and ability to see previously uploaded and attached screenshots"):
                // a screenshot row on the task editor — upload + pin to THIS task (reuses
                // the 0054 screenshots.task_id link) + a "view pinned" button that opens
                // S46.4 (owner: "Screenshot gallery must be visible on same page, not
                // hidden behind a button — like the wireframe, with thumbnails"). The
                // editor now shows pinned shots INLINE (a thumbnail grid with zoom /
                // edit-note / delete), not behind the «تصاویر سنجاق‌شده» button. The
                // upload button stays; an «در حال اپلود تصویر ...» indicator shows during
                // the upload. Same pattern as the #pd-taskadd-shots composer (S46.3).
                '<div class="pd-taskadd-shots" style="margin-top:.5rem">' +
                  '<input type="file" id="pde-shots" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>' +
                  '<div class="row" style="gap:.5rem;align-items:center">' +
                    '<button type="button" class="ghost" id="pde-shots-add" onclick="document.getElementById(\'pde-shots\').click()" title="' + _t('pde.shotsAttachTitle', 'Attach a UI/UX screenshot — pinned to this item') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg> ' + _t('pde.shotsAttach', 'Add image') + '</button>' +
                    '<span class="muted small" id="pde-shots-uploading" hidden>' + _t('pde.shotsUploading', 'Uploading image…') + '</span>' +
                  '</div>' +
                  '<div class="pd-taskadd-shots-grid" id="pde-shots-grid"></div>' +
                '</div>' +
                '<p class="error" id="pde-error" role="alert"></p>' +
                '<div class="row" style="justify-content:space-between;gap:.5rem;margin-top:1rem">' +
                  // Session 24 (user request): delete from inside the edit modal — no
                  // need to close + hunt the card's ⋯ menu. Red ghost on the opposite
                  // end from Cancel/Save; optimistic remove + Undo toast (same recipe
                  // as the card-menu delete).
                  '<button type="button" class="btn danger" id="pde-delete">' + _t('common.delete', 'Delete') + '</button>' +
                  '<div class="row" style="gap:.5rem">' +
                    '<button type="button" class="ghost" id="pde-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
                    // Session 23 (user request: "the ذخیره button must be green like other
                    // buttons"): plain <button> = the system's green CTA fill (was .btn,
                    // the neutral card-bg style).
                    '<button type="submit" id="pde-save">' + _t('common.save', 'Save') + '</button>' +
                  '</div>' +
                '</div>' +
              '</form>'
            document.body.appendChild(pdTaskEditDlg)
            const close = () => pdTaskEditDlg.close()
            // S46.7: in fullscreen mode, ✕/Cancel/Escape EXIT fullscreen first (not
            // close the modal) — so the user doesn't lose their task definition.
            const exitOrClose = () => {
              if (pdTaskEditDlg.classList.contains('pde-fullscreen')) pdTaskEditDlg.classList.remove('pde-fullscreen')
              else close()
            }
            pdTaskEditDlg.addEventListener('cancel', (e) => { e.preventDefault(); exitOrClose() })
            pdTaskEditDlg.addEventListener('click', (e) => { if (e.target === pdTaskEditDlg) exitOrClose() })
            pdTaskEditDlg.querySelector('#pde-close').addEventListener('click', exitOrClose)
            pdTaskEditDlg.querySelector('#pde-cancel').addEventListener('click', exitOrClose)
            // S46.7 (owner: "add a button for full screen writing to optimize focus"):
            // toggles a .pde-fullscreen class on the dialog — CSS expands the textarea
            // to fill the viewport + hides the other rows, so the user can focus on
            // writing the task definition. Click again (or the ✕) to exit.
            pdTaskEditDlg.querySelector('#pde-fullscreen').addEventListener('click', () => {
              pdTaskEditDlg.classList.toggle('pde-fullscreen')
            })
            // S46.4: screenshot upload + INLINE grid on the task editor. The file input
            // uploads each picked file + pins to this task (0054), showing the
            // «در حال اپلود تصویر ...» indicator during the upload. The inline grid
            // (#pde-shots-grid) shows the task's pinned shots with zoom / edit-note /
            // delete — no more "تصاویر سنجاق‌شده" button hiding them behind a dialog.
            pdTaskEditDlg.querySelector('#pde-shots').addEventListener('change', async (e) => {
              const tid = pdTaskEditDlg.dataset.tid
              if (!tid) return
              const files = [...(e.target.files || [])].filter((f) => f.type.startsWith('image/'))
              e.target.value = ''
              if (!files.length) return
              const upl = pdTaskEditDlg.querySelector('#pde-shots-uploading')
              if (upl) upl.hidden = false
              let ok = 0, fail = 0
              for (const file of files) {
                try {
                  const b64 = await new Promise((resolve, reject) => {
                    const r = new FileReader()
                    r.onload = () => resolve(String(r.result).split(',')[1])
                    r.onerror = reject
                    r.readAsDataURL(file)
                  })
                  const upRes = await fetch('/api/projects/' + id + '/screenshots', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64: b64, caption: '' }),
                  })
                  if (!upRes.ok) throw new Error('status ' + upRes.status)
                  const shot = await upRes.json().catch(() => ({}))
                  if (shot.id) { await patchShot(shot.id, { taskId: tid }); ok++ }
                  else throw new Error('no id')
                } catch { fail++ }
              }
              // S46.6: keep the «در حال اپلود تصویر ...» indicator visible UNTIL the
              // grid re-renders (await pdeRenderShotsGrid), so the user sees continuous
              // feedback: indicator → (upload) → indicator → (fetch+render) → thumbnail.
              await pdeRenderShotsGrid(tid)
              if (upl) upl.hidden = true
              if (ok && !fail) window.hibana?.toast(_t('project.shotUploaded', 'Screenshot uploaded'), 'info')
              else if (fail) window.hibana?.toast(_t('project.shotFailed', 'Upload failed'), 'err')
              bodyRefresh()
            })
            // S46.4: delegated handlers on the editor's inline shot grid — zoom / edit-note / delete
            pdTaskEditDlg.querySelector('#pde-shots-grid').addEventListener('click', async (e) => {
              const tid = pdTaskEditDlg.dataset.tid
              const zoom = e.target.closest('[data-pde-shot-zoom]')
              if (zoom) { const img = zoom.querySelector('img'); if (img) openShotLightbox(img.src); return }
              const del = e.target.closest('[data-pde-shot-del]')
              if (del) {
                const sid = del.getAttribute('data-pde-shot-del')
                // S46.8 (owner: "make sure the photo is deleted from database not just invisible"):
                // check res.ok + toast — the DELETE removes the DB row + KV bytes (core.ts:468)
                try {
                  const r = await fetch('/api/screenshots/' + sid, { method: 'DELETE' })
                  if (!r.ok) throw new Error('status ' + r.status)
                  window.hibana?.toast(_t('project.shotDeleted', 'Screenshot deleted'), 'info')
                } catch {
                  window.hibana?.toast(_t('sparks.saveFailed', "Couldn't delete"), 'err')
                }
                pdeRenderShotsGrid(tid)
                bodyRefresh()
                return
              }
              const note = e.target.closest('[data-pde-shot-note]')
              if (note) {
                const sid = note.getAttribute('data-pde-shot-note')
                const { dlg, body } = makeDialog(_t('project.shotNoteTitle', 'Note — what & where to work'), 'pd-peshot-title')
                const escXml = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                body.innerHTML =
                  '<textarea class="pd-shot-note-ta" rows="6" maxlength="1000" dir="auto" data-no-fa-digits="" placeholder="' + escXml(_t('project.shotNotePh', 'What is broken & where — the exact spot to work on…')) + '"></textarea>' +
                  '<div class="pd-shot-note-actions"><button type="button" class="ghost small" data-peshot-cancel>' + _t('common.cancel', 'Cancel') + '</button><button type="button" class="btn small" data-peshot-save>' + _t('common.save', 'Save') + '</button></div>'
                const ta2 = body.querySelector('.pd-shot-note-ta')
                body.querySelector('[data-peshot-cancel]').addEventListener('click', () => dlg.close())
                body.querySelector('[data-peshot-save]').addEventListener('click', async () => {
                  try { await patchShot(sid, { caption: ta2.value.trim() }); dlg.close(); pdeRenderShotsGrid(tid) }
                  catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
                })
                dlg.showModal()
                setTimeout(() => ta2.focus(), 0)
              }
            })
            // Session 24 (user request): delete from inside the edit modal. Same recipe
            // as the card's ⋯ menu delete — optimistic remove + Undo toast + DELETE call.
            pdTaskEditDlg.querySelector('#pde-delete').addEventListener('click', () => {
              const tid = pdTaskEditDlg.dataset.tid
              if (!tid) return
              const card = document.querySelector('.pd-task-wrap[data-pd-task="' + tid + '"]')
              const status = card?.dataset.pdStatus || 'idea'
              const titleText = card?.querySelector('.pd-task-title')?.textContent || ''
              pdTaskEditDlg.close()
              if (card) {
                card.remove()
                const countEl = document.querySelector('[data-pd-count="' + status + '"]')
                if (countEl) {
                  const n = Math.max(0, Number(countEl.dataset.n || '0') - 1)
                  countEl.dataset.n = String(n)
                  countEl.textContent = pdDig(n)
                }
                // Keep data-pd-total in sync so "more" collapse/re-expand counts match
                const tasksEl = document.querySelector('[data-pd-tasks="' + status + '"]')
                if (tasksEl) {
                  const tot = Math.max(0, Number(tasksEl.dataset.pdTotal || '0') - 1)
                  tasksEl.dataset.pdTotal = String(tot)
                }
              }
              window.hibana?.toast(_t('db.taskDeleted', 'Task deleted'), 'info', 6000, [{
                label: _t('common.undo', 'Undo'),
                onClick: () => {
                  fetch('/api/projects/' + id + '/devtasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: titleText, status: status }),
                  }).then((r) => r.ok ? window.location.reload() : null).catch(() => {})
                },
              }])
              fetch('/api/devtasks/' + tid, { method: 'DELETE' })
                .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't delete"), 'err'))
            })
            pdTaskEditDlg.querySelector('#pde-form').addEventListener('submit', async (e) => {
              e.preventDefault()
              const id = pdTaskEditDlg.dataset.tid
              if (!id) return
          // Task titles are multi-line since Session 23 (code blocks + bullet lists):
          // newlines PRESERVED (only \r\n normalized + outer trim) — was collapsed to
          // single spaces. Session 22: the title is UNLIMITED; server keeps a 100k guard.
          const title = pdTaskEditDlg.querySelector('#pde-input').value.replace(/\r\n/g, '\n').trim()
              if (!title) { pdTaskEditDlg.querySelector('#pde-input').focus(); return }
              const status = pdTaskEditDlg.querySelector('#pde-status').value
              const priority = pdTaskEditDlg.querySelector('#pde-priority').value
              // S29 follow-up: labels — replace-set semantics (the input was pre-filled
              // with the task's labels; editing it re-sets them exactly).
              const tagNames = pdParseTags((pdTaskEditDlg.querySelector('#pde-tags') || {}).value || '')
              const err = pdTaskEditDlg.querySelector('#pde-error')
              const save = pdTaskEditDlg.querySelector('#pde-save')
              err.textContent = ''
              save.disabled = true
              save.textContent = _t('common.saving', 'Saving…')
              try {
                const res = await fetch('/api/devtasks/' + id, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title, status, priority, tags: tagNames }),
                })
                if (!res.ok) throw new Error('save failed')
                const data = await res.json().catch(() => ({}))
                window.hibana?.toast(_t('sparks.saved', 'Saved'), 'info')
                pdTaskEditDlg.close()
                // Update the card in-place (no page reload). Session 22: the OLD
                // selector `.pd-task[data-pd-task=…]` matched NOTHING (data-pd-task
                // lives on the .pd-task-wrap wrapper) — the card silently stayed
                // stale after every edit. Query the wrap, update the inner card, and
                // re-clamp the title (pdApplyTitle).
                const wrap = document.querySelector('.pd-task-wrap[data-pd-task="' + id + '"]')
                if (wrap) {
                  const src = wrap.closest('.pd-tasks')
                  const from = src ? src.dataset.pdTasks : status
                  wrap.dataset.pdStatus = status
                  wrap.dataset.pdPriority = priority
                  const serverTags = (data && Array.isArray(data.tags)) ? data.tags.map((tg) => ({ name: tg.name, color: tg.color })) : tagNames.map((name) => ({ name, color: null }))
                  wrap.dataset.pdTags = JSON.stringify(serverTags)
                  const card = wrap.querySelector('.pd-task')
                  if (card) {
                    card.className = 'pd-task st-' + status
                    card.setAttribute('aria-label', title)
                  }
                  const dot = wrap.querySelector('.prio-dot')
                  if (dot) { dot.className = 'prio-dot prio-' + priority; dot.title = pdPrioLabel(priority) }
                  const titleSpan = wrap.querySelector('.pd-task-title')
                  if (titleSpan) pdApplyTitle(titleSpan, title)
                  // Rebuild the label chips + the priority half of the meta line.
                  const oldTags = wrap.querySelector('.pd-task-tags')
                  if (oldTags) oldTags.remove()
                  const chips = pdTagChipsHtml(serverTags)
                  const metaEl = wrap.querySelector('.pd-task-meta')
                  if (chips && metaEl) metaEl.insertAdjacentHTML('beforebegin', chips)
                  if (metaEl) {
                    const prioSpan = metaEl.querySelector('.pd-meta-prio')
                    if (prioSpan) { prioSpan.className = 'pd-meta-prio prio-' + priority; prioSpan.textContent = pdPrioLabel(priority) }
                  }
                  // Status change = the card moves to the new box (counts + progress
                  // repaint, same contract as the drop handler); then AUTO-SORT snaps
                  // it into its priority slot.
                  const dest = document.querySelector('[data-pd-tasks="' + status + '"]')
                  if (dest && dest !== src) {
                    pdSetCount(from, Number(pdCountEl(from)?.dataset.n || '0') - 1)
                    pdSetCount(status, Number(pdCountEl(status)?.dataset.n || '0') + 1)
                    const tasksSrc = src
                    if (tasksSrc) tasksSrc.dataset.pdTotal = String(Math.max(0, Number(tasksSrc.dataset.pdTotal || '0') - 1))
                    dest.dataset.pdTotal = String(Number(dest.dataset.pdTotal || '0') + 1)
                    const board = document.getElementById('pd-board')
                    if (board) {
                      if (from === 'done') board.dataset.done = String(Math.max(0, Number(board.dataset.done || '0') - 1))
                      if (status === 'done') board.dataset.done = String(Number(board.dataset.done || '0') + 1)
                      pdRepaintProgress()
                    }
                    dest.appendChild(wrap)
                  }
                  const list = wrap.closest('.pd-tasks')
                  if (list) pdSortWrap(list, wrap)
                }
              } catch {
                err.textContent = _t('sparks.saveFailed', "Couldn't save")
                save.disabled = false
                save.textContent = _t('common.save', 'Save')
              }
            })
          }
          pdTaskEditDlg.dataset.tid = tid
          // Pre-fill from the card (no fetch needed — the card has the title + status)
          const titleEl = cardEl.querySelector('.pd-task-title')
          pdTaskEditDlg.querySelector('#pde-input').value = titleEl ? titleEl.textContent : ''
          const status = cardEl.dataset.pdStatus || 'idea'
          pdTaskEditDlg.querySelector('#pde-status').value = status
          // S29 follow-up: pre-fill the task's REAL priority + labels from the card's
          // datasets — the old editor always defaulted to medium, so SAVING silently
          // reset an urgent task's priority (and dropped nothing since tags had no UI;
          // now they'd be reset too if not pre-filled).
          const prio = cardEl.dataset.pdPriority || 'medium'
          pdTaskEditDlg.querySelector('#pde-priority').value = prio
          let tagsVal = ''
          try {
            tagsVal = (JSON.parse(cardEl.dataset.pdTags || '[]') || []).map((tg) => tg.name).join(', ')
          } catch { /* corrupt dataset — fall back to empty */ }
          const tagsInput = pdTaskEditDlg.querySelector('#pde-tags')
          if (tagsInput) tagsInput.value = tagsVal
          pdTaskEditDlg.querySelector('#pde-save').disabled = false
          pdTaskEditDlg.querySelector('#pde-save').textContent = _t('common.save', 'Save')
          pdTaskEditDlg.querySelector('#pde-error').textContent = ''
          // S46.2: refresh the pinned-shots count badge for THIS task on every open
          pdeRenderShotsGrid(tid)
          pdTaskEditDlg.showModal()
          setTimeout(() => pdTaskEditDlg.querySelector('#pde-input').focus(), 50)
        }
        // S46.4: fetch this task's pinned shots + render them as an INLINE thumbnail grid
        // in #pde-shots-grid (zoom / edit-note / delete). Replaces the old count-badge
        // approach (S46.2's pdeRefreshShotsCount) — the gallery is now visible directly
        // in the editor, not behind a button. Reuses GET /api/projects/:id/screenshots
        // (same one taskShotsDialog uses). Silent on failure (offline → empty grid).
        // S46.5 fix: this is a FUNCTION DECLARATION (hoisted) — not a const arrow — so
        // the open-time call at L2744 + the handler calls (L2561/2573/2588) all resolve
        // without a TDZ ReferenceError. The const-arrow form (S46.4) threw on every open
        // because the call site ran before the declaration line → showModal() never ran
        // → the editor modal never actually opened (the element was in the DOM but not
        // shown), so the upload AJAX flow + the inline grid never worked.
        async function pdeRenderShotsGrid(tid) {
          const grid = pdTaskEditDlg?.querySelector('#pde-shots-grid')
          if (!grid || !tid) return
          try {
            const res = await fetch('/api/projects/' + id + '/screenshots')
            if (!res.ok) return
            const shots = ((await res.json()).screenshots) || []
            const pinned = shots.filter((s) => s.task_id === tid)
            const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
            // S46.6: the IMG onerror retries up to 4× with backoff (800ms, 1.6s, 2.4s, 3.2s)
            // — handles the KV read-after-write propagation delay (a freshly-uploaded
            // screenshot's file might 404/500 on a KV edge that hasn't seen the write yet;
            // the retry gives it time to propagate without a page refresh).
            const retryAttr = ' onerror="(function(i){var n=+(i.dataset.r||0)+1;if(n<4){i.dataset.r=n;var s=i.src;i.onerror=null;setTimeout(function(){i.src=s},800*n)}})(this)"'
            if (!pinned.length) { grid.innerHTML = ''; return }
            grid.innerHTML = pinned.map((s) =>
              '<figure class="shot-card" data-pde-shot="' + esc(s.id) + '">' +
                '<button type="button" class="shot-img-btn" data-pde-shot-zoom="' + esc(s.id) + '"><img src="/api/media/screenshots/' + esc(s.id) + '/file" alt="" loading="lazy"' + retryAttr + '></button>' +
                '<figcaption class="shot-body">' +
                  (s.caption ? '<p class="shot-note muted small" dir="auto">' + esc(s.caption) + '</p>' : '') +
                  '<div class="row spread shot-actions">' +
                    '<button type="button" class="ghost small" data-pde-shot-note="' + esc(s.id) + '">' + (s.caption ? _t('notes.editNote', 'Edit note') : _t('notes.addNote', 'Add note')) + '</button>' +
                    '<button type="button" class="ghost small danger" data-pde-shot-del="' + esc(s.id) + '" title="' + _t('common.delete', 'Delete') + '" aria-label="' + _t('common.delete', 'Delete') + '">✕</button>' +
                  '</div>' +
                '</figcaption>' +
              '</figure>'
            ).join('')
          } catch { /* offline — grid stays as-is */ }
        }

        // --- Project Archives (user request 2026-09): view + restore archived done tasks ----
        // The "Archive Done" button on board.html moves done tasks to project_archives.
        // This section (on project.html) lists them + lets the user restore or permanently
        // delete. Loaded lazily on first tab open (GET /api/projects/:id/archives).
        let archivesLoaded = false
        async function loadArchives() {
          const list = document.getElementById('pd-archives-list')
          if (!list) return
          list.hidden = false
          if (!archivesLoaded) {
            try {
              const res = await fetch('/api/projects/' + id + '/archives')
              const body = await res.json()
              const archives = body.archives || []
              list.innerHTML = archives.length
                ? archives.map((a) => {
                    const date = new Date(a.archived_at).toLocaleDateString(window.hibanaI18n?.lang === 'fa' ? 'fa-IR' : 'en-US')
                    return '<div class="pd-archive-item" data-archive-id="' + pdEsc(a.id) + '">' +
                      '<span class="pd-archive-title" title="' + pdEsc(a.title) + '">' + pdEsc(a.title) + '</span>' +
                      '<span class="pd-archive-date muted small">' + pdEsc(date) + '</span>' +
                      '<span class="pd-archive-actions">' +
                        '<button type="button" class="ghost small" data-archive-restore="' + pdEsc(a.id) + '" title="' + _t('pd.restore', 'Restore to board') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4"/></svg></button>' +
                        '<button type="button" class="ghost small danger" data-archive-delete="' + pdEsc(a.id) + '" title="' + _t('common.delete', 'Delete') + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' +
                      '</span>' +
                    '</div>'
                  }).join('')
                : '<p class="muted small">' + _t('pd.archivesEmpty', 'No archived tasks yet. Archive done tasks from the board.') + '</p>'
              archivesLoaded = true
            } catch {
              list.innerHTML = '<p class="muted small">' + _t('pd.archivesEmpty', 'No archived tasks yet.') + '</p>'
            }
          }
        }
        document.addEventListener('click', async (e) => {
          // Toggle the archives section open/closed
          const toggle = e.target.closest('[data-pd-archives-toggle]')
          if (toggle) {
            const list = document.getElementById('pd-archives-list')
            if (!list) return
            if (list.hidden) {
              await loadArchives()
            } else {
              list.hidden = true
            }
            return
          }
          const restoreBtn = e.target.closest('[data-archive-restore]')
          if (restoreBtn) {
            const aid = restoreBtn.getAttribute('data-archive-restore')
            try {
              const res = await fetch('/api/projects/' + id + '/archives/' + aid + '/restore', { method: 'POST' })
              if (!res.ok) throw new Error('restore failed')
              window.hibana?.toast(_t('pd.restored', 'Task restored to Done'), 'info')
              archivesLoaded = false
              loadArchives()
            } catch {
              window.hibana?.toast(_t('pd.restoreFailed', "Couldn't restore"), 'err')
            }
            return
          }
          const delBtn = e.target.closest('[data-archive-delete]')
          if (delBtn) {
            const aid = delBtn.getAttribute('data-archive-delete')
            if (!confirm(_t('pd.deleteArchiveConfirm', 'Permanently delete this archived task?'))) return
            try {
              const res = await fetch('/api/projects/' + id + '/archives/' + aid, { method: 'DELETE' })
              if (!res.ok) throw new Error('delete failed')
              window.hibana?.toast(_t('pd.deleted', 'Archived task deleted'), 'info')
              archivesLoaded = false
              loadArchives()
            } catch {
              window.hibana?.toast(_t('notes.deleteFailed', "Couldn't delete"), 'err')
            }
            return
          }
        })

        // --- مشکل‌ها tab (batch p): the tab and the board's Problems box are ONE list ----
        // (dev_tasks status='bug'). Composer lines → bug tasks (auto-added to the box);
        // solving moves the task to انجام‌شده (done_at stamped) and it leaves the open
        // list — exactly the box's contract. Edit is inline; delete removes it everywhere.
        const P_ICON = {
          check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M7.4 12.4l3 3 6.2-6.2"/></svg>',
          pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/></svg>',
          x: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
          trash: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l1 12.5A1.5 1.5 0 0 0 9 21h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/><path d="M10 11v6M14 11v6"/></svg>',
        }
        const setTabCount = (name, delta) => {
          const el = document.querySelector('[data-tab-count="' + name + '"]')
          if (!el) return
          const n = Math.max(0, Number(el.dataset.n || '0') + delta)
          el.dataset.n = String(n)
          el.textContent = pdDig(n)
        }
        // Optimistic chip move between board columns (problem solve = bug → done), the
        // same repaint contract as the drop handler below.
        const pdMoveChip = (taskId, to) => {
          // S29 fix: the selector matched NOTHING since Session 22 (data-pd-task lives on
          // the .pd-task-wrap, not .pd-task — same stale-selector bug the edit dialog
          // had) — the optimistic move never fired. Query the wrap; st-* is on the inner
          // card. The move also AUTO-SORTS into the destination box.
          const chip = document.querySelector('#pd-board .pd-task-wrap[data-pd-task="' + taskId + '"]')
          if (!chip) return
          const from = chip.dataset.pdStatus
          if (from === to) return
          const dest = document.querySelector('[data-pd-tasks="' + to + '"]')
          chip.dataset.pdStatus = to
          const cardEl = chip.querySelector('.pd-task')
          if (cardEl) {
            cardEl.classList.remove('st-' + from)
            cardEl.classList.add('st-' + to)
          }
          const meta = chip.querySelector('.pd-task-meta')
          if (meta) meta.innerHTML = pdMetaHtml(chip.dataset.pdPriority || 'medium', to === 'done' ? new Date().toISOString() : (chip.dataset.pdCreated || new Date().toISOString()), to === 'done')
          if (dest) pdSortWrap(dest, chip)
          pdSetCount(from, Number(pdCountEl(from)?.dataset.n || '0') - 1)
          pdSetCount(to, Number(pdCountEl(to)?.dataset.n || '0') + 1)
          const board = document.getElementById('pd-board')
          if (board) {
            if (from === 'done') board.dataset.done = String(Math.max(0, Number(board.dataset.done || '0') - 1))
            if (to === 'done') board.dataset.done = String(Number(board.dataset.done || '0') + 1)
            pdRepaintProgress()
          }
          for (const status of [from, to]) {
            const list = document.querySelector('[data-pd-tasks="' + status + '"]')
            if (!list) continue
            const n = Number(pdCountEl(status)?.dataset.n || '0')
            const more = list.querySelector('[data-pd-more]')
            if (n > 5) {
              const label = '+' + pdDig(n - 5) + ' ' + _t('pd.more', 'more')
              if (more) more.textContent = label
            } else if (more) {
              more.remove()
            }
          }
        }
        const pdRemoveChip = (taskId) => {
          const chip = document.querySelector('#pd-board .pd-task-wrap[data-pd-task="' + taskId + '"]')
          if (!chip) return
          const from = chip.dataset.pdStatus
          pdTierForget(taskId)
          chip.remove()
          pdSetCount(from, Number(pdCountEl(from)?.dataset.n || '0') - 1)
          const list = document.querySelector('[data-pd-tasks="' + from + '"]')
          const more = list?.querySelector('[data-pd-more]')
          if (more) {
            const n = Number(pdCountEl(from)?.dataset.n || '0')
            if (n > 5) more.textContent = '+' + pdDig(n - 5) + ' ' + _t('pd.more', 'more')
            else more.remove()
          }
          const board = document.getElementById('pd-board')
          if (board) {
            board.dataset.total = String(Math.max(0, Number(board.dataset.total || '0') - 1))
            if (from === 'done') board.dataset.done = String(Math.max(0, Number(board.dataset.done || '0') - 1))
            pdRepaintProgress()
          }
        }
        const problemLi = (task) => {
          const li = document.createElement('li')
          li.className = 'hurdle'
          li.dataset.problem = task.id
          li.innerHTML =
            '<button type="button" class="ghost toggle" data-problem-solve="' + pdEsc(task.id) + '" aria-label="' + pdEsc(_t('pd.solve', 'Mark solved')) + '" title="' + pdEsc(_t('pd.problemSolved', 'Solved — moves to Implemented')) + '">' + P_ICON.check + '</button>' +
            '<span class="hurdle-text">' + pdEsc(task.title) + '</span>' +
            '<button type="button" class="ghost hurdle-edit" data-problem-edit="' + pdEsc(task.id) + '" aria-label="' + pdEsc(_t('pd.editProblem', 'Edit problem')) + '">' + P_ICON.pencil + '</button>' +
            '<button type="button" class="ghost danger" data-problem-del="' + pdEsc(task.id) + '" aria-label="' + pdEsc(_t('pd.deleteProblem', 'Delete problem')) + '">' + P_ICON.x + '</button>'
          return li
        }
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('[data-problem-add]') : null
          if (!form) return
          e.preventDefault()
          const ta = form.querySelector('textarea[name=text]')
          // S30 batch 2: the composer's priority picker rides the whole batch (was a
          // hard medium default — "the bulk bug-add flow still defaults everything to
          // medium", the owner's words).
          const problemPrio = form.querySelector('select[name=priority]')?.value || 'medium'
          const lines = ta.value.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 50)
          if (!lines.length) { ta.focus(); return }
          ta.disabled = true
          try {
            const list = document.getElementById('problems')
            for (const line of lines) {
              const res = await fetch(`/api/projects/${id}/devtasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: line, status: 'bug', priority: problemPrio }),
              })
              if (!res.ok) throw new Error('add failed')
              const data = await res.json()
              insertTaskChip('bug', { id: data.id, title: line, priority: problemPrio })
              if (list) {
                const empty = list.querySelector('li.muted')
                if (empty) empty.remove()
                list.appendChild(problemLi({ id: data.id, title: line }))
              }
              setTabCount('problems', 1)
            }
            window.hibana?.toast(_t('db.taskAdded', 'Task added'))
            ta.value = ''
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
          } finally {
            ta.disabled = false
            ta.focus()
          }
        })
        ctx.on('click', async (e) => {
          const solve = e.target.closest('[data-problem-solve]')
          if (solve) {
            const taskId = solve.dataset.problemSolve
            try {
              const res = await fetch('/api/devtasks/' + taskId, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'done' }),
              })
              if (!res.ok) throw new Error('solve failed')
              const li = document.querySelector('[data-problem="' + taskId + '"]')
              if (li) li.remove()
              pdMoveChip(taskId, 'done')
              setTabCount('problems', -1)
              window.hibana?.toast(_t('pd.problemSolved', 'Solved — moved to Implemented'))
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            }
            return
          }
          const del = e.target.closest('[data-problem-del]')
          if (del) {
            const taskId = del.dataset.problemDel
            try {
              const res = await fetch('/api/devtasks/' + taskId, { method: 'DELETE' })
              if (!res.ok) throw new Error('delete failed')
              const li = document.querySelector('[data-problem="' + taskId + '"]')
              if (li) li.remove()
              pdRemoveChip(taskId)
              setTabCount('problems', -1)
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            }
            return
          }
          const editBtn = e.target.closest('[data-problem-edit]')
          if (editBtn) {
            const li = editBtn.closest('[data-problem]')
            const span = li?.querySelector('.hurdle-text')
            if (!li || !span || li.querySelector('[data-problem-input]')) return
            const original = span.textContent.trim()
            const input = document.createElement('input')
            input.className = 'pd-inline-edit'
            input.dataset.problemInput = ''
            input.value = original
            input.dir = 'auto'
            span.replaceWith(input)
            input.focus()
            input.select()
            let done = false
            const finish = async (save) => {
              if (done) return
              done = true
              const value = input.value.trim()
              const restored = document.createElement('span')
              restored.className = 'hurdle-text'
              restored.textContent = save && value ? value : original
              input.replaceWith(restored)
              if (!save || !value || value === original) return
              try {
                const res = await fetch('/api/devtasks/' + li.dataset.problem, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: value }),
                })
                if (!res.ok) throw new Error('edit failed')
                // Session 22: query the WRAP (data-pd-task lives there, not on .pd-task)
                // and re-clamp so the 150-char split + read-more stay in sync.
                const chipTitle = document.querySelector('#pd-board .pd-task-wrap[data-pd-task="' + li.dataset.problem + '"] .pd-task-title')
                if (chipTitle) pdApplyTitle(chipTitle, value)
              } catch {
                restored.textContent = original
                window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
              }
            }
            input.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') { ev.preventDefault(); finish(true) }
              if (ev.key === 'Escape') { ev.preventDefault(); finish(false) }
            })
            input.addEventListener('blur', () => finish(true))
          }
        })

        // --- برنامه آتی tab (batch p): mode A quick items + mode B documents + history ---
        const pdTimeAgo = (iso) => {
          const fa = pdLang() === 'fa'
          const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
          if (m < 1) return fa ? 'همین حالا' : 'just now'
          const u = m < 60 ? ['m', m] : m < 1440 ? ['h', Math.floor(m / 60)] : m < 43200 ? ['d', Math.floor(m / 1440)] : m < 525600 ? ['mo', Math.floor(m / 43200)] : ['y', Math.floor(m / 525600)]
          const faU = { m: 'دقیقه پیش', h: 'ساعت پیش', d: 'روز پیش', mo: 'ماه پیش', y: 'سال پیش' }
          const enU = { m: 'm ago', h: 'h ago', d: 'd ago', mo: 'mo ago', y: 'y ago' }
          return (fa ? pdDig(String(u[1])) : String(u[1])) + ' ' + (fa ? faU[u[0]] : enU[u[0]])
        }
        let blDocsCache = null
        const blRenderDocs = (docs) => {
          const holder = document.querySelector('[data-bl-docs]')
          if (!holder) return
          holder.innerHTML = docs.length ? docs.map((doc) =>
            '<article class="bl-doc" data-bl-doc="' + pdEsc(doc.id) + '">' +
              '<div class="row spread bl-doc-head">' +
                '<strong class="bl-doc-title">' + pdEsc(doc.title) + '</strong>' +
                '<span class="muted small">' + pdEsc(_t('bl.docUpdated', 'updated')) + ' ' + pdEsc(pdTimeAgo(doc.updated_at)) + '</span>' +
              '</div>' +
              '<div class="bl-doc-body">' + pdEsc(doc.content) + '</div>' +
              '<div class="row bl-doc-actions">' +
                '<button type="button" class="ghost small" data-bl-edit="' + pdEsc(doc.id) + '">' + P_ICON.pencil + ' ' + pdEsc(_t('common.edit', 'Edit')) + '</button>' +
                '<button type="button" class="ghost danger small" data-bl-del="' + pdEsc(doc.id) + '">' + P_ICON.trash + ' ' + pdEsc(_t('common.delete', 'Delete')) + '</button>' +
              '</div>' +
            '</article>'
          ).join('') : '<p class="muted bl-docs-empty">' + pdEsc(_t('bl.noDocs', 'No plan documents yet — write the first full plan here.')) + '</p>'
        }
        const blRenderHistory = (data) => {
          const head = document.querySelector('[data-bl-history-head]')
          if (head) {
            head.innerHTML = pdEsc(_t('bl.historyTitle', 'Latest changes')) +
              (data.latestAt ? ' <span class="muted small">· ' + pdEsc(_t('bl.latest', 'last change')) + ' ' + pdEsc(pdTimeAgo(data.latestAt)) + '</span>' : '')
          }
          const list = document.querySelector('[data-bl-history]')
          if (!list) return
          const events = data.history || []
          list.innerHTML = events.length ? events.map((ev) => {
            const phrase = ev.kind === 'doc_created'
              ? _t('bl.docCreated', 'Document “{t}” created').replace('{t}', ev.label)
              : ev.kind === 'doc_updated'
                ? _t('bl.docUpdatedH', 'Document “{t}” updated').replace('{t}', ev.label)
                : _t('bl.itemAdded', 'New item: {t}').replace('{t}', ev.label)
            return '<li><span class="muted small">' + pdEsc(pdTimeAgo(ev.at)) + '</span> — ' + pdEsc(phrase) + '</li>'
          }).join('') : '<li class="muted">' + pdEsc(_t('bl.noHistory', 'No backlog changes yet.')) + '</li>'
        }
        const blRefresh = async () => {
          try {
            const res = await fetch(`/api/projects/${id}/backlog`)
            if (!res.ok) return
            const data = await res.json()
            blDocsCache = data.docs || []
            blRenderDocs(blDocsCache)
            blRenderHistory(data)
          } catch { /* transient — the next action retries */ }
        }
        const blForm = () => document.querySelector('[data-bl-docform]')
        const blOpenForm = (doc) => {
          const form = blForm()
          if (!form) return
          form.dataset.blDocid = doc ? doc.id : ''
          form.querySelector('input[name=title]').value = doc ? doc.title : ''
          form.querySelector('textarea[name=content]').value = doc ? doc.content : ''
          form.hidden = false
          form.scrollIntoView({ block: 'nearest' })
          form.querySelector('input[name=title]').focus()
        }
        const blCloseForm = () => {
          const form = blForm()
          if (form) { form.hidden = true; form.dataset.blDocid = '' }
        }
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('[data-bl-item]') : null
          if (!form) return
          e.preventDefault()
          const inp = form.querySelector('input[name=title]')
          const title = inp.value.trim()
          if (!title) { form.hidden = true; return }
          inp.disabled = true
          try {
            const res = await fetch(`/api/projects/${id}/devtasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, status: 'planned' }),
            })
            if (!res.ok) throw new Error('add failed')
            const data = await res.json()
            insertTaskChip('planned', { id: data.id, title, priority: 'medium' })
            setTabCount('backlog', 1)
            window.hibana?.toast(_t('db.taskAdded', 'Task added'))
            inp.value = ''
            inp.focus()
            blRefresh()
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
          } finally {
            inp.disabled = false
          }
        })
        ctx.on('click', async (e) => {
          const newDoc = e.target.closest('[data-bl-newdoc]')
          if (newDoc) { blOpenForm(null); return }
          const cancel = e.target.closest('[data-bl-cancel]')
          if (cancel) { blCloseForm(); return }
          const editDoc = e.target.closest('[data-bl-edit]')
          if (editDoc) {
            const docId = editDoc.dataset.blEdit
            let doc = (blDocsCache || []).find((d) => d.id === docId)
            if (!doc) {
              try {
                const res = await fetch(`/api/projects/${id}/backlog`)
                if (res.ok) {
                  const data = await res.json()
                  blDocsCache = data.docs || []
                  doc = blDocsCache.find((d) => d.id === docId)
                }
              } catch { /* fallthrough */ }
            }
            if (doc) blOpenForm(doc)
            return
          }
          const delDoc = e.target.closest('[data-bl-del]')
          if (delDoc) {
            const docId = delDoc.dataset.blDel
            if (!window.confirm(_t('bl.delDocConfirm', 'Delete this plan document and its history?'))) return
            try {
              const res = await fetch('/api/backlog/docs/' + docId, { method: 'DELETE' })
              if (!res.ok) throw new Error('delete failed')
              window.hibana?.toast(_t('bl.docDeleted', 'Document deleted'))
              blRefresh()
            } catch {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            }
          }
        })
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('[data-bl-docform]') : null
          if (!form) return
          e.preventDefault()
          const titleIn = form.querySelector('input[name=title]')
          const contentIn = form.querySelector('textarea[name=content]')
          const title = titleIn.value.trim()
          const content = contentIn.value
          if (!title) { titleIn.focus(); return }
          const docId = form.dataset.blDocid || ''
          try {
            const res = await fetch(docId ? '/api/backlog/docs/' + docId : `/api/projects/${id}/backlog/docs`, {
              method: docId ? 'PATCH' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, content }),
            })
            if (!res.ok) throw new Error('save failed')
            window.hibana?.toast(_t('bl.docSaved', 'Document saved'))
            blCloseForm()
            blRefresh()
          } catch {
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
          }
        })

        // --- Cross-box drag & drop (user request 2026-09-03): move tasks between the four
        // progress boxes RIGHT HERE, same contract as board.html — cross-box drop PATCHes
        // /api/devtasks/:id {status}, same-box drop persists the new order through the
        // reorder endpoint. The DOM move + counts/meta/progress repaint are optimistic;
        // a failed PATCH toasts and reloads server truth. All delegated + ctx.on so htmx
        // re-renders of #project-body never need re-binding, and click-to-open survives
        // (browsers don't fire click after a real drag; touch-drag.js covers mobile and
        // blocks the stray post-drag click itself).
        let pdDrag = null
        let pdOver = null
        const pdClearOver = () => { if (pdOver) { pdOver.classList.remove('drag-over'); pdOver = null } }
        const pdCountEl = (status) => document.querySelector(`[data-pd-count="${status}"]`)
        const pdSetCount = (status, n) => { const el = pdCountEl(status); if (el) { el.dataset.n = String(n); el.textContent = pdDig(n) } }
        const pdRepaintProgress = () => {
          const board = document.getElementById('pd-board')
          if (!board) return
          const total = Number(board.dataset.total || '0')
          const done = Number(board.dataset.done || '0')
          const pct = total ? Math.round((done / total) * 100) : 0
          const line = document.querySelector('[data-pd-tasks-line]')
          if (line) { line.hidden = false; line.textContent = ' · ' + pdTasksLine(done, total) }
          // S29: auto-only repaint — the manual override stays displayed when set.
          window.__pdPaintAutoProgress?.(pct)
        }
        ctx.on('dragstart', (e) => {
          const task = e.target.closest ? e.target.closest('#pd-board .pd-task') : null
          if (!task) return
          // data-pd-task + data-pd-status live on the .pd-task-wrap (the wrapper outside
          // the <a>), so the drag carries the wrapper — not just the <a>.
          const wrap = task.closest('.pd-task-wrap') || task
          pdDrag = wrap
          e.dataTransfer.effectAllowed = 'move'
          try { e.dataTransfer.setData('text/plain', wrap.dataset.pdTask || '') } catch {}
          wrap.classList.add('dragging')
        })
        ctx.on('dragover', (e) => {
          if (!pdDrag) return
          const col = e.target.closest ? e.target.closest('#pd-board .pd-col') : null
          if (!col) return
          e.preventDefault()
          if (pdOver !== col) { pdClearOver(); pdOver = col; col.classList.add('drag-over') }
          // live position feedback inside the hovered column (lands before the +N more link)
          const list = col.querySelector('.pd-tasks')
          if (!list) return
          // targets are .pd-task-wrap elements (the wrapper, not the <a> inside)
          const target = e.target.closest ? e.target.closest('.pd-task-wrap') : null
          const more = list.querySelector('[data-pd-more]')
          if (target && target !== pdDrag) {
            const r = target.getBoundingClientRect()
            list.insertBefore(pdDrag, e.clientY > r.top + r.height / 2 ? target.nextSibling : target)
          } else if (!target && more && more !== pdDrag) {
            list.insertBefore(pdDrag, more)
          } else if (!target && !more) {
            list.appendChild(pdDrag)
          }
        })
        ctx.on('drop', async (e) => {
          if (!pdDrag) return
          e.preventDefault()
          const el = pdDrag
          const col = el.closest('.pd-col')
          const from = el.dataset.pdStatus
          const to = col ? col.dataset.status : from
          pdClearOver()
          el.classList.remove('dragging')
          pdDrag = null
          if (!col || !el.dataset.pdTask) return
          if (from === to) {
            // same box — only the order changed (board.html contract). S29 follow-up:
            // AUTO-SORT then snaps the card back to its PRIORITY slot — manual drag
            // re-orders within a tier (what the server renders on reload), never across.
            // S30 batch 4 (user request: "drop into the urgent zone of the column"):
            // a same-column drop ADOPTS the priority of the card it landed next to —
            // the wraps are priority-sorted, so the neighbor IS the tier zone. The wrap
            // below the drop point (or the one above at the end) defines it.
            let pdAdopted = null
            const isWrap = (n) => n && n.classList && n.classList.contains('pd-task-wrap')
            const next = isWrap(el.nextElementSibling) ? el.nextElementSibling : null
            const prev = isWrap(el.previousElementSibling) ? el.previousElementSibling : null
            const zoneWrap = next || prev
            if (zoneWrap) {
              const zonePrio = zoneWrap.dataset.pdPriority || 'medium'
              if (zonePrio !== (el.dataset.pdPriority || 'medium')) pdAdopted = zonePrio
            }
            if (pdAdopted) {
              el.dataset.pdPriority = pdAdopted
              const dot = el.querySelector('.prio-dot')
              if (dot) dot.className = 'prio-dot prio-' + pdAdopted
              const metaPrio = el.querySelector('.pd-meta-prio')
              if (metaPrio) { metaPrio.className = 'pd-meta-prio prio-' + pdAdopted; metaPrio.textContent = pdPrioLabel(pdAdopted) }
              fetch('/api/devtasks/' + el.dataset.pdTask, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ priority: pdAdopted }),
              }).catch(() => window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err'))
              pdTierTrack(el.dataset.pdTask, pdAdopted)
            }
            const ids = [...col.querySelectorAll('.pd-task-wrap')].map((x) => x.dataset.pdTask)
            pdSortWrap(el.closest('.pd-tasks') || col, el)
            if (ids.length > 1) {
              try {
                const res = await fetch(`/api/projects/${id}/devtasks/reorder`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ids }),
                })
                if (!res.ok) throw new Error('reorder failed')
              } catch {
                window.hibana?.toast(_t('list.reorderFailed', 'Reorder failed — try again'), 'err')
              }
            }
            return
          }
          // cross-box: repaint optimistically, PATCH behind it
          el.dataset.pdStatus = to
          // the st-* class is on the <a> inside the wrapper, not on the wrapper itself
          const taskEl = el.querySelector('.pd-task')
          if (taskEl) {
            taskEl.classList.remove('st-' + from)
            taskEl.classList.add('st-' + to)
          }
          const meta = el.querySelector('.pd-task-meta')
          if (meta) {
            // S29 follow-up: rebuild with the priority label (textContent would wipe it)
            meta.innerHTML = pdMetaHtml(el.dataset.pdPriority || 'medium', to === 'done' ? new Date().toISOString() : (el.dataset.pdCreated || new Date().toISOString()), to === 'done')
          }
          // S29 follow-up: cross-box drop lands in its priority slot, not the pointer's.
          const destList = document.querySelector('[data-pd-tasks="' + to + '"]')
          if (destList && destList.contains(el)) pdSortWrap(destList, el)
          pdSetCount(from, Number(pdCountEl(from)?.dataset.n || '0') - 1)
          pdSetCount(to, Number(pdCountEl(to)?.dataset.n || '0') + 1)
          const board = document.getElementById('pd-board')
          if (board) {
            if (from === 'done') board.dataset.done = String(Math.max(0, Number(board.dataset.done || '0') - 1))
            if (to === 'done') board.dataset.done = String(Number(board.dataset.done || '0') + 1)
            pdRepaintProgress()
          }
          // the +N more links follow the new counts
          for (const status of [from, to]) {
            const list = document.querySelector(`[data-pd-tasks="${status}"]`)
            if (!list) continue
            const n = Number(pdCountEl(status)?.dataset.n || '0')
            const more = list.querySelector('[data-pd-more]')
            if (n > 5) {
              const label = '+' + pdDig(n - 5) + ' ' + _t('pd.more', 'more')
              if (more) more.textContent = label
              else {
                const btn = document.createElement('button')
                btn.type = 'button'
                btn.className = 'pd-more-link'
                btn.dataset.pdMore = status
                btn.textContent = label
                list.appendChild(btn)
              }
            } else if (more) {
              more.remove()
            }
          }
          try {
            const res = await fetch('/api/devtasks/' + el.dataset.pdTask, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: to }),
            })
            if (!res.ok) throw new Error('move failed')
          } catch {
            window.hibana?.toast(_t('pd.moveFailed', "Couldn't move the task"), 'err')
            refreshBody() // restore server truth
          }
        })
        ctx.on('dragend', () => {
          pdClearOver()
          if (pdDrag) { pdDrag.classList.remove('dragging'); pdDrag = null }
        })

        // --- Item 5 + 7 (user request 2026-09-09): shared full-screen modal editor -------
        // The note textarea (Expand) and the backlog-doc editor (Full screen) both open
        // this modal with a large textarea. The save target depends on the context:
        //   - note:  POST /api/projects/:id/note  { note: text }
        //   - bl-doc: POST/PATCH /api/backlog/docs/:id or /api/projects/:id/backlog/docs
        //     { title, content }
        // The modal is server-rendered inside #project-body (loaded via htmx AFTER mount),
        // so all element lookups happen at click time, not at mount time (the elements don't
        // exist when mount runs). Looked up via getter functions each time.
        const editorEl = () => document.getElementById('pd-editor-modal')
        let editorMode = null // 'note' | 'bldoc'
        let editorDocId = ''
        const openEditor = (mode, opts) => {
          const m = editorEl()
          if (!m) return
          editorMode = mode
          editorDocId = opts.docId || ''
          const ta = document.getElementById('pd-editor-textarea')
          const title = document.getElementById('pd-editor-title')
          const subtitle = document.getElementById('pd-editor-subtitle')
          const hint = document.getElementById('pd-editor-hint')
          if (title) title.textContent = opts.title || _t('pd.editor', 'Editor')
          if (ta) {
            ta.value = opts.content || ''
            ta.maxLength = opts.maxlen || 50000
            ta.dir = opts.rtl ? 'rtl' : 'auto'
            ta.placeholder = opts.placeholder || ''
          }
          if (hint) hint.textContent = opts.hint || ''
          if (subtitle) {
            if (opts.subtitle !== undefined) {
              subtitle.hidden = false
              subtitle.value = opts.subtitle
            } else {
              subtitle.hidden = true
              subtitle.value = ''
            }
          }
          m.showModal()
          setTimeout(() => ta?.focus(), 10)
        }
        const closeEditor = () => { const m = editorEl(); if (m && m.open) m.close() }
        // Wire the modal's close/cancel/submit buttons once — they're inside #project-body
        // so they reload with each htmx swap; use a MutationObserver-free approach: check on
        // every relevant click whether the target is one of these buttons.
        ctx.on('click', (e) => {
          if (e.target.closest('#pd-editor-close') || e.target.closest('#pd-editor-cancel')) { closeEditor(); return }
        })
        ctx.on('submit', async (e) => {
          const form = e.target.closest ? e.target.closest('#pd-editor-form') : null
          if (!form) return
          e.preventDefault()
          const ta = document.getElementById('pd-editor-textarea')
          if (!ta) return
          if (editorMode === 'note') {
            const text = ta.value
            try {
              const res = await fetch(`/api/projects/${id}/note`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: text }),
              })
              if (!res.ok) throw new Error('save failed')
              const noteTa = document.getElementById('pd-note-textarea')
              if (noteTa) noteTa.value = text
              window.hibana?.toast(_t('pd.noteSaved', 'Note saved'))
              closeEditor()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          } else if (editorMode === 'bldoc') {
            const subtitle = document.getElementById('pd-editor-subtitle')
            const title = subtitle ? subtitle.value.trim() : ''
            const content = ta.value
            if (!title) { subtitle?.focus(); return }
            try {
              const res = await fetch(editorDocId ? '/api/backlog/docs/' + editorDocId : `/api/projects/${id}/backlog/docs`, {
                method: editorDocId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content }),
              })
              if (!res.ok) throw new Error('save failed')
              window.hibana?.toast(_t('bl.docSaved', 'Document saved'))
              closeEditor()
              blRefresh()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          }
        })

        // Wire the note "Expand" button (Item 5) + "Clear" button (user request 2026-09)
        ctx.on('click', (e) => {
          const clear = e.target.closest('[data-note-clear]')
          if (clear) {
            const ta = document.getElementById('pd-note-textarea')
            if (ta) {
              ta.value = ''
              ta.focus()
              // Also save the empty note to the server (so it persists)
              fetch('/api/projects/' + id + '/note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note: '' }),
              }).then(() => {
                const st = document.getElementById('note-status')
                if (st) { st.textContent = '✓ ' + _t('project.noteSaved', 'saved'); st.hidden = false; setTimeout(() => { st.hidden = true }, 1600) }
              }).catch(() => window.hibana?.toast(_t('project.noteSaveFailed', "Couldn't clear"), 'err'))
            }
            return
          }
          const expand = e.target.closest('[data-note-expand]')
          if (expand) {
            const ta = document.getElementById('pd-note-textarea')
            openEditor('note', {
              title: _t('pd.noteEditor', 'Note editor'),
              content: ta?.value || '',
              maxlen: 5000,
              rtl: pdLang() === 'fa',
              placeholder: ta?.placeholder || '',
              hint: _t('pd.noteHint', 'Write your progress update — it saves to the Notes tab.'),
            })
          }
        })

        // Wire the backlog-doc "Full screen" button (Item 7)
        ctx.on('click', (e) => {
          const fs = e.target.closest('[data-bl-fullscreen]')
          if (fs) {
            const form = fs.closest('[data-bl-docform]')
            if (!form) return
            const titleIn = form.querySelector('input[name=title]')
            const contentIn = form.querySelector('textarea[name=content]')
            openEditor('bldoc', {
              title: _t('pd.docEditor', 'Plan document editor'),
              content: contentIn?.value || '',
              subtitle: titleIn?.value || '',
              maxlen: 50000,
              placeholder: contentIn?.placeholder || '',
              hint: _t('pd.docHint', 'Write the full plan — it saves as a document in the برنامه آتی tab.'),
              docId: form.dataset.blDocid || '',
            })
          }
        })

        // --- Item 8 (user request 2026-09-09): Markdown export + Quick Copy per column ---
        // Each pd-col header has a clipboard (Quick Copy) + download (Export Markdown)
        // button. Quick Copy copies the column's task titles as bullet points.
        // Export Markdown generates a clean .md file with the column name as the heading
        // and the task titles as a bullet list — no HTML, dates, styling, or internal data.
        const pdColLabel = (status) => {
          const el = document.querySelector(`.pd-col[data-status="${status}"] .pd-col-title`)
          return el ? el.textContent.trim() : status
        }
        // Session 24 (root-cause fix, revised): ALWAYS fetch the full task list from
        // /api/projects/:id — the server renders only 5 items per column (MAX_VISIBLE)
        // and each card's title is clamped at 150 chars with a hidden .pd-title-rest
        // span. Reading from the DOM (even textContent) was unreliable for users seeing
        // truncation at the "read more" boundary. The API returns t.title = the FULL
        // untruncated title from the database. No DOM paths — bulletproof.
        // S30 batch 2: the items are now RICH ({title, priority, tagNames}) — the export
        // carries priority + labels ("- [URGENT] Fix auth leak #UI/UX #Security", the
        // owner's own format); the devTaskTags flat join resolves the names.
        const pdColItems = async (status) => {
          const res = await fetch('/api/projects/' + id)
          if (!res.ok) return []
          const data = await res.json()
          const allTasks = ((data.project ? data.project.devTasks : data.devTasks) || [])
            .filter((t) => t.status === status)
          const tagRows = (data.project ? data.project.devTaskTags : data.devTaskTags) || []
          const tagsBy = {}
          for (const r of tagRows) (tagsBy[r.task_id] = tagsBy[r.task_id] || []).push(r.name)
          return allTasks
            .map((t) => ({ title: (t.title || '').trim(), priority: t.priority || 'medium', tagNames: tagsBy[t.id] || [] }))
            .filter((x) => x.title)
        }
        const pdMdLine = (item) => {
          const tags = (item.tagNames || [])
            .map((n) => '#' + String(n || '').trim().replace(/\s+/g, '-'))
            .filter((n) => n.length > 1)
          return '- [' + String(item.priority || 'medium').toUpperCase() + '] ' + item.title.replace(/\s+/g, ' ') + (tags.length ? ' ' + tags.join(' ') : '')
        }
        const pdColToMarkdown = async (status) => {
          const label = pdColLabel(status)
          const items = await pdColItems(status)
          const heading = '# ' + label + '\n'
          if (!items.length) return heading + '\n_(No items)_\n'
          return heading + '\n' + items.map(pdMdLine).join('\n') + '\n'
        }
        const pdColToBullets = async (status) => {
          const items = await pdColItems(status)
          return items.length ? items.map(pdMdLine).join('\n') : ''
        }
        ctx.on('click', async (e) => {
          const copy = e.target.closest('[data-pd-copy]')
          if (copy) {
            const status = copy.dataset.pdCopy
            const text = await pdColToBullets(status)
            try {
              await navigator.clipboard.writeText(text)
              window.hibana?.toast(_t('pd.copied', 'Copied to clipboard'))
            } catch {
              // fallback for non-secure contexts
              const ta = document.createElement('textarea')
              ta.value = text; document.body.appendChild(ta); ta.select()
              try { document.execCommand('copy'); window.hibana?.toast(_t('pd.copied', 'Copied to clipboard')) } catch {}
              ta.remove()
            }
            return
          }
          const exp = e.target.closest('[data-pd-export]')
          if (exp) {
            const status = exp.dataset.pdExport
            const md = await pdColToMarkdown(status)
            const label = pdColLabel(status)
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = label.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, '_') + '.md'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
            window.hibana?.toast(_t('pd.exported', 'Exported as Markdown'))
          }
          // Archive Done (project page — same as board.html)
          const archiveBtn = e.target.closest('[data-pd-archive-done]')
          if (archiveBtn) {
            const col = document.querySelector('.pd-col[data-status="done"], .pd-col[data-status="operational"]')
            const count = col ? col.querySelectorAll('.pd-task').length : 0
            if (count === 0) return
            const msg = _t('pd.archiveDoneConfirm', 'Archive all {n} done tasks? They move to the project archives (restorable).').replace('{n}', pdDig(count))
            if (!confirm(msg)) return
            fetch('/api/projects/' + id + '/devtasks/archive-done', { method: 'POST' })
              .then((r) => r.ok ? r.json() : null)
              .then((body) => {
                const n = body && typeof body.archived === 'number' ? body.archived : count
                window.hibana?.toast(_t('pd.archivedDone', '{n} tasks archived').replace('{n}', pdDig(n)), 'info')
                location.reload()
              })
              .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't archive"), 'err'))
            return
          }
          // Clear Done (hard delete — project page — same as board.html)
          const clearBtn = e.target.closest('[data-pd-clear-done]')
          if (clearBtn) {
            const col = document.querySelector('.pd-col[data-status="done"], .pd-col[data-status="operational"]')
            const count = col ? col.querySelectorAll('.pd-task').length : 0
            if (count === 0) return
            const msg = _t('pd.clearDoneConfirm', 'PERMANENTLY delete all {n} done tasks? This cannot be undone. Use "Archive" to keep them.').replace('{n}', pdDig(count))
            if (!confirm(msg)) return
            const ids = Array.from(col.querySelectorAll('.pd-task-wrap')).map((w) => w.dataset.pdTask)
            Promise.all(ids.map((tid) => fetch('/api/devtasks/' + tid, { method: 'DELETE' })))
              .then(() => {
                window.hibana?.toast(_t('pd.clearedDone', '{n} tasks deleted').replace('{n}', pdDig(count)), 'info')
                location.reload()
              })
              .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't clear"), 'err'))
            return
          }
          // Project logo upload (user request 2026-09)
          // Image-resize.js: client-side resize to 512×512 max + WebP conversion (3.5MB→~100KB)
          const logoPlaceholder = e.target.closest('[data-pd-logo-upload]')
          if (logoPlaceholder) {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/png,image/jpeg,image/webp'
            input.onchange = async () => {
              const file = input.files?.[0]
              if (!file) return
              try {
                // Resize + convert to WebP (falls back to PNG if WebP unsupported)
                const { dataBase64, mimeType } = await window.hibanaImageResize.resizeAndEncode(file, { maxDim: 512, quality: 0.85 })
                const res = await fetch('/api/projects/' + id + '/logo', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ dataBase64, mimeType }),
                })
                if (!res.ok) throw new Error('upload failed')
                window.hibana?.toast(_t('pd.logoSaved', 'Logo saved'), 'info')
                location.reload()
              } catch {
                window.hibana?.toast(_t('pd.logoFailed', "Couldn't upload logo"), 'err')
              }
            }
            input.click()
            return
          }
          // Session 19 (user request): remove an existing logo. The trash button on
          // .pd-logo-wrap calls DELETE /api/projects/:id/logo, then reloads so the
          // placeholder reappears.
          const removeBtn = e.target.closest('[data-pd-logo-remove]')
          if (removeBtn) {
            const pid = removeBtn.dataset.pdLogoRemove
            if (!pid) return
            if (!confirm(_t('pd.logoRemoveConfirm', 'Remove the logo?'))) return
            try {
              const res = await fetch('/api/projects/' + pid + '/logo', { method: 'DELETE' })
              if (!res.ok) throw new Error('remove failed')
              window.hibana?.toast(_t('pd.logoRemoved', 'Logo removed'), 'info')
              location.reload()
            } catch {
              window.hibana?.toast(_t('pd.logoRemoveFailed', "Couldn't remove logo"), 'err')
            }
            return
          }
        })
      },
    })
