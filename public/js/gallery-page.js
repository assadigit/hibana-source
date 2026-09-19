    // gallery-page.js — S39 (user request: "an archive gallery of pics, similar to
    // wordpress, so the user can delete the unneeded files to make up more space").
    // The MEDIA LIBRARY: GET /api/media (every picture the user owns, joined with its
    // project + pin), rendered client-side — filter by project / open / fixed / pinned,
    // zoom lightbox, delete (the ONLY removal path — pictures never expire, S38).
    // Registers through the shared __hibanaPage queue (nav.js mounts/unmounts ctx.on).
    //
    // S79 — the gallery graduates from VIEWER to MANAGER:
    //   (a) NOTE EDITING: the caption on every card is click-to-edit (a modal with the
    //       same shape as the project page's S46 note editor — a real textarea, not a
    //       2-row strip), and the textarea carries [data-magic] so the AI wand rides it
    //       (polish/translate a note right where you see the picture it describes; the
    //       focus-reveal path anchors the wand at the textarea's corner inside the dialog).
    //   (b) BULK SPACE MANAGEMENT: a Select mode — tap pictures to pick them, a sticky
    //       bar counts them (n + the bytes they hold), one confirm deletes them all and
    //       frees the space in one pass (the owner's original gallery ask was exactly
    //       "delete the unneeded files to make up more space" — one-by-one confirm
    //       dialogs made a cleanup pass of 30 pictures 30 confirms deep).
    //
    // S80 — the cleanup pass gets its power tools:
    //   (c) SORT: newest / oldest / LARGEST / smallest (the space story gets an order —
    //       biggest offenders first is the natural cleanup view; ?sort= deep-linkable,
    //       re-ordering never invalidates selections unlike filters).
    //   (d) SELECT ALL VISIBLE: the master toggle in the selection bar (Gmail/Photos
    //       semantics — mirrors "Select all (n)" / "Deselect all" against the filtered set).
    //   (e) SHIFT+CLICK RANGE PICKS: file-manager semantics (ranges ADD; the anchor is
    //       the last individual pick, reset on re-render/exit so it can never mislead).
    //
    // S81 — the touch counterpart of (e): phones have no Shift key, so a LONG-PRESS
    //   (~480ms, finger still) sets the range anchor and the NEXT TAP completes the
    //   range — same ADD semantics, a drag past the slop cancels (the hold must never
    //   fight a scroll), and the anchor's own release click is swallowed so a hold can
    //   never un-pick the tile it just picked.
    window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
    window.__hibanaPage({
      name: 'gallery',
      mount(ctx) {
        const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
        const dig = (n) => (document.documentElement.lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) : String(n))
        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
        const grid = document.getElementById('gallery-grid')
        const stats = document.getElementById('gallery-stats')
        const projectSel = document.getElementById('gallery-project')
        const sortSel = document.getElementById('gallery-sort')
        const selectBtn = document.getElementById('gallery-select-btn')
        if (!grid) return
        // S80 — the anchor of Shift+click range picks (index within visible()).
        let lastPickIdx = null
        // S81 — the touch range state: the long-pressed tile's id while a range is
        // being armed (the NEXT tile tap completes it), + the long-press timer bits.
        let rangeAnchorId = null
        let lpFired = false // the release click right after a fired hold must not toggle
        let lpAdded = false // did the hold's pick ADD the tile (a cancel undoes exactly that)
        let lpTimer = null
        let lpStart = null

        const state = { rows: [], project: '', gs: 'all', sort: 'new', selecting: false, sel: new Set() }
        // S59b — URL params (deep-linkable filters, "never lose your place"):
        //   ?project=<id>  preselects the project filter
        //   ?gs=open|fixed|pinned|all  preselects the state filter
        // S80 — one more dimension:
        //   ?sort=new|old|big|small  preselects the display order
        // Filter changes replaceState the URL (no history spam); defaults drop their
        // param so the canonical URL stays clean. On load the project param is
        // VALIDATED against real rows — a stale/bookmarked id for a now-empty project
        // falls back to All (an empty grid with a silent filter would read as data loss).
        const GS_VALUES = new Set(['all', 'open', 'fixed', 'pinned'])
        const SORT_VALUES = new Set(['new', 'old', 'big', 'small'])
        const urlParams = () => new URLSearchParams(location.search)
        const readUrl = () => {
          const p = urlParams()
          const proj = p.get('project')
          const gs = p.get('gs')
          const sort = p.get('sort')
          if (proj && /^[a-f0-9-]{6,64}$/i.test(proj)) state.project = proj
          if (gs && GS_VALUES.has(gs)) state.gs = gs
          if (sort && SORT_VALUES.has(sort)) state.sort = sort
        }
        const syncUrl = () => {
          const p = urlParams()
          if (state.project) p.set('project', state.project); else p.delete('project')
          if (state.gs !== 'all') p.set('gs', state.gs); else p.delete('gs')
          if (state.sort !== 'new') p.set('sort', state.sort); else p.delete('sort')
          const q = p.toString()
          history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash)
        }
        // Box labels: lockstep with the board's COLS map (detail-helpers.ts) — same
        // five boxes, same order, so "where it's categorized" reads identically.
        const BOX = { idea: ['New Ideas', 'ایده‌های جدید'], bug: ['Problems', 'مشکلات'], planned: ['Plans', 'برنامه‌ها'], in_progress: ['In Progress', 'در حال انجام'], done: ['Done', 'انجام‌شده'] }
        const boxLabel = (k) => { const p = BOX[k] || BOX.idea; return document.documentElement.lang === 'fa' ? p[1] : p[0] }
        const fmtSize = (b) => {
          if (!b) return ''
          const kb = b / 1024
          if (kb >= 1024) return (kb / 1024).toFixed(1) + ' MB'
          return Math.max(1, Math.round(kb)) + ' KB'
        }
        const fmtDate = (iso) => {
          try {
            const loc = document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-US'
            return new Date(iso).toLocaleDateString(loc, { year: 'numeric', month: 'short', day: 'numeric' })
          } catch { return '' }
        }

        let lightbox = null // { el, idx, lastTrigger }
        const closeLightbox = () => {
          if (!lightbox) return
          const trigger = lightbox.lastTrigger
          lightbox.el.remove()
          lightbox = null
          document.body.style.overflow = ''
          // focus goes back where it came from — keyboard users never land in the void
          try { trigger?.focus?.() } catch {}
        }
        // S59b: the lightbox is a BROWSER now — prev/next walk the filtered set (wrap-around),
        // the counter + caption ride the dialog, arrows follow the reading direction, and
        // focus returns to the trigger on close. Scoped styles: [data-lb] (the project
        // page's lightbox shares .shot-lightbox and stays untouched).
        const lbStep = (delta) => {
          if (!lightbox) return
          const rows = visible()
          if (!rows.length) { closeLightbox(); return }
          lightbox.idx = (lightbox.idx + delta + rows.length) % rows.length
          const r = rows[lightbox.idx]
          const img = lightbox.el.querySelector('img')
          if (img) { img.src = '/api/media/screenshots/' + encodeURIComponent(r.id) + '/file'; img.alt = r.caption || _t('project.shotZoom', 'Screenshot') }
          const count = lightbox.el.querySelector('.lb-count')
          if (count) count.textContent = dig(lightbox.idx + 1) + ' / ' + dig(rows.length)
          const cap = lightbox.el.querySelector('.lb-cap')
          if (cap) cap.textContent = r.caption || _t('gallery.noNote', 'No note')
          // S60: the resolved state rides along — the cards show it, browsing must not lose it
          const st = lightbox.el.querySelector('.lb-state')
          if (st) {
            st.textContent = r.resolved ? '✓ ' + _t('gallery.fixed', 'Fixed') : _t('gallery.open', 'Open problems')
            st.classList.toggle('is-fixed', !!r.resolved)
          }
        }
        const openLightbox = (shotId, trigger) => {
          closeLightbox()
          const rows = visible()
          const idx = rows.findIndex((r) => r.id === shotId)
          if (idx < 0) return
          const el = document.createElement('div')
          el.className = 'shot-lightbox'
          el.setAttribute('role', 'dialog')
          el.setAttribute('aria-modal', 'true')
          el.setAttribute('data-lb', '')
          el.setAttribute('aria-label', _t('project.shotZoom', 'Screenshot'))
          el.innerHTML =
            '<button type="button" class="lb-nav lb-prev" aria-label="' + esc(_t('gallery.lbPrev', 'Previous picture')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
            '<img src="/api/media/screenshots/' + encodeURIComponent(shotId) + '/file" alt="' + esc(_t('project.shotZoom', 'Screenshot')) + '">' +
            '<button type="button" class="lb-nav lb-next" aria-label="' + esc(_t('gallery.lbNext', 'Next picture')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
            '<button type="button" class="lb-close" aria-label="' + esc(_t('gallery.lbClose', 'Close')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
            '<div class="lb-meta"><span class="lb-count" aria-live="polite"></span><span class="lb-state" dir="auto"></span><span class="lb-cap" dir="auto"></span></div>'
          el.addEventListener('click', (e) => {
            if (e.target.closest('.lb-nav')) {
              lbStep(e.target.closest('.lb-prev') ? -1 : 1)
              return
            }
            if (e.target.closest('.lb-close')) { closeLightbox(); return }
            if (!e.target.closest('img')) closeLightbox() // backdrop click = zoom-out (same as before)
          })
          document.body.appendChild(el)
          document.body.style.overflow = 'hidden'
          lightbox = { el, idx, lastTrigger: trigger }
          lbStep(0) // paint counter + caption for the opening shot
          el.querySelector('.lb-close')?.focus()
        }
        ctx.on('keydown', (e) => {
          if (!lightbox) return
          if (e.key === 'Escape') { closeLightbox(); return }
          // arrows follow the READING direction — in RTL, forward is ArrowLeft (the
          // nav buttons sit at the logical edges, so keys and buttons agree)
          const rtl = document.documentElement.dir === 'rtl'
          const fwd = rtl ? 'ArrowLeft' : 'ArrowRight'
          const back = rtl ? 'ArrowRight' : 'ArrowLeft'
          if (e.key === fwd) lbStep(1)
          else if (e.key === back) lbStep(-1)
        })

        const visible = () => {
          const rows = state.rows.filter((r) => {
            if (state.project && r.project_id !== state.project) return false
            if (state.gs === 'open' && r.resolved) return false
            if (state.gs === 'fixed' && !r.resolved) return false
            if (state.gs === 'pinned' && !r.task_id) return false
            return true
          })
          // S80 — the display order. 'new' is the API's own order (created_at DESC —
          // kept byte-identical to the pre-sort behavior, ties included); the other
          // three are explicit client-side comparators. The lightbox walks THIS order,
          // so browsing follows whatever the eye currently sees.
          if (state.sort === 'old') rows.reverse()
          else if (state.sort === 'big') rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0))
          else if (state.sort === 'small') rows.sort((a, b) => (a.bytes || 0) - (b.bytes || 0))
          return rows
        }

        // S69 (perf §10-F1): TRUE lazy tiles. Native loading="lazy" was ineffective —
        // Chromium's lazy-prefetch margin (~4 viewports) covered the whole 70-tile grid,
        // so every full-size original transferred up front (measured 6.5MB / 71–75 API
        // calls per gallery load). Tiles now hold a shimmering 16:11 frame and fetch
        // ONLY when they approach the viewport (rootMargin 700px). The fetch requests
        // the ?variant=thumb tile (≤320px WebP, ~5–25KB) — the server falls back to the
        // original bytes for legacy shots and says so with X-Hibana-Thumb: miss, which
        // self-heals below. The lightbox keeps full-size originals (unchanged).
        const objectUrls = new Set()
        const healedThisSession = new Set()
        const thumbUrl = (id) => '/api/media/screenshots/' + encodeURIComponent(id) + '/file?variant=thumb'
        const lazyIO = new IntersectionObserver((entries) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue
            lazyIO.unobserve(en.target)
            loadTile(en.target)
          }
        }, { rootMargin: '700px 0px' })

        // Generate + PUT a ≤320px WebP tile for a legacy shot (best-effort, once per
        // session per id): decode the already-loaded original, downscale on canvas,
        // PATCH it beside the original. Every later visit — this device or any other —
        // gets the cheap tile. Skips silently when the browser can't export webp or the
        // result exceeds the server's cap.
        const selfHealThumb = async (id, objectUrl) => {
          if (healedThisSession.has(id)) return
          healedThisSession.add(id)
          try {
            const img = new Image()
            img.src = objectUrl
            await img.decode()
            const scale = Math.min(1, 320 / Math.max(img.width, img.height))
            const w = Math.max(1, Math.round(img.width * scale))
            const h = Math.max(1, Math.round(img.height * scale))
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            canvas.getContext('2d').drawImage(img, 0, 0, w, h)
            const dataUrl = canvas.toDataURL('image/webp', 0.8)
            if (!dataUrl.startsWith('data:image/webp')) return // no webp canvas export
            const b64 = dataUrl.split(',')[1]
            if (b64.length > 120_000) return // over the server's thumb cap — not worth it
            await fetch('/api/screenshots/' + encodeURIComponent(id), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ thumbBase64: b64 }),
            })
          } catch { /* best-effort — the next miss retries */ }
        }

        const loadTile = async (btn) => {
          const id = btn.getAttribute('data-gal-zoom')
          if (!id) return
          const img = btn.querySelector('img')
          if (!img) return
          try {
            const res = await fetch(thumbUrl(id))
            if (!res.ok) throw new Error('status ' + res.status)
            const miss = res.headers.get('X-Hibana-Thumb') === 'miss'
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            objectUrls.add(url)
            img.addEventListener('load', () => { img.classList.add('is-in') }, { once: true })
            img.src = url
            if (miss) selfHealThumb(id, url) // legacy shot — leave a tile behind for next time
          } catch {
            // offline / SW failure — fall back to a direct src (alt text carries the tile)
            img.addEventListener('load', () => { img.classList.add('is-in') }, { once: true })
            img.src = thumbUrl(id)
          }
        }

        const observeTiles = () => {
          lazyIO.disconnect() // a re-render rebuilds the grid — start observations fresh
          grid.querySelectorAll('.shot-img-btn[data-gal-zoom]').forEach((btn) => lazyIO.observe(btn))
        }

        // ---- S79 (a): the NOTE EDITOR modal ---------------------------------------
        // Same shape as the project page's S46 editor (a real textarea + Save/Cancel,
        // self-cleaning dialog) — but the textarea carries [data-magic] so the AI wand
        // rides it: focus the note, polish/translate, review, Save. The wand mounts
        // INSIDE the dialog (its own dialog-aware positioning) so it's never trapped
        // under the dialog's top layer.
        let noteDlg = null
        const galNoteForm = (shotId) => {
          if (noteDlg) { try { noteDlg.close() } catch {} }
          const row = state.rows.find((r) => r.id === shotId)
          if (!row) return
          const dlg = document.createElement('dialog')
          dlg.className = 'dialog gal-note-modal'
          dlg.setAttribute('aria-labelledby', 'gal-note-title')
          dlg.innerHTML =
            '<div class="modal gal-note-inner">' +
              '<div class="row spread gal-note-head"><h3 id="gal-note-title"></h3>' +
              '<button type="button" class="ghost" data-gal-note-close aria-label="' + esc(_t('common.close', 'Close')) + '">✕</button></div>' +
              '<div class="gal-note-body">' +
                '<textarea class="gal-note-ta" rows="6" maxlength="1000" dir="auto" data-magic data-no-fa-digits="" placeholder="' + esc(_t('project.shotNotePh', 'What is broken & where — the exact spot to work on…')) + '"></textarea>' +
                '<div class="gal-note-actions">' +
                  '<span class="muted small gal-note-hint">' + esc(_t('gallery.noteWandHint', 'Focus the note — the ✨ wand polishes or translates it')) + '</span>' +
                  '<span class="gal-note-btns">' +
                    '<button type="button" class="ghost small" data-gal-note-cancel>' + esc(_t('common.cancel', 'Cancel')) + '</button>' +
                    '<button type="button" class="btn small" data-gal-note-save>' + esc(_t('common.save', 'Save')) + '</button>' +
                  '</span>' +
                '</div>' +
              '</div>' +
            '</div>'
          dlg.querySelector('h3').textContent = _t('project.shotNoteTitle', 'Note — what & where to work')
          const ta = dlg.querySelector('.gal-note-ta')
          ta.value = row.caption || ''
          document.body.appendChild(dlg)
          noteDlg = dlg
          const close = () => { try { dlg.close() } catch {} }
          dlg.querySelector('[data-gal-note-close]').addEventListener('click', close)
          dlg.querySelector('[data-gal-note-cancel]').addEventListener('click', close)
          dlg.querySelector('[data-gal-note-save]').addEventListener('click', async () => {
            const caption = ta.value.trim()
            try {
              const res = await fetch('/api/screenshots/' + encodeURIComponent(shotId), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ caption }),
              })
              if (!res.ok) throw new Error('status ' + res.status)
              // surgical DOM update — a full re-render would re-fetch every thumb tile
              row.caption = caption
              const p = grid.querySelector('.gal-card[data-shot="' + shotId + '"] .shot-note')
              if (p) {
                p.textContent = caption
                p.classList.toggle('has-note', !!caption)
                if (!caption) {
                  p.innerHTML = '<span class="shot-note-empty">' + esc(_t('gallery.noNote', 'No note')) + '</span>'
                }
              }
              window.hibana?.toast(_t('project.noteSaved', 'saved'), 'info')
              close()
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save"), 'err') }
          })
          // Esc + Cancel both clean up; Enter inside the textarea is a newline (real notes
          // are multi-line), so only the buttons save.
          dlg.addEventListener('close', () => { dlg.remove(); if (noteDlg === dlg) noteDlg = null })
          dlg.showModal()
          setTimeout(() => ta.focus(), 0)
        }

        // ---- S79 (b): SELECT mode — bulk space management --------------------------
        // One toggle enters selection; tapping a tile (or its check) picks it; the sticky
        // bar counts picks + the bytes they hold; one confirm deletes them all. Esc /
        // "Done" / any filter change exits. The check buttons live in the DOM permanently
        // (CSS gates them on [data-selecting]) so a mode flip never rebuilds the grid.
        let selBar = null
        const selBytes = () => state.rows.filter((r) => state.sel.has(r.id)).reduce((n, r) => n + (r.bytes || 0), 0)
        // S80 — every visible row picked (or not — the master toggle). Picking ALL is
        // the cleanup pass's natural gesture: sort by size → Select all → Delete →
        // space freed; the label flips to "Deselect all" once the set is complete
        // (Gmail/Photos semantics — the master control mirrors the state it controls).
        const selectAllVisible = () => {
          const rows = visible()
          const allOn = rows.length > 0 && rows.every((r) => state.sel.has(r.id))
          if (allOn) state.sel.clear()
          else rows.forEach((r) => state.sel.add(r.id))
          paintSelection()
        }
        const ensureSelBar = () => {
          if (selBar) return selBar
          selBar = document.createElement('div')
          selBar.className = 'gal-selbar'
          selBar.setAttribute('role', 'status')
          selBar.setAttribute('aria-live', 'polite')
          selBar.innerHTML =
            '<span class="gal-selbar-count"></span>' +
            '<span class="gal-selbar-btns">' +
              '<button type="button" class="ghost small gal-selbar-all"></button>' +
              '<button type="button" class="ghost small gal-selbar-clear">' + esc(_t('gallery.clearSelection', 'Clear selection')) + '</button>' +
              '<button type="button" class="btn small danger gal-selbar-del">' + esc(_t('gallery.deleteSelected', 'Delete selected')) + '</button>' +
            '</span>'
          selBar.querySelector('.gal-selbar-all').addEventListener('click', selectAllVisible)
          selBar.querySelector('.gal-selbar-clear').addEventListener('click', () => { state.sel.clear(); paintSelection() })
          selBar.querySelector('.gal-selbar-del').addEventListener('click', deleteSelected)
          document.body.appendChild(selBar)
          return selBar
        }
        const removeSelBar = () => { if (selBar) { selBar.remove(); selBar = null } }
        const paintSelection = () => {
          grid.querySelectorAll('.gal-card').forEach((card) => {
            const on = state.sel.has(card.getAttribute('data-shot'))
            card.classList.toggle('is-sel', on)
            const chk = card.querySelector('.gal-check')
            if (chk) chk.setAttribute('aria-pressed', on ? 'true' : 'false')
          })
          if (!state.selecting) { removeSelBar(); return }
          const bar = ensureSelBar()
          const vis = visible()
          const n = state.sel.size
          const size = fmtSize(selBytes()) || '0 KB'
          const countEl = bar.querySelector('.gal-selbar-count')
          countEl.textContent =
            n === 0
              ? _t('gallery.selectOn', 'Tap pictures to pick them')
              : _t('gallery.selectedCount', '{n} selected · ≈{size}').split('{n}').join(dig(n)).split('{size}').join(dig(size))
          // the desktop range affordance rides the empty bar's count (CSS shows it only
          // for hover+fine pointers — touch can't shift-click and never sees the hint);
          // S81 gives touch its own line: the long-press counterpart, shown for
          // coarse/no-hover pointers by the SAME gating pattern in reverse.
          countEl.setAttribute('data-range-hint', _t('gallery.rangeHint', 'Shift+click picks a range'))
          countEl.setAttribute('data-range-touch-hint', _t('gallery.rangeTouchHint', 'Hold a picture, then tap another to pick a range'))
          // the master toggle mirrors the visible set: "Select all (n)" while anything
          // is unpicked, "Deselect all" once the set is complete (it clears ALL picks,
          // including any now-hidden by filters — Clear selection's exact job, but the
          // mirrored label is what makes the state legible).
          const allBtn = bar.querySelector('.gal-selbar-all')
          let allOn = false
          if (allBtn) {
            allOn = vis.length > 0 && vis.every((r) => state.sel.has(r.id))
            allBtn.textContent = allOn
              ? _t('gallery.deselectAll', 'Deselect all')
              : _t('gallery.selectAll', 'Select all ({n})').split('{n}').join(dig(vis.length))
            allBtn.disabled = vis.length === 0
          }
          bar.classList.toggle('is-all', allOn)
          bar.classList.toggle('is-empty', n === 0)
          bar.querySelector('.gal-selbar-del').disabled = n === 0
          bar.querySelector('.gal-selbar-clear').disabled = n === 0
        }
        const enterSelect = () => {
          state.selecting = true
          if (selectBtn) {
            selectBtn.setAttribute('aria-pressed', 'true')
            selectBtn.classList.add('is-on')
            selectBtn.textContent = _t('gallery.exitSelect', 'Done selecting')
          }
          grid.setAttribute('data-selecting', '')
          paintSelection()
        }
        const exitSelect = () => {
          state.selecting = false
          state.sel.clear()
          lastPickIdx = null // a fresh session must not shift-range off a stale anchor
          lpFired = false
          lpAdded = false
          lpCancel()
          clearRangeAnchor() // and no armed touch range may outlive the mode
          if (selectBtn) {
            selectBtn.setAttribute('aria-pressed', 'false')
            selectBtn.classList.remove('is-on')
            selectBtn.textContent = _t('gallery.select', 'Select')
          }
          grid.removeAttribute('data-selecting')
          paintSelection()
        }
        const deleteSelected = async () => {
          const ids = [...state.sel]
          if (!ids.length) return
          const n = ids.length
          const size = fmtSize(selBytes()) || '0 KB'
          if (!window.confirm(_t('gallery.deleteSelectedConfirm', 'Delete {n} pictures for good? Frees ≈{size} of space.').split('{n}').join(dig(n)).split('{size}').join(dig(size)))) return
          // delete bar first (the count is stale the moment the first DELETE lands)
          removeSelBar()
          if (selectBtn) selectBtn.disabled = true
          const results = await Promise.allSettled(ids.map((id) =>
            fetch('/api/screenshots/' + encodeURIComponent(id), { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error('status ' + r.status) })
          ))
          if (selectBtn) selectBtn.disabled = false
          const failed = results.filter((r) => r.status === 'rejected').length
          exitSelect()
          if (failed === 0) {
            window.hibana?.toast(_t('gallery.bulkDeleted', '{n} pictures deleted — space freed').split('{n}').join(dig(n)), 'info')
          } else {
            window.hibana?.toast(_t('gallery.bulkDeletedPartial', '{n} deleted · {m} failed').split('{n}').join(dig(n - failed)).split('{m}').join(dig(failed)), 'err')
          }
          await load() // fresh totals (count + space meter)
        }

        const render = () => {
          // stats + project select (both derive from the CURRENT rows)
          const totalBytes = state.rows.reduce((n, r) => n + (r.bytes || 0), 0)
          if (stats) {
            stats.hidden = !state.rows.length
            const mb = totalBytes >= 1024 * 1024 ? (totalBytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(0, Math.round(totalBytes / 1024)) + ' KB'
            stats.textContent = dig(state.rows.length) + ' ' + _t('gallery.pics', 'pictures') + ' · ≈' + dig(mb)
          }
          if (projectSel) {
            const projects = []
            const seen = new Set()
            for (const r of state.rows) {
              if (r.project_id && !seen.has(r.project_id)) { seen.add(r.project_id); projects.push({ id: r.project_id, title: r.project_title || '' }) }
            }
            projects.sort((a, b) => a.title.localeCompare(b.title))
            projectSel.innerHTML =
              '<option value="">' + esc(_t('gallery.allProjects', 'All projects')) + '</option>' +
              projects.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === state.project ? ' selected' : '') + '>' + esc(p.title) + '</option>').join('')
          }
          const rows = visible()
          // S80: the size-emphasis hook — when the display order IS the size story
          // (largest/smallest first), the per-card size stops being a footnote and
          // becomes the leading fact; CSS bumps it (layout.css [data-sort-size]).
          grid.setAttribute('data-sort-size', state.sort === 'big' || state.sort === 'small' ? state.sort : '')
          if (sortSel) sortSel.classList.toggle('is-on', state.sort !== 'new')
          lastPickIdx = null // a re-render re-orders tiles — a stale range anchor misleads
          clearRangeAnchor() // S81: ditto the armed touch range (re-render = new indices)
          grid.innerHTML = rows.length
            ? rows.map((r) => {
              const pin = r.task_id
                ? '<span class="chip gal-pin" dir="auto" title="' + esc(_t('gallery.pinHint', 'Pinned to a progress-box item')) + '">📌 ' + esc(boxLabel(r.task_status)) + ' · ' + esc(String(r.task_title || '').replace(/\s+/g, ' ').slice(0, 60)) + '</span>'
                : ''
              return '<figure class="shot shot-card gal-card' + (r.resolved ? ' is-fixed' : '') + (state.sel.has(r.id) ? ' is-sel' : '') + '" data-shot="' + esc(r.id) + '">' +
                '<button type="button" class="gal-check" data-gal-check="' + esc(r.id) + '" aria-pressed="' + (state.sel.has(r.id) ? 'true' : 'false') + '" aria-label="' + esc(_t('gallery.selectPicture', 'Select picture')) + '">' +
                  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>' +
                '</button>' +
                '<button type="button" class="shot-img-btn" data-gal-zoom="' + esc(r.id) + '" aria-label="' + esc(_t('project.shotZoom', 'Screenshot')) + '">' +
                '<img alt="' + esc(r.caption || '') + '" decoding="async"></button>' +
                '<figcaption class="shot-body">' +
                '<p class="shot-note muted small' + (r.caption ? ' has-note' : '') + '" dir="auto" data-gal-note="' + esc(r.id) + '" role="button" tabindex="0" title="' + esc(_t('gallery.editNote', 'Click to edit the note')) + '">' + (esc(r.caption) || '<span class="shot-note-empty">' + esc(_t('gallery.noNote', 'No note')) + '</span>') + '</p>' +
                '<div class="row gal-chips" style="gap:0.3rem;flex-wrap:wrap">' +
                '<a class="chip gal-project" dir="auto" href="/project.html?id=' + esc(r.project_id) + '" title="' + esc(_t('gallery.openProject', 'Open the project')) + '">' + esc(r.project_title || '') + (r.project_deleted ? ' <span class="gal-deleted">(' + esc(_t('gallery.deletedProject', 'deleted')) + ')</span>' : '') + '</a>' +
                pin +
                '</div>' +
                '<div class="row spread shot-actions">' +
                '<span class="shot-state' + (r.resolved ? ' is-fixed' : '') + '">' + (r.resolved ? '✓ ' + esc(_t('gallery.fixed', 'Fixed')) : esc(_t('gallery.open', 'Open'))) + '</span>' +
                '<span class="muted small shot-size">' + esc(fmtDate(r.created_at)) + (r.bytes ? ' · ' + dig(fmtSize(r.bytes)) : '') + '</span>' +
                '<button type="button" class="ghost small danger" data-gal-del="' + esc(r.id) + '" title="' + esc(_t('gallery.delete', 'Delete')) + '" aria-label="' + esc(_t('gallery.delete', 'Delete')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div></figcaption></figure>'
            }).join('')
            : '<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg></span><p class="empty-state-title">' + esc(_t('gallery.emptyTitle', 'No pictures yet')) + '</p><p class="empty-state-text">' + esc(_t('gallery.emptyText', 'Pictures you upload on a project page (the Screenshots tab) all land here — one safe, permanent library.')) + '</p><a class="empty-state-cta btn" href="/projects.html">' + esc(_t('gallery.emptyCta', 'Open your projects')) + '</a></div>'
          // S69: stale object URLs from the previous render go back to the browser
          // (the grid rebuild drops every reference to them).
          for (const u of objectUrls) { try { URL.revokeObjectURL(u) } catch {} }
          objectUrls.clear()
          grid.setAttribute('aria-busy', 'false')
          if (state.selecting) paintSelection()
          observeTiles()
        }

        const load = async () => {
          grid.setAttribute('aria-busy', 'true')
          try {
            const res = await fetch('/api/media')
            if (!res.ok) throw new Error('status ' + res.status)
            const data = await res.json()
            state.rows = (data.screenshots) || []
            // URL-provided project must point at a project that actually has pictures —
            // otherwise fall back to All and clean the param (feedback over silence).
            if (state.project && !state.rows.some((r) => r.project_id === state.project)) {
              state.project = ''
              syncUrl()
            }
            render()
          } catch {
            grid.setAttribute('aria-busy', 'false')
            grid.innerHTML = '<div class="empty-state empty"><p class="empty-state-title">' + esc(_t('gallery.loadFailed', "Couldn't load the gallery — try again.")) + '</p></div>'
          }
        }

        ctx.on('change', (e) => {
          if (e.target !== projectSel && e.target !== sortSel) return
          if (e.target === sortSel) {
            // S80 — a sort change only RE-ORDERS the visible set (never changes
            // membership), so selections stay valid — unlike the filters below.
            state.sort = SORT_VALUES.has(sortSel.value) ? sortSel.value : 'new'
            syncUrl()
            render()
            return
          }
          state.project = projectSel.value
          syncUrl()
          if (state.selecting) exitSelect() // filter change = new visible set — selection is stale
          render()
        })
        // ---- S81: touch range-picks — long-press the start, tap the end -------------
        // Phones have no Shift key: a ~480ms hold (finger still — 10px of travel means
        // "this is a scroll, not a hold" and cancels) ARMS the range from the held
        // tile, and the very next tile TAP completes it (ADD semantics, identical to
        // Shift+click). The anchor tile carries .is-range-anchor until the range lands
        // (or is cancelled: tapping the anchor again, Esc, a re-render, exiting select).
        // Pen pointers ride the same path (no shift key there either); mouse is
        // excluded — Shift+click already owns that input.
        const LP_MS = 480
        const LP_SLOP = 10
        const clearRangeAnchor = () => {
          rangeAnchorId = null
          grid.querySelectorAll('.gal-card.is-range-anchor').forEach((el) => el.classList.remove('is-range-anchor'))
        }
        const tileIdOf = (e) => {
          const t = e.target instanceof Element ? e.target.closest('[data-gal-zoom], [data-gal-check]') : null
          return t ? (t.getAttribute('data-gal-zoom') || t.getAttribute('data-gal-check')) : null
        }
        ctx.on('pointerdown', (e) => {
          if (!state.selecting || e.pointerType === 'mouse' || (e.button !== undefined && e.button !== 0)) return
          const id = tileIdOf(e)
          if (!id) return
          if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } // a second finger re-arms, never stacks timers
          lpFired = false
          lpStart = { x: e.clientX, y: e.clientY, id }
          lpTimer = window.setTimeout(() => {
            lpTimer = null
            lpFired = true
            // the anchor PICKS (ranges ADD — the held tile is in the range it starts);
            // a later cancel undoes the pick ONLY if the hold added it (a pre-picked
            // anchor stays picked — cancel is "never mind the range", not "unpick")
            lpAdded = !state.sel.has(lpStart.id)
            state.sel.add(lpStart.id)
            rangeAnchorId = lpStart.id
            lastPickIdx = visible().findIndex((r) => r.id === lpStart.id)
            paintSelection()
            grid.querySelectorAll('.gal-card').forEach((el) => el.classList.toggle('is-range-anchor', el.getAttribute('data-shot') === rangeAnchorId))
            try { navigator.vibrate?.(12) } catch { /* no haptics — fine */ }
            window.hibana?.toast(_t('gallery.rangeTouchStart', 'Range start — now tap the last picture'), 'info')
          }, LP_MS)
        })
        ctx.on('pointermove', (e) => {
          if (!lpTimer || !lpStart) return
          if (Math.abs(e.clientX - lpStart.x) > LP_SLOP || Math.abs(e.clientY - lpStart.y) > LP_SLOP) {
            clearTimeout(lpTimer)
            lpTimer = null
          }
        })
        const lpCancel = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null } }
        ctx.on('pointerup', lpCancel)
        ctx.on('pointercancel', lpCancel)
        // the hold must never bleed into the OS: no context menu / image drag while a
        // hold is pending or just fired (long-press on an <img> is the classic trigger)
        ctx.on('contextmenu', (e) => { if (lpTimer || lpFired) e.preventDefault() })
        ctx.on('dragstart', (e) => { if (state.selecting) e.preventDefault() })

        ctx.on('click', async (e) => {
          const chip = e.target.closest('[data-gs]')
          if (chip) {
            state.gs = chip.getAttribute('data-gs')
            document.querySelectorAll('.gallery-state').forEach((c) => {
              const on = c === chip
              c.classList.toggle('is-on', on)
              c.setAttribute('aria-pressed', on ? 'true' : 'false')
            })
            syncUrl()
            if (state.selecting) exitSelect() // same as the project filter — stale set
            render()
            return
          }
          // S79 (b): select-mode first — while selecting, the tile tap PICKS (the whole
          // image button is a 100%-width target, far beyond the 40px check chip).
          // S80: Shift+click picks the RANGE from the last individual pick to here
          // (file-manager semantics: ranges ADD — a mid-range unpick doesn't carve a
          // hole; unselect stays a deliberate single tap).
          // S81: a fired long-press SWALLOWS its own release click (it already picked
          // the anchor), and an ARMED touch range makes the next tap COMPLETE it.
          if (state.selecting) {
            const pick = e.target.closest('[data-gal-check], [data-gal-zoom]')
            if (pick) {
              const id = pick.getAttribute('data-gal-check') || pick.getAttribute('data-gal-zoom')
              // the release click that follows a fired hold is the anchor's own — it
              // must not toggle the tile the hold just picked
              if (lpFired) { lpFired = false; return }
              const rows = visible()
              const idx = rows.findIndex((r) => r.id === id)
              // an ARMED touch range completes here: anchor → this tile, ADD semantics
              // (tapping the anchor itself cancels the armed range — and un-picks the
              // anchor iff the hold picked it: "never mind" is one gesture, a
              // pre-existing pick is never collateral)
              if (rangeAnchorId) {
                if (rangeAnchorId === id) {
                  if (lpAdded) state.sel.delete(id)
                  clearRangeAnchor()
                  paintSelection()
                  return
                }
                const a = rows.findIndex((r) => r.id === rangeAnchorId)
                if (a >= 0 && idx >= 0) {
                  for (let i = Math.min(a, idx); i <= Math.max(a, idx); i++) state.sel.add(rows[i].id)
                  lastPickIdx = idx
                }
                clearRangeAnchor()
                paintSelection()
                return
              }
              if (e.shiftKey && lastPickIdx != null && idx >= 0 && idx !== lastPickIdx) {
                const a = Math.min(lastPickIdx, idx)
                const b = Math.max(lastPickIdx, idx)
                for (let i = a; i <= b; i++) state.sel.add(rows[i].id)
              } else {
                if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id)
                lastPickIdx = idx
              }
              paintSelection()
              return
            }
          }
          const note = e.target.closest('[data-gal-note]')
          if (note) { galNoteForm(note.getAttribute('data-gal-note')); return }
          const zoom = e.target.closest('[data-gal-zoom]')
          if (zoom) { openLightbox(zoom.getAttribute('data-gal-zoom'), zoom); return }
          const del = e.target.closest('[data-gal-del]')
          if (del) {
            if (!window.confirm(_t('gallery.deleteConfirm', 'Delete this picture for good? It also frees the space it uses.'))) return
            try {
              const res = await fetch('/api/screenshots/' + del.getAttribute('data-gal-del'), { method: 'DELETE' })
              if (!res.ok) throw new Error('status ' + res.status)
              window.hibana?.toast(_t('gallery.deleted', 'Picture deleted'), 'info')
              await load() // fresh totals (count + space meter)
            } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't delete"), 'err') }
            return
          }
          if (lightbox && !e.target.closest('.shot-lightbox')) closeLightbox()
        })
        // S79: the Select toggle (toolbar) + keyboard parity for the click-to-edit
        // note (role="button" needs Enter/Space) + Esc exits select mode.
        if (selectBtn) {
          selectBtn.addEventListener('click', () => { if (state.selecting) exitSelect(); else enterSelect() })
        }
        ctx.on('keydown', (e) => {
          if (e.key === 'Escape' && state.selecting && !lightbox && !noteDlg) { exitSelect(); return }
          if (e.key !== 'Enter' && e.key !== ' ') return
          const note = e.target instanceof Element ? e.target.closest('[data-gal-note]') : null
          if (note) { e.preventDefault(); galNoteForm(note.getAttribute('data-gal-note')) }
        })

        // the dict may still be loading (i18n.js is deferred) — re-render once ready
        // so FA labels/dates land after the fetch won the race.
        if (window.hibanaI18n?.ready) window.hibanaI18n.ready.then(() => render()).catch(() => {})
        readUrl()
        // reflect a URL-provided state filter on its chip + sort on its select BEFORE any render
        document.querySelectorAll('.gallery-state').forEach((c) => {
          const on = c.getAttribute('data-gs') === state.gs
          c.classList.toggle('is-on', on)
          c.setAttribute('aria-pressed', on ? 'true' : 'false')
        })
        if (sortSel) sortSel.value = state.sort
        load()

        // soft-navigation away (nav.js calls this on the NEXT page's mount): never
        // leave a fixed-position selection bar or an open lightbox on the old page —
        // they're document.body children the shell swap would otherwise orphan.
        return () => {
          removeSelBar()
          closeLightbox()
          if (noteDlg) { try { noteDlg.close() } catch {} }
          lpCancel() // a hold pending across a soft-nav must never fire into a dead page
          clearRangeAnchor()
          lazyIO.disconnect()
        }
      },
    })
