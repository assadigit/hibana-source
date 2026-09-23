// S85 (owner redesign instruction #1): hibanaResume — "Continue where you left off".
//
// THE MERGE: this used to be TWO components showing the same project with two
// different timestamps — the server's "Resume work" card (project.updated_at =
// last EDITED, doing-status only) and this strip's "Pick up where you left off"
// (open-time, projects + notes) — with no explanation of the difference
// (Recognition Rather Than Recall, Nielsen #6). The server card is deleted
// (dashboard.ts); this component is the ONE surface.
//
// THE ONE DEFINITION (S105, owner re-defined it): "last touched" = last ACTIVELY
// INTERACTED WITH — updating something (a save, an add, a move, a drag, an upload).
// A mere VIEW no longer records anything (the owner: "the items must be items the
// user actively interacted with — a view is not enough to appear in this list").
// It covers projects AND notes uniformly, and paints instantly from localStorage
// before/without the htmx dashboard API. The header hint labels the definition
// explicitly ("Last edited") so the timestamp is self-explanatory.
//
// Structure: header (title + "Last edited" hint + Clear) → HERO entry (the newest —
// glyph, kind · stage · timeAgo, title, explicit Open CTA; inherits the old banner's
// affordances from the ONE store) → up to 3 smaller chips for the rest of the history.
// Records last-EDITED projects + vault notes into localStorage (hibana-resume,
// newest-first, max 8). Recording happens at MUTATION SUCCESS points: project-page.js
// (resumeTouch + the htmx afterRequest hook — task saves/adds/deletes/drags, note
// saves, uploads, doc saves; passes the project's stage slug as the hero badge) +
// notes-page.js (doSave/newNote/moveNote).
// The strip lives INSIDE main.shell-dash (dies with the dashboard on soft-nav,
// never leaks to another page), renders only when something exists, and navigates
// via hibanaNav soft-nav when available.
(() => {
  const KEY = 'hibana-resume'
  const MAX_STORE = 8
  const MAX_RENDER = 4 // hero + 3 chips
  const _t = (k, f) => { const s = window.hibanaI18n?.t(k); return s && s !== k ? s : f }
  const isFA = () => window.hibanaI18n?.lang?.() === 'fa' || document.documentElement.lang === 'fa'
  const faNum = (s) => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
  // S85: the fixed status roles (client dictionary status.* keys — the SAME
  // fixed pastel palette the server badges/stat-boxes use, see themes.css tokens).
  // 0060: the renamed five stages + spark (compass = planning, hourglass = queued).
  const STAGES = ['spark', 'planning', 'queued', 'developing', 'awaiting_dev', 'operational']
  const STAGE_ICONS = {
    spark: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>',
    planning: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-1.9 5.1-5.1 1.9 1.9-5.1z"/>',
    queued: '<path d="M7 3.5h10M7 20.5h10M8 3.5v2.6c0 1.9 1.6 3.1 4 5.9 2.4-2.8 4-4 4-5.9V3.5M8 20.5v-2.6c0-1.9 1.6-3.1 4-5.9 2.4 2.8 4 4 4 5.9v2.6"/>',
    developing: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none"/>',
    awaiting_dev: '<path d="M9 5.5v13M15 5.5v13"/>',
    operational: '<path d="M4.5 16.5c1.2 2.8 4 4.5 7.5 4.5 4.5 0 7.7-2.6 7.7-6.4 0-4.5-4-5.6-6.9-6.5C10.4 7.3 9 6.2 9 4.3c0-.5.1-1 .3-1.5-3 1.2-5 3.6-5 6.4 0 1.7.7 3.1 1.9 4.1"/>',
  }

  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '[]')
      // S118: legacy entries stored the '—' placeholder for untitled notes — normalize
      // to empty so the render layer speaks the CURRENT language's Untitled label.
      return (Array.isArray(v) ? v : [])
        .filter((e) => e && e.k && e.id)
        .map((e) => (e.t === '—' ? { ...e, t: '' } : e))
    } catch { return [] }
  }
  const write = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_STORE))) } catch { /* storage unavailable */ } }

  /** record('project'|'note', id, title, badge?) — idempotent (re-opening moves it
   *  to the top). `badge` is the project's stage slug at open time — rendered on the
   *  hero as the fixed-palette status chip (S85). Old 3-arg call sites keep working.
   *  S118: an UNTITLED note records an empty title (never the '—' placeholder — the
   *  render layer speaks the localized Untitled label at VIEW time, so a language
   *  switch re-labels honestly instead of freezing the recording language). */
  const record = (k, id, title, badge) => {
    if (!id) return
    const list = read().filter((e) => !(e.k === k && e.id === id))
    const stage = STAGES.includes(badge) ? badge : undefined
    const prev = read().find((e) => e.k === k && e.id === id)
    list.unshift({ k, id, t: String(title || '').trim().slice(0, 80), ts: Date.now(), b: stage ?? prev?.b })
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

  // The hero's stage badge: fixed-palette chip (badge-{stage} tokens — the same roles
  // the activity badges and stat-box pills speak). Projects only; notes get none.
  const stageBadge = (e) => {
    if (e.k !== 'project' || !STAGES.includes(e.b)) return ''
    const label = _t('status.' + e.b, e.b)
    return `<span class="resume-stage-badge badge-${e.b}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STAGE_ICONS[e.b]}</svg>${esc(label)}</span>`
  }

  const render = () => {
    const main = document.querySelector('main.shell-dash')
    if (!main) return // only the dashboard renders the strip
    const entries = read().slice(0, MAX_RENDER)
    let strip = document.getElementById('resume-strip')
    if (!entries.length) { if (strip) strip.remove(); return }
    const [hero, ...rest] = entries
    // S72 BUGFIX lineage: translate at render time (i18n.js apply() sweeps the STATIC
    // DOM only — dynamically injected markup never got translated).
    const headText = () => _t('resume.title', 'Continue where you left off')
    const hintText = () => _t('resume.hint', 'Last edited')
    const clearLabel = () => _t('resume.clear', 'Clear')
    const clearAria = () => _t('resume.clearAria', 'Clear the resume history')
    const ctaText = () => _t('resume.cta', 'Open')
    const kindOf = (e) => (e.k === 'project' ? _t('resume.project', 'Project') : _t('resume.note', 'Note'))
    // S118 (S117 candidate 5): an untitled note rendered as a bare '—' — every other
    // surface (the vault cards, the command palette) speaks a localized Untitled label.
    // Reuse the EXISTING keys (no new parity surface): notes → cmdk.untitledNote,
    // projects (nameless can't really happen — name is required at creation) → sp.untitled.
    const titleOf = (e) => e.t || (e.k === 'note' ? _t('cmdk.untitledNote', 'Untitled note') : _t('sp.untitled', 'Untitled'))
    const heroLabel = () => _t('resume.openAria', 'Open {k}: {t}')
    const chips = rest.map((e) => {
      const label = heroLabel().split('{k}').join(kindOf(e)).split('{t}').join(titleOf(e))
      return `<a class="resume-chip" href="${urlFor(e)}" data-resume-go="${urlFor(e)}" aria-label="${esc(label)}" title="${esc(titleOf(e))}">
        <span class="resume-chip-ico ${e.k === 'project' ? 'is-project' : 'is-note'}">${ICONS[e.k] || ICONS.note}</span>
        <span class="resume-chip-body">
          <span class="resume-chip-title" dir="auto">${esc(titleOf(e))}</span>
          <span class="resume-chip-meta">${esc(kindOf(e))} · ${esc(timeAgo(e.ts))}</span>
        </span>
      </a>`
    }).join('')
    // The hero: newest entry, banner-grade treatment — glyph + kind·stage·timeAgo +
    // title + explicit Open CTA (all sourced from the ONE shared last-opened store).
    const heroAria = heroLabel().split('{k}').join(kindOf(hero)).split('{t}').join(titleOf(hero))
    const heroHtml = (mount) => {
      const h = mount.querySelector('.resume-hero')
      const next = `<a class="resume-hero" href="${urlFor(hero)}" data-resume-go="${urlFor(hero)}" aria-label="${esc(heroAria)}">
        <span class="resume-chip-ico ${hero.k === 'project' ? 'is-project' : 'is-note'}">${ICONS[hero.k] || ICONS.note}</span>
        <span class="resume-hero-body">
          <span class="resume-hero-kicker">${esc(kindOf(hero))}${stageBadge(hero) ? ' ' + stageBadge(hero) + ' ' : ' · '}<span class="resume-hero-time">${esc(timeAgo(hero.ts))}</span></span>
          <span class="resume-hero-title" dir="auto">${esc(titleOf(hero))}</span>
        </span>
        <span class="btn resume-hero-cta">${esc(ctaText())}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="icon arrow" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
      </a>`
      if (h) { h.outerHTML = next; return }
      mount.insertAdjacentHTML('afterbegin', next)
    }
    if (strip) {
      // Idempotent re-render (i18n settle / re-open / htmx swap): refresh the hero
      // and the chips row in place. The row may legitimately be ABSENT (the previous
      // render had a single entry → hero only) — create it when chips now exist.
      const existingRow = strip.querySelector('.resume-row')
      if (existingRow) { if (chips) existingRow.innerHTML = chips; else existingRow.remove() }
      else if (chips) strip.insertAdjacentHTML('beforeend', `<div class="resume-row">${chips}</div>`)
      heroHtml(strip.querySelector('.resume-body') || strip)
      // Re-render path (i18n race / re-open): refresh the header too, not just the body.
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
      <div class="resume-body"></div>
      ${chips ? `<div class="resume-row">${chips}</div>` : ''}`
    heroHtml(strip.querySelector('.resume-body'))
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
