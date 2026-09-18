// S71: hibanaResume — the app's job #2 ("never lose your place"), surfaced.
// Records the last OPENED projects + vault notes into localStorage (hibana-resume,
// newest-first, max 8) and renders a "Pick up where you left off" strip at the top of
// the dashboard — instantly, from localStorage, before/without the htmx dashboard API.
// Recording happens in project-page.js (htmx afterSwap) + notes-page.js (openNote).
// The strip lives OUTSIDE main.shell-dash (never wiped by htmx refreshes), renders only
// when something exists, and navigates via hibanaNav soft-nav when available.
(() => {
  const KEY = 'hibana-resume'
  const MAX_STORE = 8
  const MAX_RENDER = 4
  const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
  const isFA = () => window.hibanaI18n?.lang?.() === 'fa' || document.documentElement.lang === 'fa'
  const faNum = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])

  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]')
      return Array.isArray(v) ? v.filter((e) => e && e.k && e.id) : []
    } catch { return [] }
  }
  const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STORE))) } catch { /* storage unavailable */ } }

  /** record('project'|'note', id, title) — idempotent (re-opening moves it to the top). */
  const record = (k, id, title) => {
    if (!id) return
    const list = read().filter((e) => !(e.k === k && e.id === id))
    list.unshift({ k, id, t: String(title || '').trim().slice(0, 80) || '—', ts: Date.now() })
    write(list)
  }

  const timeAgo = (ts) => {
    const fa = isFA()
    const n = (v) => (fa ? faNum(String(v)) : String(v))
    const m = Math.max(0, Math.floor((Date.now() - ts) / 60000))
    if (m < 1) return fa ? 'همین حالا' : 'just now'
    if (m < 60) return fa ? n(m) + ' دقیقه پیش' : m + 'm ago'
    const h = Math.floor(m / 60)
    if (h < 24) return fa ? n(h) + ' ساعت پیش' : h + 'h ago'
    const d = Math.floor(h / 24)
    if (d < 31) return fa ? n(d) + ' روز پیش' : d + 'd ago'
    try { return new Date(ts).toLocaleDateString(fa ? 'fa-IR' : undefined) } catch { return '' }
  }

  const ICONS = {
    project: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h9l5 5v9a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19V6.5A1.5 1.5 0 0 1 5.5 5Z"/><path d="M8 12h8M8 15.5h5"/></svg>',
  }
  const urlFor = (e) => (e.k === 'project' ? '/project.html?id=' + encodeURIComponent(e.id) : '/notes.html#n=' + encodeURIComponent(e.id))
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

  const render = () => {
    const main = document.querySelector('main.shell-dash')
    if (!main) return // only the dashboard renders the strip
    const entries = read().slice(0, MAX_RENDER)
    let strip = document.getElementById('resume-strip')
    if (!entries.length) { if (strip) strip.remove(); return }
    // S72 BUGFIX: the header/hint previously carried data-i18n + hardcoded EN text — but
    // i18n.js apply() sweeps the STATIC DOM only (its own header note), so dynamically
    // injected markup never got translated. Like the chips, translate at render time.
    const headText = () => _t('resume.title', 'Pick up where you left off')
    const hintText = () => _t('resume.hint', 'Recently opened')
    const clearLabel = () => _t('resume.clear', 'Clear')
    const clearAria = () => _t('resume.clearAria', 'Clear the resume history')
    const chips = entries.map((e) => {
      const kind = e.k === 'project' ? _t('resume.project', 'Project') : _t('resume.note', 'Note')
      const label = _t('resume.openAria', 'Open {k}: {t}').split('{k}').join(kind).split('{t}').join(e.t || '')
      return `<a class="resume-chip" href="${urlFor(e)}" data-resume-go="${urlFor(e)}" aria-label="${esc(label)}" title="${esc(e.t || '')}">
        <span class="resume-chip-ico ${e.k === 'project' ? 'is-project' : 'is-note'}">${ICONS[e.k] || ICONS.note}</span>
        <span class="resume-chip-body">
          <span class="resume-chip-title" dir="auto">${esc(e.t || '—')}</span>
          <span class="resume-chip-meta">${esc(kind)} · ${esc(timeAgo(e.ts))}</span>
        </span>
      </a>`
    }).join('')
    if (strip) {
      strip.querySelector('.resume-row').innerHTML = chips
      // Re-render path (i18n race / re-open): refresh the header too, not just the chips.
      const h = strip.querySelector('#resume-title'); if (h) h.textContent = headText()
      const hint = strip.querySelector('.resume-hint'); if (hint) hint.textContent = hintText()
      const clear = strip.querySelector('[data-resume-clear]')
      if (clear) {
        clear.setAttribute('aria-label', clearAria()); clear.title = clearAria()
        const lbl = clear.querySelector('.resume-clear-label'); if (lbl) lbl.textContent = clearLabel()
      }
      return
    }
    strip = document.createElement('section')
    strip.id = 'resume-strip'
    strip.className = 'resume-strip card'
    strip.setAttribute('aria-labelledby', 'resume-title')
    strip.innerHTML = `
      <header class="resume-head">
        <h2 id="resume-title">${esc(headText())}</h2>
        <span class="resume-hint muted">${esc(hintText())}</span>
        <button type="button" class="resume-clear" data-resume-clear aria-label="${esc(clearAria())}" title="${esc(clearAria())}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14Z"/></svg>
          <span class="resume-clear-label">${esc(clearLabel())}</span>
        </button>
      </header>
      <div class="resume-row">${chips}</div>`
    // INSIDE <main>: soft-nav replaces the shell element wholesale (nav.js
    // shell.replaceWith) — so the strip dies with the dashboard and can never leak
    // onto another page. After the sr-only h1 (a11y: heading stays main's first child).
    const h1 = main.querySelector('h1.sr-only')
    if (h1 && h1.nextSibling) main.insertBefore(strip, h1.nextSibling)
    else main.insertBefore(strip, main.firstChild)
    // Soft-nav when the SPA router is present; plain navigation otherwise (palette pattern).
    strip.addEventListener('click', (e) => {
      // S72: clear-history button — wipes the localStorage record and removes the strip.
      // Low-stakes by design (history rebuilds itself as you open things) → no confirm.
      const clearBtn = e.target.closest('[data-resume-clear]')
      if (clearBtn) {
        try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
        strip.remove()
        return
      }
      const a = e.target.closest('a[data-resume-go]')
      if (!a) return
      const href = a.getAttribute('href') || ''
      if (!href || href.startsWith('http') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      if (window.hibanaNav && !href.includes('#')) window.hibanaNav.go(href)
      else window.location.href = href
    })
  }

  // S72: mark horizontal scrollers (.is-scrollable) for the CSS scroll-edge fades
  // (polish-ui.css). A scroll-driven animation on a NON-overflowing row would sit at
  // 0% progress = permanent left fade — so the class is only set when the row really
  // overflows. Covers the stale-chips row too (same page, same swap). Re-runs after
  // every render (fonts/labels land late and change widths) + on resize.
  const markScrollables = () => {
    document.querySelectorAll('.resume-row, .dash-stale-chips').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('is-scrollable')
      else el.classList.remove('is-scrollable')
    })
  }
  window.addEventListener('resize', markScrollables, { passive: true })

  window.hibanaResume = { record, read }

  if (document.querySelector('main.shell-dash')) {
    // Render after the dashboard's htmx swap (hx-get on <main> itself replaces the
    // skeleton — an immediate render would live one frame before that swap wipes it).
    document.addEventListener('htmx:afterSwap', (e) => {
      if (e.target?.matches?.('main.shell-dash')) setTimeout(() => { render(); markScrollables() }, 0)
    })
    // Hard-load onto an already-swapped dashboard (e.g. browser back): no afterSwap fires.
    if (!document.querySelector('#dash-skeleton')) setTimeout(() => { render(); markScrollables() }, 60)
    // i18n races the htmx swap: the first render may land before the FA dictionary
    // finished loading (labels fall back to EN, timeAgo already knows lang from <html>).
    // hibana:i18n fires on every apply() — re-render then; render() is idempotent.
    document.addEventListener('hibana:i18n', () => { render(); markScrollables() })
    // Late font/label settles (FA dict, webfonts) shift chip widths after the first
    // mark — one more pass once the page is fully quiet.
    window.addEventListener('load', () => setTimeout(markScrollables, 400))
  }
})()
