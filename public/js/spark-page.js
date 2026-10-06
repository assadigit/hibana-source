// spark-page.js — S161 (spec #6): the LEAN idea detail page's controller.
// Sparks stop reusing the heavy Project template: title / description / tags /
// folder / links (the project template's htmx component, reused verbatim) / images
// (resize→thumb upload, drop+paste+picker, cover toggle, lightbox). Save is explicit
// with a "✓ Saved" flash (spec #8); the S120 draft store rides the title/description
// (sessionStorage per keystroke, same-id restore, stale drop, save retires).
window.__hibanaPage = window.__hibanaPage || ((d) => (window.__hibanaPageQueue = window.__hibanaPageQueue || []).push(d))
window.__hibanaPage({
  name: 'spark',
  mount(ctx) {
    const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
    const escS = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    const $ = (id) => document.getElementById(id)
    const id = new URLSearchParams(location.search).get('id')
    const detail = $('spark-detail'), loading = $('spark-loading'), notfound = $('spark-notfound')

    if (!id) { showNotFound(); return }
    let project = null
    let folders = []
    let dirty = false
    let saving = false

    function showNotFound() {
      if (loading) loading.hidden = true
      if (detail) detail.hidden = true
      if (notfound) notfound.hidden = false
    }

    // ---- the S120 draft store, ported to the lean page ---------------------------
    // A half-edited idea rides a reload/soft-nav — sessionStorage per keystroke,
    // restored into the SAME idea's fields; a draft for a DIFFERENT idea is dropped.
    // Pristine (all fields back to the loaded values) retires the store.
    const DRAFT_KEY = 'hibana-sp-draft'
    const draftClear = () => { try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* private mode */ } }
    const draftSave = () => {
      try {
        const t = $('spark-title').value, d = $('spark-desc').value
        if (t === project.title && d === (project.description ?? '')) { draftClear(); return }
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ id, t, d }))
      } catch { /* private mode */ }
    }
    const draftRestore = () => {
      try {
        const dr = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
        if (dr && dr.id === id) {
          $('spark-title').value = String(dr.t ?? '').slice(0, 200)
          $('spark-desc').value = String(dr.d ?? '').slice(0, 200)
          markDirty(true)
        } else if (dr) draftClear()
      } catch { /* malformed — the loaded values stand */ }
    }

    function markDirty(on) {
      dirty = on
      const status = $('spark-status')
      if (status && !saving) status.textContent = on ? _t('spark.unsaved', 'Unsaved changes') : ''
    }

    // ---- S171: the meta line (Created · Updated) — the lean page finally says WHEN ----
    // Mirrors the server timeAgo() units exactly (src/lib/html.ts): just now / {n}m/h/d/
    // mo/y — one 8-key i18n set (metaCreated + metaUpdated + the six units), Persian
    // digits included. Rendered on load, on every surgical reload, after Save (the
    // updated_at just moved), and on the hibana:i18n repaint (FA units).
    const langFA = () => window.hibanaI18n?.lang?.() === 'fa'
    const faDig = (s) => (langFA() ? String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(s))
    const relTime = (iso) => {
      const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
      if (m < 1) return _t('spark.relNow', 'just now')
      const unit = m < 60 ? 'relMin' : m < 1440 ? 'relHour' : m < 43200 ? 'relDay' : m < 525600 ? 'relMonth' : 'relYear'
      const n = unit === 'relMin' ? m : unit === 'relHour' ? Math.floor(m / 60) : unit === 'relDay' ? Math.floor(m / 1440) : unit === 'relMonth' ? Math.floor(m / 43200) : Math.floor(m / 525600)
      return _t('spark.' + unit, '{n} ago').split('{n}').join(faDig(n))
    }
    function renderMeta() {
      const el = $('spark-meta')
      if (!el || !project) return
      const parts = []
      if (project.created_at) parts.push(_t('spark.metaCreated', 'Created {t}').split('{t}').join(relTime(project.created_at)))
      if (project.updated_at) parts.push(_t('spark.metaUpdated', 'Updated {t}').split('{t}').join(relTime(project.updated_at)))
      el.textContent = parts.join(' · ')
      el.hidden = !parts.length
    }

    // ---- S171: the beforeunload guard — a dirty idea never silently vanishes. ---------
    // Soft-nav is already covered by the S120 draft store (sessionStorage restore);
    // this catches the LAST hole: a hard reload / tab close / external link with
    // unsaved title/description. The native dialog stays out of the way when the
    // fields are pristine or a save is in flight.
    const beforeUnload = (e) => {
      if (dirty && !saving) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', beforeUnload)

    // ---- S193: the review queue — the place-keeper in the unreviewed set ----------
    // The unreviewed sparks (created >7d ago, still sparks) ARE the attention
    // surface's info group, oldest first. While the current idea is itself in
    // that set and siblings exist, a slim bar carries your place — "Review
    // queue · i of n" + Prev/Next — so reviewing N ideas is N deliberate reads,
    // not N back-and-forth hops (never lose an idea; never lose your place).
    // Contextual by construction: no timers, no toasts, no badge churn — the
    // bar renders only on the lean page of an idea IN the set (§7: never a nag).
    let queue = null // [{ id, title, date }] oldest-first; null = not applicable
    const queueIdx = () => (queue ? queue.findIndex((q) => q.id === id) : -1)

    function renderQueue() {
      const host = $('spark-queue')
      if (!host) return
      const idx = queueIdx()
      if (!queue || queue.length < 2 || idx < 0) { host.hidden = true; host.innerHTML = ''; return }
      const pos = _t('spark.queuePos', '{i} of {n}').split('{i}').join(faDig(idx + 1)).split('{n}').join(faDig(queue.length))
      const prevT = queue[idx - 1], nextT = queue[idx + 1]
      host.innerHTML =
        '<button type="button" class="ghost small spark-queue-btn" id="spark-queue-prev"' + (idx === 0 ? ' disabled' : '') +
          ' aria-label="' + escS(_t('spark.prevIdea', 'Previous idea') + (prevT ? ': ' + prevT.title : '')) + '">' +
          '<svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg><span>' + escS(_t('spark.prevIdea', 'Previous idea')) + '</span>' +
        '</button>' +
        '<span class="spark-queue-pos muted small">' + escS(_t('spark.reviewQueue', 'Review queue')) + ' · ' + escS(pos) + '</span>' +
        '<button type="button" class="ghost small spark-queue-btn" id="spark-queue-next"' + (idx === queue.length - 1 ? ' disabled' : '') +
          ' aria-label="' + escS(_t('spark.nextIdea', 'Next idea') + (nextT ? ': ' + nextT.title : '')) + '">' +
          '<span>' + escS(_t('spark.nextIdea', 'Next idea')) + '</span><svg class="icon arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' +
        '</button>'
      host.hidden = false
    }

    // The deliberate queue hop. A dirty idea saves FIRST (the confirm says so —
    // the words are the idea, never lost to a queue hop); a failed save keeps
    // you on the page. The S120 draft store can't cover this one: it restores
    // only the SAME idea's fields, and the queue opens the NEXT idea's page.
    function queueGo(nextId) {
      const url = '/spark.html?id=' + encodeURIComponent(nextId)
      const leave = () => { if (window.hibanaNav) window.hibanaNav.go(url); else window.location.assign(url) }
      if (dirty && !saving) {
        if (!window.confirm(_t('spark.queueUnsaved', 'You have unsaved changes — save them and continue?'))) return
        save().then((ok) => { if (ok) leave() })
        return
      }
      leave()
    }

    // S193: the queue-aware landing shared by promote + delete — the next
    // unreviewed idea keeps the session moving; the LAST one closes the loop on
    // the caught-up notifications page; outside a queue, each action keeps its
    // natural destination (the new project's page / the ideas shelf).
    function queueLanding(fallback) {
      const idx = queueIdx()
      if (idx < 0) return fallback
      const next = queue[idx + 1]
      return next ? '/spark.html?id=' + encodeURIComponent(next.id) : '/notifications.html'
    }

    function renderTags() {
      const host = $('spark-tags')
      const tags = (project.tags || []).slice().sort((a, b) => a.name.localeCompare(b.name))
      host.innerHTML =
        tags.map((tg) =>
          // S171: the tag NAME is now a button — one tap jumps to the Ideas shelf
          // searched by that tag (?q= deep-link). Two siblings inside the chip (the
          // name + the ✕ delete), never a nested interactive.
          '<span class="chip pd-tag-chip spark-tag" dir="auto">' +
            '<button type="button" class="spark-tag-name" data-tag-search="' + escS(tg.name) + '" title="' + escS(_t('spark.tagSearch', 'Search ideas with this tag')) + '" aria-label="' + escS(_t('spark.tagSearch', 'Search ideas with this tag')) + '">' + escS(tg.name) + '</button>' +
            '<button type="button" class="spark-tag-x" data-tag-del="' + escS(tg.id) + '" aria-label="' + escS(_t('spark.removeTag', 'Remove tag')) + ' ✕ ' + escS(tg.name) + '" title="' + escS(_t('spark.removeTag', 'Remove tag')) + '">✕</button></span>'
        ).join('') +
        '<input id="spark-tag-in" class="spark-tag-in" maxlength="50" autocomplete="off" data-magic="" placeholder="' + escS(_t('spark.addTagPh', 'Add tag…')) + '" aria-label="' + escS(_t('spark.tagAria', 'Add a tag')) + '">'
      const input = host.querySelector('#spark-tag-in')
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        const name = input.value.trim()
        if (!name) return
        input.disabled = true
        fetch('/api/projects/' + id + '/tags', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        }).then((r) => { if (!r.ok) throw new Error('tag failed') }).then(() => reload(['tags', 'folders']))
          .catch(() => window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err'))
          .finally(() => { input.disabled = false })
      })
    }

    function renderFolderSelect() {
      const sel = $('spark-folder-sel')
      sel.innerHTML =
        '<option value="">' + escS(_t('sparks.noFolder', 'No folder')) + '</option>' +
        folders.map((f) => '<option value="' + escS(f.id) + '">' + (f.icon ? escS(f.icon) + ' ' : '') + escS(f.name) + '</option>').join('')
      sel.value = project.folder_id || ''
    }

    function renderGallery() {
      const gallery = $('spark-gallery')
      const shots = (project.screenshots || []).filter((s) => String(s.mime_type || '').startsWith('image/'))
      if (!shots.length) {
        gallery.innerHTML = '<p class="muted small spark-gallery-empty">' + escS(_t('spark.noImages', 'No images yet — the first upload becomes the card thumbnail.')) + '</p>'
        return
      }
      gallery.innerHTML = shots.map((s) => {
        const isCover = s.id === project.cover_shot_id
        return '<figure class="spark-tile' + (isCover ? ' is-cover' : '') + '" data-shot="' + escS(s.id) + '">' +
          '<button type="button" class="spark-tile-img" data-shot-zoom="' + escS(s.id) + '" aria-label="' + escS(_t('spark.viewImage', 'View image')) + '">' +
            '<img src="/api/media/screenshots/' + escS(s.id) + '/file?variant=thumb" alt="" loading="lazy">' +
            (isCover ? '<span class="spark-cover-mark" role="img" aria-label="' + escS(_t('spark.coverImage', 'Cover image')) + '"><svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg></span>' : '') +
          '</button>' +
          '<figcaption class="spark-tile-acts">' +
            '<button type="button" class="ghost small spark-cover-btn' + (isCover ? ' is-on' : '') + '" data-shot-cover="' + escS(s.id) + '"' + (isCover ? ' disabled' : '') + '>' +
              (isCover ? '✓ ' + escS(_t('spark.coverSet', 'Cover')) : escS(_t('spark.setCover', 'Set as cover'))) + '</button>' +
            '<button type="button" class="ghost small danger" data-shot-del="' + escS(s.id) + '" aria-label="' + escS(_t('spark.deleteImage', 'Delete image')) + '" title="' + escS(_t('spark.deleteImage', 'Delete image')) + '">✕</button>' +
          '</figcaption>' +
        '</figure>'
      }).join('')
    }

    function renderPin() {
      const btn = $('spark-pin')
      const on = !!project.pinned_at
      btn.classList.toggle('is-on', on)
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
      // S171: aria-label rides WITH the title — a title-only flip leaves screen
      // readers announcing the stale "Pin idea" on a pinned card.
      const label = on ? _t('sparks.unpin', 'Unpin idea') : _t('sparks.pin', 'Pin idea')
      btn.title = label
      btn.setAttribute('aria-label', label)
      const svg = btn.querySelector('svg')
      if (svg) { if (on) svg.setAttribute('fill', 'currentColor'); else svg.removeAttribute('fill') }
    }

    async function reload(parts) {
      // fresh row (tags/folder/pin/cover/updated metrics) — one fetch, surgical renders
      try {
        const r = await fetch('/api/projects/' + id, { cache: 'no-store' })
        if (!r.ok) throw new Error('reload failed')
        const body = await r.json()
        project = body.project || project
        if (parts?.includes('tags')) renderTags()
        if (parts?.includes('folders')) renderFolderSelect()
        if (parts?.includes('gallery')) renderGallery()
        if (parts?.includes('pin')) renderPin()
        renderMeta() // S171: fresh Created/Updated on every surgical reload
      } catch { /* transient — the current render stands */ }
    }

    async function save() {
      if (saving) return false
      saving = true
      const btn = $('spark-save'), status = $('spark-status')
      btn.disabled = true
      status.textContent = _t('spark.saving', 'Saving…')
      try {
        const res = await fetch('/api/projects/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: $('spark-title').value.trim() || project.title, description: $('spark-desc').value }),
        })
        if (!res.ok) throw new Error('save failed')
        project.title = $('spark-title').value.trim() || project.title
        project.description = $('spark-desc').value
        project.updated_at = new Date().toISOString() // S171: the meta line follows the save
        draftClear()
        markDirty(false)
        status.textContent = _t('spark.saved', '✓ Saved')
        window.hibanaResume?.record?.('spark', id, project.title, 'spark')
        window.hibana?.rail?.refresh?.()
        setTimeout(() => { if (status.textContent === _t('spark.saved', '✓ Saved')) status.textContent = '' }, 2500)
        return true // S193: queueGo's save-and-continue rides the result
      } catch {
        status.textContent = ''
        window.hibana?.toast(_t('spark.saveFailed', "Couldn't save — try again"), 'err')
        return false
      } finally {
        saving = false
        btn.disabled = false
      }
    }

    // ---- S193: the PROMOTE action — the board's dialog grammar, on the lean page ----
    // The deliberate review decision lands where the idea is actually READ (the
    // board's ⋯ menu stays for shelf-side triage): stage select → ONE PATCH with
    // the dirty title/description folded in (the words are never lost to the
    // promotion) → toast + rail refresh + the resume record as a PROJECT (the
    // S119 grammar) → the queue-aware landing (next unreviewed idea; the new
    // project's page without a queue; the caught-up notifications page when the
    // queue empties — the loop closes where it began).
    let promoteDlg = null
    const PROMOTE_STAGES = ['planning', 'queued', 'developing', 'awaiting_dev', 'operational']
    function openPromote() {
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
            '<button type="button" class="ghost" id="sp-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
            '<button type="submit" id="sp-save">' + _t('common.save', 'Save') + '</button>' +
          '</div>' +
        '</form>'
      document.body.appendChild(dlg)
      promoteDlg = dlg
      const close = () => { dlg.close(); dlg.remove(); promoteDlg = null }
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
      dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
      dlg.querySelector('#sp-cancel').addEventListener('click', close)
      dlg.querySelector('#sp-form').addEventListener('submit', async (e) => {
        e.preventDefault()
        const status = dlg.querySelector('#sp-status').value
        const saveBtn = dlg.querySelector('#sp-save')
        const err = dlg.querySelector('#sp-error')
        err.textContent = ''
        saveBtn.disabled = true
        try {
          // dirty fields fold into the SAME request — promotion never strands edits
          const payload = { status }
          if (dirty) {
            payload.title = $('spark-title').value.trim() || project.title
            payload.description = $('spark-desc').value
          }
          const res = await fetch('/api/projects/' + id, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
          if (!res.ok) throw new Error('promote failed')
          if (payload.title !== undefined) { project.title = payload.title; $('spark-title').value = payload.title }
          if (payload.description !== undefined) { project.description = payload.description; $('spark-desc').value = payload.description }
          project.status = status
          draftClear()
          markDirty(false)
          window.hibana?.rail?.refresh?.() // the idea leaves the rail's sparks section
          // S119: a PROMOTED spark records as a PROJECT with its new stage
          window.hibanaResume?.record?.('project', id, (project.title || '').trim(), status)
          close()
          window.hibana?.toast(_t('sparks.promoted', 'Promoted — it now lives under Projects'), 'ok', 4000)
          const url = queueLanding('/project.html?id=' + encodeURIComponent(id))
          if (window.hibanaNav) window.hibanaNav.go(url)
          else window.location.assign(url)
        } catch {
          err.textContent = _t('sparks.saveFailed', "Couldn't save — try again")
        } finally {
          saveBtn.disabled = false
        }
      })
      dlg.showModal()
    }

    async function uploadFiles(files) {
      const pics = [...files].filter((f) => f.type && f.type.startsWith('image/'))
      if (!pics.length) return
      const drop = $('spark-drop')
      drop.classList.add('is-busy')
      try {
        for (const f of pics) {
          const main = await window.hibanaImageResize.resizeAndEncode(f, { maxDim: 1600 })
          let thumb = null
          try { thumb = await window.hibanaImageResize.resizeAndEncode(f, { maxDim: 320 }) } catch { thumb = null }
          const res = await fetch('/api/projects/' + id + '/screenshots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataBase64: main.dataBase64, mimeType: main.mimeType, thumbBase64: thumb?.dataBase64, fileName: f.name || 'image', caption: '' }),
          })
          if (!res.ok) throw new Error('upload failed')
        }
        await reload(['gallery'])
        window.hibana?.rail?.refresh?.()
      } catch {
        window.hibana?.toast(_t('spark.uploadFailed', "Couldn't upload the image — try again"), 'err')
      } finally {
        drop.classList.remove('is-busy')
      }
    }

    function openLightbox(shotId) {
      const lb = $('spark-lightbox')
      const shot = (project.screenshots || []).find((s) => s.id === shotId)
      if (!lb || !shot) return
      lb.innerHTML = '<button type="button" class="shot-lightbox-x" data-lb-close aria-label="' + escS(_t('common.close', 'Close')) + '">✕</button>' +
        '<img src="/api/media/screenshots/' + escS(shot.id) + '/file" alt="">'
      lb.hidden = false
    }
    const closeLightbox = () => { const lb = $('spark-lightbox'); if (lb) { lb.hidden = true; lb.innerHTML = '' } }

    // ---- delegated events (htmx swaps + dynamic renders never need re-binding) ----
    ctx.on('click', async (e) => {
      // S193: the review queue's hops — prev/next carry the place through the
      // unreviewed set (delegated: renderQueue re-creates the buttons per render)
      const qPrev = e.target.closest('#spark-queue-prev')
      if (qPrev) {
        if (!qPrev.disabled) { const i = queueIdx(); if (i > 0) queueGo(queue[i - 1].id) }
        return
      }
      const qNext = e.target.closest('#spark-queue-next')
      if (qNext) {
        if (!qNext.disabled) { const i = queueIdx(); if (i >= 0 && i < queue.length - 1) queueGo(queue[i + 1].id) }
        return
      }
      // S171: tag-click-to-search — the tag name jumps to the Ideas shelf with the
      // ?q= deep-link (soft-nav when the shell router is present, honest load otherwise).
      const tagSearch = e.target.closest('[data-tag-search]')
      if (tagSearch) {
        const name = tagSearch.getAttribute('data-tag-search') || ''
        if (name) {
          const url = '/sparks.html?q=' + encodeURIComponent(name)
          if (window.hibanaNav) window.hibanaNav.go(url)
          else window.location.assign(url)
        }
        return
      }
      const tagDel = e.target.closest('[data-tag-del]')
      if (tagDel) {
        tagDel.disabled = true
        try {
          const r = await fetch('/api/projects/' + id + '/tags/' + tagDel.getAttribute('data-tag-del'), { method: 'DELETE' })
          if (!r.ok) throw new Error('tag del failed')
          await reload(['tags'])
        } catch { window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err') }
        return
      }
      const coverBtn = e.target.closest('[data-shot-cover]')
      if (coverBtn) {
        coverBtn.disabled = true
        try {
          const r = await fetch('/api/projects/' + id, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cover_shot_id: coverBtn.getAttribute('data-shot-cover') }),
          })
          if (!r.ok) throw new Error('cover failed')
          await reload(['gallery'])
        } catch { window.hibana?.toast(_t('spark.saveFailed', "Couldn't save — try again"), 'err') }
        return
      }
      const shotDel = e.target.closest('[data-shot-del]')
      if (shotDel) {
        shotDel.disabled = true
        try {
          const r = await fetch('/api/screenshots/' + shotDel.getAttribute('data-shot-del'), { method: 'DELETE' })
          if (!r.ok) throw new Error('shot del failed')
          await reload(['gallery'])
        } catch { window.hibana?.toast(_t('spark.deleteImageFailed', "Couldn't delete the image"), 'err') }
        return
      }
      const zoom = e.target.closest('[data-shot-zoom]')
      if (zoom) { openLightbox(zoom.getAttribute('data-shot-zoom')); return }
      const lbClose = e.target.closest('[data-lb-close]')
      if (lbClose || e.target.id === 'spark-lightbox') { closeLightbox(); return }
    })
    ctx.on('keydown', (e) => {
      if (e.key === 'Escape') closeLightbox()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
    })

    // uploads: picker + drop + paste (spec #7 — the project upload flow, reused)
    $('spark-pick').addEventListener('click', () => $('spark-file').click())
    $('spark-file').addEventListener('change', (e) => { uploadFiles(e.target.files); e.target.value = '' })
    const drop = $('spark-drop')
    ;['dragenter', 'dragover'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.add('is-over') }))
    ;['dragleave', 'drop'].forEach((n) => drop.addEventListener(n, (e) => { e.preventDefault(); drop.classList.remove('is-over') }))
    drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files) })
    ctx.on('paste', (e) => {
      if (e.target.closest('input, textarea')) return // typed paste stays where it is
      const files = [...(e.clipboardData?.files || [])]
      if (files.length) uploadFiles(files)
    })

    // save + dirty
    $('spark-save').addEventListener('click', save)
    for (const fid of ['spark-title', 'spark-desc']) {
      $(fid).addEventListener('input', () => { markDirty(true); draftSave() })
    }
    // the folder select is its own instant PATCH (single-select, no draft semantics)
    $('spark-folder-sel').addEventListener('change', async (e) => {
      const v = e.target.value || null
      try {
        const r = await fetch('/api/projects/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_id: v }),
        })
        if (!r.ok) throw new Error('folder failed')
        project.folder_id = v
        window.hibana?.rail?.refresh?.()
      } catch {
        window.hibana?.toast(_t('sparks.folderFailed', "Couldn't update the folder — try again"), 'err')
        renderFolderSelect()
      }
    })

    // pin + delete
    $('spark-pin').addEventListener('click', async () => {
      const next = !project.pinned_at
      try {
        const r = await fetch('/api/projects/' + id, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned: next }),
        })
        if (!r.ok) throw new Error('pin failed')
        await reload(['pin'])
      } catch { window.hibana?.toast(_t('sparks.saveFailed', "Couldn't save — try again"), 'err') }
    })
    $('spark-delete').addEventListener('click', () => {
      if (!window.confirm(_t('spark.deleteConfirm', 'Delete this idea?'))) return
      dirty = false // S171: the guard must not fire on the deliberate, confirmed delete hop
      draftClear()
      fetch('/api/projects/' + id, { method: 'DELETE' })
        .then((r) => {
          if (!r.ok) throw new Error('delete failed')
          window.hibana?.rail?.refresh?.()
          // S193: queue-aware landing — the next unreviewed idea keeps the review
          // moving; the LAST one closes the loop on the caught-up page
          window.location.assign(queueLanding('/sparks.html'))
        })
        .catch(() => window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err'))
    })

    // S193: the promote action — where the idea is actually read
    $('spark-promote').addEventListener('click', openPromote)

    // links (htmx, reused from the project template — same #links target contract)
    const linksUl = $('links')
    linksUl.setAttribute('hx-get', '/api/projects/' + id + '/links')
    linksUl.setAttribute('hx-trigger', 'load')
    const linkForm = $('spark-link-form')
    linkForm.setAttribute('hx-post', '/api/projects/' + id + '/links')
    linkForm.setAttribute('hx-target', '#links')
    linkForm.setAttribute('hx-swap', 'innerHTML')
    // S105: every mutation counts as "actively interacted" — the resume strip follows
    ctx.on('htmx:afterRequest', (e) => {
      const xhr = e.detail?.xhr
      if (!xhr || xhr.status >= 300) return
      const method = (e.detail?.requestConfig?.method || 'GET').toUpperCase()
      if (method === 'GET' || method === 'HEAD') return
      if (!/\/api\/(projects|links|screenshots)\//.test(String(e.detail?.requestConfig?.url || ''))) return
      window.hibanaResume?.record?.('spark', id, $('spark-title').value.trim() || project.title, 'spark')
    })

    // S166 lesson (baked-EN race): a FA hard-load where htmx beats the dict leaves
    // server-agnostic labels EN forever — repaint the dynamic chrome on hibana:i18n.
    // The title re-stamp rides the same event: i18n.js's async apply() can settle
    // AFTER this page's fetch set the idea's name (the me-fetch race) — the event
    // fires last, so the idea's OWN name wins the tab (the S64 doctrine: the item's
    // name, not the generic page label).
    ctx.on('hibana:i18n', () => {
      // S169b (live QA catch): i18n's async apply() can settle BEFORE the idea fetch
      // resolves (or after not-found) — project is still null and the unguarded
      // renderPin threw "Cannot read properties of null (reading 'pinned_at')" as a
      // LIVE console error. The repaint is only for a LOADED idea.
      if (project) { renderPin(); renderTags(); renderFolderSelect(); renderMeta() }
      renderQueue() // S193: the queue bar repaints with FA digits + FA labels
      if (!dirty && !saving) $('spark-status').textContent = ''
      if (project) document.title = (project.title || 'Idea') + ' — Hibana'
    })

    // ---- boot --------------------------------------------------------------------
    ;(async () => {
      try {
        const [pRes, fRes] = await Promise.all([
          fetch('/api/projects/' + id, { cache: 'no-store' }),
          fetch('/api/projects/sparks/folders', { cache: 'no-store' }),
        ])
        if (pRes.status === 404) { showNotFound(); return }
        if (!pRes.ok) throw new Error('load failed')
        const body = await pRes.json()
        project = body.project
        // spec #6 guard: only SPARKS live here — a project row hands off to the heavy page
        if (project.status && project.status !== 'spark') {
          window.location.replace('/project.html?id=' + encodeURIComponent(id))
          return
        }
        if (fRes.ok) folders = (await fRes.json()).folders || []
        document.title = (project.title || 'Idea') + ' — Hibana'
        $('spark-title').value = project.title ?? ''
        $('spark-desc').value = project.description ?? ''
        renderTags()
        renderFolderSelect()
        renderGallery()
        renderPin()
        renderMeta()
        draftRestore()
        if (window.htmx) { window.htmx.process(linksUl); window.htmx.process(linkForm) }
        loading.hidden = true
        detail.hidden = false
        // S193: the review queue — fetched only for an idea OLD enough to be in the
        // unreviewed set (>7d, the notifications' exact boundary); the bar renders
        // only when THIS idea is in the set AND siblings exist. Transient failures
        // leave the page standing without the bar (the review still works — the
        // notifications rows remain the map).
        if (project.created_at && new Date(project.created_at).getTime() < Date.now() - 7 * 24 * 3600 * 1000) {
          fetch('/api/notifications', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('queue failed'))))
            .then((body) => {
              const set = (body.notifications || [])
                .filter((n) => n.kind === 'unreviewed-spark')
                .map((n) => ({ id: String(n.id).replace(/^spark-/, ''), title: String(n.detail || ''), date: String(n.date || '') }))
                .sort((a, b) => a.date.localeCompare(b.date))
              if (set.some((q) => q.id === id)) queue = set
              renderQueue()
            })
            .catch(() => { /* transient — no bar, no error */ })
        }
      } catch {
        showNotFound()
      }
    })()

    return () => {
      // teardown: the draft survives (that's its point) — nothing else leaks
      closeLightbox()
      window.removeEventListener('beforeunload', beforeUnload) // S171: the guard dies with the page
    }
  },
})
