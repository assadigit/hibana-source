    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'board',
      mount(ctx) {
        const B = () => window.HibanaBoard
        const qs = new URLSearchParams(location.search)
        const projectId = qs.get('project')
        const openTask = qs.get('task')
        const addStatus = qs.get('add')
        const root = document.getElementById('db-board')
        const loading = document.getElementById('db-loading')
        // Translate through hibanaI18n when it's up (FA users must see the FA strings even
        // while HibanaBoard is still missing — the raw English fallback leaked for weeks).
        const _t = (k, f) => {
          const s = window.hibanaI18n ? window.hibanaI18n.t(k) : null
          return s && s !== k ? s : (window.HibanaBoard ? B().t(k, f) : f)
        }

        if (!projectId) { location.replace('/projects.html'); return }

        // S30 batch 2: the filter state (module-scope — render() reads it; the toggles
        // mutate + re-render). Names are stored LOWERCASE for case-insensitive matching.
        const filterPrios = new Set()
        const filterTags = new Set()

        const render = () => {
          const S = B().state
          document.getElementById('db-title').textContent = S.project ? S.project.title : ''
          document.getElementById('db-sprint-link').href = '/sprint.html?project=' + projectId
          const done = S.tasks.filter((x) => x.status === 'done').length
          document.getElementById('db-counts').textContent = _t('db.counts', '{n} of {m} done')
            .replace('{n}', B().faDig(done)).replace('{m}', B().faDig(S.tasks.length))

          const lang = window.hibanaI18n && window.hibanaI18n.lang ? window.hibanaI18n.lang() : 'en'
          // S30 batch 2 (user request): the FILTER BAR — priority toggles + label
          // toggles above the columns. Empty selection = show everything (the default);
          // each group is an OR within itself, the two groups AND together ("only 🔴
          // urgent × #Security"). A task's label names resolve through tagById (the
          // API carries tag ids on the task rows + the tag table in state).
          const usedTags = []
          const seenTag = new Set()
          for (const task of S.tasks) {
            for (const id of (task.tags || [])) {
              const tg = B().tagById(id)
              if (tg && !seenTag.has(tg.name.toLowerCase())) { seenTag.add(tg.name.toLowerCase()); usedTags.push(tg) }
            }
          }
          usedTags.sort((a, b) => a.name.localeCompare(b.name))
          const taskMatches = (task) => {
            if (filterPrios.size && !filterPrios.has(task.priority || 'medium')) return false
            if (filterTags.size) {
              const names = (task.tags || []).map((id) => { const tg = B().tagById(id); return tg ? tg.name.toLowerCase() : '' }).filter(Boolean)
              if (!names.some((n) => filterTags.has(n))) return false
            }
            return true
          }
          const shownCount = S.tasks.filter(taskMatches).length
          const anyFilter = filterPrios.size > 0 || filterTags.size > 0
          const filterBarHtml = S.tasks.length ? '<div class="db-filter" data-db-filter role="toolbar" aria-label="' + B().esc(_t('db.filterAria', 'Filter tasks')) + '">' +
            '<span class="db-filter-label muted small">' + B().esc(_t('db.filterPrio', 'Priority')) + '</span>' +
            B().PRIORITIES.slice().reverse().map((p) =>
              '<button type="button" class="chip db-filter-prio prio-' + p + '" data-fp="' + p + '" aria-pressed="' + (filterPrios.has(p) ? 'true' : 'false') + '" title="' + B().esc(_t('db.filterPrioHint', 'Show only {p} tasks').replace('{p}', B().prioLabel(p))) + '"><span class="prio-dot prio-' + p + '"></span>' + B().esc(B().prioLabel(p)) + '</button>'
            ).join('') +
            (usedTags.length ? '<span class="db-filter-label muted small">' + B().esc(_t('db.filterLabels', 'Labels')) + '</span>' +
              usedTags.map((tg) =>
                '<button type="button" dir="auto" class="chip db-filter-tag" data-ft="' + B().esc(tg.name.toLowerCase()) + '" style="color:' + B().esc(tg.color) + '" aria-pressed="' + (filterTags.has(tg.name.toLowerCase()) ? 'true' : 'false') + '" title="' + B().esc(_t('db.filterTagHint', 'Click to filter by this label')) + '"><span style="color:' + B().esc(tg.color) + '">●</span> ' + B().esc(tg.name) + '</button>'
              ).join('') : '') +
            (anyFilter ? '<button type="button" class="chip db-filter-clear" data-db-filter-clear>✕ ' + B().esc(_t('db.filterClear', 'Clear filter')) + '</button><span class="muted small db-filter-shown">' + _t('db.filterShown', '{n} of {m} shown').replace('{n}', B().faDig(shownCount)).replace('{m}', B().faDig(S.tasks.length)) + '</span>' : '') +
            '</div>' : ''
          // Session 22 (user request): unlimited task titles clamp at 150 CHARS — same
          // recipe as the project page's progress boxes: first 150 chars visible, the
          // rest in a hidden .pd-title-rest span INSIDE the title element (so
          // textContent keeps reading the FULL title — copy/export, delete-confirm,
          // the wand all consume it), + a read-more button. The two boards read as ONE
          // system now.
          const TITLE_CLAMP = 150
          // Session 23 (user request): titles may carry fenced ``` CODE blocks, **bold**
          // and manual line breaks — SAME renderer as project.html / routes/projects.ts:
          // fence lines open/close a <code class="t-code" dir="ltr"> mono container with
          // the fence LINES kept in <span hidden class="t-fence"> markers INSIDE it, so
          // textContent round-trips the RAW title exactly (copy/export/delete/wand all
          // consume textContent). Prose lines get **pair** → <strong>. Unclosed fences
          // render as code till end (self-healing).
          const renderTitle = (raw) => {
            const escd = B().esc(raw)
            const hasFence = /(^|\n)\s*```/.test(escd)
            const hasBold = /\*\*[^*\n]+\*\*/.test(escd)
            if (!hasFence && !hasBold) return escd
            const lines = escd.split('\n')
            let out = ''
            let inCode = false
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              const nl = i < lines.length - 1 ? '\n' : ''
              if (!inCode && /^\s*```/.test(line)) {
                inCode = true
                const codeLang = line.trim().slice(3).trim()
                out += '<code class="t-code"' + (codeLang ? ' data-lang="' + codeLang + '"' : '') + ' dir="ltr"><span hidden class="t-fence">' + line + '</span>'
              } else if (inCode && line.trim() === '```') {
                inCode = false
                out += '<span hidden class="t-fence">' + line + '</span></code>'
              } else if (inCode) {
                out += line
              } else {
                out += line.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
              }
              out += nl
            }
            if (inCode) out += '</code>'
            return out
          }
          const titleHtml = (title) => {
            const s = String(title == null ? '' : title)
            if (s.length <= TITLE_CLAMP) return renderTitle(s)
            return renderTitle(s.slice(0, TITLE_CLAMP)) + '<span class="pd-title-rest" hidden>' + renderTitle(s.slice(TITLE_CLAMP)) + '</span>'
          }
          const titleAttrs = (title) => (String(title || '').length > TITLE_CLAMP ? ' data-clamped=""' : '')
          const readMoreBtn = (title) => (String(title || '').length > TITLE_CLAMP
            ? '<button type="button" class="pd-read-more" data-task-read-more aria-expanded="false">' + B().esc(_t('pd.readMore', 'read more')) + '</button>'
            : '')
          // Item 8: inline SVG icons for the export/copy buttons (board.html has no P_ICON)
          const I_CLIPBOARD = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.5A.5.5 0 0 1 9.5 3h5a.5.5 0 0 1 .5.5V4M9 9.5h6M9 13.5h6M9 17.5h4"/></svg>'
          const I_DOWNLOAD = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>'
          const I_ARCHIVE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>'
          const I_TRASH = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
          root.innerHTML = filterBarHtml + '<div class="db-cols">' + B().STATUSES.map((st) => {
            const items = S.tasks.filter((x) => x.status === st && taskMatches(x))
            const isDone = st === 'done'
            // Done column gets TWO extra buttons: Archive (moves done → project_archives,
            // viewable + restorable) + Clear (hard-deletes, no archive). Only shown when
            // there are done tasks. The Done column is also visually marked (CSS .db-col-done).
            const doneActions = isDone && items.length > 0
              ? '<button type="button" class="ghost small" data-db-archive-done title="' + B().esc(_t('pd.archiveDone', 'Archive done tasks')) + '">' + I_ARCHIVE + '</button>' +
                '<button type="button" class="ghost small danger" data-db-clear-done title="' + B().esc(_t('pd.clearDone', 'Clear done (delete)')) + '">' + I_TRASH + '</button>'
              : ''
            return '<section class="db-col' + (isDone ? ' db-col-done' : '') + '" data-col="' + st + '">' +
              '<header class="db-col-head"><span class="db-col-name">' + B().esc(B().statusLabel(st)) + '</span>' +
              '<span class="detail-tab-count">' + B().faDig(items.length) + '</span>' +
              '<span class="pd-col-actions">' +
                doneActions +
                '<button type="button" class="ghost small" data-db-copy="' + st + '" title="' + B().esc(_t('pd.quickCopy', 'Quick copy')) + '">' + I_CLIPBOARD + '</button>' +
                '<button type="button" class="ghost small" data-db-export="' + st + '" title="' + B().esc(_t('pd.exportMd', 'Export Markdown')) + '">' + I_DOWNLOAD + '</button>' +
              '</span></header>' +
              '<div class="db-col-body" data-colbody="' + st + '">' +
                items.map((task) => {
                  const cat = task.category_id ? B().findCategory(task.category_id) : null
                  const sprint = task.sprint_id ? B().findSprint(task.sprint_id) : null
                  const tags = (task.tags || []).map((id) => B().tagById(id)).filter(Boolean)
                  return '<article class="db-card st-' + task.status + '" draggable="true" data-task-card="' + task.id + '" data-status="' + task.status + '" data-priority="' + (task.priority || 'medium') + '">' +
                    '<div class="db-card-main" dir="auto">' +
                      // S30 batch 2: the dot's tooltip is the TRANSLATED label (was the raw
                      // 'urgent' string) + the cycle hint; clicking it cycles the priority.
                      '<button type="button" class="prio-dot-btn" data-db-cycle-prio="' + task.id + '" title="' + B().esc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', B().prioLabel(task.priority))) + '" aria-label="' + B().esc(_t('db.cyclePrio', 'Priority: {p} — click to change').replace('{p}', B().prioLabel(task.priority))) + '"><span class="prio-dot prio-' + task.priority + '"></span></button>' +
                      '<span class="db-card-title"' + titleAttrs(task.title) + '>' + titleHtml(task.title) + '</span>' +
                    '</div>' +
                    readMoreBtn(task.title) +
                    // ⋯ hover menu (Edit + Delete) — injected client-side after render so
                    // it survives every reload(). Edit opens the existing modal (no refresh);
                    // Delete shows a confirm modal (no refresh).
                    '<div class="spark-menu db-card-menu" hidden></div>' +
                    (cat || tags.length || sprint
                      ? '<div class="db-card-meta">' +
                        (cat ? '<span class="db-cat-chip" style="background:' + cat.color + '2E;color:' + cat.color + '">' + B().esc(cat.name) + '</span>' : '') +
                        // S30 batch 2: label chips are FILTER toggles (GitHub behavior) —
                        // data-tag-name carries the match key.
                        tags.map((tg) => '<button type="button" dir="auto" class="db-mini-chip" data-tag-name="' + B().esc(tg.name.toLowerCase()) + '" style="background:' + tg.color + '26" title="' + B().esc(_t('db.filterTagHint', 'Click to filter by this label')) + '"><span style="color:' + tg.color + '">●</span>' + B().esc(tg.name) + '</button>').join('') +
                        (sprint ? '<span class="db-sprint-badge">◆ ' + B().esc(sprint.name) + '</span>' : '') +
                      '</div>'
                      : '') +
                    '<span class="db-card-date muted small">' + (task.status === 'done' && task.done_at
                      ? '✓ ' + B().fullLabel(B().dayIdx(task.done_at), lang)
                      : B().fullLabel(B().dayIdx(task.created_at), lang)) + '</span>' +
                  '</article>'
                }).join('') +
                '<button type="button" class="db-add" data-add="' + st + '">＋ <span>' + B().esc(_t('db.addTask', 'Add task')) + '</span></button>' +
              '</div>' +
            '</section>'
          }).join('') + '</div>'
          root.hidden = false
          if (loading) loading.hidden = true
          // Inject the ⋯ menu content into each .db-card-menu (the cards re-render on
          // every load(), so we fill the menu placeholders + attach handlers here).
          injectDbCardMenus()
        }

        const reload = async () => { await B().load(projectId); render() }

        // S30 batch 4: the LABEL MANAGER — rename/merge/recolor/delete-unused, opened
        // from the toolbar. Every change reloads the board (labels ride the cards).
        ctx.on('click', (e) => {
          if (!e.target.closest('#db-labels-btn')) return
          e.preventDefault()
          B().openLabels({ onChanged: reload })
        })

        // ⋯ hover menu on each .db-card — Edit opens the existing modal (no refresh),
        // Delete shows a confirm modal (no refresh). Re-injected after every render().
        const I_MENU_DOTS = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>'
        const I_EDIT = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
        const I_TRASH = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
        function injectDbCardMenus() {
          document.querySelectorAll('.db-card-menu:not([data-ok])').forEach((menu) => {
            const card = menu.closest('.db-card')
            if (!card) return
            const tid = card.dataset.taskCard
            if (!tid) return
            menu.innerHTML =
              '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + B().esc(_t('sparks.more', 'More actions')) + '">' + I_MENU_DOTS + '</button>' +
              '<div class="spark-menu-pop" hidden>' +
                '<button type="button" data-db-edit-card="' + tid + '">' + I_EDIT + '<span>' + B().esc(_t('common.edit', 'Edit')) + '</span></button>' +
                '<button type="button" class="danger" data-db-del-card="' + tid + '">' + I_TRASH + '<span>' + B().esc(_t('common.delete', 'Delete')) + '</span></button>' +
              '</div>'
            menu.hidden = false
            menu.setAttribute('data-ok', '')
            // Direct handlers (the card is draggable + the menu is inside it — preventDefault
            // stops drag + any parent navigation)
            const openBtn = menu.querySelector('[data-menu-open]')
            openBtn.addEventListener('click', (ev) => {
              ev.preventDefault(); ev.stopPropagation()
              const pop = menu.querySelector('.spark-menu-pop')
              if (!pop) return
              const willOpen = pop.hidden
              closeAllDbMenus()
              pop.hidden = !willOpen
              if (willOpen) openBtn.setAttribute('data-open', '')
              else openBtn.removeAttribute('data-open')
            })
            menu.querySelector('[data-db-edit-card]').addEventListener('click', (ev) => {
              ev.preventDefault(); ev.stopPropagation()
              closeAllDbMenus()
              B().openEditor(tid, { onSaved: reload })
            })
            menu.querySelector('[data-db-del-card]').addEventListener('click', (ev) => {
              ev.preventDefault(); ev.stopPropagation()
              closeAllDbMenus()
              showDeleteConfirm(tid, card.querySelector('.db-card-title')?.textContent || '')
            })
          })
        }
        function closeAllDbMenus() {
          document.querySelectorAll('.db-card-menu .spark-menu-pop:not([hidden])').forEach((pop) => {
            pop.hidden = true
            const btn = pop.parentElement.querySelector('[data-menu-open]')
            if (btn) btn.removeAttribute('data-open')
          })
        }
        document.addEventListener('click', (e) => {
          if (!e.target.closest('.db-card-menu')) closeAllDbMenus()
        })
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDbMenus() })

        // Delete confirm modal — a native <dialog> (no page refresh). "Are you sure?" +
        // Confirm/Cancel. On confirm → DELETE /api/devtasks/:id → reload().
        let delConfirmDlg = null
        function showDeleteConfirm(tid, title) {
          if (!delConfirmDlg) {
            delConfirmDlg = document.createElement('dialog')
            delConfirmDlg.id = 'db-del-confirm'
            delConfirmDlg.className = 'dialog'
            delConfirmDlg.innerHTML =
              '<form class="modal" method="dialog">' +
                '<h3>' + B().esc(_t('db.delConfirm', 'Delete this task?')) + '</h3>' +
                '<p class="muted small" id="db-del-title"></p>' +
                '<p class="muted small">' + B().esc(_t('db.delConfirmHint', 'This cannot be undone.')) + '</p>' +
                '<div class="row" style="justify-content:flex-end;gap:.5rem;margin-top:1rem">' +
                  '<button type="button" class="ghost" id="db-del-cancel">' + B().esc(_t('common.cancel', 'Cancel')) + '</button>' +
                  '<button type="button" class="btn danger" id="db-del-ok">' + B().esc(_t('common.delete', 'Delete')) + '</button>' +
                '</div>' +
              '</form>'
            document.body.appendChild(delConfirmDlg)
            delConfirmDlg.addEventListener('click', (e) => { if (e.target === delConfirmDlg) delConfirmDlg.close() })
            delConfirmDlg.querySelector('#db-del-cancel').onclick = () => delConfirmDlg.close()
            delConfirmDlg.querySelector('#db-del-ok').onclick = async () => {
              const id = delConfirmDlg.dataset.tid
              if (!id) return
              delConfirmDlg.querySelector('#db-del-ok').disabled = true
              try {
                const r = await fetch('/api/devtasks/' + id, { method: 'DELETE' })
                if (!r.ok) throw new Error('delete failed')
                window.hibana?.toast(B().esc(_t('db.taskDeleted', 'Task deleted')), 'info')
                delConfirmDlg.close()
                reload()
              } catch {
                window.hibana?.toast(B().esc(_t('notes.deleteFailed', "Couldn't delete")), 'err')
                delConfirmDlg.querySelector('#db-del-ok').disabled = false
              }
            }
          }
          delConfirmDlg.dataset.tid = tid
          delConfirmDlg.querySelector('#db-del-title').textContent = title
          delConfirmDlg.querySelector('#db-del-ok').disabled = false
          delConfirmDlg.showModal()
        }

        // ---- interactions (delegated once — render() only rebuilds innerHTML) ----
        ctx.on('click', (e) => {
          if (e.target.closest('#db-retry')) {
            loading.innerHTML = '<span>' + String(_t('db.loading', 'Loading board…')).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]) + '</span>'
            boot()
            return
          }
          // S30 batch 2 — the FILTER BAR toggles (priority × label, clear).
          const fp = e.target.closest('[data-fp]')
          if (fp) {
            const p = fp.dataset.fp
            if (filterPrios.has(p)) filterPrios.delete(p); else filterPrios.add(p)
            render()
            return
          }
          const ft = e.target.closest('[data-ft]')
          if (ft) {
            const n = ft.dataset.ft
            if (filterTags.has(n)) filterTags.delete(n); else filterTags.add(n)
            render()
            return
          }
          if (e.target.closest('[data-db-filter-clear]')) {
            filterPrios.clear(); filterTags.clear()
            render()
            return
          }
          // S30 batch 2 — clicking a card's LABEL chip toggles that label's filter
          // (GitHub behavior). Runs before the card-open branch below; the card-open
          // branch also guards on .db-mini-chip (ctx.on handlers are independent
          // document listeners — stopPropagation can't cross them).
          const chip = e.target.closest('.db-mini-chip[data-tag-name]')
          if (chip) {
            e.preventDefault()
            const n = chip.dataset.tagName
            if (filterTags.has(n)) filterTags.delete(n); else filterTags.add(n)
            render()
            return
          }
          // S30 batch 2 — click the priority dot: cycle low → medium → high → urgent
          // without opening the editor. PATCH + optimistic state mutation + re-render
          // (the re-render re-sorts the column for free).
          const cycleDot = e.target.closest('[data-db-cycle-prio]')
          if (cycleDot) {
            e.preventDefault()
            const tid = cycleDot.dataset.dbCyclePrio
            const task = B().findTask(tid)
            if (!task) return
            const next = B().cyclePriority(task.priority)
            task.priority = next
            render()
            B().patchTask(tid, { priority: next }).catch(() => {
              window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
              reload()
            })
            return
          }
          const add = e.target.closest('[data-add]')
          if (add) {
            B().openEditor(null, { defaults: { status: add.dataset.add }, onSaved: reload })
            return
          }
          // Session 22: read-more / read-less toggle — must run BEFORE the card branch
          // (the button lives INSIDE [data-task-card], and ctx.on handlers are separate
          // document-level listeners — stopPropagation can't stop the card branch).
          const moreBtn = e.target.closest('[data-task-read-more]')
          if (moreBtn) {
            e.preventDefault()
            const card = moreBtn.closest('.db-card')
            const title = card ? card.querySelector('.db-card-title') : null
            const rest = title ? title.querySelector('.pd-title-rest') : null
            if (title && rest) {
              if (rest.hidden) {
                rest.hidden = false
                title.removeAttribute('data-clamped')
                moreBtn.textContent = _t('pd.readLess', 'read less')
                moreBtn.setAttribute('aria-expanded', 'true')
              } else {
                rest.hidden = true
                title.setAttribute('data-clamped', '')
                moreBtn.textContent = _t('pd.readMore', 'read more')
                moreBtn.setAttribute('aria-expanded', 'false')
              }
            }
            return
          }
          const card = e.target.closest('[data-task-card]')
          // S30 batch 2: never open the editor from the prio dot / label chips (they
          // are actions of their own — cycling and filtering).
          if (card && !e.target.closest('[data-task-read-more]') && !e.target.closest('[data-db-cycle-prio]') && !e.target.closest('.db-mini-chip')) B().openEditor(card.dataset.taskCard, { onSaved: reload })

          // Item 8 + S30 batch 2: per-column Quick Copy + Export Markdown — the bullets
          // now carry priority + labels ("- [URGENT] Fix auth leak #UI/UX #Security") and
          // read from the LOADED STATE, not the DOM (the DOM only shows what the filter
          // lets through; the export stays truthful to the whole column).
          const colLines = (st) => B().state.tasks
            .filter((x) => x.status === st)
            .map((x) => B().mdTaskLine(x, (x.tags || []).map((id) => { const tg = B().tagById(id); return tg ? tg.name : '' }).filter(Boolean)))
            .filter(Boolean)
          const copy = e.target.closest('[data-db-copy]')
          if (copy) {
            const st = copy.dataset.dbCopy
            const text = colLines(st).join('\n')
            navigator.clipboard?.writeText(text).then(
              () => window.hibana?.toast(_t('pd.copied', 'Copied to clipboard')),
              () => { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch {}; ta.remove() }
            )
            return
          }
          const exp = e.target.closest('[data-db-export]')
          if (exp) {
            const st = exp.dataset.dbExport
            const col = document.querySelector(`.db-col[data-col="${st}"]`)
            const label = col ? (col.querySelector('.db-col-name')?.textContent.trim() || st) : st
            const lines = colLines(st)
            const md = '# ' + label + '\n\n' + (lines.length ? lines.join('\n') : '_(No items)_') + '\n'
            const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = label.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]+/g, '_') + '.md'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
            window.hibana?.toast(_t('pd.exported', 'Exported as Markdown'))
            return
          }
          // "Archive Done" button — moves done tasks to project_archives (permanent,
          // viewable + restorable). The safe "clear" — nothing is lost.
          const archiveBtn = e.target.closest('[data-db-archive-done]')
          if (archiveBtn) {
            const col = document.querySelector('.db-col[data-col="done"]')
            const count = col ? col.querySelectorAll('.db-card').length : 0
            if (count === 0) return
            const msg = _t('pd.archiveDoneConfirm', 'Archive all {n} done tasks? They move to the project archives (restorable).').replace('{n}', B().faDig(count))
            if (!confirm(msg)) return
            fetch('/api/projects/' + projectId + '/devtasks/archive-done', { method: 'POST' })
              .then((r) => r.ok ? r.json() : null)
              .then((body) => {
                const n = body && typeof body.archived === 'number' ? body.archived : count
                window.hibana?.toast(_t('pd.archivedDone', '{n} tasks archived').replace('{n}', B().faDig(n)), 'info')
                reload()
              })
              .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't archive"), 'err'))
            return
          }
          // "Clear Done" button — HARD-DELETES done tasks (no archive). Destructive.
          const clearBtn = e.target.closest('[data-db-clear-done]')
          if (clearBtn) {
            const col = document.querySelector('.db-col[data-col="done"]')
            const count = col ? col.querySelectorAll('.db-card').length : 0
            if (count === 0) return
            const msg = _t('pd.clearDoneConfirm', 'PERMANENTLY delete all {n} done tasks? This cannot be undone. Use "Archive" to keep them.').replace('{n}', B().faDig(count))
            if (!confirm(msg)) return
            // Delete each task individually (no bulk-delete endpoint — keeps it simple)
            const ids = Array.from(col.querySelectorAll('.db-card')).map((c) => c.dataset.taskCard)
            Promise.all(ids.map((id) => fetch('/api/devtasks/' + id, { method: 'DELETE' })))
              .then(() => {
                window.hibana?.toast(_t('pd.clearedDone', '{n} tasks deleted').replace('{n}', B().faDig(count)), 'info')
                reload()
              })
              .catch(() => window.hibana?.toast(_t('notes.deleteFailed', "Couldn't clear"), 'err'))
            return
          }
        })

        // ---- drag & drop: within a column reorders, across columns changes status ----
        let drag = null
        let over = null
        const clearOver = () => { if (over) { over.classList.remove('drag-over'); over = null } }
        ctx.on('dragstart', (e) => {
          const card = e.target.closest('[data-task-card]')
          if (!card) return
          drag = card
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', card.dataset.taskCard)
          card.classList.add('dragging')
        })
        ctx.on('dragover', (e) => {
          if (!drag) return
          e.preventDefault()
          const colBody = e.target.closest('[data-colbody]')
          if (!colBody) return
          clearOver()
          over = colBody
          colBody.classList.add('drag-over')
          // live-reorder inside the column for visual feedback
          const target = e.target.closest('[data-task-card]')
          const addBtn = colBody.querySelector('.db-add')
          if (target && target !== drag) {
            const r = target.getBoundingClientRect()
            const after = e.clientY > r.top + r.height / 2
            colBody.insertBefore(drag, after ? target.nextSibling : target)
          } else if (!target && addBtn) {
            colBody.insertBefore(drag, addBtn)
          }
        })
        ctx.on('drop', async (e) => {
          if (!drag) return
          e.preventDefault()
          const id = drag.dataset.taskCard
          const colBody = drag.closest('[data-colbody]')
          const newStatus = colBody ? colBody.dataset.colbody : null
          const task = B().findTask(id)
          // S30 batch 4 (user request: "drop into the urgent zone of the column"):
          // a SAME-COLUMN drop ADOPTS the priority of the card it landed next to —
          // the columns are priority-sorted, so the neighbor IS the tier zone. The
          // card below the drop point (or the one above when dropping at the end)
          // defines it; a differing tier PATCHes the priority with the move.
          let adoptedPrio = null
          if (task && newStatus === task.status && colBody) {
            const next = drag.nextElementSibling && drag.nextElementSibling.matches('[data-task-card]') ? drag.nextElementSibling : null
            const prev = drag.previousElementSibling && drag.previousElementSibling.matches('[data-task-card]') ? drag.previousElementSibling : null
            const zone = next || prev
            const zonePrio = zone ? (zone.dataset.priority || 'medium') : null
            if (zonePrio && zonePrio !== (task.priority || 'medium')) adoptedPrio = zonePrio
          }
          clearOver()
          drag.classList.remove('dragging')
          drag = null
          if (!task || !newStatus) return
          try {
            if (newStatus !== task.status) await B().patchTask(id, { status: newStatus })
            if (adoptedPrio) await B().patchTask(id, { priority: adoptedPrio })
            const ids = [...(colBody ? colBody.querySelectorAll('[data-task-card]') : [])].map((x) => x.dataset.taskCard)
            if (ids.length > 1) await B().reorderTasks(ids)
            await reload()
          } catch {
            window.hibana && window.hibana.toast(_t('sparks.saveFailed', "Couldn't save"), 'err')
            await reload()
          }
        })
        ctx.on('dragend', () => { clearOver(); if (drag) { drag.classList.remove('dragging'); drag = null } })

        // ---- boot ----
        // Self-healing library wait: HibanaBoard can be missing when this page arrives
        // through a soft navigation from a STALE nav.js (deployed before script transport
        // existed — the tag is simply never appended), when devboard.js failed to fetch,
        // or when a slow deferred script hasn't evaluated yet. Give it a moment, then
        // inject the scripts OURSELVES and keep waiting — only give up (with a retry
        // button) after a real timeout. Re-appending the tag re-executes the module,
        // which is idempotent (it only defines window.HibanaBoard).
        const ensureLib = () => new Promise((resolve) => {
          if (window.HibanaBoard) return resolve(true)
          let waited = 0
          let injected = false
          const inject = (src) => {
            const el = document.createElement('script')
            el.src = src
            document.head.appendChild(el)
          }
          const tick = () => {
            if (window.HibanaBoard) return resolve(true)
            if (!injected && waited >= 1200) {
              injected = true
              inject('/js/devboard.js?v=19') // keep in sync with the <head> tag + sw SHELL
              if (!window.HibanaChips) inject('/js/chip-render.js?v=4') // S36: was ?v=1 while the HTML tags say v=2 — two cache entries for one file (the cache-bust gate caught it under the sandbox's mode-bit noise). Aligned; local-dev + SW caches now share ONE url per version.
              if (!window.jalaali) inject('/vendor/jalaali.min.js') // Jalali dates for FA
            }
            if (waited >= 9000) return resolve(false)
            waited += 150
            setTimeout(tick, 150)
          }
          tick()
        })
        const fail = () => {
          root.hidden = true
          loading.hidden = false
          const msg = String(_t('db.loadFailed', "Couldn't load the board")).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
          const retry = String(_t('db.retry', 'Try again')).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
          loading.innerHTML = '<span>' + msg + '</span> <button type="button" class="btn small" id="db-retry">' + retry + '</button>'
        }
        // 404 = the project doesn't exist (anymore). Retrying can never succeed — say
        // what happened and offer the way back instead of a dead-end error.
        const gone = () => {
          root.hidden = true
          loading.hidden = false
          const msg = String(_t('db.projectGone', "This project doesn't exist or was deleted")).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
          const back = String(_t('db.backToProjects', 'Back to projects')).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
          loading.innerHTML = '<span>' + msg + '</span> <a class="btn small" href="/projects.html">' + back + '</a>'
        }
        const boot = async () => {
          document.querySelector('[data-back-link]').href = '/project.html?id=' + projectId
          const ok = await ensureLib()
          if (!ok) return fail()
          try {
            await reload()
          } catch (err) {
            if (err && err.status === 404) return gone()
            return fail()
          }
          if (openTask && B().findTask(openTask)) B().openEditor(openTask, { onSaved: reload })
          else if (addStatus) B().openEditor(null, { defaults: { status: addStatus }, onSaved: reload })
        }
        // S30 batch 5 (FA-guard find): `ready` is a PROMISE (always truthy) — the old
        // truthy-check booted BEFORE apply() resolved the language, so FA users got an
        // English first render. Await it: it resolves AFTER the lazy FA dictionary
        // lands (i18n.js's apply awaits ensureFaDict before resolving).
        if (window.hibanaI18n && window.hibanaI18n.ready) window.hibanaI18n.ready.then(boot).catch(boot)
        else document.addEventListener('hibana:i18n', boot, { once: true })
      },
    })
