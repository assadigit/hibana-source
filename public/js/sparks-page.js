    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'sparks',
      mount(ctx) {
        const _t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f
        const isFA = () => window.hibanaI18n?.lang?.() === 'fa'
        const faNum = (s) => (isFA() ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s))
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

        // ---- S161 (spec #12): the SEARCH — one query spans title/description/links/
        // tags/folder name (server-side LIKE+EXISTS), and OVERRIDES the open folder.
        // Debounced 250ms; the ✕ + Escape clear; the match count follows every swap
        // and poll. An ACTIVE search also de-activates every folder chip (the server
        // renders no active chip while q rides the request).
        const searchInput = document.getElementById('sparks-q')
        const searchClear = document.getElementById('sparks-q-clear')
        const searchCount = document.getElementById('sparks-q-count')
        const currentQuery = () => (searchInput ? searchInput.value.trim() : '')
        let searchTimer = 0
        const paintSearchChrome = () => {
          if (searchClear) searchClear.hidden = !searchInput.value
        }
        const updateMatchCount = () => {
          if (!searchCount) return
          const q = currentQuery()
          if (!q) { searchCount.textContent = ''; return }
          const root = shelf()
          const n = root ? root.querySelectorAll('[data-project-id]').length : 0
          searchCount.textContent = n === 1
            ? _t('sparks.nMatchesOne', '1 match')
            : _t('sparks.nMatches', '{n} matches').split('{n}').join(faNum(n))
        }
        const clearSearch = (refocus) => {
          if (!searchInput) return
          if (!searchInput.value) { paintSearchChrome(); return }
          searchInput.value = ''
          paintSearchChrome()
          if (refocus) searchInput.focus()
          reloadShelf()
        }
        if (searchInput) {
          searchInput.addEventListener('input', () => {
            paintSearchChrome()
            clearTimeout(searchTimer)
            searchTimer = setTimeout(reloadShelf, 250)
          })
          searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); clearSearch(false) }
          })
        }
        searchClear?.addEventListener('click', () => clearSearch(true))

        const reloadShelf = () => {
          if (!window.htmx) return
          const f = currentFolder()
          const v = currentView()
          const q = currentQuery()
          // Folder param only when a folder is explicitly selected AND no search rides
          // the request (a search overrides the folder scope — spec #12). When both are
          // empty the server renders the folder grid home.
          const params = new URLSearchParams()
          params.set('status', 'spark')
          params.set('view', v)
          if (q) params.set('q', q)
          else if (f) params.set('folder', f)
          window.htmx.ajax('GET', '/api/projects?' + params.toString(), { target: '#spark-shelf', swap: 'innerHTML' })
        }

        // ---- S160 + S161 (spec #13): DRAG-TO-FILE. Manual drag-REORDER of the idea
        // list is RETIRED (spec #13's deliberate exception) — dragging an idea now
        // means FILING it: drop on a folder chip (every view) or a kanban column.
        // ONE dragstart feeds both target families; the view chips ('' home / 'all')
        // are never droppable; 'none' + the No-folder column mean folder_id=null.
        let sparkDragId = null
        const droppableChip = (el) => {
          const chip = el.closest?.('.sf-bar .sf-chip[data-sf]')
          if (!chip) return null
          const key = chip.getAttribute('data-sf') || ''
          // '' = the home/Folders chip (the grid home), 'all' = every idea — neither is
          // a folder; a drop there must not file anywhere (spec #11's virtual folders
          // are 'none' only).
          return key === '' || key === 'all' ? null : chip
        }
        const clearDragHints = () => {
          document.querySelectorAll('#spark-shelf .drag-over').forEach((el) => el.classList.remove('drag-over'))
        }
        ctx.on('dragstart', (e) => {
          const card = e.target.closest?.('#spark-shelf [data-project-id]')
          if (!card) return
          if (e.target.closest('.spark-menu, .spark-pin, button, a, input, select, textarea')) { e.preventDefault(); return }
          sparkDragId = card.dataset.projectId || null
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
            try { e.dataTransfer.setData('text/plain', sparkDragId || '') } catch {}
          }
        })
        ctx.on('dragover', (e) => {
          if (!sparkDragId) return
          const col = e.target.closest?.('.kanban-col[data-spark-folder]')
          const chip = droppableChip(e.target)
          if (!col && !chip) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          clearDragHints()
          ;(col || chip).classList.add('drag-over')
        })
        ctx.on('drop', async (e) => {
          if (!sparkDragId) return
          const col = e.target.closest?.('.kanban-col[data-spark-folder]')
          const chip = droppableChip(e.target)
          if (!col && !chip) return
          e.preventDefault()
          const id = sparkDragId
          sparkDragId = null
          clearDragHints()
          const folderKey = col ? col.dataset.sparkFolder : chip.getAttribute('data-sf')
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
        ctx.on('dragend', () => { sparkDragId = null; clearDragHints() })

        // ---- S161 (spec #5): the PIN TOGGLE — one tap, no confirm, optimistic
        // fill/unfill + an authoritative refetch (pins float to the top).
        ctx.on('click', async (e) => {
          const pinBtn = e.target.closest('[data-spark-pin]')
          if (!pinBtn || !pinBtn.closest('#spark-shelf')) return
          e.preventDefault()
          e.stopPropagation()
          const id = pinBtn.getAttribute('data-spark-pin')
          const on = !pinBtn.classList.contains('is-on')
          // optimistic
          pinBtn.classList.toggle('is-on', on)
          pinBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
          const svg = pinBtn.querySelector('svg')
          if (svg) { if (on) svg.setAttribute('fill', 'currentColor'); else svg.removeAttribute('fill') }
          try {
            const res = await fetch('/api/projects/' + id, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned: on }),
            })
            if (!res.ok) throw new Error('pin failed')
            reloadShelf()
          } catch {
            pinBtn.classList.toggle('is-on', !on)
            pinBtn.setAttribute('aria-pressed', on ? 'false' : 'true')
            if (svg) { if (!on) svg.setAttribute('fill', 'currentColor'); else svg.removeAttribute('fill') }
            window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save the idea"), 'err')
          }
        })

        // ---- ⋯ menu injection — client-side only (the renderers are shared server
        // fragments; a server-rendered menu would render dead buttons elsewhere) ----
        // S44: every view's row/card/note gets the same menu. S161: the EDIT dialog is
        // RETIRED (the lean page IS the edit surface — the card click opens it) and the
        // menu learns PROMOTE (spec #17: the stage select as its own dialog; the status
        // behavior stays).
        function sparkMenuHtml(id) {
          return '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + _t('sparks.more', 'More actions') + '">' +
              '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>' +
            '</button>' +
            '<div class="spark-menu-pop" hidden>' +
              // batch (s): file the idea into a folder right from its card.
              '<button type="button" data-spark-move="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/></svg><span>' + _t('sparks.moveToFolder', 'Move to folder') + '</span></button>' +
              // S161 (spec #17): promote — the old edit dialog's stage select, its own dialog.
              '<button type="button" data-spark-promote="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span>' + _t('sparks.promote', 'Promote to project') + '</span></button>' +
              '<button type="button" class="danger" data-spark-delete="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>' + _t('common.delete', 'Delete') + '</span></button>' +
            '</div>'
        }
        const MENU_HOST = '.spark-card, .projects-table tr, .kanban-card, .sticky-note'
        function injectSparksMenus() {
          const root = shelf()
          if (!root) return
          // CARDS — the ⋯ docks the top-inline-end corner beside the pin.
          for (const card of root.querySelectorAll('.spark-card[data-project-id]:not([data-menu-ok])')) {
            const id = card.dataset.projectId
            const menu = document.createElement('div')
            menu.className = 'spark-menu'
            menu.setAttribute('data-nav-local', '')
            menu.innerHTML = sparkMenuHtml(id)
            card.appendChild(menu)
            card.setAttribute('data-menu-ok', '')
          }
          // LIST rows — the ⋯ rides the title cell next to the project link.
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
          // KANBAN + STICKY — the ⋯ docks the top-end corner (quicknotes.css hosts).
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

        // ---- S161 (spec #17): the PROMOTE dialog — pick the stage, the idea becomes
        // a project (the status field's existing behavior; the S120 edit dialog's
        // stage select reborn as its own focused flow).
        let promoteDlg = null
        const PROMOTE_STAGES = ['planning', 'queued', 'developing', 'awaiting_dev', 'operational']
        function openPromote(id) {
          if (promoteDlg) promoteDlg.remove()
          const dlg = document.createElement('dialog')
          dlg.id = 'spark-promote-dialog'
          dlg.className = 'dialog'
          dlg.innerHTML =
            '<form class="modal" id="sp-form" novalidate>' +
              '<h3>' + _t('sparks.promote', 'Promote to project') + '</h3>' +
              '<p class="muted small">' + _t('sparks.promoteHint', 'Choose the stage — the idea becomes a project and leaves the shelf.') + '</p>' +
              '<label>' + _t('calendar.stage', 'Stage') + ' <select id="sp-status">' +
                PROMOTE_STAGES.map(function (s) { return '<option value="' + s + '">' + _t('status.' + s, s) + '</option>' }).join('') +
              '</select></label>' +
              '<p class="error" id="sp-error" role="alert"></p>' +
              '<div class="row">' +
                '<button type="submit" id="sp-save">' + _t('common.save', 'Save') + '</button>' +
                '<button type="button" class="ghost" id="sp-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
              '</div>' +
            '</form>'
          document.body.appendChild(dlg)
          const close = () => { dlg.close(); dlg.remove(); promoteDlg = null }
          dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
          dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
          dlg.querySelector('#sp-cancel').addEventListener('click', close)
          dlg.querySelector('#sp-form').addEventListener('submit', async (e) => {
            e.preventDefault()
            const status = dlg.querySelector('#sp-status').value
            const save = dlg.querySelector('#sp-save')
            const err = dlg.querySelector('#sp-error')
            err.textContent = ''
            save.disabled = true
            try {
              const res = await fetch('/api/projects/' + id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
              })
              if (!res.ok) throw new Error('promote failed')
              window.hibana?.rail?.refresh?.() // the rail follows the promotion — the idea leaves its sparks section
              // S119: a PROMOTED spark records as a PROJECT with its new stage (the
              // resume strip deep-links the project page).
              // the title, not the whole card link: comma querySelectors resolve in
              // DOCUMENT order, so the card's <a> would outrank .spark-card-title and
              // drag the description into the resume record.
              const _row = shelf()?.querySelector('[data-project-id="' + id + '"]')
              const _title = (_row?.querySelector('.spark-card-title') || _row?.querySelector('strong') || _row?.querySelector('a') || {}).textContent
              window.hibanaResume?.record?.('project', id, (_title || '').trim(), status)
              close()
              window.hibana?.toast(_t('sparks.promoted', 'Promoted — it now lives under Projects'), 'ok', 4000)
              reloadShelf()
            } catch {
              err.textContent = _t('sparks.saveFailed', "Couldn't save the idea")
              save.disabled = false
            }
          })
          promoteDlg = dlg
          dlg.showModal()
        }

        // ---- Delete (soft) + Undo toast — mirrors the quick-notebook pattern in app.js ----
        function deleteSpark(id, card) {
          if (!id || !card) return
          fetch('/api/projects/' + id, { method: 'DELETE' })
            .then(async (r) => {
              if (!r.ok) {
                window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err')
                return
              }
              card.remove()
              window.hibana?.rail?.refresh?.() // S148: the rail's sparks section drops the deleted row in the same beat
              // P4.11 (F-L24): use the toast() actions API (canonical pattern) instead of
              // post-hoc appending a button to the toast element.
              window.hibana?.toast(_t('sparks.deleted', 'Idea deleted'), 'ok', 6000, [{
                label: _t('common.undo', 'Undo'),
                onClick: () => {
                  fetch('/api/projects/' + id + '/restore', { method: 'POST' })
                    .then((r2) => { if (r2.ok) { window.hibana?.rail?.refresh?.(); reloadShelf() } }) // S148: the rail restores the spark too
                    .catch(() => {})
                },
              }])
              reloadShelf() // fresh server order (also renders the empty state after the last card)
            })
            .catch(() => window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err'))
        }

        // ---- Folders (batch s) — create / rename / delete / move-to-folder -----------
        // The folder BAR is server-rendered inside the shelf fragment (fresh counts on
        // every swap); these dialogs are lazily-built natives.
        // S41: the create/rename dialog carries the folder's EMOJI icon (the shared
        // picker). S161 (spec #3): it also carries the 16-swatch PASTEL picker — the
        // curated CAT_PAIRS tiles read from the --cat-sw-* CSS tokens (the design-token
        // law's only other home); a toggle-OFF returns the folder to the hash-of-id
        // default (color_fill/color_text NULL).
        const DEFAULT_FOLDER_ICON = '📁'
        let folderDlg = null
        let moveDlg = null

        function swatchData() {
          // the 16 curated pairs, read from the live CSS tokens (variables.css) — the
          // SAME list the categories system + a unit test pin (they can never drift)
          const cs = getComputedStyle(document.documentElement)
          const out = []
          for (let i = 1; i <= 16; i++) {
            const fill = cs.getPropertyValue('--cat-sw-' + i + '-fill').trim()
            const ink = cs.getPropertyValue('--cat-sw-' + i + '-ink').trim()
            if (fill && ink) out.push({ fill, ink })
          }
          return out
        }

        function buildFolderDialog() {
          if (folderDlg) return
          const dlg = document.createElement('dialog')
          dlg.id = 'spark-folder-dialog'
          dlg.className = 'dialog'
          const swatches = swatchData()
          dlg.innerHTML =
            '<form class="modal" id="sf-form" novalidate>' +
              '<h3 id="sf-title"></h3>' +
              '<div class="sf-icon-row">' +
                '<button type="button" id="sf-icon-btn" class="sf-icon-btn" aria-label="' + _t('sparks.folderIcon', 'Folder icon') + '" title="' + _t('sparks.folderIcon', 'Folder icon') + '"><span id="sf-icon-preview" aria-hidden="true">' + DEFAULT_FOLDER_ICON + '</span></button>' +
                '<button type="button" class="ghost small" id="sf-icon-clear" hidden>✕ <span>' + _t('sparks.clearIcon', 'Remove icon') + '</span></button>' +
              '</div>' +
              (swatches.length
                ? '<div class="sf-color-row"><span class="small muted">' + _t('sparks.folderColor', 'Folder color') + '</span>' +
                    '<div class="sf-swatches" role="group" aria-label="' + _t('sparks.folderColor', 'Folder color') + '" id="sf-swatches">' +
                      swatches.map((sw, i) => '<button type="button" class="sf-swatch" data-sw="' + i + '" style="--sw-fill:' + sw.fill + ';--sw-ink:' + sw.ink + '" aria-label="' + _t('sparks.swatchAria', 'Swatch {n}').split('{n}').join(String(i + 1)) + '" aria-pressed="false"></button>').join('') +
                    '</div>' +
                    '<button type="button" class="ghost small" id="sf-swatch-default" hidden>' + _t('sparks.defaultColor', 'Default color') + '</button>' +
                  '</div>'
                : '') +
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
          // the swatch state: '' = the hash-of-id DEFAULT (color_fill NULL), else 'fill|ink'
          const paintSwatches = () => {
            const active = dlg.dataset.pair || ''
            for (const b of dlg.querySelectorAll('.sf-swatch')) {
              const pair = b.style.getPropertyValue('--sw-fill') + '|' + b.style.getPropertyValue('--sw-ink')
              const on = active === pair
              b.classList.toggle('is-on', on)
              b.setAttribute('aria-pressed', on ? 'true' : 'false')
            }
            const defBtn = dlg.querySelector('#sf-swatch-default')
            if (defBtn) defBtn.hidden = !active
          }
          dlg.querySelector('#sf-swatches')?.addEventListener('click', (e) => {
            const b = e.target.closest('.sf-swatch')
            if (!b) return
            const pair = b.style.getPropertyValue('--sw-fill') + '|' + b.style.getPropertyValue('--sw-ink')
            // toggle-off: clicking the active swatch returns the folder to the default
            dlg.dataset.pair = (dlg.dataset.pair === pair) ? '' : pair
            dlg.dataset.pairDirty = '1'
            paintSwatches()
          })
          dlg.querySelector('#sf-swatch-default')?.addEventListener('click', () => {
            dlg.dataset.pair = ''
            dlg.dataset.pairDirty = '1'
            paintSwatches()
          })
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
              // icon + pair ride along ONLY when the user touched them (rename without
              // touching the pickers never clears the stored values; null = explicit
              // clear / back to the hash-of-id default).
              const iconDirty = dlg.dataset.iconDirty === '1'
              const pairDirty = dlg.dataset.pairDirty === '1'
              const pair = dlg.dataset.pair || ''
              const payload = { name }
              if (iconDirty) payload.icon = dlg.dataset.icon || null
              if (pairDirty) {
                if (pair) { const [fill, ink] = pair.split('|'); payload.color_fill = fill; payload.color_text = ink }
                else { payload.color_fill = null; payload.color_text = null }
              }
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

        function openFolderDialog(id, name, icon, pair) {
          buildFolderDialog()
          const dlg = folderDlg
          dlg.dataset.folderId = id || ''
          dlg.querySelector('#sf-title').textContent = _t(id ? 'sparks.renameFolder' : 'sparks.newFolder', id ? 'Rename folder' : 'New folder')
          dlg.querySelector('#sf-error').textContent = ''
          dlg.querySelector('#sf-name').value = name || ''
          dlg.dataset.icon = icon || ''
          dlg.dataset.iconDirty = ''
          dlg.dataset.pair = pair || ''
          dlg.dataset.pairDirty = ''
          dlg.querySelector('#sf-icon-preview').textContent = icon || DEFAULT_FOLDER_ICON
          dlg.querySelector('#sf-icon-clear').hidden = !icon
          // paint the swatch state (the active tile, or none = the default)
          const swatches = dlg.querySelectorAll('.sf-swatch')
          swatches.forEach((b) => {
            const p = b.style.getPropertyValue('--sw-fill') + '|' + b.style.getPropertyValue('--sw-ink')
            const on = !!pair && p === pair
            b.classList.toggle('is-on', on)
            b.setAttribute('aria-pressed', on ? 'true' : 'false')
          })
          const defBtn = dlg.querySelector('#sf-swatch-default')
          if (defBtn) defBtn.hidden = !pair
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
            // the folder's current emoji from it. S161: data-sf-pair prefills the swatch.
            const folderIcon = item.getAttribute('data-sf-icon') || ''
            const folderPair = item.getAttribute('data-sf-pair') || ''
            menu.innerHTML =
              '<button type="button" data-sf-rename="' + id + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>' +
                '<span>' + _t('sparks.renameFolder', 'Rename folder') + '</span></button>' +
              '<button type="button" class="danger" data-sf-delete="' + id + '">' +
                '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>' +
                '<span>' + _t('sparks.deleteFolder', 'Delete folder') + '</span></button>'
            menu.dataset.folderName = name
            menu.dataset.folderIcon = folderIcon
            menu.dataset.folderPair = folderPair
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

        // ---- S161 (spec #1): the folder BANNER flow — the prompt/Change buttons open
        // the picker, the pick runs the fixed 2.5:1 CROP (image-crop.js), Apply PUTs
        // the WebP bytes through the shared object-store chain, the shelf reloads.
        const bannerInput = document.createElement('input')
        bannerInput.type = 'file'
        bannerInput.accept = 'image/png,image/jpeg,image/webp'
        bannerInput.hidden = true
        document.body.appendChild(bannerInput)
        bannerInput.addEventListener('change', async () => {
          const file = bannerInput.files && bannerInput.files[0]
          bannerInput.value = ''
          const folderId = bannerInput.dataset.folderId
          if (!file || !folderId) return
          if (!window.hibanaImageCrop?.openCrop) {
            window.hibana?.toast(_t('sparks.bannerFailed', "Couldn't update the banner — try again"), 'err')
            return
          }
          try {
            const cropped = await window.hibanaImageCrop.openCrop(file, { aspect: 2.5 })
            if (!cropped) return // cancelled — the placeholder stays
            const res = await fetch('/api/projects/sparks/folders/' + folderId + '/banner', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dataBase64: cropped.dataBase64, mimeType: cropped.mimeType }),
            })
            if (!res.ok) throw new Error('banner failed')
            reloadShelf()
          } catch {
            window.hibana?.toast(_t('sparks.bannerFailed', "Couldn't update the banner — try again"), 'err')
          }
        })
        const pickBanner = (folderId) => {
          bannerInput.dataset.folderId = folderId
          bannerInput.click()
        }

        // ---- Delegated clicks: banner / menus / pin / expand / folders ----------------
        ctx.on('click', (e) => {
          // ---- the BANNER first (it lives inside the shelf fragment) ----
          const sfhUpload = e.target.closest('[data-sfh-upload], [data-sfh-change], [data-sfh-img]')
          if (sfhUpload) {
            const host = sfhUpload.closest('.sfh')
            if (host) { e.preventDefault(); pickBanner(host.getAttribute('data-sfh-folder') || ''); return }
          }
          const sfhRemove = e.target.closest('[data-sfh-remove]')
          if (sfhRemove) {
            const host = sfhRemove.closest('.sfh')
            e.preventDefault()
            if (!host) return
            fetch('/api/projects/sparks/folders/' + host.getAttribute('data-sfh-folder') + '/banner', { method: 'DELETE' })
              .then((r) => { if (!r.ok) throw new Error('banner remove failed'); reloadShelf() })
              .catch(() => window.hibana?.toast(_t('sparks.bannerFailed', "Couldn't update the banner — try again"), 'err'))
            return
          }

          // ---- Folder bar / folder GRID first (they live inside the shelf but must not
          // fall through to the card-menu branch). S40 ORDER FIX: [data-sf-new] and
          // [data-sf-menu] are checked BEFORE [data-sf] — in the folder GRID the ⋯ menu
          // button sits INSIDE the [data-sf] card, so the old order turned every menu
          // click into a folder entry (rename/delete were unreachable there).
          const sfNew = e.target.closest('[data-sf-new]')
          if (sfNew) { e.preventDefault(); openFolderDialog('', '', '', ''); return }
          const sfMenuBtn = e.target.closest('[data-sf-menu]')
          if (sfMenuBtn) { e.preventDefault(); toggleSfMenu(sfMenuBtn); return }
          const sfRename = e.target.closest('[data-sf-rename]')
          if (sfRename) {
            const host = sfRename.closest('.sf-menu')
            openFolderDialog(sfRename.getAttribute('data-sf-rename'), host?.dataset.folderName || '', host?.dataset.folderIcon || '', host?.dataset.folderPair || '')
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
            // S162 (folded): a chip click during an active search CLEARS the query —
            // the folder the user asked for must actually open (the server's search
            // overrides the folder scope; without this the click did nothing).
            if (searchInput && searchInput.value) {
              searchInput.value = ''
              paintSearchChrome()
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
          const promoteBtn = e.target.closest('[data-spark-promote]')
          if (promoteBtn) { closeMenus(); openPromote(promoteBtn.getAttribute('data-spark-promote')); return }
          const delBtn = e.target.closest('[data-spark-delete]')
          if (delBtn) { closeMenus(); deleteSpark(delBtn.getAttribute('data-spark-delete'), delBtn.closest(MENU_HOST)); return }
          if (!e.target.closest('#spark-shelf .spark-menu')) closeMenus()

          // ---- S161 (spec #14): MOBILE tap-to-expand. At ≤640px cards render condensed
          // (title + thumb); the FIRST tap expands (desc/meta/links revealed), later
          // taps navigate to the lean page (the anchor's plain default — a full load,
          // honest on a rare open). The RACE with nav.js's capture-phase interceptor
          // is won by the data-nav-local paint below (nav stands down for it; the
          // attribute exists ONLY at ≤640px so desktop soft-nav stays untouched).
          const expandLink = e.target.closest('[data-spark-expand]')
          if (expandLink && window.matchMedia('(max-width: 640px)').matches) {
            const card = expandLink.closest('.spark-card')
            if (card && !card.classList.contains('is-expanded')) {
              e.preventDefault()
              card.classList.add('is-expanded')
            }
          }
        })
        ctx.on('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); closeSfMenus() } })

        // Re-inject menus + repaint the count on every shelf render (initial load, 30s
        // refresh, manual reload). htmx 2.x dispatches both the legacy `htmx:`-prefixed
        // and the new unprefixed event names — register both so the injection never
        // misses a swap.
        // S44: open menus used to DIE with the 30s poll's innerHTML swap — beforeSwap
        // captures what was open; afterSwap re-opens it on the fresh DOM.
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
          updateMatchCount()
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

        // spec #14's paint: data-nav-local rides the card links ONLY at ≤640px —
        // nav.js's CAPTURE-phase anchor interceptor stands down for it, so the first
        // tap's expand (preventDefault) wins the race. Above 640px the attribute is
        // gone and the desktop soft-nav flow is untouched.
        const paintExpandability = () => {
          const mobile = window.matchMedia('(max-width: 640px)').matches
          document.querySelectorAll('#spark-shelf [data-spark-expand]').forEach((a) => {
            if (mobile) a.setAttribute('data-nav-local', '')
            else a.removeAttribute('data-nav-local')
          })
        }
        const expandMq = window.matchMedia('(max-width: 640px)')
        expandMq.addEventListener?.('change', paintExpandability)
        const reinjectWithPaint = () => { reinject(); paintExpandability() }
        for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
          ctx.on(name, reinjectWithPaint)
        }
        paintExpandability()

        // S166 (the baked-EN race): a FA hard-load where htmx beats the dict leaves the
        // injected menus' aria-labels EN forever — the menus rebuild in place on every
        // hibana:i18n (the labels re-read the live dict).
        ctx.on('hibana:i18n', () => {
          const root = shelf()
          if (!root) return
          root.querySelectorAll('[data-menu-ok]').forEach((el) => el.removeAttribute('data-menu-ok'))
          root.querySelectorAll('.spark-menu').forEach((m) => m.remove())
          injectSparksMenus()
          updateMatchCount()
        })

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
          if (folderDlg) folderDlg.remove()
          folderDlg = null
          if (moveDlg) moveDlg.remove()
          moveDlg = null
          if (promoteDlg) promoteDlg.remove()
          promoteDlg = null
          if (bannerInput) bannerInput.remove()
          delete window.__hibanaShelfReload
        }
      },
    })
