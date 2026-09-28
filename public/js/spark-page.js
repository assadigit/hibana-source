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

    function renderTags() {
      const host = $('spark-tags')
      const tags = (project.tags || []).slice().sort((a, b) => a.name.localeCompare(b.name))
      host.innerHTML =
        tags.map((tg) =>
          '<span class="chip pd-tag-chip spark-tag" dir="auto">' + escS(tg.name) +
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
      btn.title = on ? _t('sparks.unpin', 'Unpin idea') : _t('sparks.pin', 'Pin idea')
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
      } catch { /* transient — the current render stands */ }
    }

    async function save() {
      if (saving) return
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
        draftClear()
        markDirty(false)
        status.textContent = _t('spark.saved', '✓ Saved')
        window.hibanaResume?.record?.('spark', id, project.title, 'spark')
        window.hibana?.rail?.refresh?.()
        setTimeout(() => { if (status.textContent === _t('spark.saved', '✓ Saved')) status.textContent = '' }, 2500)
      } catch {
        status.textContent = ''
        window.hibana?.toast(_t('spark.saveFailed', "Couldn't save — try again"), 'err')
      } finally {
        saving = false
        btn.disabled = false
      }
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
      draftClear()
      fetch('/api/projects/' + id, { method: 'DELETE' })
        .then((r) => {
          if (!r.ok) throw new Error('delete failed')
          window.hibana?.rail?.refresh?.()
          window.location.assign('/sparks.html')
        })
        .catch(() => window.hibana?.toast(_t('sparks.deleteFailed', "Couldn't delete the idea"), 'err'))
    })

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
      if (project) { renderPin(); renderTags(); renderFolderSelect() }
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
        draftRestore()
        if (window.htmx) { window.htmx.process(linksUl); window.htmx.process(linkForm) }
        loading.hidden = true
        detail.hidden = false
      } catch {
        showNotFound()
      }
    })()

    return () => {
      // teardown: the draft survives (that's its point) — nothing else leaks
      closeLightbox()
    }
  },
})
