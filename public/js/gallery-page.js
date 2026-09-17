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
        // S59b — URL params (deep-linkable filters, "never lose your place"):
        //   ?project=<id>  preselects the project filter
        //   ?gs=open|fixed|pinned|all  preselects the state filter
        // Filter changes replaceState the URL (no history spam); defaults drop their
        // param so the canonical URL stays clean. On load the project param is
        // VALIDATED against real rows — a stale/bookmarked id for a now-empty project
        // falls back to All (an empty grid with a silent filter would read as data loss).
        const GS_VALUES = new Set(['all', 'open', 'fixed', 'pinned'])
        const urlParams = () => new URLSearchParams(location.search)
        const readUrl = () => {
          const p = urlParams()
          const proj = p.get('project')
          const gs = p.get('gs')
          if (proj && /^[a-f0-9-]{6,64}$/i.test(proj)) state.project = proj
          if (gs && GS_VALUES.has(gs)) state.gs = gs
        }
        const syncUrl = () => {
          const p = urlParams()
          if (state.project) p.set('project', state.project); else p.delete('project')
          if (state.gs !== 'all') p.set('gs', state.gs); else p.delete('gs')
          const q = p.toString()
          history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash)
        }
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

        const visible = () => state.rows.filter((r) => {
          if (state.project && r.project_id !== state.project) return false
          if (state.gs === 'open' && r.resolved) return false
          if (state.gs === 'fixed' && !r.resolved) return false
          if (state.gs === 'pinned' && !r.task_id) return false
          return true
        })

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
                '<img alt="' + esc(r.caption || '') + '" decoding="async"></button>' +
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
            : '<div class="empty-state empty"><span class="empty-state-icon" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8" cy="10" r="1.5"/><path d="M21 16l-5-5L5 19"/></svg></span><p class="empty-state-title">' + esc(_t('gallery.emptyTitle', 'No pictures yet')) + '</p><p class="empty-state-text">' + esc(_t('gallery.emptyText', 'Pictures you upload on a project page (the Screenshots tab) all land here — one safe, permanent library.')) + '</p><a class="empty-state-cta btn" href="/projects.html">' + esc(_t('gallery.emptyCta', 'Open your projects')) + '</a></div>'
          // S69: stale object URLs from the previous render go back to the browser
          // (the grid rebuild drops every reference to them).
          for (const u of objectUrls) { try { URL.revokeObjectURL(u) } catch {} }
          objectUrls.clear()
          grid.setAttribute('aria-busy', 'false')
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
          if (e.target !== projectSel) return
          state.project = projectSel.value
          syncUrl()
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
            syncUrl()
            render()
            return
          }
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

        // the dict may still be loading (i18n.js is deferred) — re-render once ready
        // so FA labels/dates land after the fetch won the race.
        if (window.hibanaI18n?.ready) window.hibanaI18n.ready.then(() => render()).catch(() => {})
        readUrl()
        // reflect a URL-provided state filter on its chip BEFORE any render
        document.querySelectorAll('.gallery-state').forEach((c) => {
          const on = c.getAttribute('data-gs') === state.gs
          c.classList.toggle('is-on', on)
          c.setAttribute('aria-pressed', on ? 'true' : 'false')
        })
        load()
      },
    })
