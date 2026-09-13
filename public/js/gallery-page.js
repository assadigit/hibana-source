    // gallery-page.js — S39 (user request: "an archive gallery of pics, similar to
    // wordpress, so the user can delete the unneeded files to make up more space").
    // The MEDIA LIBRARY: GET /api/media (every picture the user owns, joined with its
    // project + pin), rendered client-side — filter by project / open / fixed / pinned,
    // zoom lightbox, delete (the ONLY removal path — pictures never expire, S38).
    // Registers through the shared __hibanaPage queue (nav.js mounts/unmounts ctx.on).
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
        if (!grid) return

        const state = { rows: [], project: '', gs: 'all' }
        // Box labels: lockstep with the board's COLS map (detail-helpers.ts) — same
        // five boxes, same order, so "where it's categorized" reads identically.
        const BOX = { idea: ['New Ideas', 'ایده‌های جدید'], bug: ['Problems', 'مشکلات'], planned: ['Upcoming Plan', 'برنامه آتی'], in_progress: ['In Progress', 'در حال انجام'], done: ['Done', 'انجام‌شده'] }
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

        let lightbox = null
        const closeLightbox = () => { if (lightbox) { lightbox.remove(); lightbox = null; document.body.style.overflow = '' } }
        const openLightbox = (src) => {
          closeLightbox()
          lightbox = document.createElement('div')
          lightbox.className = 'shot-lightbox'
          lightbox.setAttribute('role', 'dialog')
          lightbox.setAttribute('aria-label', _t('project.shotZoom', 'Screenshot'))
          lightbox.innerHTML = '<img src="' + src + '" alt="' + esc(_t('project.shotZoom', 'Screenshot')) + '">'
          lightbox.addEventListener('click', closeLightbox)
          document.body.appendChild(lightbox)
          document.body.style.overflow = 'hidden'
        }
        ctx.on('keydown', (e) => { if (e.key === 'Escape' && lightbox) closeLightbox() })

        const visible = () => state.rows.filter((r) => {
          if (state.project && r.project_id !== state.project) return false
          if (state.gs === 'open' && r.resolved) return false
          if (state.gs === 'fixed' && !r.resolved) return false
          if (state.gs === 'pinned' && !r.task_id) return false
          return true
        })

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
          grid.innerHTML = rows.length
            ? rows.map((r) => {
              const pin = r.task_id
                ? '<span class="chip gal-pin" dir="auto" title="' + esc(_t('gallery.pinHint', 'Pinned to a progress-box item')) + '">📌 ' + esc(boxLabel(r.task_status)) + ' · ' + esc(String(r.task_title || '').replace(/\s+/g, ' ').slice(0, 60)) + '</span>'
                : ''
              return '<figure class="shot shot-card gal-card' + (r.resolved ? ' is-fixed' : '') + '" data-shot="' + esc(r.id) + '">' +
                '<button type="button" class="shot-img-btn" data-gal-zoom="' + esc(r.id) + '" aria-label="' + esc(_t('project.shotZoom', 'Screenshot')) + '">' +
                '<img src="/api/media/screenshots/' + esc(r.id) + '/file" alt="' + esc(r.caption || '') + '" loading="lazy" decoding="async"></button>' +
                '<figcaption class="shot-body">' +
                '<p class="shot-note muted small" dir="auto">' + (esc(r.caption) || '<span class="shot-note-empty">' + esc(_t('gallery.noNote', 'No note')) + '</span>') + '</p>' +
                '<div class="row gal-chips" style="gap:0.3rem;flex-wrap:wrap">' +
                '<a class="chip gal-project" dir="auto" href="/project.html?id=' + esc(r.project_id) + '" title="' + esc(_t('gallery.openProject', 'Open the project')) + '">' + esc(r.project_title || '') + (r.project_deleted ? ' <span class="gal-deleted">(' + esc(_t('gallery.deletedProject', 'deleted')) + ')</span>' : '') + '</a>' +
                pin +
                '</div>' +
                '<div class="row spread shot-actions">' +
                '<span class="shot-state' + (r.resolved ? ' is-fixed' : '') + '">' + (r.resolved ? '✓ ' + esc(_t('gallery.fixed', 'Fixed')) : esc(_t('gallery.open', 'Open'))) + '</span>' +
                '<span class="muted small">' + esc(fmtDate(r.created_at)) + (r.bytes ? ' · ' + dig(fmtSize(r.bytes)) : '') + '</span>' +
                '<button type="button" class="ghost small danger" data-gal-del="' + esc(r.id) + '" title="' + esc(_t('gallery.delete', 'Delete')) + '" aria-label="' + esc(_t('gallery.delete', 'Delete')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
                '</div></figcaption></figure>'
            }).join('')
            : '<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg></span><p class="empty-state-title">' + esc(_t('gallery.emptyTitle', 'No pictures yet')) + '</p><p class="empty-state-text">' + esc(_t('gallery.emptyText', 'Pictures you upload on a project page (the Screenshots tab) all land here — one safe, permanent library.')) + '</p></div>'
          grid.setAttribute('aria-busy', 'false')
        }

        const load = async () => {
          grid.setAttribute('aria-busy', 'true')
          try {
            const res = await fetch('/api/media')
            if (!res.ok) throw new Error('status ' + res.status)
            const data = await res.json()
            state.rows = (data.screenshots) || []
            render()
          } catch {
            grid.setAttribute('aria-busy', 'false')
            grid.innerHTML = '<div class="empty-state empty"><p class="empty-state-title">' + esc(_t('gallery.loadFailed', "Couldn't load the gallery — try again.")) + '</p></div>'
          }
        }

        ctx.on('change', (e) => {
          if (e.target !== projectSel) return
          state.project = projectSel.value
          render()
        })
        ctx.on('click', async (e) => {
          const chip = e.target.closest('[data-gs]')
          if (chip) {
            state.gs = chip.getAttribute('data-gs')
            document.querySelectorAll('.gallery-state').forEach((c) => {
              const on = c === chip
              c.classList.toggle('is-on', on)
              c.setAttribute('aria-pressed', on ? 'true' : 'false')
            })
            render()
            return
          }
          const zoom = e.target.closest('[data-gal-zoom]')
          if (zoom) { const img = zoom.querySelector('img'); if (img) openLightbox(img.src); return }
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
          if (lightbox && !e.target.closest('.shot-lightbox img')) closeLightbox()
        })

        // the dict may still be loading (i18n.js is deferred) — re-render once ready
        // so FA labels/dates land after the fetch won the race.
        if (window.hibanaI18n?.ready) window.hibanaI18n.ready.then(() => render()).catch(() => {})
        load()
      },
    })
