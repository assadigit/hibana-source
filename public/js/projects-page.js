    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'projects',
      mount(ctx) {
        // Dashboard stat-box “view all →” links land here with ?status= (and ?view=):
        // adopt them into the filter bar and reload the list through the form itself.
        const qs = new URLSearchParams(location.search)
        const urlView = qs.get('view')
        const urlStatus = qs.get('status')
        // S75: the full stale view — the S72 dashboard nudge's "View all" deep link
        // (?stale=1). Landing mode: cards view (the stages home is meaningless for a
        // filtered special view — mirrors the ?status= behavior), and the hidden form
        // input carries the flag so the initial hx-include request serializes it.
        const urlStale = qs.get('stale') === '1'
        if (urlStale) {
          const staleFlag = document.getElementById('stale-flag')
          if (staleFlag) staleFlag.value = '1'
        }
        // Phase 5 item 10 (2026-09-08): the view is a REMEMBERED preference — an explicit
        // ?view= / ?status= link still wins (it carries intent), otherwise the stored
        // choice rides (list stays list, kanban stays kanban). Default remains the grid.
        const VIEW_PREF_KEY = 'hibana-projects-view'
        const readViewPref = () => { try { return localStorage.getItem(VIEW_PREF_KEY) || '' } catch { return '' } }
        const writeViewPref = (v) => { try { localStorage.setItem(VIEW_PREF_KEY, v) } catch {} }
        const VALID_VIEWS = ['grid', 'cards', 'list', 'sticky', 'kanban']
        const viewSel = () => document.getElementById('view-select-sel')
        const syncViewUi = (v) => {
          const sel = viewSel()
          if (sel) sel.value = v
        }
        let initialView = 'grid'
        if (urlView && VALID_VIEWS.includes(urlView)) initialView = urlView
        else if (urlStatus || urlStale) initialView = 'cards' // a status/stale link wants the list of that stage
        else {
          const pref = readViewPref()
          if (VALID_VIEWS.includes(pref)) initialView = pref
        }
        document.getElementById('view').value = initialView
        syncViewUi(initialView)
        if (!urlView && !urlStatus && !urlStale) writeViewPref(initialView) // a stale link is a landing mode, not a preference change
        // batch q: legacy pre-0034 URLs/filters map onto the new lifecycle vocabulary.
        const LEGACY_STATUS = { pending: 'unreviewed', building: 'doing', working: 'operational', archived: 'halted' }
        const normStatus = (s) => LEGACY_STATUS[s] || s
        const normUrlStatus = urlStatus ? normStatus(urlStatus) : null
        if (normUrlStatus) {
          const sel = document.querySelector('select[name="status"]')
          // spark is not among the filter options (ideas live on the Ideas shelf) — an
          // old ?status=spark link falls back to the unfiltered list.
          if (sel && [...sel.options].some((o) => o.value === normUrlStatus)) sel.value = normUrlStatus
        }
        // The values above are read by #project-list's hx-trigger="load" request
        // (hx-include="form.filters") — no manual ajax here anymore: the old second
        // request raced the load trigger's bare GET and lost, wiping the params.

        // S45: the sort select mirrors the view pref pattern — ?sort= carries intent
        // (deep links), else the stored choice rides, else 'stage' (server default).
        // Changing the select is a normal form change: htmx re-requests the list AND
        // flipOutOfGrid (below) flips the stages home → cards, so the sort immediately
        // has visible results — a sort change on the home must not look like a dead
        // control. We just persist the choice here.
        const SORT_PREF_KEY = 'hibana-projects-sort'
        const VALID_SORTS = ['stage', 'recent', 'title']
        const sortSel = () => document.getElementById('sort-select-sel')
        const urlSort = qs.get('sort')
        if (urlSort && VALID_SORTS.includes(urlSort)) {
          if (sortSel()) sortSel().value = urlSort
        } else {
          let pref = ''
          try { pref = localStorage.getItem(SORT_PREF_KEY) || '' } catch { /* storage unavailable */ }
          if (VALID_SORTS.includes(pref) && sortSel()) sortSel().value = pref
        }
        if (sortSel()) {
          sortSel().addEventListener('change', () => {
            try { localStorage.setItem(SORT_PREF_KEY, sortSel().value) } catch {}
          })
        }

        window.setView = function (v) {
          if (!VALID_VIEWS.includes(v)) return
          document.getElementById('view').value = v
          syncViewUi(v)
          writeViewPref(v) // Phase 5 item 10 — the preference sticks across visits
          reloadList()
        }

        // batch (s): while the GRID view is showing, touching any filter control means
        // the user wants results — flip to cards BEFORE htmx serializes the form (capture
        // phase, so this runs ahead of htmx's own bubble-phase trigger listeners).
        // S75: the same touch also EXITS the stale view — a filter interaction means
        // browsing normally again, so the hidden stale flag must not ride the next
        // request (the server banner disappears with the swap; the URL is cleaned so a
        // refresh does not re-land in the special view).
        const exitStaleMode = () => {
          const f = document.getElementById('stale-flag')
          if (f && f.value) {
            f.value = ''
            try { history.replaceState({}, '', '/projects.html') } catch { /* history unavailable */ }
          }
        }
        const flipOutOfGrid = () => {
          const viewInput = document.getElementById('view')
          if (viewInput && viewInput.value === 'grid') {
            viewInput.value = 'cards'
            syncViewUi('cards')
            writeViewPref('cards')
          }
          exitStaleMode()
        }
        const filterForm = document.querySelector('form.filters')
        if (filterForm) {
          filterForm.addEventListener('change', flipOutOfGrid, true)
          filterForm.addEventListener('keyup', flipOutOfGrid, true)
        }

        // B3.2: "f" focuses the search input (Quick Find), when not already in an input.
        // "/" stays with the global command palette (which also searches projects).
        ctx.on('keydown', (e) => {
          if (e.key === 'f' && !/input|textarea|select/i.test(e.target.tagName) && !e.target.isContentEditable && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const search = document.querySelector('form.filters input[type="search"]')
            if (search) { e.preventDefault(); search.focus(); search.select() }
          }
        })

        // R2.3: Saved filters — localStorage-backed chips. Save current status+tag+search+view
        // as a named chip; click to re-apply; × to delete. Pure client convenience, zero server.
        const SF_KEY = 'hibana-saved-filters'
        const sfBar = document.getElementById('saved-filters')
        const sfList = document.getElementById('saved-filters-list')
        const sfAddBtn = document.getElementById('save-filter-btn')
        const _tsf = (k, f) => window.hibanaI18n?.t(k) || f
        function readSavedFilters() {
          try { return JSON.parse(localStorage.getItem(SF_KEY) || '[]') } catch { return [] }
        }
        function writeSavedFilters(arr) {
          try { localStorage.setItem(SF_KEY, JSON.stringify(arr)) } catch {}
        }
        function currentFilter() {
          const form = document.querySelector('form.filters')
          if (!form) return null
          return {
            status: form.querySelector('[name="status"]')?.value || '',
            tag: form.querySelector('[name="tag"]')?.value || '',
            q: form.querySelector('[name="q"]')?.value || '',
            view: form.querySelector('[name="view"]')?.value || 'cards',
          }
        }
        function applyFilter(f) {
          const form = document.querySelector('form.filters')
          if (!form) return
          form.querySelector('[name="status"]').value = normStatus(f.status || '')
          form.querySelector('[name="tag"]').value = f.tag || ''
          form.querySelector('[name="q"]').value = f.q || ''
          const viewInput = form.querySelector('[name="view"]')
          if (viewInput) viewInput.value = f.view || 'cards'
          for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === (f.view || 'cards'))
          if (window.htmx) window.htmx.ajax('GET', '/api/projects', { source: form, target: '#project-list', swap: 'innerHTML' })
        }
        function renderSavedFilters() {
          const filters = readSavedFilters()
          if (!filters.length) { sfBar.hidden = true; return }
          sfBar.hidden = false
          sfList.innerHTML = filters.map((f, i) => {
            const label = f.name.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
            return `<span class="saved-filter-chip" data-sf-idx="${i}" role="button" tabindex="0">
              <span class="sf-label">${label}</span>
              <button type="button" class="sf-remove" data-sf-remove="${i}" aria-label="${_tsf('filters.remove','Remove')}"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            </span>`
          }).join('')
        }
        sfAddBtn?.addEventListener('click', () => {
          const f = currentFilter()
          if (!f) return
          const name = prompt(_tsf('filters.namePrompt','Name this filter (e.g. "Client work this week"):'), '')
          if (!name) return
          const filters = readSavedFilters()
          filters.push({ name: name.slice(0, 40), ...f })
          writeSavedFilters(filters)
          renderSavedFilters()
        })
        sfList?.addEventListener('click', (e) => {
          const remove = e.target.closest('[data-sf-remove]')
          if (remove) {
            e.stopPropagation()
            const idx = Number(remove.dataset.sfRemove)
            const filters = readSavedFilters()
            filters.splice(idx, 1)
            writeSavedFilters(filters)
            renderSavedFilters()
            return
          }
          const chip = e.target.closest('[data-sf-idx]')
          if (chip) {
            const idx = Number(chip.dataset.sfIdx)
            const filters = readSavedFilters()
            if (filters[idx]) applyFilter(filters[idx])
          }
        })
        renderSavedFilters()

        // S75: the banner's exit hatch (server-rendered inside the fragment, so the
        // handler is document-delegated — htmx swaps never need re-binding, same as
        // the DnD listeners). Clear the flag, clean the URL, re-request through the
        // form so every OTHER active filter still applies.
        ctx.on('click', (e) => {
          const btn = e.target?.closest?.('[data-stale-clear]')
          if (!btn) return
          e.preventDefault()
          exitStaleMode()
          const form = document.querySelector('form.filters')
          if (form && window.htmx) window.htmx.ajax('GET', '/api/projects', { source: form, target: '#project-list', swap: 'innerHTML' })
        })

        // Drag & drop (spec §5.3): a kanban cross-column drop changes status; dropping a card onto a
        // same-status sibling reorders it (cards/list) or within its kanban column. Native HTML5 DnD,
        // delegated on the document so htmx fragment swaps never need re-binding. ctx.on keeps the
        // listeners mounted — nav.js removes them when this page unmounts.
        const t_ = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f
        let dragEl = null
        let dragOverEl = null
        const REORDERABLE = '.card-grid, .projects-table, .kanban-col'

        function clearDragOver() {
          if (dragOverEl) { dragOverEl.classList.remove('drag-over'); dragOverEl = null }
        }

        // The sibling we may live-reorder onto: same parent run as the dragged card (same kanban
        // column / same grid root) and, for the flat cards/list views, the same status.
        function reorderTarget(el) {
          if (!dragEl) return null
          const node = el.closest('[data-project-id]')
          if (!node || node === dragEl) return null
          if (node.parentElement !== dragEl.parentElement) return null
          if (!dragEl.closest('.kanban-col') && node.dataset.status !== dragEl.dataset.status) return null
          return node
        }

        // Persist the current on-screen order of one status group (server reassigns sort_order).
        async function postOrder(container, status) {
          const ids = [...container.querySelectorAll(`[data-project-id][data-status="${status}"]`)].map((el) => el.dataset.projectId)
          if (ids.length < 2) return
          const res = await fetch('/api/projects/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status, ids }),
          })
          if (!res.ok) throw new Error('reorder failed')
        }

        function cleanup() {
          if (dragEl) dragEl.classList.remove('dragging')
          dragEl = null
          clearDragOver()
        }

        ctx.on('dragstart', (e) => {
          const card = e.target.closest('[data-project-id]')
          if (!card || !card.closest(REORDERABLE)) return // sticky notes stay click-to-open
          if (e.target.closest('.spark-menu')) { e.preventDefault(); return } // menu clicks must not drag
          dragEl = card
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', card.dataset.projectId)
          card.classList.add('dragging')
        })

        ctx.on('dragover', (e) => {
          e.preventDefault()
          const target = reorderTarget(e.target)
          clearDragOver()
          if (!target) return
          const r = target.getBoundingClientRect()
          const after = r.width >= r.height ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
          target.parentElement.insertBefore(dragEl, after ? target.nextSibling : target)
          dragOverEl = target
          target.classList.add('drag-over')
        })

        ctx.on('drop', async (e) => {
          if (!dragEl) return
          e.preventDefault()
          const container = dragEl.parentElement
          const status = dragEl.dataset.status
          const col = e.target.closest('.kanban-col')
          try {
            if (dragEl.closest('.kanban-col')) {
              if (col && col.dataset.status === status) {
                await postOrder(container, status) // in-column reorder (incl. drop on empty column space)
              } else if (col && col.dataset.status !== status) {
                const res = await fetch(`/api/projects/${dragEl.dataset.projectId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: col.dataset.status }),
                })
                if (!res.ok) throw new Error('status change failed')
              }
            } else if (container.classList.contains('card-grid') || container.tagName === 'TBODY') {
              if (container.contains(e.target)) await postOrder(container, status) // in-status reorder
            }
            reloadList() // refresh from the server (authoritative order)
          } catch (err) {
            window.hibana?.toast(t_('list.reorderFailed', 'Reorder failed — try again'), 'err')
          } finally {
            cleanup()
          }
        })

        ctx.on('dragend', cleanup)

        // ---- ⋯ quick menu on every card: Edit / Delete (user request 2026-08-21) ----
        // Same injection pattern as the sparks page: client-side only, re-injected after
        // every htmx swap so filter/view changes never leave dead buttons.
        const _t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f
        const list = () => document.getElementById('project-list')
        // Deterministic list refresh: serialize the filter form and swap the list in — no
        // reliance on synthetic events reaching htmx's trigger handlers.
        const reloadList = () => {
          if (!window.htmx) return
          window.htmx.ajax('GET', '/api/projects', {
            source: document.querySelector('form.filters'),
            target: '#project-list',
            swap: 'innerHTML',
          })
        }

        function injectCardMenus() {
          const root = list()
          if (!root) return
          for (const card of root.querySelectorAll('.project-card:not([data-menu-ok])')) {
            const meta = card.querySelector('.title-meta')
            if (!meta) continue
            const id = card.dataset.projectId
            const menu = document.createElement('div')
            menu.className = 'spark-menu'
            menu.innerHTML =
              '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + _t('sparks.more', 'More actions') + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>' +
              '</button>' +
              '<div class="spark-menu-pop" hidden>' +
                '<button type="button" data-card-edit="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>' + _t('common.edit', 'Edit') + '</span></button>' +
                '<button type="button" class="danger" data-card-delete="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>' + _t('common.delete', 'Delete') + '</span></button>' +
              '</div>'
            meta.appendChild(menu)
            card.setAttribute('data-menu-ok', '')
          }
        }

        function closeMenus() {
          document.querySelectorAll('#project-list .spark-menu-pop:not([hidden])').forEach((pop) => {
            pop.hidden = true
            const btn = pop.parentElement && pop.parentElement.querySelector('[data-menu-open]')
            if (btn) btn.removeAttribute('data-open')
          })
        }

        // ---- Edit dialog (title + description) — mirror of the sparks-page dialog ----
        let editDlg = null
        function buildEditDialog() {
          if (editDlg) return
          const dlg = document.createElement('dialog')
          dlg.id = 'card-edit-dialog'
          dlg.className = 'dialog'
          dlg.innerHTML =
            '<form class="modal" id="ce-form" novalidate>' +
              '<h3>' + _t('card.dialogTitle', 'Edit project') + '</h3>' +
              '<label>' + _t('sparks.title', 'Title') + ' <input id="ce-title" required maxlength="200" autocomplete="off"></label>' +
              '<label>' + _t('sparks.description', 'Description') + ' <textarea id="ce-description" rows="4" maxlength="2000"></textarea></label>' +
              // Task 24 (#6, user 2026-09-05): the dialog edits the project's STATE too —
              // until now only kanban DnD (desktop) could move idea → in progress.
              // batch q: spark (idea) + the six project stages — demoting to «ایده» sends
              // the project back to the Ideas shelf.
              '<label>' + _t('calendar.stage', 'Stage') + ' <select id="ce-status">' +
                ['spark','unreviewed','investigating','awaiting','doing','halted','operational'].map(function (s) { return '<option value="' + s + '">' + _t('status.' + s, s) + '</option>' }).join('') +
              '</select></label>' +
              '<p class="error" id="ce-error" role="alert"></p>' +
              '<div class="row">' +
                '<button type="submit" id="ce-save">' + _t('common.save', 'Save') + '</button>' +
                '<button type="button" class="ghost" id="ce-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
              '</div>' +
            '</form>'
          document.body.appendChild(dlg)
          const close = () => dlg.close()
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
          dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
          dlg.querySelector('#ce-cancel').addEventListener('click', close)
          dlg.querySelector('#ce-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const id = dlg.dataset.editId
            const title = dlg.querySelector('#ce-title').value.trim()
            if (!id || !title) return
            const err = dlg.querySelector('#ce-error')
            const save = dlg.querySelector('#ce-save')
            err.textContent = ''
            save.disabled = true
            save.textContent = _t('card.saving', 'Saving…')
            try {
              const res = await fetch('/api/projects/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description: dlg.querySelector('#ce-description').value, status: dlg.querySelector('#ce-status').value || undefined }),
              })
              if (!res.ok) throw new Error('update failed')
              close()
              window.hibana?.toast(_t('sparks.saved', 'Saved'), 'info', 3000)
              // User request: after saving a project, land back on the dashboard.
              if (window.hibanaNav) window.hibanaNav.go('/app')
              else window.location.href = '/app'
            } catch (err2) {
              err.textContent = _t('card.saveFailed', "Couldn't save the project")
            } finally {
              save.disabled = false
              save.textContent = _t('common.save', 'Save')
            }
          })
          editDlg = dlg
        }

        function openEdit(id) {
          buildEditDialog()
          const dlg = editDlg
          dlg.querySelector('#ce-error').textContent = ''
          fetch('/api/projects/' + id)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fetch failed'))))
            .then((body) => {
              const p = body.project || {}
              dlg.dataset.editId = id
              dlg.querySelector('#ce-title').value = p.title ?? ''
              dlg.querySelector('#ce-description').value = p.description ?? ''
              if (p.status) dlg.querySelector('#ce-status').value = p.status
              dlg.showModal()
            })
            .catch(() => window.hibana?.toast(_t('card.loadFailed', "Couldn't load the project"), 'err'))
        }

        // ---- Delete (soft) + Undo toast, then reload the authoritative list ----
        function deleteCard(id, card) {
          if (!id || !card) return
          fetch('/api/projects/' + id, { method: 'DELETE' })
            .then(async (r) => {
              if (!r.ok) {
                window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err')
                return
              }
              card.remove()
              window.hibana?.toast(_t('card.deleted', 'Project deleted'), 'info', 6000)
              const toastEl = document.getElementById('toast')
              if (toastEl) {
                const undo = document.createElement('button')
                undo.className = 'ghost'
                undo.textContent = _t('common.undo', 'Undo')
                undo.addEventListener('click', () => {
                  fetch('/api/projects/' + id + '/restore', { method: 'POST' })
                    .then((r2) => { if (r2.ok) reloadList() })
                    .catch(() => {})
                })
                toastEl.appendChild(undo)
              }
              reloadList()
            })
            .catch(() => window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err'))
        }

        // Delegated clicks: menu toggle / outside-close / edit / delete.
        ctx.on('click', (e) => {
          const openBtn = e.target.closest('[data-menu-open]')
          if (openBtn && openBtn.closest('#project-list')) {
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
          const editBtn = e.target.closest('[data-card-edit]')
          if (editBtn) { closeMenus(); openEdit(editBtn.getAttribute('data-card-edit')); return }
          const delBtn = e.target.closest('[data-card-delete]')
          if (delBtn) { closeMenus(); deleteCard(delBtn.getAttribute('data-card-delete'), delBtn.closest('.project-card')); return }
          if (!e.target.closest('#project-list .spark-menu')) closeMenus()
        })
        ctx.on('keydown', (e) => { if (e.key === 'Escape') closeMenus() })

        const reinject = () => injectCardMenus()
        for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
          ctx.on(name, reinject)
        }
        injectCardMenus()

        // ---- batch q: the six-box glance strip (server-rendered at the top of the list
        // fragment). Clicking a box applies the stage filter in place — no page reload;
        // the href is the no-JS fallback. The server re-renders the strip with the active
        // highlight on the next fragment swap.
        // S44: the boxes carry data-nav-local — nav.js's capture-phase link interceptor
        // used to swallow the click (stopPropagation) and then no-op on the same URL, so
        // NOTHING happened when the filter was already the URL's status. The handler now
        // actually runs. It sets the select and dispatches a real (bubbling) change event
        // so the EXISTING filter machinery fires: flipOutOfGrid (grid → cards when a
        // filter is touched) + the form's own hx-trigger="change" request.
        ctx.on('click', (e) => {
          const box = e.target.closest('[data-pglance]')
          if (!box) return
          e.preventDefault()
          const form = document.querySelector('form.filters')
          const sel = form?.querySelector('[name="status"]')
          if (!form || !sel || !window.htmx) return
          const stage = box.getAttribute('data-pglance')
          // clicking the active box clears the filter (toggle)
          sel.value = sel.value === stage ? '' : stage
          sel.dispatchEvent(new Event('change', { bubbles: true }))
        })

        // ---- R3.2: Search highlight — after every list swap, wrap the query text in <mark>
        // in titles/descriptions. The FTS5 search already filtered server-side; this just
        // visually highlights the match. Re-runs on every htmx swap (filter/view change).
        const TITLE_ELS = '.project-title, .sticky-note strong, .projects-table td:first-child a, .kanban-card strong'
        // Plain text of elements we highlighted, keyed by element — a cleared query puts
        // the exact server-rendered text back (no stale <mark>s left behind).
        const originalText = new WeakMap()
        function highlightSearch() {
          const q = (document.querySelector('form.filters input[name="q"]')?.value || '').trim()
          const root = document.getElementById('project-list')
          if (!root) return
          if (!q || q.length < 2) {
            // Query cleared / too short to highlight: restore the original text.
            root.querySelectorAll(TITLE_ELS).forEach((el) => {
              const orig = originalText.get(el)
              if (orig !== undefined) {
                el.textContent = orig
                originalText.delete(el)
              }
            })
            return
          }
          const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
          // Titles (.project-title, .card strong, .sticky-note strong, table td:first-child a)
          root.querySelectorAll(TITLE_ELS).forEach((el) => {
            if (el.querySelector('mark')) return // already highlighted (avoid double-wrap)
            const txt = el.textContent
            // SECURITY (2026-08-29): never re-serialize the decoded text through innerHTML —
            // a crafted title (e.g. "<img src=x onerror=…>") would re-parse as HTML and
            // execute (stored XSS). Build DOM nodes instead: text nodes for the unmatched
            // parts, a <mark> whose textContent carries the match. txt.split(re) with the
            // single capture group yields [before, match, between, match, …, after].
            const parts = txt.split(re)
            if (parts.length === 1) return // no match
            originalText.set(el, txt)
            const frag = document.createDocumentFragment()
            for (let i = 0; i < parts.length; i++) {
              if (i % 2 === 1) {
                const mark = document.createElement('mark')
                mark.className = 'search-hit'
                mark.textContent = parts[i]
                frag.appendChild(mark)
              } else if (parts[i]) {
                frag.appendChild(document.createTextNode(parts[i]))
              }
            }
            el.replaceChildren(frag)
          })
        }
        const reHighlight = () => highlightSearch()
        for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
          ctx.on(name, reHighlight)
        }
        highlightSearch()

        return () => {
          closeMenus()
          if (editDlg) editDlg.remove()
          editDlg = null
        }
      },
    })
