    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'sparks',
      mount(ctx) {
        const _t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f
        const shelf = () => document.getElementById('spark-shelf')
        // Task 24 fix: htmx 2.0.4 fires the 'load' trigger exactly once at init —
        // htmx.trigger('#spark-shelf','load') was a silent no-op afterwards, so the
        // shelf never refreshed after edit/delete/reorder (a spark promoted to a project
        // stage stayed visible). Refetch explicitly — same pattern as projects.html.
        // batch (s): folder-aware — serializes the current #spark-folder selection.
        const currentFolder = () => {
          const input = document.getElementById('spark-folder')
          return input ? input.value : ''
        }
        // ---- S40: the remembered FOLDER (the view pref's sibling). The inline stamp in
        // sparks.html restores #spark-folder before htmx's first fetch; this module keeps
        // the pref in sync on every folder click. Only REAL folders + 'none' persist —
        // 'all' and '' are browsing states that boot back to the folder grid (home).
        const FOLDER_PREF_KEY = 'hibana-sparks-folder'
        const readFolderPref = () => {
          try {
            const raw = localStorage.getItem(FOLDER_PREF_KEY)
            if (!raw) return null
            const v = JSON.parse(raw)
            return v && typeof v.id === 'string' ? v : null
          } catch { return null }
        }
        const writeFolderPref = (id, name) => {
          try {
            if (id && id !== 'all') localStorage.setItem(FOLDER_PREF_KEY, JSON.stringify({ id, name: name || '' }))
            else localStorage.removeItem(FOLDER_PREF_KEY)
          } catch {}
        }
        // ---- Phase 6 item 3: the remembered view (projects.html's pattern — item 10 of
        // Phase 5). The hidden #spark-view input rides the initial load + the 30s poll
        // through hx-include, so the poll never resets the choice.
        const VIEW_PREF_KEY = 'hibana-sparks-view'
        const VALID_VIEWS = ['cards', 'list', 'sticky', 'kanban']
        const readViewPref = () => { try { return localStorage.getItem(VIEW_PREF_KEY) || '' } catch { return '' } }
        const writeViewPref = (v) => { try { localStorage.setItem(VIEW_PREF_KEY, v) } catch {} }
        const currentView = () => {
          const input = document.getElementById('spark-view')
          return input && VALID_VIEWS.includes(input.value) ? input.value : 'cards'
        }
        let initialView = readViewPref()
        if (!VALID_VIEWS.includes(initialView)) initialView = 'cards'
        const viewInput = document.getElementById('spark-view')
        if (viewInput) viewInput.value = initialView
        const viewSel = document.getElementById('sparks-view-sel')
        if (viewSel) viewSel.value = initialView
        viewSel?.addEventListener('change', () => {
          const v = viewSel.value
          if (!VALID_VIEWS.includes(v)) return
          writeViewPref(v)
          if (viewInput) viewInput.value = v
          reloadShelf()
        })
        const reloadShelf = () => {
          if (!window.htmx) return
          const f = currentFolder()
          const v = currentView()
          // Pass folder param only when a folder is explicitly selected (f is non-empty).
          // When f is '' (initial state, no folder clicked), don't send folder param →
          // server shows the folder grid.
          const folderParam = f ? '&folder=' + encodeURIComponent(f) : ''
          window.htmx.ajax('GET', '/api/projects?status=spark&view=' + encodeURIComponent(v) + folderParam, { target: '#spark-shelf', swap: 'innerHTML' })
        }

        // ---- Phase 6 item 3: KANBAN DnD — drop a spark-card on a folder column to
        // FILE it (PATCH folder_id, the batch (s) API). Delegated + capture-free: the
        // cards are htmx-swapped constantly, so per-card binding would die on the first
        // poll. A same-folder drop is a no-op (the server PATCH is idempotent anyway).
        let kbDragId = null
        ctx.on('dragstart', (e) => {
          const card = e.target.closest?.('.kanban-col[data-spark-folder] .kanban-card')
          if (!card) return
          kbDragId = card.dataset.projectId || null
          if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', kbDragId || '') } catch {} }
        })
        ctx.on('dragover', (e) => {
          const col = e.target.closest?.('.kanban-col[data-spark-folder]')
          if (!col || !kbDragId) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        })
        ctx.on('drop', async (e) => {
          const col = e.target.closest?.('.kanban-col[data-spark-folder]')
          if (!col || !kbDragId) return
          e.preventDefault()
          const id = kbDragId
          kbDragId = null
          const folderKey = col.dataset.sparkFolder // '' = بدون پوشه → null
          try {
            const res = await fetch('/api/projects/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder_id: folderKey || null }),
            })
            if (!res.ok) throw new Error('move failed')
            window.hibana?.rail?.refresh?.() // S148: the rail's sparks section follows the folder drop in the same beat
            reloadShelf()
          } catch {
            window.hibana?.toast(_t('sparks.moveFailed', "Couldn't move the idea"), 'err')
          }
        })

        // ---- ⋯ menu injection — client-side only (cardHtml is shared with the
        // projects page, where a server-rendered menu would render dead buttons) ----
        // S44 (owner: "there must be a way to delete/edit the folder ideas"): the ⋯
        // used to inject into CARDS only — the list/kanban/sticky views of the SAME
        // ideas had no edit/delete at all. Every view's row/card/note now gets the
        // same menu; all clicks run through the delegation below. The injected host
        // carries data-nav-local so nav.js's [data-nav-url] interceptor (kanban +
        // sticky cards are navigable) lets the ⋯ open the menu instead of navigating.
        function sparkMenuHtml(id) {
          return '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + _t('sparks.more', 'More actions') + '">' +
              '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>' +
            '</button>' +
            '<div class="spark-menu-pop" hidden>' +
              // batch (s): file the idea into a folder right from its card.
              '<button type="button" data-spark-move="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/></svg><span>' + _t('sparks.moveToFolder', 'Move to folder') + '</span></button>' +
              '<button type="button" data-spark-edit="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>' + _t('sparks.edit', 'Edit spark') + '</span></button>' +
              '<button type="button" class="danger" data-spark-delete="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>' + _t('common.delete', 'Delete') + '</span></button>' +
            '</div>'
        }
        const MENU_HOST = '.project-card, .projects-table tr, .kanban-card, .sticky-note'
        function injectSparksMenus() {
          const root = shelf()
          if (!root) return
          for (const card of root.querySelectorAll('.project-card:not([data-menu-ok])')) {
            const meta = card.querySelector('.title-meta')
            if (!meta) continue
            const id = card.dataset.projectId
            const menu = document.createElement('div')
            menu.className = 'spark-menu'
            menu.setAttribute('data-nav-local', '')
            menu.innerHTML = sparkMenuHtml(id)
            meta.appendChild(menu)
            card.setAttribute('data-menu-ok', '')
          }
          // S44: the other three views. LIST — the ⋯ rides the title cell next to the
          // project link (rows are not navigable; the link itself is an anchor the
          // interceptor ignores for buttons). KANBAN + STICKY — the ⋯ docks the top-end
          // corner (quicknotes.css hosts); the card stays click-to-open otherwise.
          for (const row of root.querySelectorAll('.projects-table tr[data-project-id]:not([data-menu-ok])')) {
            const td = row.querySelector('td')
            if (!td) continue
            const menu = document.createElement('div')
            menu.className = 'spark-menu'
            menu.setAttribute('data-nav-local', '')
            menu.innerHTML = sparkMenuHtml(row.dataset.projectId)
            td.appendChild(menu)
            row.setAttribute('data-menu-ok', '')
          }
          for (const card of root.querySelectorAll('.kanban-card[data-project-id]:not([data-menu-ok]), .sticky-note[data-project-id]:not([data-menu-ok])')) {
            const menu = document.createElement('div')
            menu.className = 'spark-menu'
            menu.setAttribute('data-nav-local', '')
            menu.innerHTML = sparkMenuHtml(card.dataset.projectId)
            card.appendChild(menu)
            card.setAttribute('data-menu-ok', '')
          }
        }

        function closeMenus() {
          document.querySelectorAll('#spark-shelf .spark-menu-pop:not([hidden])').forEach((pop) => {
            pop.hidden = true
            const btn = pop.parentElement && pop.parentElement.querySelector('[data-menu-open]')
            if (btn) btn.removeAttribute('data-open')
          })
        }

        // ---- Edit dialog (built lazily on first edit; native <dialog> like quick-add) ----
        let editDlg = null
        // S120 (two jobs #1 — never lose an idea; the S118 quick-add pattern lands on
        // the edit dialog): a half-edited spark rides a reload/soft-nav — sessionStorage
        // per keystroke, restored into the SAME spark's dialog when it reopens (the
        // restore happens after the prefill fetch, before showModal — the fetch races
        // nothing). A draft for a DIFFERENT spark is dropped — the prefill is the truth
        // for the spark at hand. Dismissal retires the store SYNCHRONOUSLY inside
        // close(): the 'close' event is a QUEUED TASK, and a fast Escape→reload tore
        // the document down before the listener ran (the S118 race, guarded at birth).
        const SE_DRAFT_KEY = 'hibana-se-draft'
        const seClearDraft = () => { try { sessionStorage.removeItem(SE_DRAFT_KEY) } catch { /* private mode */ } }
        function buildEditDialog() {
          if (editDlg) return
          const dlg = document.createElement('dialog')
          dlg.id = 'spark-edit-dialog'
          dlg.className = 'dialog'
          dlg.innerHTML =
            '<form class="modal" id="se-form" novalidate>' +
              '<h3>' + _t('sparks.edit', 'Edit spark') + '</h3>' +
              '<label>' + _t('sparks.title', 'Title') + ' <input id="se-title" required maxlength="200" autocomplete="off"></label>' +
              '<label>' + _t('sparks.description', 'Description') + ' <textarea id="se-description" rows="4" maxlength="2000"></textarea></label>' +
              // Task 24 (#6): stage select — moving a spark out of «ایده» promotes it into
              // a real project stage right from the shelf (it leaves the shelf naturally).
              // batch q: the spark promotes into the six-stage lifecycle; «بررسی نشده»
              // (unreviewed) is phase 1 of a project — the natural next step for a spark.
              '<label>' + _t('calendar.stage', 'Stage') + ' <select id="se-status">' +
                ['spark','planning','queued','developing','awaiting_dev','operational'].map(function (s) { return '<option value="' + s + '">' + _t('status.' + s, s) + '</option>' }).join('') +
              '</select></label>' +
              '<p class="error" id="se-error" role="alert"></p>' +
              '<div class="row">' +
                '<button type="submit" id="se-save">' + _t('common.save', 'Save') + '</button>' +
                '<button type="button" class="ghost" id="se-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
              '</div>' +
            '</form>'
          document.body.appendChild(dlg)
          // S120: dismissal retires the draft BEFORE dlg.close() — close()'s 'close'
          // event only fires as a queued task (the S118 race), so the sync clear here
          // is the guarantee; the 'close' listener below stays as the belt.
          const close = () => { seClearDraft(); dlg.close() }
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
          dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
          dlg.querySelector('#se-cancel').addEventListener('click', close)
          dlg.querySelector('#se-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const id = dlg.dataset.editId
            const title = dlg.querySelector('#se-title').value.trim()
            if (!id || !title) return
            const err = dlg.querySelector('#se-error')
            const save = dlg.querySelector('#se-save')
            err.textContent = ''
            save.disabled = true
            save.textContent = _t('sparks.saving', 'Saving…')
            try {
              const res = await fetch('/api/projects/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description: dlg.querySelector('#se-description').value, status: dlg.querySelector('#se-status').value || undefined }),
              })
              if (!res.ok) throw new Error('update failed')
              window.hibana?.rail?.refresh?.() // S148: the rail follows the edit — a promoted spark leaves the shelf for the projects section
              // S119 (two jobs #2 — never lose your place, the ideas edition): an EDIT is
              // the S105 "actively interacted" mutation — the resume strip remembers the
              // spark ("Continue where you left off" now covers ideas too; the strip links
              // back to /sparks.html). A PROMOTED spark (the stage select moved it out of
              // «ایده») records as a PROJECT with its new stage — it left the shelf for the
              // pipeline, so the entry deep-links to the project page instead.
              const st = dlg.querySelector('#se-status').value || 'spark'
              window.hibanaResume?.record?.(st === 'spark' ? 'spark' : 'project', id, title, st)
              close()
              window.hibana?.toast(_t('sparks.saved', 'Saved'), 'ok', 3000)
              reloadShelf()
            } catch (err2) {
              err.textContent = _t('sparks.saveFailed', "Couldn't save the spark")
            } finally {
              save.disabled = false
              save.textContent = _t('common.save', 'Save')
            }
          })
          // S120: the draft store — every keystroke persists {id,t,d,s}; reverting all
          // three fields back to the prefill retires the store (pristine = nothing to
          // keep). The stage select joins on 'change' (selects don't fire input).
          const seFields = () => [dlg.querySelector('#se-title'), dlg.querySelector('#se-description'), dlg.querySelector('#se-status')]
          const seSaveDraft = () => {
            try {
              const [t, d, s] = seFields().map((el) => el.value)
              const orig = dlg.dataset.orig ? JSON.parse(dlg.dataset.orig) : null
              if (orig && t === orig[0] && d === orig[1] && s === orig[2]) { seClearDraft(); return }
              sessionStorage.setItem(SE_DRAFT_KEY, JSON.stringify({ id: dlg.dataset.editId, t, d, s }))
            } catch { /* private mode */ }
          }
          seFields().forEach((el, i) => el && el.addEventListener(i === 2 ? 'change' : 'input', seSaveDraft))
          dlg.addEventListener('close', seClearDraft) // belt — the sync clear lives in close()
          editDlg = dlg
        }

        function openEdit(id) {
          buildEditDialog()
          const dlg = editDlg
          dlg.querySelector('#se-error').textContent = ''
          fetch('/api/projects/' + id)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
            .then((body) => {
              const p = body.project || {}
              dlg.dataset.editId = id
              dlg.querySelector('#se-title').value = p.title ?? ''
              dlg.querySelector('#se-description').value = p.description ?? ''
              if (p.status) dlg.querySelector('#se-status').value = p.status
              // S120: the pristine baseline is the ACTUAL prefill — the stage select keeps
              // its previous value when the row carries no status, so read the live
              // fields, not the row.
              const orig = [dlg.querySelector('#se-title').value, dlg.querySelector('#se-description').value, dlg.querySelector('#se-status').value]
              dlg.dataset.orig = JSON.stringify(orig)
              // a draft for THIS spark returns (newer intent wins, sliced to the fields'
              // own maxima); a stale draft for a DIFFERENT spark is dropped
              try {
                const dr = JSON.parse(sessionStorage.getItem(SE_DRAFT_KEY) || 'null')
                if (dr && dr.id === id) {
                  dlg.querySelector('#se-title').value = String(dr.t ?? '').slice(0, 200)
                  dlg.querySelector('#se-description').value = String(dr.d ?? '').slice(0, 2000)
                  if (dr.s) dlg.querySelector('#se-status').value = String(dr.s)
                } else if (dr) {
                  seClearDraft()
                }
              } catch { /* malformed draft — the prefill stands */ }
              dlg.showModal()
            })
            .catch(() => window.hibana?.toast(_t('sparks.loadFailed', "Couldn't load the spark"), 'err'))
        }

        // ---- Delete (soft) + Undo toast — mirrors the quick-notebook pattern in app.js ----
        function deleteSpark(id, card) {
          if (!id || !card) return
          fetch('/api/projects/' + id, { method: 'DELETE' })
            .then(async (r) => {
              if (!r.ok) {
                window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the spark"), 'err')
                return
              }
              card.remove()
              window.hibana?.rail?.refresh?.() // S148: the rail's sparks section drops the deleted row in the same beat
              // P4.11 (F-L24): use the toast() actions API (canonical pattern) instead of
              // post-hoc appending a button to the toast element.
              window.hibana?.toast(_t('sparks.deleted', 'Spark deleted'), 'ok', 6000, [{
                label: _t('common.undo', 'Undo'),
                onClick: () => {
                  fetch('/api/projects/' + id + '/restore', { method: 'POST' })
                    .then((r2) => { if (r2.ok) { window.hibana?.rail?.refresh?.(); reloadShelf() } }) // S148: the rail restores the spark too
                    .catch(() => {})
                },
              }])
              reloadShelf() // fresh server order (also renders the empty state after the last card)
            })
            .catch(() => window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the spark"), 'err'))
        }

        // ---- Folders (batch s) — create / rename / delete / move-to-folder -----------
        // The folder BAR is server-rendered inside the shelf fragment (fresh counts on
        // every swap); these dialogs are lazily-built natives like the spark edit dialog.
        // S41: the create/rename dialog carries the folder's EMOJI icon — a preview
        // button that opens the shared emoji picker (window.hibanaEmojiPicker, which
        // docks as a bottom sheet under 640px — mobile-first by design). Icon PATCH
        // semantics mirror the server: only send `icon` when the user touched it
        // (dirty flag); null = clear back to the folder-plus glyph.
        const DEFAULT_FOLDER_ICON = '📁'
        let folderDlg = null
        let moveDlg = null

        function buildFolderDialog() {
          if (folderDlg) return
          const dlg = document.createElement('dialog')
          dlg.id = 'spark-folder-dialog'
          dlg.className = 'dialog'
          dlg.innerHTML =
            '<form class="modal" id="sf-form" novalidate>' +
              '<h3 id="sf-title"></h3>' +
              '<div class="sf-icon-row">' +
                '<button type="button" id="sf-icon-btn" class="sf-icon-btn" aria-label="' + _t('sparks.folderIcon', 'Folder icon') + '" title="' + _t('sparks.folderIcon', 'Folder icon') + '"><span id="sf-icon-preview" aria-hidden="true">' + DEFAULT_FOLDER_ICON + '</span></button>' +
                '<button type="button" class="ghost small" id="sf-icon-clear" hidden>✕ <span>' + _t('sparks.clearIcon', 'Remove icon') + '</span></button>' +
              '</div>' +
              '<label>' + _t('sparks.folderName', 'Folder name') + ' <input id="sf-name" required maxlength="50" autocomplete="off"></label>' +
              '<p class="error" id="sf-error" role="alert"></p>' +
              '<div class="row">' +
                '<button type="submit" id="sf-save">' + _t('common.save', 'Save') + '</button>' +
                '<button type="button" class="ghost" id="sf-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
              '</div>' +
            '</form>'
          document.body.appendChild(dlg)
          const close = () => dlg.close()
          const preview = () => dlg.querySelector('#sf-icon-preview')
          const clearBtn = () => dlg.querySelector('#sf-icon-clear')
          const setIconState = (icon, dirty) => {
            dlg.dataset.icon = icon || ''
            dlg.dataset.iconDirty = dirty ? '1' : ''
            preview().textContent = icon || DEFAULT_FOLDER_ICON
            clearBtn().hidden = !icon
          }
          dlg.querySelector('#sf-icon-btn').addEventListener('click', () => {
            const picker = window.hibanaEmojiPicker
            if (!picker) {
              window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err')
              return
            }
            picker.open({
              anchor: dlg.querySelector('#sf-icon-btn'),
              current: dlg.dataset.icon || '',
              onPick: (emoji) => setIconState(emoji, true),
            })
          })
          clearBtn().addEventListener('click', () => setIconState('', true))
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
          dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
          dlg.querySelector('#sf-cancel').addEventListener('click', close)
          dlg.querySelector('#sf-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const id = dlg.dataset.folderId // '' = create
            const name = dlg.querySelector('#sf-name').value.trim()
            if (!name) return
            const err = dlg.querySelector('#sf-error')
            const save = dlg.querySelector('#sf-save')
            err.textContent = ''
            save.disabled = true
            save.textContent = _t('sparks.saving', 'Saving…')
            try {
              // icon rides along ONLY when the user touched it (rename without opening
              // the picker never clears the stored emoji; null = explicit clear).
              const iconDirty = dlg.dataset.iconDirty === '1'
              const payload = iconDirty ? { name, icon: dlg.dataset.icon || null } : { name }
              const res = await fetch(id ? '/api/projects/sparks/folders/' + id : '/api/projects/sparks/folders', {
                method: id ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              })
              if (!res.ok) throw new Error('folder save failed')
              window.hibana?.rail?.refresh?.() // S148: the rail's sparks shelf mirrors the folder create/rename
              close()
              window.hibana?.toast(_t(id ? 'sparks.folderRenamed' : 'sparks.folderCreated', id ? 'Folder renamed' : 'Folder created'), 'ok', 3000)
              reloadShelf()
            } catch {
              err.textContent = _t('sparks.folderFailed', "Couldn't update the folder — try again")
            } finally {
              save.disabled = false
              save.textContent = _t('common.save', 'Save')
            }
          })
          folderDlg = dlg
        }

        function openFolderDialog(id, name, icon) {
          buildFolderDialog()
          const dlg = folderDlg
          dlg.dataset.folderId = id || ''
          dlg.querySelector('#sf-title').textContent = _t(id ? 'sparks.renameFolder' : 'sparks.newFolder', id ? 'Rename folder' : 'New folder')
          dlg.querySelector('#sf-error').textContent = ''
          dlg.querySelector('#sf-name').value = name || ''
          dlg.dataset.icon = icon || ''
          dlg.querySelector('#sf-icon-preview').textContent = icon || DEFAULT_FOLDER_ICON
          dlg.querySelector('#sf-icon-clear').hidden = !icon
          dlg.dataset.iconDirty = ''
          dlg.showModal()
          dlg.querySelector('#sf-name').focus()
        }

        function deleteFolder(id, name) {
          // Native confirm (same approved pattern as the archive's hard delete):
          // deleting returns the folder's sparks to «All» — the hint says so.
          const ok = window.confirm(_t('sparks.deleteFolderConfirm', 'Delete "{name}"? ' + _t('sparks.deleteFolderHint', 'The ideas in it move back to All.')).split('{name}').join(name || ''))
          if (!ok) return
          fetch('/api/projects/sparks/folders/' + id, { method: 'DELETE' })
            .then((r) => {
              if (!r.ok) throw new Error('folder delete failed')
              window.hibana?.rail?.refresh?.() // S148: the rail's sparks shelf drops the deleted folder in the same beat
              // Viewing the deleted folder? Fall back to «All» before reloading.
              if (currentFolder() === id && document.getElementById('spark-folder')) document.getElementById('spark-folder').value = ''
              // S40: the persisted context died with the folder — clear it so the next
              // boot lands on the folder grid instead of a ghost selection.
              if (readFolderPref()?.id === id) writeFolderPref('', '')
              window.hibana?.toast(_t('sparks.folderDeleted', 'Folder deleted'), 'ok', 3000)
              reloadShelf()
            })
            .catch(() => window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err'))
        }

        // The ⋯ pop next to each folder chip — a tiny inline menu (rename / delete).
        // S40: hosts are BOTH shapes — the bar's .sf-item chips AND the file-manager
        // grid's .spark-folder-card (whose ⋯ button previously only ever entered the
        // folder, see the click-order note below).
        function closeSfMenus() {
          document.querySelectorAll('#spark-shelf .sf-menu').forEach((m) => m.remove())
        }
        function toggleSfMenu(btn) {
          const item = btn.closest('.sf-item, .spark-folder-card')
          const wasOpen = item && item.querySelector('.sf-menu')
          closeSfMenus()
          if (item && !wasOpen) {
            const menu = document.createElement('div')
            menu.className = 'sf-menu'
            const id = btn.getAttribute('data-sf-menu')
            const label = item.querySelector('.sf-label, .spark-folder-name')
            const name = (label || {}).textContent || ''
            // S41: the host chip/card carries data-sf-icon — the rename dialog prefills
            // the folder's current emoji from it.
            const folderIcon = item.getAttribute('data-sf-icon') || ''
            menu.innerHTML =
              '<button type="button" data-sf-rename="' + id + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
                '<span>' + _t('sparks.renameFolder', 'Rename folder') + '</span></button>' +
              '<button type="button" class="danger" data-sf-delete="' + id + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                '<span>' + _t('sparks.deleteFolder', 'Delete folder') + '</span></button>'
            menu.dataset.folderName = name
            menu.dataset.folderIcon = folderIcon
            item.appendChild(menu)
          }
        }

        // Move an idea into a folder — radio picker dialog, built per open (folders change).
        function openMoveDialog(sparkId) {
          Promise.all([
            fetch('/api/projects/sparks/folders').then((r) => (r.ok ? r.json() : Promise.reject(new Error('folders failed')))),
            fetch('/api/projects/' + sparkId).then((r) => (r.ok ? r.json() : Promise.reject(new Error('spark failed')))),
          ])
            .then(([{ folders }, body]) => {
              const current = (body.project || {}).folder_id || ''
              if (moveDlg) moveDlg.remove()
              const dlg = document.createElement('dialog')
              dlg.id = 'spark-move-dialog'
              dlg.className = 'dialog'
              const escHtml = (s) => (s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
              const rows = ['<label class="row"><input type="radio" name="sf-move" value=""' + (current ? '' : ' checked') + '> <span>' + _t('sparks.noFolder', 'No folder') + '</span></label>']
              for (const f of folders) {
                rows.push('<label class="row"><input type="radio" name="sf-move" value="' + f.id + '"' + (current === f.id ? ' checked' : '') + '> <span>' + (f.icon ? '<span class="sf-emoji" aria-hidden="true">' + escHtml(f.icon) + '</span> ' : '') + escHtml(f.name) + '</span></label>')
              }
              if (folders.length === 0) {
                rows.unshift('<p class="muted small">' + _t('sparks.noFoldersYet', 'No folders yet — create one first.') + '</p>')
              }
              dlg.innerHTML =
                '<form class="modal" id="sf-move-form" novalidate>' +
                  '<h3>' + _t('sparks.moveToFolder', 'Move to folder') + '</h3>' +
                  '<div class="sf-move-list">' + rows.join('') + '</div>' +
                  '<p class="error" id="sf-move-error" role="alert"></p>' +
                  '<div class="row">' +
                    '<button type="submit" id="sf-move-save"' + (folders.length === 0 ? ' disabled' : '') + '>' + _t('common.save', 'Save') + '</button>' +
                    '<button type="button" class="ghost" id="sf-move-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
                  '</div>' +
                '</form>'
              document.body.appendChild(dlg)
              const close = () => dlg.close()
              dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
              dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
              dlg.querySelector('#sf-move-cancel').addEventListener('click', close)
              dlg.querySelector('#sf-move-form').addEventListener('submit', async (e) => {
                e.preventDefault()
                const picked = dlg.querySelector('input[name="sf-move"]:checked')
                if (!picked) return
                const save = dlg.querySelector('#sf-move-save')
                save.disabled = true
                try {
                  const res = await fetch('/api/projects/' + sparkId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ folder_id: picked.value || null }),
                  })
                  if (!res.ok) throw new Error('move failed')
                  window.hibana?.rail?.refresh?.() // S148: the rail's sparks section follows the move-dialog re-filing
                  close()
                  reloadShelf()
                } catch {
                  dlg.querySelector('#sf-move-error').textContent = _t('sparks.folderFailed', "Couldn't update the folder — try again")
                  save.disabled = false
                }
              })
              moveDlg = dlg
              dlg.showModal()
            })
            .catch(() => window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err'))
        }

        // ---- Delegated clicks: menu toggle / outside-close / edit / delete / folders ----
        ctx.on('click', (e) => {
          // ---- Folder bar / folder GRID first (they live inside the shelf but must not
          // fall through to the card-menu branch). S40 ORDER FIX: [data-sf-new] and
          // [data-sf-menu] are checked BEFORE [data-sf] — in the folder GRID the ⋯ menu
          // button sits INSIDE the [data-sf] card, so the old order turned every menu
          // click into a folder entry (rename/delete were unreachable there).
          const sfNew = e.target.closest('[data-sf-new]')
          if (sfNew) { e.preventDefault(); openFolderDialog('', '', ''); return }
          const sfMenuBtn = e.target.closest('[data-sf-menu]')
          if (sfMenuBtn) { e.preventDefault(); toggleSfMenu(sfMenuBtn); return }
          const sfRename = e.target.closest('[data-sf-rename]')
          if (sfRename) {
            const host = sfRename.closest('.sf-menu')
            openFolderDialog(sfRename.getAttribute('data-sf-rename'), host?.dataset.folderName || '', host?.dataset.folderIcon || '')
            closeSfMenus()
            return
          }
          const sfDelete = e.target.closest('[data-sf-delete]')
          if (sfDelete) {
            const name = sfDelete.closest('.sf-menu')?.dataset.folderName || ''
            closeSfMenus()
            deleteFolder(sfDelete.getAttribute('data-sf-delete'), name)
            return
          }
          if (!e.target.closest('#spark-shelf .sf-menu')) closeSfMenus()
          const sfChip = e.target.closest('[data-sf]')
          if (sfChip) {
            const input = document.getElementById('spark-folder')
            if (input) {
              input.value = sfChip.getAttribute('data-sf') || ''
              // Session 28: stamp the picked folder's NAME too — the quick-add modal
              // reads it to hint where the capture will land («Files into: …»).
              // S41: only for a REAL folder selection — the bar's home chip (data-sf="")
              // clears the context; stamping «پوشه‌ها» there would lie to the hint.
              const label = input.value ? sfChip.querySelector('.sf-label, .spark-folder-name') : null
              const name = label ? label.textContent.trim() : ''
              if (input.dataset) input.dataset.folderName = name
              // S40: persist the working folder so reloads/captures keep the context.
              writeFolderPref(input.value, name)
            }
            reloadShelf()
            return
          }

          const openBtn = e.target.closest('[data-menu-open]')
          if (openBtn && openBtn.closest('#spark-shelf')) {
            const host = openBtn.closest('.spark-menu')
            const pop = host && host.querySelector('.spark-menu-pop')
            const isOpen = pop && !pop.hidden
            closeMenus()
            if (pop && !isOpen) {
              pop.hidden = false
              openBtn.setAttribute('data-open', '')
            }
            return
          }
          const moveBtn = e.target.closest('[data-spark-move]')
          if (moveBtn) { closeMenus(); openMoveDialog(moveBtn.getAttribute('data-spark-move')); return }
          const editBtn = e.target.closest('[data-spark-edit]')
          if (editBtn) { closeMenus(); openEdit(editBtn.getAttribute('data-spark-edit')); return }
          const delBtn = e.target.closest('[data-spark-delete]')
          if (delBtn) { closeMenus(); deleteSpark(delBtn.getAttribute('data-spark-delete'), delBtn.closest(MENU_HOST)); return }
          if (!e.target.closest('#spark-shelf .spark-menu')) closeMenus()
        })
        ctx.on('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); closeSfMenus() } })

        // ---- Drag-to-reorder (native HTML5 DnD, delegated so htmx swaps never need re-binding).
        // Mirrors projects.html but scoped to the sparks shelf (all cards share status=spark). ----
        let dragEl = null
        ctx.on('dragstart', (e) => {
          const card = e.target.closest('#spark-shelf [data-project-id]')
          if (!card) return
          if (e.target.closest('.spark-menu')) { e.preventDefault(); return } // menu clicks must not drag
          dragEl = card
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', card.dataset.projectId)
          card.classList.add('dragging')
        })
        ctx.on('dragover', (e) => {
          if (!dragEl) return
          e.preventDefault()
          const node = e.target.closest('#spark-shelf [data-project-id]')
          if (!node || node === dragEl || node.parentElement !== dragEl.parentElement) return
          const r = node.getBoundingClientRect()
          const after = r.width >= r.height ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
          node.parentElement.insertBefore(dragEl, after ? node.nextSibling : node)
        })
        ctx.on('drop', async (e) => {
          if (!dragEl) return
          e.preventDefault()
          try {
            const container = dragEl.parentElement
            if (container && container.contains(e.target)) {
              const ids = [...container.querySelectorAll('[data-project-id]')].map((el) => el.dataset.projectId)
              if (ids.length >= 2) {
                const res = await fetch('/api/projects/reorder', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'spark', ids }),
                })
                if (!res.ok) throw new Error('reorder failed')
                window.hibana?.rail?.refresh?.() // S148: the rail's sparks section follows the reorder in the same beat
              }
            }
            reloadShelf() // server reassigns sort_order — refetch authoritative order
          } catch (err) {
            window.hibana?.toast(_t('sparks.reorderFailed', 'Reorder failed — try again'), 'err')
          } finally {
            if (dragEl) dragEl.classList.remove('dragging')
            dragEl = null
          }
        })
        ctx.on('dragend', () => {
          if (dragEl) dragEl.classList.remove('dragging')
          dragEl = null
        })

        // Re-inject menus on every shelf render (initial load, 30s refresh, manual reload).
        // htmx 2.x dispatches both the legacy `htmx:`-prefixed and the new unprefixed event
        // names — register both so the injection never misses a swap.
        // S44: open menus used to DIE with the 30s poll's innerHTML swap — a ⋯ popped,
        // then vanished mid-read before the tap landed ("clicking does nothing").
        // beforeSwap captures what was open; afterSwap re-opens it on the fresh DOM.
        let reopenSparkId = null
        let reopenFolderId = null
        const captureOpenMenus = () => {
          const root = shelf()
          if (!root) return
          const pop = root.querySelector('.spark-menu-pop:not([hidden])')
          reopenSparkId = pop ? (pop.closest('[data-project-id]')?.dataset.projectId || null) : null
          const sfm = root.querySelector('.sf-menu')
          reopenFolderId = sfm ? (sfm.querySelector('[data-sf-rename]')?.getAttribute('data-sf-rename') || null) : null
        }
        for (const name of ['htmx:beforeSwap', 'beforeSwap']) ctx.on(name, captureOpenMenus)
        const reinject = () => {
          injectSparksMenus()
          const root = shelf()
          if (!root) return
          if (reopenSparkId) {
            const pop = root.querySelector('[data-project-id="' + reopenSparkId + '"] .spark-menu-pop')
            if (pop) {
              pop.hidden = false
              const btn = pop.parentElement?.querySelector('[data-menu-open]')
              if (btn) btn.setAttribute('data-open', '')
            }
            reopenSparkId = null
          }
          if (reopenFolderId) {
            const btn = root.querySelector('[data-sf-menu="' + reopenFolderId + '"]')
            if (btn) toggleSfMenu(btn)
            reopenFolderId = null
          }
        }
        for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
          ctx.on(name, reinject)
        }
        injectSparksMenus()

        // ---- S40: belt-and-suspenders restore of the remembered folder. sparks.html's
        // inline stamp covers hard loads (before htmx's first fetch); THIS covers soft
        // navigation back to the page and any future boot-order drift: if the hidden
        // input is still empty while a pref exists, apply it and fetch the folder view.
        const pref = readFolderPref()
        if (pref && !currentFolder() && pref.id !== 'all') {
          const input = document.getElementById('spark-folder')
          if (input) {
            input.value = pref.id
            if (input.dataset) input.dataset.folderName = pref.name || ''
            reloadShelf()
          }
        }

        // ---- S40: the post-capture soft refresh hook. app.js's quick-add used to hard
        // reload /sparks.html (losing the open folder + scroll position every capture);
        // it now calls this when present and falls back to the reload otherwise.
        window.__hibanaShelfReload = () => { reloadShelf() }

        // Teardown: drop the lazily-built dialogs from the body on unmount.
        return () => {
          closeMenus()
          closeSfMenus()
          if (editDlg) editDlg.remove()
          editDlg = null
          if (folderDlg) folderDlg.remove()
          folderDlg = null
          if (moveDlg) moveDlg.remove()
          moveDlg = null
          delete window.__hibanaShelfReload
        }
      },
    })
