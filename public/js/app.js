// Hibana frontend helpers — vanilla + htmx + Alpine (no build step, per the stack decision).

// S48i (owner: "a loading animation between pages and navigations — sometimes it takes
// some time for a page to open up"): the full-page overlay (#hibana-page-loader) is
// painted in every page's HTML (before JS loads) so it's visible immediately during
// initial load + hard navigation. Hide it once the page is ready. Also wire the top
// progress bar (#hibana-nav-loader, normally driven by nav.js for soft navigation) to
// htmx content swaps so the project page's content-load delay has feedback too.
(function () {
  // Hide the full-page overlay on DOMContentLoaded (or immediately if already loaded).
  // S84 (owner: "notes.html still appears pre-emptively and unloaded — elements are
  // not looking proper"): DOMContentLoaded only proves the scripts PARSED. On pages
  // that render their content from post-DCL API data (the vault), lifting the veil
  // at DCL shows a skeleton page for seconds — and the old 8s safety could even
  // lift it over a half-booted page when a script stalled. Pages that own their
  // data now declare <html data-hibana-reveal="gated"> and reveal themselves via
  // the hibana:page-ready event (or the data-hibana-ready attribute) once their
  // first REAL paint happened — real cards, or the honest load-failed Retry panel.
  // The veil still never traps: a 12s safety (aligned with the inline watchdog's
  // 12s reload rhythm) and base.css's pure-CSS 20s escape (for the dead-JS case)
  // both backstop the gate. Non-gated pages keep today's DCL behavior untouched.
  var pageLoader = document.getElementById('hibana-page-loader')
  if (pageLoader) {
    var hideOverlay = function () { if (!pageLoader.classList.contains('is-hidden')) pageLoader.classList.add('is-hidden') }
    if (document.documentElement.getAttribute('data-hibana-reveal') === 'gated') {
      // Gated page: reveal on the page controller's signal, not the DOM's.
      if (document.documentElement.hasAttribute('data-hibana-ready')) hideOverlay()
      else {
        window.addEventListener('hibana:page-ready', hideOverlay, { once: true })
        // Never trap: after 12s the veil lifts no matter what (the inline watchdog
        // reloads an un-booted page at 12s; a booted-but-slow fetch beats an
        // eternal veil — whatever state the page reached is worth seeing by then).
        setTimeout(hideOverlay, 12000)
      }
    } else {
      if (document.readyState !== 'loading') hideOverlay()
      else document.addEventListener('DOMContentLoaded', hideOverlay, { once: true })
      window.addEventListener('load', hideOverlay, { once: true }) // fallback: all assets loaded
      // Safety: never let the overlay trap the user — hide after 8s no matter what
      setTimeout(hideOverlay, 8000)
    }
  }
  // Top progress bar for htmx content swaps (the project page's hx-get, etc.)
  var navBar = null
  var navBarTimer = null
  var showBar = function () {
    if (!navBar) navBar = document.getElementById('hibana-nav-loader')
    if (!navBar) return
    clearTimeout(navBarTimer)
    navBar.className = 'is-loading'
    void navBar.offsetWidth // reflow → restart animation
  }
  var hideBar = function () {
    if (!navBar) navBar = document.getElementById('hibana-nav-loader')
    if (!navBar) return
    navBar.className = 'is-done'
    clearTimeout(navBarTimer)
    navBarTimer = setTimeout(function () { if (navBar) navBar.className = '' }, 400)
  }
  // htmx fires these on the document for every AJAX request (content swaps)
  document.addEventListener('htmx:beforeRequest', showBar)
  document.addEventListener('htmx:afterRequest', hideBar)
  document.addEventListener('htmx:afterSwap', hideBar)
  document.addEventListener('htmx:responseError', hideBar)
})()

// Apply the saved theme site-wide before paint (Settings → Theme store it in localStorage).
// S87: the app has exactly two looks — light and claude-dark (THE dark mode; the old
// `dark` theme was retired). A legacy stored 'dark' migrates to 'claude-dark' on sight;
// 'system' (or nothing) resolves through the OS scheme — dark → claude-dark. So
// data-theme is ALWAYS an explicit 'light' | 'claude-dark' by first paint (boot.js does
// the same synchronously in <head> for the pages that load it; this covers the rest).
try {
  let savedTheme = localStorage.getItem('hibana-theme')
  if (savedTheme === 'dark') {
    savedTheme = 'claude-dark'
    try { localStorage.setItem('hibana-theme', 'claude-dark') } catch {}
  }
  if (savedTheme !== 'light' && savedTheme !== 'claude-dark') {
    savedTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light'
  }
  document.documentElement.dataset.theme = savedTheme
} catch {}

// a11y (S51-A): skip-to-content link — reintroduced the standard way. Session 21 removed
// the old one because the focused pill sat at the top and COVERED the header avatar in
// RTL. This implementation cannot: it parks bottom-center (never near the avatar/brand),
// fully invisible until keyboard-focused, and hides again on blur. Injected from ONE
// place (here) so every page that loads app.js gets it — no per-page markup to drift.
// Target precedence: a rendered <main> (the .landmark-ghost display:contents wrappers on
// canvas/notebook can't take focus), then the board wrappers. Auth pages have their own
// <main class="auth-split"> and get the link too (consistent first Tab stop everywhere).
// S69 (perf §10-F1): on-demand loader for the shared image-resize helper (canvas
// downscale + WebP). The helper is page-specific (~4KB); app.js runs on every page, so
// instead of shipping it everywhere it is injected the FIRST time a quick-add sketch
// actually needs resizing (screenshots get bounded to ≤1600px + a gallery tile — the
// perf §10-F1 fix). Resolves false when the script can't load — callers keep the raw
// upload path. Idempotent: one <script> tag per document, ever.
let __imgResizeLoader = null
function ensureImageResize() {
  if (window.hibanaImageResize) return Promise.resolve(window.hibanaImageResize)
  if (__imgResizeLoader) return __imgResizeLoader
  __imgResizeLoader = new Promise((resolve) => {
    const s = document.createElement('script')
    s.src = '/js/image-resize.js?v=1'
    s.onload = () => resolve(window.hibanaImageResize || null)
    s.onerror = () => resolve(null)
    document.head.appendChild(s)
  })
  return __imgResizeLoader
}
;(() => {
  try {
    const target = document.querySelector('main:not(.landmark-ghost), .sadhana-wrap, .shell, #canvas-wrap, #nb-page')
    if (!target || target.closest('[aria-hidden="true"]')) return
    if (!target.id) target.id = 'hibana-skip-target'
    // tabindex=-1 lets the anchor navigation MOVE FOCUS to the landmark (not just scroll)
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    const skip = document.createElement('a')
    skip.href = '#' + target.id
    skip.className = 'skip-link'
    skip.setAttribute('data-i18n', 'a11y.skipToMain') // localized by i18n.js apply()
    skip.textContent = 'Skip to content'
    // Browsers (Chromium included) reset DOM focus to <body> when an anchor's DEFAULT
    // fragment-navigation action completes — any focus() issued during the click is
    // blurred ~10ms later (verified: focusin MAIN → focusout MAIN relatedTarget=null;
    // a plain programmatic location.hash assignment does NOT do this). So the skip
    // link manages the whole thing: preventDefault, focus the landmark directly, and
    // mirror the hash via pushState (URL semantics + back button, zero navigation).
    skip.addEventListener('click', (e) => {
      e.preventDefault()
      target.focus()
      try { if (location.hash !== '#' + target.id) history.pushState(null, '', '#' + target.id) } catch {}
    })
    document.body.insertBefore(skip, document.body.firstChild)
  } catch { /* progressive enhancement — never block boot */ }
})()

// Ensure the shared offline queue (window.hibanaQueue) is always loaded — it lives in
// js/queue.js and powers the quick-add + canvas sync. Guard against pages that forgot the tag.
if (!window.hibanaQueue) {
  const qs = document.createElement('script')
  qs.src = '/js/queue.js?v=1' // F7 (session 9): versioned like the HTML refs — cache-bust discipline
  document.head.appendChild(qs)
}

// S75 (§10-F4 tail): ONE /api/auth/me per page load. Four independent consumers fired
// the same unauthenticated-identical GET on every authenticated page (i18n apply at
// DOMContentLoaded, hib-init's re-apply after the nav mount, hib-init's nav user info,
// and the auth guard) — a 4-request shotgun measured live on all key pages. This helper
// memoizes the response for the page lifetime (hard loads only; soft navs keep the
// same document, so the memo rides on). force=true refetches — the language toggle
// PATCHes the user's language_pref and the follow-up apply() must see the NEW value.
// Envelope shape { ok, status, body } — the auth guard needs raw status semantics
// (401 vs 503-offline), the other consumers just read body. A network-level failure
// releases the memo so a later consumer retries (the old code did that per-call).
window.__hibanaMe = (force) => {
  if (force) window.__hibanaMeP = null
  if (window.__hibanaMeP) return window.__hibanaMeP
  window.__hibanaMeP = fetch('/api/auth/me')
    .then(async (r) => {
      let body = null
      try { body = await r.json() } catch { /* non-JSON (204/5xx html) — body stays null */ }
      return { ok: r.ok, status: r.status, body }
    })
    .catch(() => {
      window.__hibanaMeP = null // offline / SW-fabricated failure — let the next caller retry
      return null
    })
  return window.__hibanaMeP
}

window.hibana = (() => {
  window.__hib = {}  // Phase 3: shared namespace for split files
  // Persistent theme control — a deterministic light/dark toggle in the header.
  // S87 (owner request 2026-09-20): the app ships exactly TWO looks — light and
  // claude-dark (THE dark mode; the old `dark` theme + OS auto-dark fallback were
  // retired). The header button flips between the two. 'system' is still stored when
  // chosen in Settings and resolved to whichever the OS prefers (dark → claude-dark),
  // live via the matchMedia listener below (parity with the retired CSS media query).
  const SUN = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
  const MOON = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>'
  // A legacy stored 'dark' (pre-S87) reads as 'claude-dark' — returning dark-mode users
  // land on the surviving dark mode, never a dead value.
  function currentTheme() {
    const saved = localStorage.getItem('hibana-theme') || 'system'
    if (saved === 'light') return 'light'
    if (saved === 'claude-dark' || saved === 'dark') return 'claude-dark'
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light'
  }
  function setTheme(t) {
    // Normalize: 'dark' (legacy) → 'claude-dark'; anything else non-dark → 'light'.
    // 'system' keeps the stored preference but applies the resolved look.
    const resolved = t === 'claude-dark' || t === 'dark' ? 'claude-dark' : t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'claude-dark' : 'light') : 'light'
    document.documentElement.dataset.theme = resolved
    try {
      localStorage.setItem('hibana-theme', t === 'system' ? 'system' : resolved)
    } catch {}
    // P4.4 (F-M15): update the mobile address-bar color to match the theme. Light
    // mode bg is #FAF9F6; claude-dark's base is #141413 (S86).
    const barColor = resolved === 'claude-dark' ? '#141413' : '#FAF9F6'
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', barColor)
  }
  function paintThemeButton() {
    const cur = currentTheme()
    document.querySelectorAll('[data-theme-toggle], .theme-floater').forEach((b) => {
      // S93 (owner round, item 7 — "remove tooltip from darkmode/light mode button"):
      // no hover tooltip anymore — the rail's own «Theme» label (or the icon itself on
      // the floater) says what it does. The static data-tooltip/title left the partial
      // with v163; this KILLS the runtime title the old code re-added on every paint.
      b.removeAttribute('title')
      b.removeAttribute('data-tooltip')
      const svg = cur === 'claude-dark' ? MOON : SUN
      // S93 fix (found in QA): the naive innerHTML swap WIPED the S89 rail label —
      // the button painted its icon but silently lost «Theme». Swap ONLY the icon
      // when a .rail-label rides along; labelless surfaces keep the full swap.
      const label = b.querySelector('.rail-label')
      if (label) {
        const old = b.querySelector('.icon')
        if (old) old.outerHTML = svg
        else b.insertAdjacentHTML('afterbegin', svg)
      } else {
        b.innerHTML = svg
      }
    })
  }
  function toggleTheme() {
    const next = currentTheme() === 'light' ? 'claude-dark' : 'light'
    setTheme(next)
    paintThemeButton()
    return next
  }
  // S87: 'system' users follow the OS live — flipping the OS scheme mid-session
  // re-resolves the page (parity with the retired CSS media-query behaviour).
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if ((localStorage.getItem('hibana-theme') || 'system') === 'system') {
        setTheme('system')
        paintThemeButton()
      }
    })
  } catch { /* older browsers without matchMedia listeners resolve per-load instead */ }
  // One toast component for all errors and confirmations (spec §7).
  // Phase B2.4: action-button support + persistent errors by default.
  //   toast('Saved', 'info')              → 4s, auto-dismiss
  //   toast('Failed', 'err')              → persistent (stays until dismissed)
  //   toast('Deleted', 'info', 6000, [{label:'Undo', onClick:undoFn}]) → 6s + Undo button
  // H2 fix (2026-09-10): the message string is set via innerHTML (to support <a> links),
  // so ALL server-rendered fields interpolated into it MUST be escaped via esc() first.
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
  }
  function toast(message, kind = 'info', ms, actions = null) {
    if (ms === undefined) ms = kind === 'err' ? 0 : 4000 // errors persist by default
    const old = document.getElementById('toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.id = 'toast'
    el.className = `toast ${kind}`
    el.setAttribute('role', 'status')
    // S105 (owner: "success messages such as 'task is saved' show like 'Saved [x]' —
    // they must show 'Saved [✓]' and the modal must be pastel green with a small [x]
    // in the top-right corner"): the SUCCESS ('ok') variant carries a leading check
    // glyph next to the message, pastel-green styling (components.css), and its
    // dismiss × anchored to the TOP-RIGHT CORNER (the UX convention). Other kinds
    // keep the classic inline-row layout.
    if (kind === 'ok') {
      const row = document.createElement('div')
      row.className = 'toast-msg-row'
      const check = document.createElement('span')
      check.className = 'toast-check'
      check.setAttribute('aria-hidden', 'true')
      check.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 7"/></svg>'
      row.appendChild(check)
      const msg = document.createElement('span')
      msg.className = 'toast-msg'
      msg.innerHTML = message
      row.appendChild(msg)
      el.appendChild(row)
      if (Array.isArray(actions)) {
        for (const a of actions) {
          const btn = document.createElement('button')
          btn.className = a.kind === 'primary' ? '' : 'ghost'
          btn.textContent = a.label
          btn.addEventListener('click', () => { try { a.onClick?.() } catch {} el.remove() })
          row.appendChild(btn)
        }
      }
      const dismiss = document.createElement('button')
      dismiss.className = 'toast-x'
      dismiss.setAttribute('aria-label', 'Dismiss')
      dismiss.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      dismiss.addEventListener('click', () => el.remove())
      el.appendChild(dismiss)
      document.body.appendChild(el)
      if (ms > 0) setTimeout(() => { if (el.parentNode) el.remove() }, ms)
      return
    }
    // Message (existing behavior: message can contain HTML, e.g. links)
    const msg = document.createElement('span')
    msg.className = 'toast-msg'
    msg.innerHTML = message
    el.appendChild(msg)
    // Action buttons (undo, retry, etc.) — appended before the dismiss button
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const btn = document.createElement('button')
        btn.className = a.kind === 'primary' ? '' : 'ghost'
        btn.textContent = a.label
        btn.addEventListener('click', () => { try { a.onClick?.() } catch {} el.remove() })
        el.appendChild(btn)
      }
    }
    // Dismiss button (always present)
    const dismiss = document.createElement('button')
    dismiss.className = 'ghost danger'
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'
    dismiss.addEventListener('click', () => el.remove())
    el.appendChild(dismiss)
    document.body.appendChild(el)
    if (ms > 0) setTimeout(() => { if (el.parentNode) el.remove() }, ms)
  }

  // Minimal 401 handling (2026-08-29): an expired session on a user-initiated action
  // bounces to login instead of dead-ending behind a generic error toast. Called only
  // with the Response of a direct user action (drag/edit/submit) — background sync
  // (queue.js flush) must NEVER redirect; it keeps its items and retries (see queue.js).
  function handle401(res) {
    if (res && res.status === 401 && location.pathname !== '/login.html') {
      // S111: carry WHERE the user was — login.html now bounces back to ?next= after a
      // successful sign-in, so an expired session no longer costs the user their place
      // (and a PWA share-target capture riding the query survives the bounce intact).
      // S115 r3: ONE-SHOT — hib-init's boot guard / htmx handler can bounce for the
      // same 401 on the same page; a second location change would supersede (abort)
      // the first navigation. window.__hibanaLoginBounce is the shared one-shot flag.
      if (!window.__hibanaLoginBounce) {
        window.__hibanaLoginBounce = true
        window.location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search)
      }
      return true
    }
    return false
  }

  // ---- Quick-add Spark modal (native <dialog> — reliable open/close/Esc, no Alpine scope) ----
  // Client-side strings go through the i18n layer (spec §14); fallbacks keep English default.
  const _t = (key, fallback) => window.hibanaI18n?.t(key) ?? (fallback || key)
  // Built once into <body> so every page shares one implementation (spec §5.5 quick-add modal).
  let quickAddEl = null
  let quickAddForm = null
  // S112 (the S111 carry-forward): a share-sheet capture that SAVES announces itself —
  // "Idea captured from the share sheet". The save handler toasts IN PLACE and drops a
  // sessionStorage token; announceShareCapture() at boot consumes the token once — if the
  // token still matches the window's copy, the document survived (soft nav, toast already
  // shown); if it doesn't (hard reload tore the window down), the landing page toasts.
  // A reload never re-toasts; a cancel never arms (see the close listener below).
  let shareCaptureArmed = false
  const SHARE_CAPTURED_KEY = 'hibana-share-captured'

  // S118 (the S117 rail-draft pattern completing job #1 across ALL capture surfaces):
  // the quick-add draft persists {t, d, g} to sessionStorage per keystroke — a reload,
  // a soft-nav landing, or the 401 login-bounce round-trip brings the half-typed idea
  // BACK when the dialog reopens. The S117 semantics carry over: Escape/Cancel/backdrop
  // is the deliberate discard and retires the store; a landed capture retires it (reset());
  // a failed save keeps it (the dialog never closed). The SKETCH FILE cannot ride
  // sessionStorage (binary) — it stays attach-per-document (documented limitation).
  // Silent restore — no toast noise, no new i18n keys (the S117 precedent).
  const QA_DRAFT_KEY = 'hibana-qa-draft'
  const qaDraftFields = () =>
    quickAddEl ? ['#qa-title', '#qa-description', '#qa-tags'].map((s) => quickAddEl.querySelector(s)) : []
  const qaSaveDraft = () => {
    try {
      const [t, d, g] = qaDraftFields().map((el) => (el ? el.value : ''))
      if (!t.trim() && !d.trim() && !g.trim()) {
        sessionStorage.removeItem(QA_DRAFT_KEY)
        return
      }
      sessionStorage.setItem(QA_DRAFT_KEY, JSON.stringify({ t, d, g }))
    } catch { /* private mode / storage unavailable */ }
  }
  const qaClearDraft = () => {
    try { sessionStorage.removeItem(QA_DRAFT_KEY) } catch { /* private mode */ }
  }
  const qaDraftEmpty = (d) =>
    !d || (!String(d.t || '').trim() && !String(d.d || '').trim() && !String(d.g || '').trim())

  function buildQuickAdd() {
    if (quickAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'quickadd-dialog'
    dlg.className = 'dialog dialog-wide'
    dlg.innerHTML = `
      <form class="modal" id="quickadd-form" novalidate>
        <h3>${_t('qa.title', 'New Idea')}</h3>
        <label>${_t('qa.title', 'New Idea')} <span class="row qa-title-row">
          <input type="text" id="qa-title" required maxlength="200" autocomplete="off">
        </span></label>
        <p class="muted small" id="qa-dup" hidden></p>
        <p class="muted small" id="qa-folder-hint" hidden></p>
        <label>${_t('qa.oneLiner', 'One-liner')} <textarea id="qa-description" rows="4" maxlength="2000"></textarea></label>
        <label>${_t('qa.tags', 'Tags (comma-separated, optional)')} <input type="text" id="qa-tags" placeholder="${_t('qa.tagsPlaceholder', 'AI, WordPress, …')}" maxlength="200"></label>
        <span class="qa-sketch-label">${_t('qa.sketch', 'Sketch (optional)')}</span>
        <label class="qa-sketch" for="qa-file">
          <svg class="qa-sketch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
          <span class="qa-sketch-text" data-idle>${_t('qa.sketchHint', 'Attach a sketch — a photo or drawing')}</span>
          <span class="qa-sketch-name" hidden></span>
          <input type="file" id="qa-file" accept="image/png,image/jpeg,image/webp,image/gif">
        </label>
        <p class="error" id="qa-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="qa-save">${_t('common.save', 'Save')}</button>
          <button type="button" class="ghost" id="qa-cancel">${_t('common.cancel', 'Cancel')}</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    quickAddForm = dlg.querySelector('#quickadd-form')
    const dupEl = dlg.querySelector('#qa-dup')

    // Duplicate-title soft warning (spec §5.3): never blocks, just nudges. Debounced so it
    // fires once the user pauses typing, and silenced while the field is empty.
    let dupTimer = null
    dlg.querySelector('#qa-title').addEventListener('input', () => {
      clearTimeout(dupTimer)
      dupEl.hidden = true
      const title = dlg.querySelector('#qa-title').value.trim()
      if (!title) return
      dupTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/duplicate-check?title=${encodeURIComponent(title)}`)
          const body = await res.json()
          dupEl.textContent = body.duplicate ? _t('qa.duplicate', 'A project with this title already exists') : ''
          dupEl.hidden = !body.duplicate
        } catch { /* the soft warning must never block capture */ }
      }, 350)
    })

    // S112: the branded sketch chip mirrors the file input's state — filename on
    // pick, back to the idle hint on reset (the offline path calls reset() too).
    const sketchChip = dlg.querySelector('.qa-sketch')
    const sketchText = dlg.querySelector('.qa-sketch-text')
    const sketchName = dlg.querySelector('.qa-sketch-name')
    dlg.querySelector('#qa-file').addEventListener('change', () => {
      const f = dlg.querySelector('#qa-file').files[0]
      if (!sketchChip || !sketchText || !sketchName) return
      if (f) {
        sketchName.textContent = f.name
        sketchName.hidden = false
        sketchText.hidden = true
        sketchChip.classList.add('has-file')
      } else {
        sketchName.hidden = true
        sketchText.hidden = false
        sketchChip.classList.remove('has-file')
      }
    })

    // S118: EVERY deliberate dismissal funnels through close() — the store clears
    // SYNCHRONOUSLY here, because the 'close' event fires as a QUEUED TASK: a dismiss
    // followed immediately by a navigation (the owner's own fast hand) can tear the
    // document down before the task runs, silently resurrecting a dismissed idea.
    // The 'close' listener below keeps its qaClearDraft as the belt for closes that
    // bypass this helper.
    const close = () => {
      qaClearDraft()
      dlg.close()
    }
    const reset = () => {
      quickAddForm.reset()
      document.getElementById('qa-error').textContent = ''
      sketchName && (sketchName.hidden = true)
      sketchText && (sketchText.hidden = false)
      sketchChip && sketchChip.classList.remove('has-file')
      dupEl.hidden = true
      dupEl.textContent = ''
      qaClearDraft() // S118: a landed capture (online or queued offline) retires the draft
    }

    // Esc (native cancel) + backdrop click + explicit Cancel all dismiss cleanly.
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      close()
    })
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close() // click on the dimmed backdrop, not the panel
    })
    dlg.querySelector('#qa-cancel').addEventListener('click', close)

    dlg.addEventListener('close', () => {
      const save = dlg.querySelector('#qa-save')
      save.disabled = false
      save.textContent = _t('common.save', 'Save')
      shareCaptureArmed = false // S112: cancel/Esc/backdrop close never toasts
      // S118: a close WITHOUT a landed save is the deliberate discard (Cancel/Esc/
      // backdrop) — the store retires so a later reload can't resurrect a dismissed
      // idea. The in-document fields keep their text (pre-existing close/reopen
      // behavior — untouched); only the cross-document layer is discarded. A failure
      // close never reaches here (the catch path leaves the dialog open).
      qaClearDraft()
    })

    quickAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('qa-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#qa-save')
      save.disabled = true
      save.textContent = _t('qa.saving', 'Saving…')
      const err = document.getElementById('qa-error')
      err.textContent = ''
      try {
        const tags = document
          .getElementById('qa-tags')
          .value.split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((name) => ({ name })) // server assigns the default palette color
        const id = crypto.randomUUID() // rule 2: addressable before the network call
        const payload = { id, title, description: document.getElementById('qa-description').value, tags, status: 'spark' }
        // Session 28 (user request: "go to a folder and create the idea there"): when the
        // quick-add opens ON the Ideas page with a specific folder open, the capture files
        // itself into that folder (the server re-validates ownership). 'all'/''/'none' and
        // every other page capture as unfiled — same behavior as before.
        if (location.pathname === '/sparks.html') {
          const f = (document.getElementById('spark-folder') || {}).value || ''
          if (/^[0-9a-f-]{36}$/i.test(f)) payload.folder_id = f
        }
        await window.hibanaQueue.enqueue({ kind: 'project', data: payload })
        const synced = await window.hibanaQueue.flush()
        const drained = (await window.hibanaQueue.count()) === 0
        const file = document.getElementById('qa-file').files[0]
        if (file) {
          // Optional sketch attached to the raw idea (spec §2) — uploaded once the project exists.
          // S69 (perf §10-F1): the sketch gets the SAME treatment as every other screenshot —
          // bounded to ≤1600px WebP + a ≤320px grid tile for the gallery. The resize helper
          // isn't on every page (it's page-specific), so it's injected ON DEMAND here (one
          // <script> per session, ~4KB) instead of shipping on all 22 app pages. GIFs and
          // helper failures fall back to the raw FileReader path (the old behavior).
          let dataBase64 = null
          let mimeType = file.type
          let thumbBase64 = null
          const R = await ensureImageResize()
          if (R && file.type !== 'image/gif' && file.type !== 'image/svg+xml') {
            try {
              const img = await R.decodeImage(file)
              if (Math.max(img.width, img.height) > 1600 || file.size > 220 * 1024) {
                const main = await R.resizeAndEncode(file, { maxDim: 1600, quality: 0.85 })
                dataBase64 = main.dataBase64
                mimeType = main.mimeType
              }
              try {
                const t = await R.resizeAndEncode(file, { maxDim: 320, quality: 0.8 })
                if (t.mimeType === 'image/webp' && t.dataBase64.length <= 120_000) thumbBase64 = t.dataBase64
              } catch { /* tile optional */ }
            } catch { /* canvas failed — raw below */ }
          }
          if (!dataBase64) {
            dataBase64 = await new Promise((resolve, reject) => {
              const r = new FileReader()
              r.onload = () => resolve(String(r.result).split(',')[1])
              r.onerror = reject
              r.readAsDataURL(file)
            })
            mimeType = file.type
          }
          await fetch(`/api/projects/${id}/screenshots`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: file.name, mimeType, dataBase64, ...(thumbBase64 ? { thumbBase64 } : {}) }),
          }).catch(() => {}) // attachment failure must not block capture
        }
        if (synced && drained && navigator.onLine) {
          if (shareCaptureArmed) {
            shareCaptureArmed = false
            const tok = crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
            try { sessionStorage.setItem(SHARE_CAPTURED_KEY, tok) } catch { /* private mode */ }
            window.__hibShareSavedToken = tok // same-document marker for announceShareCapture
            window.hibana?.toast(_t('qa.shareCaptured', 'Idea captured from the share sheet'), 'ok', 4200)
          }
          close()
          reset()
          // User request (2026-08-25): capturing from the Ideas page lands back there with a
          // real reload so the new idea shows; anywhere else the dashboard. (nav.js skips
          // same-page navigation, hence the hard reload for the Ideas page.)
          // S40 (user report: "can't enter a folder and add an idea there"): the hard
          // reload wiped the open-folder context on EVERY capture (the new idea landed
          // in a folder the page silently forgot). sparks-page.js now installs a soft
          // refresh hook that refetches the shelf with the folder intact — no reload
          // flash, no context loss. Fallback keeps the old reload for page drift.
          if (location.pathname === '/sparks.html') {
            if (typeof window.__hibanaShelfReload === 'function') window.__hibanaShelfReload()
            else window.location.href = '/sparks.html'
          }
          else if (window.hibanaNav) window.hibanaNav.go('/app')
          else window.location.href = '/app'
        } else {
          close()
          reset()
          window.hibana?.toast(_t('qa.savedOffline', 'Saved offline — it will sync when you reconnect'), 'info', 5000)
        }
      } catch (e2) {
        err.textContent = `${_t('qa.errorPrefix', "Couldn't create the idea —")} ${e2 instanceof Error ? e2.message : 'network error'}`
        save.disabled = false
        save.textContent = _t('common.save', 'Save')
      }
    })

    quickAddEl = dlg
    // S118: per-keystroke draft persistence on the three text fields (the sketch
    // input's change event deliberately does NOT feed the store — binary, see above).
    // Attached AFTER quickAddEl is assigned — qaDraftFields() reads through it.
    qaDraftFields().forEach((el) => el && el.addEventListener('input', qaSaveDraft))
  }

  function openQuickAdd(prefill) {
    buildQuickAdd()
    // Session 28: surface where the capture will land — when a specific folder is open on
    // the Ideas page, its name rides the hidden input's data attribute (sparks-page.js
    // stamps it on every folder click); otherwise the hint stays hidden.
    const hint = quickAddEl.querySelector('#qa-folder-hint')
    if (hint) {
      const f = (document.getElementById('spark-folder') || {}).value || ''
      const name = (document.getElementById('spark-folder') || {}).dataset?.folderName || ''
      if (location.pathname === '/sparks.html' && /^[0-9a-f-]{36}$/i.test(f) && name) {
        hint.textContent = _t('qa.filesInto', 'Files into') + ': ' + name
        hint.hidden = false
      } else {
        hint.hidden = true
      }
    }
    // S111 (PWA share_target): an optional { title, description } prefill — the share
    // sheet's composed values land straight in the form. Setting .value (never markup)
    // keeps shared text inert; the synthetic input event wakes the debounced
    // duplicate-title soft warning so a re-shared page nudges like typed input.
    if (prefill && (prefill.title || prefill.description)) {
      const titleInput = quickAddEl.querySelector('#qa-title')
      const descInput = quickAddEl.querySelector('#qa-description')
      if (titleInput && prefill.title) titleInput.value = prefill.title
      if (descInput && prefill.description) descInput.value = prefill.description
    }
    // S118: restore a half-typed draft — only when the form is PRISTINE and no share
    // prefill came in (a prefill or in-document values are newer intent and win; the
    // store is per-TAB sessionStorage, so two tabs never cross-contaminate).
    if (!(prefill && (prefill.title || prefill.description))) {
      const [tEl, dEl, gEl] = qaDraftFields()
      const pristine = tEl && dEl && gEl && !tEl.value.trim() && !dEl.value.trim() && !gEl.value.trim()
      if (pristine) {
        try {
          const stored = JSON.parse(sessionStorage.getItem(QA_DRAFT_KEY) || 'null')
          if (!qaDraftEmpty(stored)) {
            if (stored.t) tEl.value = String(stored.t).slice(0, 200)
            if (stored.d) dEl.value = String(stored.d).slice(0, 2000)
            if (stored.g) gEl.value = String(stored.g).slice(0, 200)
          }
        } catch { /* corrupt store — start clean */ }
      }
    }
    quickAddEl.showModal()
    if (prefill && (prefill.title || prefill.description)) {
      const titleInput = quickAddEl.querySelector('#qa-title')
      if (titleInput) {
        titleInput.dispatchEvent(new Event('input', { bubbles: true }))
        titleInput.focus()
      }
    }
  }

  // S120 (S119 candidate 6 — the blank-tile polish): preload="metadata" leaves the
  // first frame UNPAINTED in some engines — the tile sits as a black box until play
  // even though its bytes are fetched. A 1ms seek after metadata forces the
  // poster-style frame paint (the standard no-ffmpeg poster substitute; the server
  // can't render one). Delegated at document CAPTURE — 'loadedmetadata' does NOT
  // bubble, and the tiles render from four different bundles (the server grid,
  // the project page's three grids, the gallery) — one listener owns them all.
  // Idempotent per element (the lightbox builds a fresh <video> each open): a real
  // user seek is never touched (only a still-at-zero player is nudged).
  document.addEventListener('loadedmetadata', (e) => {
    const v = e.target
    if (!(v instanceof HTMLVideoElement) || !v.classList.contains('shot-video')) return
    if (v.dataset.framed) return
    v.dataset.framed = '1'
    try { if (v.currentTime < 0.01) v.currentTime = 0.001 } catch { /* not seekable yet */ }
  }, true)

  // ---- New Project dialog (personal, lands in Pending — the vetted step of the pipeline,
  // spec §2). Same offline-safe queue flow as quick-add; only the starting status differs.
  let projectAddEl = null
  let projectAddForm = null

  function buildProjectAdd() {
    if (projectAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'projectadd-dialog'
    dlg.className = 'dialog dialog-wide'
    dlg.innerHTML = `
      <form class="modal" id="projectadd-form" novalidate>
        <h3>${_t('pa.title', 'New Project')}</h3>
        <label>${_t('qa.name', 'Name')} <input type="text" id="pa-title" required maxlength="200" autocomplete="off"></label>
        <p class="muted small" id="pa-dup" hidden></p>
        <label>${_t('qa.oneLiner', 'One-liner')} <textarea id="pa-description" rows="4" maxlength="2000"></textarea></label>
        <label>${_t('qa.tags', 'Tags (comma-separated, optional)')} <input type="text" id="pa-tags" placeholder="${_t('qa.tagsPlaceholder', 'AI, WordPress, …')}" maxlength="200"></label>
        <p class="error" id="pa-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="pa-save">${_t('common.save', 'Save')}</button>
          <button type="button" class="ghost" id="pa-cancel">${_t('common.cancel', 'Cancel')}</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    projectAddForm = dlg.querySelector('#projectadd-form')
    const dupEl = dlg.querySelector('#pa-dup')

    // Duplicate-title soft warning — same debounced, non-blocking behavior as quick-add.
    let dupTimer = null
    dlg.querySelector('#pa-title').addEventListener('input', () => {
      clearTimeout(dupTimer)
      dupEl.hidden = true
      const title = dlg.querySelector('#pa-title').value.trim()
      if (!title) return
      dupTimer = setTimeout(async () => {
        try {
          const res = await fetch(`/api/projects/duplicate-check?title=${encodeURIComponent(title)}`)
          const body = await res.json()
          dupEl.textContent = body.duplicate ? _t('qa.duplicate', 'A project with this title already exists') : ''
          dupEl.hidden = !body.duplicate
        } catch { /* the soft warning must never block capture */ }
      }, 350)
    })

    const close = () => dlg.close()
    const reset = () => {
      projectAddForm.reset()
      document.getElementById('pa-error').textContent = ''
      dupEl.hidden = true
      dupEl.textContent = ''
    }

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#pa-cancel').addEventListener('click', close)
    dlg.addEventListener('close', () => {
      const save = dlg.querySelector('#pa-save')
      save.disabled = false
      save.textContent = _t('common.save', 'Save')
    })

    projectAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('pa-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#pa-save')
      save.disabled = true
      save.textContent = _t('qa.saving', 'Saving…')
      const err = document.getElementById('pa-error')
      err.textContent = ''
      try {
        const tags = document
          .getElementById('pa-tags')
          .value.split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .map((name) => ({ name })) // server assigns the default palette color
        const id = crypto.randomUUID() // rule 2: addressable before the network call
        // batch q: a NEW project starts at phase 1 of the lifecycle (0060: Planning) — ideas
        // are captured with the other FAB as sparks (status 'spark') and live on the Ideas shelf
        const payload = { id, title, description: document.getElementById('pa-description').value, tags, status: projectAddEl.dataset.startStatus || 'planning', type: 'personal' }
        await window.hibanaQueue.enqueue({ kind: 'project', data: payload })
        const synced = await window.hibanaQueue.flush()
        const drained = (await window.hibanaQueue.count()) === 0
        close()
        reset()
        if (synced && drained && navigator.onLine) {
          // User request (2026-09-03): a NEW project lands on ITS detail page. The id is
          // client-generated (rule 2: addressable before the network call), so the
          // destination is known without waiting for a response body.
          const dest = '/project.html?id=' + id
          if (window.hibanaNav) window.hibanaNav.go(dest)
          else window.location.href = dest
        } else {
          window.hibana?.toast(_t('qa.savedOffline', 'Saved offline — it will sync when you reconnect'), 'info', 5000)
        }
      } catch (e2) {
        err.textContent = `${_t('qa.errorPrefix', "Couldn't create the project —")} ${e2 instanceof Error ? e2.message : 'network error'}`
        save.disabled = false
        save.textContent = _t('common.save', 'Save')
      }
    })

    projectAddEl = dlg
  }

  // batch q: default first project stage (0060: Planning; legacy 'pending'/'unreviewed'
  // callers normalize to planning server-side)
  function openProjectAdd(startStatus = 'planning') {
    buildProjectAdd()
    projectAddEl.dataset.startStatus = startStatus
    projectAddEl.showModal()
  }

  // ---- New Task dialog (user request 2026-08-30): the FAB's primary action. A light
  // capture form — quadrant + title + optional deadline — that posts straight to the
  // to-do board. The full editor (emoji, tags, recurrence…) stays on the board page.
  let taskAddEl = null
  let taskAddForm = null
  let taskQuads = null // [{id, icon, name}] in the active language

  async function fillTaskQuads() {
    const lang = window.hibanaI18n?.lang?.() || 'en'
    if (taskQuads && taskQuads.lang === lang) return taskQuads.list
    let list = null
    try {
      const res = await fetch('/api/sadhana')
      const data = res.ok ? await res.json() : null
      if (data && Array.isArray(data.quads) && data.quads.length) {
        list = data.quads.map((q) => ({ id: q.id, icon: q.icon, name: lang === 'fa' ? q.name_fa : q.name_en }))
      }
    } catch { /* offline → defaults below */ }
    if (!list) {
      list = [
        { id: 1, icon: '⚙️', name: lang === 'fa' ? 'امروز' : 'Today' },
        { id: 3, icon: '🚨', name: lang === 'fa' ? 'فوری و باارزش' : 'Urgent & High Value' },
        { id: 2, icon: '🏔️', name: lang === 'fa' ? 'استراتژیک' : 'Strategic' },
        { id: 4, icon: '🍃', name: lang === 'fa' ? 'شخصی و احساسی' : 'Personal & Sentimental' },
      ]
    }
    taskQuads = { lang, list }
    return list
  }

  function buildTaskAdd() {
    if (taskAddEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'taskadd-dialog'
    dlg.className = 'dialog'
    dlg.innerHTML = `
      <form class="modal" id="taskadd-form" novalidate>
        <h3 data-i18n="taskAdd.title">New Task</h3>
        <label><span data-i18n="taskAdd.taskLabel">Task</span> <input type="text" id="taskadd-title" required maxlength="255" autocomplete="off"></label>
        <label><span data-i18n="taskAdd.quadrant">Quadrant</span> <select id="taskadd-quad"></select></label>
        <label><span data-i18n="taskAdd.deadline">Deadline (optional)</span> <input type="date" id="taskadd-date"></label>
        <p class="error" id="taskadd-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="taskadd-save" data-i18n="taskAdd.add">Add task</button>
          <button type="button" class="ghost" id="taskadd-cancel" data-i18n="common.cancel">Cancel</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    taskAddForm = dlg.querySelector('#taskadd-form')
    const close = () => dlg.close()
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#taskadd-cancel').addEventListener('click', close)
    taskAddForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const title = document.getElementById('taskadd-title').value.trim()
      if (!title) return
      const save = dlg.querySelector('#taskadd-save')
      save.disabled = true
      const err = document.getElementById('taskadd-error')
      err.textContent = ''
      const dateVal = document.getElementById('taskadd-date').value
      const payload = {
        quadrant: Number(document.getElementById('taskadd-quad').value || 1),
        title,
        ...(dateVal ? { due_date: dateVal } : {}),
      }
      try {
        const res = await fetch('/api/sadhana/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        close()
        taskAddForm.reset()
        toast(_t('taskAdd.added', 'Task added'), 'info')
        // S143: the rail panel follows the add in the same beat (its 'hibana:tasks-changed'
        // listener re-reads /api/rail) — the board refresh hooks below cover the page itself.
        try { document.dispatchEvent(new CustomEvent('hibana:tasks-changed', { detail: { source: 'board' } })) } catch { /* older engines */ }
        // Realtime pickup everywhere (2026-09-02 user request): the dashboard to-do
        // section + calendar dots refresh via htmx; when the FAB was used ON the
        // to-do board page itself, the board re-fetches its payload — no manual
        // page refresh needed anymore. (Session-11: '#dash' never matched — the
        // dashboard main's duplicate id attribute was dropped at parse time; the
        // live hook is main.shell-dash.)
        if (document.querySelector('main.shell-dash')) refreshDashboard()
        else if (typeof window.hibanaSadhanaRefresh === 'function') window.hibanaSadhanaRefresh()
      } catch {
        err.textContent = _t('taskAdd.failed', "Couldn't add the task — try again")
      } finally {
        save.disabled = false
      }
    })
    taskAddEl = dlg
  }

  async function openTaskAdd() {
    buildTaskAdd()
    document.getElementById('taskadd-title').value = ''
    document.getElementById('taskadd-date').value = ''
    document.getElementById('taskadd-error').textContent = ''
    // Dialog labels: the build-time _t snapshot can go stale after a language switch,
    // so re-translate the dialog's data-i18n nodes on every open (light local pass).
    document.getElementById('taskadd-dialog')?.querySelectorAll('[data-i18n]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18n)
      if (s && s !== el.dataset.i18n && !el.children.length) el.textContent = s
    })
    // Show IMMEDIATELY — the quadrant-names fetch can take a beat on slow links, and a
    // dead click feels broken. The select fills the moment the names land.
    taskAddEl.showModal()
    document.getElementById('taskadd-title')?.focus()
    const quads = await fillTaskQuads()
    const sel = document.getElementById('taskadd-quad')
    if (sel) sel.innerHTML = quads.map((q) => `<option value="${q.id}">${q.icon} ${q.name}</option>`).join('')
  }

  // ---- Quick-add triggers — DELEGATED, so they survive every page swap --------
  // nav.js replaces <main> wholesale on soft navigation (and drops the per-element
  // bindings this script made at DOMContentLoaded), which left the “Capture an idea”
  // button and the FABs dead on any page reached via the topbar. A document-level
  // listener catches them wherever they appear — hard load, soft nav, htmx swaps.
  document.addEventListener('click', (e) => {
    const task = e.target.closest('[data-taskadd-open]')
    if (task) {
      e.preventDefault()
      closeFabMenu()
      openTaskAdd()
      return
    }
    // Phase 7 item 12 — the FAB's third option: یادداشت سریع. A modal (textarea +
    // اتصال-to-project picker + ذخیره/لغو) that lands in the Quick Notebook.
    const note = e.target.closest('[data-notequickadd]')
    if (note) {
      e.preventDefault()
      closeFabMenu()
      openQuickNoteAdd()
      return
    }
    const quick = e.target.closest('[data-quickadd-open]')
    if (quick) {
      e.preventDefault()
      closeFabMenu()
      openQuickAdd()
      return
    }
    const project = e.target.closest('[data-projectquickadd], [data-projectquickadd-status]')
    if (project) {
      e.preventDefault()
      closeFabMenu()
      openProjectAdd(project.getAttribute('data-projectquickadd-status') || 'planning')
    }
  })

  // ---- S88: the markdown code-block COPY button — ONE delegated handler --------
  // renderMarkdown (server + the vault's client mirror) emits .md-code panels with a
  // [data-md-copy] button on every markdown surface: the vault preview, the quicknote
  // reader, AND the live editor overlay (the panel painted over the raw ``` block).
  // Delegated at the document level so htmx swaps + soft-navs never lose it. The copy
  // source is the panel's <pre><code> textContent — the tokenizer only wraps tokens
  // in spans, so the concatenated text IS the raw code. Feedback: the icon swaps to a
  // check + "Copied" chip for 1.4s, then reverts (the Notion/Obsidian affordance).
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest ? e.target.closest('[data-md-copy]') : null
    if (!btn) return
    const panel = btn.closest('.md-code')
    const codeEl = panel ? panel.querySelector('pre code') : null
    const raw = codeEl ? codeEl.textContent : ''
    if (!raw) return
    e.preventDefault()
    let ok = false
    try {
      await navigator.clipboard.writeText(raw)
      ok = true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = raw
        ta.setAttribute('readonly', '')
        ta.style.cssText = 'position:fixed;inset-inline-start:-9999px;opacity:0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        ok = true
      } catch { ok = false }
    }
    if (!ok) { toast(_t('notes.copyFail', 'Could not copy.'), 'err', 2500); return }
    // swap the affordance: check icon + Copied label, revert after the pause
    const prev = btn.innerHTML
    btn.classList.add('is-copied')
    btn.innerHTML = '<span class="md-copy-done">' + _t('md.copied', 'Copied') + '</span>' +
      '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'
    setTimeout(() => {
      btn.classList.remove('is-copied')
      btn.innerHTML = prev
    }, 1400)
  })

  // ---- Single creation FAB (dashboard): one circle that expands into the two-item
  // menu (New idea / New project). Delegated + document-level so it survives nav.js
  // swaps; closes on outside click, Escape, or after picking an item. The FAB circle
  // itself means CREATE only — every other circular icon action in the app is a ghost/
  // outline button (design rule 2026-08-25).
  const fabEl = () => document.querySelector('.fab-stack[data-fab]')
  const setFabOpen = (open) => {
    const fab = fabEl()
    if (!fab) return
    const toggle = fab.querySelector('[data-fab-toggle]')
    const menu = fab.querySelector('[data-fab-menu]')
    if (menu) menu.hidden = !open
    if (toggle) toggle.setAttribute('aria-expanded', String(open))
  }
  window.closeFabMenu = () => setFabOpen(false)
  document.addEventListener('click', (e) => {
    const fab = fabEl()
    if (!fab) return
    const toggle = e.target.closest('[data-fab-toggle]')
    if (toggle) {
      e.stopPropagation()
      const open = toggle.getAttribute('aria-expanded') !== 'true'
      setFabOpen(open)
      return
    }
    if (!e.target.closest('.fab-stack[data-fab]')) setFabOpen(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setFabOpen(false)
  })

  // Quick-capture shortcut (audit 18/19): Ctrl/Cmd+N opens the New Task dialog (the FAB's
  // primary action, 2026-08-30) from any page. Skipped while typing (inputs,
  // contenteditable) and when a dialog is already open.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'n' && e.key !== 'N')) return
    const t = e.target
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
    e.preventDefault()
    openTaskAdd()
  })

  // ---- Phase 7 item 12: the FAB's «یادداشت سریع» modal ----------------------------
  // A native <dialog> (same .dialog/.modal recipe as New Task): a textarea, an اتصال
  // toggle that reveals the user's live projects (GET /api/projects, JSON mode), and
  // ذخیره/لغو. Saving POSTs /api/notes {kind:'note', content, project_id?} and refreshes
  // the dashboard's #notebook via htmx so the note is visible immediately.
  let quickNoteEl = null
  function buildQuickNoteAdd() {
    if (quickNoteEl) return
    const dlg = document.createElement('dialog')
    dlg.id = 'quicknote-dialog'
    dlg.className = 'dialog dialog-wide'
    dlg.innerHTML = `
      <form class="modal" id="quicknote-form" novalidate>
        <h3 data-i18n="qn.title">Quick note</h3>
        <textarea id="quicknote-text" rows="10" maxlength="20000" dir="auto"
          placeholder="${_t('notes.typeNote', 'Type a note and press Enter…')}" data-i18n-placeholder="notes.typeNote"></textarea>
        <div class="qn-attach">
          <button type="button" class="ghost small" id="quicknote-attach-btn" aria-expanded="false" data-i18n="qn.attach">Attach to project</button>
          <span class="chip qn-attach-chip" id="quicknote-attach-chip" hidden></span>
        </div>
        <div class="qn-attach-options" id="quicknote-attach-options" hidden></div>
        <p class="error" id="quicknote-error" role="alert"></p>
        <div class="row">
          <button type="submit" id="quicknote-save" data-i18n="qn.save">Save</button>
          <button type="button" class="ghost" id="quicknote-cancel" data-i18n="common.cancel">Cancel</button>
        </div>
      </form>`
    document.body.appendChild(dlg)
    const form = dlg.querySelector('#quicknote-form')
    const ta = dlg.querySelector('#quicknote-text')
    const errEl = dlg.querySelector('#quicknote-error')
    const attachBtn = dlg.querySelector('#quicknote-attach-btn')
    const attachOpts = dlg.querySelector('#quicknote-attach-options')
    const attachChip = dlg.querySelector('#quicknote-attach-chip')
    let attachProject = null // {id, title} | null
    const paintChip = () => {
      if (attachProject) {
        attachChip.hidden = false
        attachChip.textContent = attachProject.title
      } else attachChip.hidden = true
    }
    const close = () => dlg.close()
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#quicknote-cancel').addEventListener('click', close)
    attachBtn.addEventListener('click', async () => {
      const open = attachOpts.hidden
      attachOpts.hidden = !open
      attachBtn.setAttribute('aria-expanded', String(open))
      if (!open) return
      attachOpts.innerHTML = `<span class="muted small">…</span>`
      try {
        const res = await fetch('/api/projects')
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        const projects = (data.projects || []).filter((p) => !p.deleted_at).slice(0, 40)
        attachOpts.innerHTML = projects.length
          ? `<strong class="small">${escHtml(_t('qn.attachTo', 'Attach to…'))}</strong>` +
            projects.map((p) => `<button type="button" class="qn-attach-option" data-id="${escHtml(p.id)}" data-title="${escHtml(p.title)}">${escHtml(p.title)}</button>`).join('')
          : `<span class="muted small">${escHtml(_t('qn.noProjects', 'No projects to attach to yet — create one first.'))}</span>`
      } catch {
        attachOpts.innerHTML = `<span class="muted small">${escHtml(_t('qn.loadFailed', "Couldn't load the projects"))}</span>`
      }
    })
    attachOpts.addEventListener('click', (e) => {
      const opt = e.target.closest('.qn-attach-option')
      if (!opt) return
      attachProject = { id: opt.dataset.id, title: opt.dataset.title }
      attachOpts.hidden = true
      attachBtn.setAttribute('aria-expanded', 'false')
      paintChip()
    })
    attachChip.addEventListener('click', () => {
      attachProject = null // tap the chip to detach
      paintChip()
    })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const content = ta.value.trim()
      errEl.textContent = ''
      if (!content) { errEl.textContent = _t('notes.emptyHint', 'Write a note first'); ta.focus(); return }
      const save = dlg.querySelector('#quicknote-save')
      save.disabled = true
      try {
        const res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'note', content, ...(attachProject ? { project_id: attachProject.id } : {}) }),
        })
        window.hibana?.handle401?.(res)
        if (!res.ok) throw new Error(String(res.status))
        close()
        form.reset()
        attachProject = null
        paintChip()
        toast(_t('qn.saved', 'Note saved'), 'ok')
        // The dashboard's notebook widget swaps in the fresh list; on other pages the
        // note is already saved server-side and shows on the next dashboard visit.
        if (document.querySelector('#notebook') && window.htmx) {
          window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
        }
      } catch {
        errEl.textContent = _t('qn.failed', "Couldn't save the note — try again")
      } finally {
        save.disabled = false
      }
    })
    quickNoteEl = dlg
  }
  function openQuickNoteAdd() {
    buildQuickNoteAdd()
    const dlg = quickNoteEl
    if (!dlg) return
    dlg.querySelector('#quicknote-text').value = ''
    dlg.querySelector('#quicknote-error').textContent = ''
    dlg.querySelector('#quicknote-attach-options').hidden = true
    dlg.querySelector('#quicknote-attach-btn').setAttribute('aria-expanded', 'false')
    // re-translate on open (the taskAdd pattern — a build-time snapshot can go stale)
    dlg.querySelectorAll('[data-i18n]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18n)
      if (s && s !== el.dataset.i18n && !el.children.length) el.textContent = s
    })
    dlg.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const s = window.hibanaI18n?.t(el.dataset.i18nPlaceholder)
      if (s && s !== el.dataset.i18nPlaceholder) el.placeholder = s
    })
    dlg.showModal()
    dlg.querySelector('#quicknote-text').focus()
  }

  // ---- Quick Notebook (dashboard widget): delegated so htmx swaps never lose it ----
  // Three client-side jobs: the Note/List composer toggle (updates the hidden kind input
  // + placeholder), the per-card done toggle (Phase 5 item 3 — ✓ marks a project-linked
  // note done/undone; it STAYS on the project's record, unlike the delete below), and
  // the per-card delete (fetch DELETE → toast + Undo → restore + refresh).
  document.addEventListener('click', (e) => {
    // Phase 5 item 3: ✓ done toggle — PATCH {done} then re-render the notebook (the
    // server repaints the card with the done styling + swapped icon). Distinct from
    // delete: nothing is removed, the note keeps its place everywhere.
    const doneBtn = e.target.closest('[data-note-done]')
    if (doneBtn) {
      const id = doneBtn.getAttribute('data-note-done')
      const card = doneBtn.closest('.note-card')
      if (!id || !card) return
      const next = doneBtn.getAttribute('aria-pressed') !== 'true'
      fetch(`/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: next }),
      })
        .then(async (r) => {
          if (!r.ok) { handle401(r); throw new Error('done failed') }
          const mode = document.querySelector('form[data-note-compose] input[name="kind"]')?.value
          const qs = mode === 'list' || mode === 'note' ? `?mode=${mode}` : ''
          if (window.htmx) window.htmx.ajax('GET', `/api/notes${qs}`, { target: '#notebook', swap: 'outerHTML' })
        })
        .catch(() => toast(_t('notes.updateFailed', "Couldn't update the note"), 'err'))
      return
    }

    const seg = e.target.closest('.seg-btn[data-note-mode]')
    if (seg) {
      const group = seg.closest('.seg')
      if (!group) return
      const mode = seg.dataset.noteMode === 'list' ? 'list' : 'note'
      for (const b of group.querySelectorAll('.seg-btn')) {
        b.classList.toggle('active', b === seg)
        b.setAttribute('aria-pressed', String(b === seg))
      }
      const form = seg.closest('form[data-note-compose]')
      if (form) {
        const kind = form.querySelector('input[name="kind"]')
        if (kind) kind.value = mode
        const ta = form.querySelector('.note-compose-text')
        if (ta) ta.placeholder = mode === 'list' ? _t('notes.firstTask', 'Type a task and press Enter…') : _t('notes.typeNote', 'Type a note and press Enter…')
      }
      return
    }

    const del = e.target.closest('[data-note-delete]')
    if (del) {
      const id = del.getAttribute('data-note-delete')
      const card = del.closest('.note-card')
      if (!id || !card) return
      fetch(`/api/notes/${id}`, { method: 'DELETE' })
        .then(async (r) => {
          if (!r.ok) {
            toast(_t('notes.deleteFailed', "Couldn't delete the note"), 'err')
            return
          }
          card.remove()
          // P4.11 (F-L24): use the toast() actions API (the canonical pattern) instead of
          // post-hoc appending a button to the toast element.
          toast(_t('notes.deleted', 'Note deleted'), 'info', 6000, [{
            label: _t('common.undo', 'Undo'),
            onClick: () => {
              const mode = document.querySelector('form[data-note-compose] input[name="kind"]')?.value
              const qs = mode === 'list' || mode === 'note' ? `?mode=${mode}` : ''
              fetch(`/api/notes/${id}/restore`, { method: 'POST' })
                .then((r2) => {
                  if (r2.ok && window.htmx) {
                    window.htmx.ajax('GET', `/api/notes${qs}`, { target: '#notebook', swap: 'outerHTML' })
                  }
                })
                .catch(() => {})
            },
          }])
        })
        .catch(() => toast(_t('notes.deleteFailed', "Couldn't delete the note"), 'err'))
    }
  })

  // ---- S64: jump-to-note — the palette's quick-note deep link lands HERE ----------------
  // /app#note-<uuid>&q=<term>: the dashboard is the one surface that renders note-cards,
  // so this is where quick notes' "find → open → SEE" ends. The card scrolls into view
  // with one accent pulse; when a query rides the link, the first matching text node is
  // wrapped in a temporary <mark class="note-jump"> that unwraps itself after the flash
  // (the same visual language as the vault's S63 jump-to-match). The hash is consumed
  // via replaceState so a reload reopens clean. The widget caps at 20 recent cards — a
  // hit deeper than that toasts instead of dead-scrolling. Re-armed on hashchange,
  // popstate, and every htmx:afterSwap (the dashboard main swaps async via hx-get, and
  // soft-nav re-entries re-fire it — pushState itself fires no event to hook).
  ;(() => {
    const canHostCards = () =>
      !!document.querySelector('main.shell-dash') ||
      location.pathname === '/app' || location.pathname === '/dashboard.html'
    const parseHash = () => {
      if (!location.hash || !location.hash.startsWith('#note-')) return null
      const raw = location.hash.slice(6)
      const amp = raw.indexOf('&q=')
      const id = (amp >= 0 ? raw.slice(0, amp) : raw).trim()
      if (!/^[0-9a-f-]{10,}$/i.test(id)) return null // uuid-ish only — never a stray fragment
      let q = ''
      if (amp >= 0) { try { q = decodeURIComponent(raw.slice(amp + 3)) } catch { q = raw.slice(amp + 3) } }
      return { id, q }
    }
    let armed = null
    const disarm = () => {
      if (!armed) return
      if (armed.observer) armed.observer.disconnect()
      if (armed.timer) clearInterval(armed.timer)
      if (armed.failTimer) clearTimeout(armed.failTimer)
      armed = null
    }
    // Wrap the card's first text-node hit in <mark class="note-jump">. Form controls are
    // skipped: a <mark> inside a <textarea> is invalid DOM and the walk would otherwise
    // match the raw source twin of the rendered markdown before the visible one.
    const wrapFirstMatch = (card, q) => {
      const needle = String(q || '').toLowerCase()
      if (!needle) return null
      const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
          const p = n.parentElement
          if (!p) return NodeFilter.FILTER_REJECT
          const tag = p.tagName
          if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node
      while ((node = walker.nextNode())) {
        const v = node.nodeValue || ''
        const i = v.toLowerCase().indexOf(needle)
        if (i >= 0) {
          const range = document.createRange()
          range.setStart(node, i)
          range.setEnd(node, i + needle.length)
          const mark = document.createElement('mark')
          mark.className = 'note-jump'
          try { range.surroundContents(mark) } catch { return null }
          return mark
        }
      }
      return null
    }
    const jump = (card, q) => {
      card.scrollIntoView({ block: 'center' })
      card.classList.add('note-jump')
      setTimeout(() => card.classList.remove('note-jump'), 2600)
      if (q) {
        const mark = wrapFirstMatch(card, q)
        if (mark) mark.scrollIntoView({ block: 'center' })
        setTimeout(() => {
          if (mark && mark.parentNode) { mark.replaceWith(...Array.from(mark.childNodes)); card.normalize() }
        }, 2600)
      }
    }
    const arm = () => {
      if (!canHostCards()) return
      const parsed = parseHash()
      if (!parsed) return
      if (armed && armed.id === parsed.id) return // already watching this target
      disarm()
      armed = { ...parsed, observer: null, timer: null, failTimer: null }
      // S65: the beyond-cap resolution — the note is real but deeper than the widget's 20
      // cards, so finish the intent in the ARCHIVE (opens centered on the note, flashed).
      // The toast stays as the fallback when the archive can't load the anchor at all.
      const resolveBeyondCap = () => {
        if (!armed) return
        const { id, q } = armed
        disarm()
        try { history.replaceState(null, '', location.pathname + location.search) } catch { /* history unavailable */ }
        if (window.hibanaArchive && typeof window.hibanaArchive.openAt === 'function') window.hibanaArchive.openAt(id, q)
        else toast(_t('qn.jumpMissing', 'That note is saved, but older than the recent list shown here.'), 'info', 6000)
      }
      const tryNow = () => {
        if (!armed) return false
        const card = document.getElementById('note-' + armed.id)
        if (card) {
          const { q } = armed
          disarm()
          try { history.replaceState(null, '', location.pathname + location.search) } catch { /* history unavailable */ }
          jump(card, q)
          return true
        }
        // S65: the widget section exists in the CURRENT main (it dies with the old main on
        // soft-nav and returns only with the fresh content swap) — so its presence means
        // the dashboard landed, and our card isn't among the rendered 20. Don't make the
        // user wait out the fail timer: the archive has the note.
        if (document.querySelector('#notebook')) { resolveBeyondCap(); return true }
        return false
      }
      if (tryNow()) return // hash arrived after the cards were already in the DOM
      // Hard load: main.shell-dash swaps its content via hx-get after app.js boots. Soft
      // nav: nav.js replaces the whole <main> first, THEN the hx-get fires. Either way
      // the card lands via mutation — the observer catches it, the interval is
      // belt-and-suspenders, and the fail timer converts a hopeless wait into the archive
      // (hidden-notebook edge: no #notebook ever lands, so the timer is the only signal).
      armed.observer = new MutationObserver(() => { tryNow() })
      armed.observer.observe(document.body, { childList: true, subtree: true })
      armed.timer = setInterval(() => { tryNow() }, 400)
      armed.failTimer = setTimeout(() => { resolveBeyondCap() }, 4500)
    }
    arm()
    window.addEventListener('hashchange', arm)
    window.addEventListener('popstate', arm)
    document.addEventListener('htmx:afterSwap', arm)
  })()

  // ---- S65: the quick-note ARCHIVE — every note ever captured, browsable at last -------
  // The dashboard widget caps at 20 cards (P5.1 F-M1) and the API at 100; anything older
  // was stored but rendered NOWHERE. This dialog is the full list: paginated server
  // fragments (60/page), an optional anchored target (the palette's beyond-cap jump lands
  // here centered on the note), a client-side filter, and rows that open the existing
  // note-reader via their hidden full-markdown render (no extra fetch). Read-only by
  // design — edits belong to the live widget; the archive's job is "never lose an idea".
  ;(() => {
    const PAGE = 60
    let dlg = null
    let loading = false
    // Current loaded window [lo, hi) over the archive's total. lo>0 → newer pages exist
    // above; hi<total → older pages exist below.
    let lo = 0
    let hi = 0
    let total = 0

    const buildDialog = () => {
      if (dlg) return dlg
      dlg = document.createElement('dialog')
      dlg.id = 'quicknote-archive'
      dlg.className = 'qa-archive'
      dlg.innerHTML =
        '<div class="qa-head">' +
          '<h3 class="qa-title" data-i18n="qn.archiveTitle">All notes</h3>' +
          '<span class="qa-count small muted" aria-live="polite"></span>' +
          '<input type="search" class="qa-filter" data-i18n-placeholder="qn.filterNotes" placeholder="Filter…" aria-label="Filter notes" data-i18n-aria-label="qn.filterNotes" autocomplete="off">' +
          '<input type="date" class="qa-date" hidden aria-label="Jump to date" data-i18n-aria-label="qn.jumpToDate">' +
          '<button type="button" class="ghost icon-btn qa-clearjump" data-qa-clearjump hidden aria-label="Back to the latest notes" data-i18n-aria-label="qn.clearJump" title="Back to the latest notes" data-i18n-title="qn.clearJump"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4m0 0 6-6m-6 6 6 6"/></svg></button>' +
          '<button type="button" class="ghost icon-btn qa-jumpbtn" data-qa-jump aria-label="Jump to date" data-i18n-aria-label="qn.jumpToDate" title="Jump to date"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg></button>' +
          '<button type="button" class="ghost icon-btn" data-qa-close aria-label="Close" data-i18n-aria-label="common.close"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
        '</div>' +
        '<div class="qa-body" role="list" aria-label="All notes"></div>'
      document.body.appendChild(dlg)
      // Lazily-built dialogs miss the page-load i18n pass — re-apply so FA users get
      // the localized title/placeholder/aria labels on first open (idempotent).
      try { window.hibanaI18n?.apply?.() } catch { /* i18n unavailable */ }
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close() })
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
      dlg.querySelector('[data-qa-close]').addEventListener('click', () => dlg.close())
      // Client-side filter over the RENDERED rows (title/excerpt + meta text).
      // Persian digit normalization (the app's i18n rule): a query typed with Persian
      // digits (۷) must match Latin digits in the content (7) — both sides normalize.
      const normDigits = (s) => s.replace(/[۰-۹٠-٩]/g, (ch) => {
        const fa = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)
        if (fa >= 0) return String(fa)
        const ar = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)
        return ar >= 0 ? String(ar) : ch
      })
      dlg.querySelector('.qa-filter').addEventListener('input', (e) => {
        const needle = normDigits(e.target.value.trim().toLowerCase())
        // S66: while filtering, the date-group headers would lie (a "Today" header with
        // zero visible rows under it) — the filtering class hides them; the count and the
        // no-match notice below tell the truth instead.
        dlg.classList.toggle('filtering', !!needle)
        for (const row of dlg.querySelectorAll('.qa-row')) {
          const hit = !needle || normDigits(row.textContent.toLowerCase()).includes(needle)
          row.classList.toggle('qa-hidden', !hit)
        }
        updateCount()
      })
      // S66 jump-to-date: the calendar button reveals the native date input (same head
      // slot) and opens its picker on the same user gesture; picking a day re-anchors the
      // list at the newest note of that local day. Escape inside the input just hides it.
      // S67 clear-jump: after a jump the list is anchored somewhere OLD and the input
      // keeps its value — a ↩ affordance appears in the head (visible even if the input
      // was hidden with Escape, because the anchor is still active) and returns the list
      // to the newest window. The picked input also carries data-jump so its border can
      // state "this filter is shaping the list" (the palette's pressed-button language).
      const dateInput = dlg.querySelector('.qa-date')
      const clearJump = dlg.querySelector('[data-qa-clearjump]')
      const jumpBtn = dlg.querySelector('[data-qa-jump]')
      const setJumpActive = (on) => {
        dateInput.dataset.jump = on ? '1' : ''
        if (dateInput.dataset.jump === '') delete dateInput.dataset.jump
        clearJump.hidden = !on
      }
      const clearJumpNow = () => {
        dateInput.value = ''
        dateInput.hidden = true
        jumpBtn.setAttribute('aria-pressed', 'false')
        setJumpActive(false)
        load({ mode: 'replace' })
      }
      clearJump.addEventListener('click', clearJumpNow)
      jumpBtn.addEventListener('click', (e) => {
        const show = dateInput.hidden
        dateInput.hidden = !show
        e.currentTarget.setAttribute('aria-pressed', String(show))
        if (show) {
          try { dateInput.showPicker() } catch { /* older engines: focus instead */ try { dateInput.focus() } catch { /* focus denied */ } }
        }
      })
      dateInput.addEventListener('change', () => {
        const v = dateInput.value
        if (!v) return
        const [y, m, d] = v.split('-').map(Number)
        const end = new Date(y, m - 1, d, 23, 59, 59, 999) // local end-of-day → UTC ISO
        setJumpActive(true)
        load({ mode: 'replace', before: end.toISOString() })
      })
      dateInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { dateInput.hidden = true } })
      // Row activation (click + keyboard — rows are role=button tabindex=0): open the
      // existing note-reader on the row's hidden full markdown render.
      const activate = (row) => {
        const render = row.querySelector('.qa-render')
        if (!render) return
        const reader = buildNoteReader()
        reader.querySelector('.note-reader-body').innerHTML = render.innerHTML
        // Archive rows aren't the live widget's cards — the reader's Edit path edits
        // #note-<id> in the widget, which beyond-cap notes don't have. Read-only here.
        const editBtn = reader.querySelector('[data-note-reader-edit]')
        if (editBtn) editBtn.hidden = true
        reader.dataset.noteId = row.dataset.archiveNote || ''
        // S65: the reader's Copy-as-Markdown source — the row carries the paste-ready
        // markdown (notes verbatim; lists as title + checkbox lines) in data-raw.
        reader.dataset.raw = row.dataset.raw || ''
        setReaderMeta(reader, reader.dataset.raw) // S66: the reading-time estimate
        reader.showModal()
      }
      dlg.querySelector('.qa-body').addEventListener('click', (e) => {
        const row = e.target.closest('.qa-row')
        if (row) activate(row)
      })
      dlg.querySelector('.qa-body').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        const row = e.target.closest('.qa-row')
        if (!row) return
        e.preventDefault()
        activate(row)
      })
      // S65: arrow-key roving through the rows (the S63 vault-menu language): the list
      // is a vertical scan surface — ArrowUp/Down walk it, Home/End jump the edges.
      // Bound on the DIALOG (not .qa-body) so the keys work from the filter too —
      // ArrowDown enters the list at the top, ArrowUp from outside enters at the bottom
      // (the cmdk palette convention). Only VISIBLE rows participate (filter-skipped).
      dlg.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
        const rows = Array.from(dlg.querySelectorAll('.qa-row:not(.qa-hidden)'))
        if (!rows.length) return
        e.preventDefault()
        const idx = rows.indexOf(document.activeElement)
        let next = 0
        if (e.key === 'ArrowDown') next = idx < 0 ? 0 : Math.min(rows.length - 1, idx + 1)
        else if (e.key === 'ArrowUp') next = idx < 0 ? rows.length - 1 : Math.max(0, idx - 1)
        else if (e.key === 'End') next = rows.length - 1
        rows[next].focus()
      })
      return dlg
    }

    const faDig = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
    const dig = (n) => (window.hibanaI18n && window.hibanaI18n.lang && window.hibanaI18n.lang() === 'fa' ? faDig(String(n)) : String(n))
    const updateCount = () => {
      if (!dlg) return
      const shown = dlg.querySelectorAll('.qa-row:not(.qa-hidden)').length
      const filter = dlg.querySelector('.qa-filter')
      const filtering = filter && filter.value.trim() !== ''
      dlg.querySelector('.qa-count').textContent = filtering
        ? dig(shown) + ' / ' + dig(total)
        : dig(total)
      // S66: an honest dead end — filtering to zero shows "no notes match", not a
      // silently blank body.
      const nm = dlg.querySelector('.qa-nomatch')
      if (nm) nm.hidden = !(filtering && shown === 0)
    }

    // ---- S66: date-group headers — Today / Yesterday / This week / This month / Earlier.
    // Computed CLIENT-side from each row's data-ts against the browser's local now: the
    // user's own calendar day decides "today" (a server UTC boundary would be wrong by
    // hours for +03:30). Recomputed from scratch after every render (replace/append/
    // prepend) — idempotent by construction, so pagination can never duplicate a header.
    // While the filter is active the headers hide (they'd lie about visible rows).
    const DAY_MS = 86_400_000
    const sameLocalDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    const bucketOf = (iso) => {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return 'earlier'
      const now = new Date()
      const yest = new Date(now.getTime() - DAY_MS)
      if (sameLocalDay(d, now)) return 'today'
      if (sameLocalDay(d, yest)) return 'yesterday'
      if (d.getTime() > now.getTime() - 7 * DAY_MS) return 'week'
      if (d.getTime() > now.getTime() - 30 * DAY_MS) return 'month'
      return 'earlier'
    }
    const GROUP_FALLBACK = { today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', earlier: 'Earlier' }
    const GROUP_KEY = { today: 'qn.today', yesterday: 'qn.yesterday', week: 'qn.thisWeek', month: 'qn.thisMonth', earlier: 'qn.earlier' }
    const regroup = () => {
      const body = dlg ? dlg.querySelector('.qa-body') : null
      if (!body) return
      for (const g of body.querySelectorAll('.qa-group')) g.remove()
      let prev = null
      for (const row of body.querySelectorAll('.qa-row')) {
        const b = bucketOf(row.dataset.ts || '')
        if (b !== prev) {
          const g = document.createElement('div')
          g.className = 'qa-group'
          g.setAttribute('data-i18n', GROUP_KEY[b])
          g.textContent = _t(GROUP_KEY[b], GROUP_FALLBACK[b])
          row.before(g)
          prev = b
        }
      }
    }
    // The flash language shared by the anchored open (S64) and the date jump (S66):
    // center the row, one accent pulse, self-clearing.
    const flashRow = (row) => {
      if (!row) return
      row.scrollIntoView({ block: 'center' })
      row.classList.add('note-jump')
      setTimeout(() => row.classList.remove('note-jump'), 2600)
    }
    // S66: the filter's dead-end notice lives at the END of the body (after pagers) —
    // renderFragment's replace mode wipes the body, so re-create it idempotently.
    const ensureNomatch = () => {
      const body = dlg ? dlg.querySelector('.qa-body') : null
      if (!body) return
      let nm = body.querySelector('.qa-nomatch')
      if (!nm) {
        nm = document.createElement('div')
        nm.className = 'qa-nomatch muted'
        nm.setAttribute('data-i18n', 'qn.noMatch')
        nm.textContent = _t('qn.noMatch', 'No notes match the filter.')
        body.appendChild(nm)
      }
      return nm
    }

    // Renders a fetched fragment into the body. mode: 'replace' (fresh open), 'append'
    // (load more), 'prepend' (load newer). Wires the pagination buttons from the
    // wrapper's data attrs.
    const renderFragment = (htmlText, mode, anchoredId, q) => {
      const body = dlg.querySelector('.qa-body')
      const tpl = document.createElement('template')
      tpl.innerHTML = htmlText.trim()
      const wrap = tpl.content.querySelector('.qa-rows')
      if (!wrap) throw new Error('bad fragment')
      total = Number(wrap.dataset.total) || 0
      const rows = Array.from(wrap.querySelectorAll('.qa-row'))
      const newLo = Number(wrap.dataset.prevOffset) || 0
      const newHi = newLo + rows.length
      if (mode === 'replace') {
        body.innerHTML = ''
        lo = newLo
        hi = newHi
        for (const r of rows) body.appendChild(r)
      } else if (mode === 'append') {
        hi = newHi
        const more = body.querySelector('.qa-more')
        if (more) more.before(...rows) // keep the pager at the bottom
        else for (const r of rows) body.appendChild(r)
      } else {
        // prepend — the newer-notes pager must stay at the very top
        const newer = body.querySelector('.qa-newer')
        if (newer) newer.after(...rows)
        else body.prepend(...rows)
        lo = newLo
      }
      ensureNomatch()
      finishPagers(lo, hi)
      regroup()
      // S66 jump-to-date: the wrapper's data-land says how the server resolved `before`.
      // A fallback (nothing that old) toasts honestly; either way the landed row flashes.
      const land = wrap.dataset.land || ''
      if (land) {
        if (land === 'before-fallback') toast(_t('qn.noOlder', 'No notes that far back — showing the oldest.'), 'info', 6000)
        flashRow(body.querySelector('.qa-row.qa-anchored'))
      }
      // Anchored open: flash the row + mark the excerpt hit (same language as the S64
      // jump). The hidden .qa-render's mark would never be seen until the reader opens.
      if (anchoredId) {
        const row = body.querySelector('#an-' + CSS.escape(anchoredId))
        if (row) {
          flashRow(row)
          const needle = String(q || '').toLowerCase()
          const text = row.querySelector('.qa-text')
          const v = text ? text.textContent : ''
          const i = needle ? v.toLowerCase().indexOf(needle) : -1
          if (i >= 0 && text) {
            const mark = document.createElement('mark')
            mark.className = 'note-jump'
            mark.textContent = v.slice(i, i + needle.length)
            text.textContent = ''
            text.append(document.createTextNode(v.slice(0, i)), mark, document.createTextNode(v.slice(i + needle.length)))
          }
        }
      }
    }

    // (Re)creates the pager buttons from the loaded window [lo, hi).
    const finishPagers = (l, h) => {
      const body = dlg.querySelector('.qa-body')
      let more = body.querySelector('.qa-more')
      let newer = body.querySelector('.qa-newer')
      if (h < total) {
        if (!more) {
          more = document.createElement('button')
          more.type = 'button'
          more.className = 'qa-more ghost'
          more.setAttribute('data-i18n', 'qn.loadMore')
          more.textContent = 'Load more'
          more.addEventListener('click', () => load({ mode: 'append' }))
          body.appendChild(more)
        }
        more.hidden = false
      } else if (more) more.hidden = true
      if (l > 0) {
        if (!newer) {
          newer = document.createElement('button')
          newer.type = 'button'
          newer.className = 'qa-newer ghost'
          newer.setAttribute('data-i18n', 'qn.loadNewer')
          newer.textContent = 'Newer notes'
          newer.addEventListener('click', () => load({ mode: 'prepend' }))
          body.prepend(newer)
        }
        newer.hidden = false
      } else if (newer) newer.hidden = true
      updateCount()
    }

    const load = async ({ mode = 'replace', anchor, q, before } = {}) => {
      if (!dlg || loading) return
      loading = true
      try {
        // Prepend fetches EXACTLY the missing window [lo - n, lo) — a full PAGE would
        // overlap rows already loaded after an anchored open (lo = pos - PAGE/2).
        const n = mode === 'prepend' ? Math.min(PAGE, lo) : PAGE
        const offset = mode === 'append' ? hi : mode === 'prepend' ? lo - n : 0
        const qs = '?offset=' + offset + '&limit=' + n + (anchor ? '&anchor=' + encodeURIComponent(anchor) : '') + (before ? '&before=' + encodeURIComponent(before) : '')
        const res = await fetch('/api/notes/archive' + qs, { headers: { Accept: 'text/html' } })
        if (!res.ok) throw new Error('archive ' + res.status)
        renderFragment(await res.text(), mode, anchor, q)
        return true
      } catch {
        toast(_t('qn.archiveFailed', 'Could not load the archive — try again.'), 'err')
        return false
      } finally { loading = false }
    }

    const open = async () => {
      buildDialog()
      dlg.querySelector('.qa-filter').value = ''
      // A fresh open always lands on the newest window — any prior jump state resets
      // (S67: the clear-jump affordance belongs to a LIVE jump, not a reopened dialog).
      try {
        const di = dlg.querySelector('.qa-date')
        di.value = ''
        di.hidden = true
        dlg.querySelector('[data-qa-jump]').setAttribute('aria-pressed', 'false')
        dlg.querySelector('[data-qa-clearjump]').hidden = true
        if ('jump' in di.dataset) delete di.dataset.jump
      } catch { /* head not built */ }
      dlg.showModal()
      // S65: land the keyboard in the filter — the dialog's primary scanning control.
      try { dlg.querySelector('.qa-filter').focus() } catch { /* focus denied */ }
      await load({ mode: 'replace' })
    }

    const openAt = async (id, q) => {
      buildDialog()
      dlg.querySelector('.qa-filter').value = ''
      try {
        const di = dlg.querySelector('.qa-date')
        di.value = ''
        di.hidden = true
        dlg.querySelector('[data-qa-jump]').setAttribute('aria-pressed', 'false')
        dlg.querySelector('[data-qa-clearjump]').hidden = true
        if ('jump' in di.dataset) delete di.dataset.jump
      } catch { /* head not built */ }
      dlg.showModal()
      try { dlg.querySelector('.qa-filter').focus() } catch { /* focus denied */ }
      const ok = await load({ mode: 'replace', anchor: id, q })
      if (ok && !dlg.querySelector('#an-' + CSS.escape(id))) {
        // The anchor note no longer exists (deleted since it was searched) — the archive
        // opened at the top; say what happened instead of a silent no-show.
        toast(_t('qn.jumpMissing', 'That note is saved, but older than the recent list shown here.'), 'info', 6000)
      }
    }

    // The widget's footer affordance (server-rendered only when total > shown).
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-note-archive]')) { e.preventDefault(); open() }
    })

    window.hibanaArchive = { open, openAt }
  })()

  // ---- Notebook list mode: Enter drafts a line, + commits the whole list -----------------
  // The composer is a textarea (needed for note mode). In list mode each Enter turns the
  // current line into a draft row in a visible preview (nothing is saved yet — spec: show
  // the user a preview, then record the list and all its items when they tap +). The draft
  // lives on the form element, so an htmx re-render (after a commit) naturally clears it.
  // Delegated everywhere so htmx swaps never lose the behavior.
  const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const draftLines = (form) => (form.__draftLines = form.__draftLines || [])
  const DRAFT_CHECK = '<span class="draft-check" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/></svg></span>'
  const DRAFT_X = (i) => '<button type="button" class="ghost danger" data-draft-remove="' + i + '" aria-label="' + escHtml(_t('notes.removeDraft', 'Remove')) + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'

  function renderDraft(form) {
    const ul = form.querySelector('.note-draft')
    if (!ul) return
    const lines = draftLines(form)
    if (lines.length === 0) {
      ul.hidden = true
      ul.innerHTML = ''
      return
    }
    ul.hidden = false
    ul.innerHTML =
      `<li class="muted small draft-hint">${escHtml(_t('notes.draftHint', 'Draft — press + to save'))}</li>` +
      lines.map((t, i) => `<li class="hurdle draft-item">${DRAFT_CHECK}<span>${escHtml(t)}</span>${DRAFT_X(i)}</li>`).join('')
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    const ta = e.target
    if (!(ta instanceof HTMLTextAreaElement) || !ta.classList.contains('note-compose-text')) return
    const form = ta.closest('form[data-note-compose]')
    if (!form) return
    const mode = form.querySelector('input[name="kind"]')?.value
    const text = ta.value.trim()
    if (mode === 'list') {
      // List mode: Enter drafts a new preview item — nothing is saved until + (user request).
      e.preventDefault()
      if (!text) return
      draftLines(form).push(text) // add to the preview only — no server write yet
      ta.value = ''
      renderDraft(form)
      return
    }
    // Note mode: Enter records the note immediately (user request — write > Enter = saved).
    // Shift+Enter still breaks lines so multi-line notes stay possible.
    if (mode === 'note' && text && window.htmx) {
      e.preventDefault()
      window.htmx.ajax('POST', '/api/notes?mode=note', {
        target: '#notebook',
        swap: 'outerHTML',
        values: { kind: 'note', title: '', content: text },
      })
    }
  })

  // Commit the whole draft on + (form submit captures the click). Note mode is untouched.
  document.addEventListener('submit', (e) => {
    const form = e.target
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-note-compose')) return
    const mode = form.querySelector('input[name="kind"]')?.value
    if (mode === 'note') {
      // User request: an empty note must not be created — clicking ＋ with an empty
      // composer shows a hint instead of saving a blank card (Enter already ignores
      // empty input; this blocks the + button's natural form submit).
      const ta = form.querySelector('.note-compose-text')
      const text = ta ? ta.value.trim() : ''
      if (!text) {
        e.preventDefault()
        e.stopImmediatePropagation()
        toast(_t('notes.emptyHint', 'Write a note first'))
        ta?.focus()
      }
      return
    }
    if (mode !== 'list') return
    e.preventDefault()
    e.stopImmediatePropagation()
    const ta = form.querySelector('.note-compose-text')
    const lines = (form.__draftLines || []).slice()
    const left = ta ? ta.value.trim() : ''
    if (left) lines.push(left) // a typed-but-not-Entered tail is included on + too
    const text = lines.join('\n')
    if (!text || !window.htmx) return
    const latest = [...document.querySelectorAll('.note-card[data-kind="list"]')].at(-1)
    const id = latest ? latest.id.replace(/^note-/, '') : null
    // htmx.ajax sets the HX-Request header, so the server returns the re-rendered widget;
    // the server splits the newline-joined text into one item per line. ?mode=list keeps the
    // composer in list mode.
    const url = id ? `/api/notes/list/${id}?mode=list` : '/api/notes?mode=list'
    const values = id ? { text } : { kind: 'list', title: '', content: text }
    window.htmx.ajax('POST', url, {
      target: '#notebook',
      swap: 'outerHTML',
      values,
    })
  }, true)

  // Removing a drafted line from the preview.
  document.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-draft-remove]')
    if (!rm) return
    const form = rm.closest('form[data-note-compose]')
    if (!form) return
    const i = Number(rm.getAttribute('data-draft-remove'))
    const lines = draftLines(form)
    if (Number.isInteger(i) && i >= 0 && i < lines.length) lines.splice(i, 1)
    renderDraft(form)
  })

  // ---- Dashboard boxes: drag an item between Idea → Pending → Building ----------
  // Native HTML5 DnD, delegated (survives htmx re-renders of the strip). The row carries
  // its project id + current status; dropping it onto another status box PATCHes the
  // status, then the strip re-renders from the server — a partial swap, no page refresh.
  let dashDragRow = null
  document.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.stat-box [data-project-id]')
    if (!row) return
    dashDragRow = row
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', row.dataset.projectId)
    row.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    const box = e.target.closest('.stat-box')
    if (!dashDragRow || !box) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    box.classList.add('drag-over')
  })
  document.addEventListener('dragleave', (e) => {
    const box = e.target.closest('.stat-box')
    if (box && !box.contains(e.relatedTarget)) box.classList.remove('drag-over')
  })
  document.addEventListener('drop', async (e) => {
    const box = e.target.closest('.stat-box')
    if (!dashDragRow || !box) return
    e.preventDefault()
    const status = box.dataset.status
    const current = dashDragRow.dataset.status
    const id = dashDragRow.dataset.projectId
    const row = dashDragRow
    dashDragRow = null
    row.classList.remove('dragging')
    document.querySelectorAll('.stat-box.drag-over').forEach((b) => b.classList.remove('drag-over'))
    if (status === current) return
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) { handle401(res); throw new Error('status change failed') }
      if (window.htmx) window.htmx.ajax('GET', '/api/dashboard', { target: 'main.shell-dash', swap: 'innerHTML' })
    } catch {
      toast(_t('dashboard.moveFailed', "Couldn't move it — try again"), 'err')
    }
  })
  document.addEventListener('dragend', () => {
    if (dashDragRow) dashDragRow.classList.remove('dragging')
    dashDragRow = null
    document.querySelectorAll('.stat-box.drag-over').forEach((b) => b.classList.remove('drag-over'))
  })

  // ---- Dashboard projects strip: the stage-box carousel (batch s 2026-09-08) -----------
  // User request: "only three boxes by default, the rest behind carousel clicks". The
  // server orders the track (investigating · awaiting · doing first) and renders the
  // arrows + dots; this driver pages the scroll-snap rail. Delegated on document so it
  // survives every htmx re-render of the dashboard main; the scroll listener uses CAPTURE (scroll
  // events don't bubble, but they do capture) to keep dots/arrows honest through native
  // touch/wheel scrolls. Works in RTL too: scrollBy is direction-relative, and the dot
  // math uses abs(scrollLeft) (RTL tracks scroll negative in Chromium/FF).
  const syncStatCarousel = (track) => {
    if (!track) return
    const root = track.closest('[data-stat-carousel]')
    if (!root) return
    const dots = root.querySelector('[data-stat-dots]')
    const prev = root.querySelector('[data-stat-prev]')
    const next = root.querySelector('[data-stat-next]')
    if (!prev || !next) return
    const pos = Math.abs(track.scrollLeft)
    const page = track.clientWidth
    const pages = Math.max(1, Math.round(track.scrollWidth / Math.max(1, page)))
    const active = Math.min(pages - 1, Math.round(pos / Math.max(1, page)))
    if (dots) {
      if (dots.children.length !== pages) {
        dots.textContent = ''
        for (let i = 0; i < pages; i++) {
          const dot = document.createElement('span')
          dot.className = 'stat-dot'
          dots.appendChild(dot)
        }
      }
      ;[...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === active))
    }
    // At the ends the arrows dim out (native touch/wheel scroll still works everywhere).
    prev.disabled = pos <= 1
    next.disabled = pos >= track.scrollWidth - track.clientWidth - 1
    root.classList.toggle('at-start', pos <= 1)
    root.classList.toggle('at-end', pos >= track.scrollWidth - track.clientWidth - 1)
  }
  document.addEventListener('click', (e) => {
    const arrow = e.target.closest('[data-stat-prev], [data-stat-next]')
    if (!arrow) return
    const track = arrow.closest('[data-stat-carousel]')?.querySelector('[data-stat-track]')
    if (!track) return
    const dir = arrow.hasAttribute('data-stat-next') ? 1 : -1
    // scrollBy's left is direction-relative: positive moves toward later content in LTR,
    // toward the START in RTL — so flip for RTL (later boxes live at lower scrollLeft).
    const rtl = getComputedStyle(track).direction === 'rtl'
    // S121: reduced-motion users get the instant scroll (the smooth glide is motion
    // for motion's sake — the paging itself is unaffected; same snap endpoint lands).
    const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    track.scrollBy({ left: (rtl ? -dir : dir) * track.clientWidth, behavior: smooth ? 'smooth' : 'auto' })
  })
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.matches && e.target.matches('[data-stat-track]')) syncStatCarousel(e.target)
  }, true)
  // Initial paint + every dashboard swap (the track element is recreated by htmx).
  const initStatCarousel = () => {
    document.querySelectorAll('[data-stat-track]').forEach((t) => syncStatCarousel(t))
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, initStatCarousel)
  }
  if (document.readyState !== 'loading') initStatCarousel()

  // ---- Collapsible dashboard sections (Phase 3) ----
  // Each section header has a [data-dash-collapse] button. Clicking toggles
  // .is-collapsed on the section + persists to localStorage.
  const COLLAPSE_KEY = 'hibana-dash-collapsed'
  function getCollapsed() { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]') } catch { return [] } }
  function setCollapsed(arr) { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(arr)) } catch {} }
  function initCollapseButtons() {
    document.querySelectorAll('[data-dash-collapse]').forEach((btn) => {
      if (btn.getAttribute('data-collapse-wired')) return
      btn.setAttribute('data-collapse-wired', '1')
      const sectionId = btn.getAttribute('data-dash-collapse')
      const section = document.getElementById(sectionId) || btn.closest('section')
      if (section && getCollapsed().includes(sectionId)) section.classList.add('is-collapsed')
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation()
        if (!section) return
        section.classList.toggle('is-collapsed')
        const collapsed = getCollapsed()
        const idx = collapsed.indexOf(sectionId)
        if (section.classList.contains('is-collapsed') && idx === -1) collapsed.push(sectionId)
        else if (idx >= 0) collapsed.splice(idx, 1)
        setCollapsed(collapsed)
      })
    })
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, initCollapseButtons)
  }
  if (document.readyState !== 'loading') initCollapseButtons()

  // ---- Dashboard To-Do quadrants: phone swipe carousel (session 12, user request) -----
  // "Make the to-do-list quadrant only show 1 in mobile, the rest by swipe." ≤720px the
  // grid is a scroll-snap rail — ONE full-width quadrant per slide. The dot row is built
  // from the rendered quadrants (data-dash-name → aria-labels) and re-built after every
  // htmx swap of main.shell-dash; the user's slide SURVIVES the refresh (the fresh grid
  // scrolls back to where they were, no smooth — no flash). RTL: modern browsers report
  // NEGATIVE scrollLeft on an RTL container, so |scrollLeft| / clientWidth is the slide
  // index in both directions; the sign flips only when WE scroll. Same pattern as the
  // Sadhana board's carousel (session 9).
  const dashQuadPhone = () => window.matchMedia('(max-width: 720px)').matches
  let dashQuadSlide = 0
  let dashQuadRaf = 0
  let dashSwipeHintHidden = false
  const dashQuadGrid = () => document.querySelector('[data-dash-quadrants]')
  const dashQuadIndex = () => {
    const g = dashQuadGrid()
    if (!g) return 0
    const n = g.querySelectorAll('.dash-todo-quadrant').length || 1
    return Math.max(0, Math.min(n - 1, Math.round(Math.abs(g.scrollLeft) / Math.max(1, g.clientWidth))))
  }
  const syncDashQuadDots = () => {
    const i = dashQuadIndex()
    document.querySelectorAll('[data-dash-quad-dots] .dash-quad-dot').forEach((d, k) => {
      d.classList.toggle('active', k === i)
      d.setAttribute('aria-selected', k === i ? 'true' : 'false')
    })
  }
  const goToDashQuad = (i) => {
    const g = dashQuadGrid()
    if (!g) return
    const n = g.querySelectorAll('.dash-todo-quadrant').length
    const target = Math.max(0, Math.min(n - 1, i))
    const sign = getComputedStyle(g).direction === 'rtl' ? -1 : 1
    g.scrollTo({ left: sign * target * g.clientWidth, behavior: 'smooth' })
    hideDashSwipeHint()
  }
  const hideDashSwipeHint = () => {
    dashSwipeHintHidden = true
    const h = document.querySelector('[data-dash-swipe-hint]')
    if (h) h.classList.add('hide')
  }
  const wireDashSwipeHint = () => {
    const h = document.querySelector('[data-dash-swipe-hint]')
    if (!h) return
    if (dashSwipeHintHidden || !dashQuadPhone()) { h.classList.add('hide'); return }
    h.classList.remove('hide')
    setTimeout(hideDashSwipeHint, 4000)
  }
  const buildDashQuadDots = () => {
    const wrap = document.querySelector('[data-dash-quad-dots]')
    const g = dashQuadGrid()
    if (!wrap || !g) return
    const quads = Array.prototype.slice.call(g.querySelectorAll('.dash-todo-quadrant'))
    wrap.textContent = ''
    if (quads.length < 2) return
    quads.forEach((q, k) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'dash-quad-dot'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', 'false')
      const label = q.getAttribute('data-dash-name') || `Section ${k + 1}`
      b.setAttribute('aria-label', label)
      b.title = label
      b.addEventListener('click', () => goToDashQuad(k))
      wrap.appendChild(b)
    })
    // The grid element is RECREATED by every htmx swap (scroll resets to slide 0) —
    // put the user back on the slide they were reading.
    if (dashQuadPhone() && dashQuadSlide > 0) {
      const sign = getComputedStyle(g).direction === 'rtl' ? -1 : 1
      g.scrollTo({ left: sign * Math.min(dashQuadSlide, quads.length - 1) * g.clientWidth })
    }
    syncDashQuadDots()
    wireDashSwipeHint()
  }
  // Capture-phase document scroll: works across the recreated grid elements without
  // re-binding (same trick as the stage carousel above).
  document.addEventListener('scroll', (e) => {
    const t = e.target
    if (!t || !t.matches || !t.matches('[data-dash-quadrants]')) return
    hideDashSwipeHint()
    if (dashQuadRaf) return
    dashQuadRaf = requestAnimationFrame(() => {
      dashQuadRaf = 0
      dashQuadSlide = dashQuadIndex()
      syncDashQuadDots()
    })
  }, true)
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, buildDashQuadDots)
  }
  window.addEventListener('resize', buildDashQuadDots)
  if (document.readyState !== 'loading') buildDashQuadDots()

  // ---- Dashboard To-Do preview: shared Sadhana data, local card UI state -------------
  // The preview never owns task data. It posts to the Sadhana endpoints and refreshes the
  // dashboard fragment, so completion, notes, progress, and renames stay in sync with the
  // dedicated /to-do-list page.
  const refreshDashboard = () => {
    if (window.htmx) window.htmx.ajax('GET', '/api/dashboard', { target: 'main.shell-dash', swap: 'innerHTML' })
  }
  const closeDashMenu = (el) => {
    const menu = el?.closest?.('.dash-todo-menu')
    if (menu) menu.open = false
  }
  const dashTaskRequest = async (id, body) => {
    const res = await fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) { handle401(res); throw new Error('task update failed') }
  }
  const refreshTaskSurface = (row) => {
    if (document.querySelector('main.shell-dash')) return refreshDashboard()
    const focus = row?.closest?.('#sadhana-focus[data-focus-q]')
    if (focus?.dataset.focusQ && window.htmx) {
      window.htmx.ajax('GET', `/api/sadhana/focus/${encodeURIComponent(focus.dataset.focusQ)}`, { target: '#sadhana-focus', swap: 'innerHTML' })
      return
    }
    if (document.querySelector('#sadhana-zone') && window.htmx) window.htmx.ajax('GET', '/api/sadhana', { target: '#sadhana-zone', swap: 'outerHTML' })
  }

  document.addEventListener('click', (e) => {
    const quadrantStyle = e.target.closest('[data-sadhana-style]')
    if (quadrantStyle) {
      const card = quadrantStyle.closest('.sadhana-quadrant')
      const pop = card?.querySelector(`[data-sadhana-style-pop="${quadrantStyle.dataset.sadhanaStyle}"]`)
      if (pop) {
        pop.hidden = !pop.hidden
        if (!pop.hidden) {
          pop.style.position = 'fixed'
          const rect = quadrantStyle.getBoundingClientRect()
          const width = pop.offsetWidth || 288
          pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px'
          pop.style.top = Math.max(8, Math.min(window.innerHeight - (pop.offsetHeight || 240) - 8, rect.bottom + 6)) + 'px'
        }
      }
      return
    }
    const quadrantChoice = e.target.closest('[data-sadhana-icon], [data-sadhana-accent]')
    if (quadrantChoice) {
      const card = quadrantChoice.closest('.sadhana-quadrant')
      const quadrant = card?.dataset.quadrant
      const iconChoice = quadrantChoice.dataset.sadhanaIcon
      const accentChoice = quadrantChoice.dataset.sadhanaAccent
      if (!card || !quadrant || (!iconChoice && !accentChoice)) return
      if (iconChoice) {
        const trigger = card.querySelector('[data-sadhana-style]')
        // S83: the EMPTY choice clears the trigger (the 'none' sentinel renders nothing)
        if (trigger) trigger.innerHTML = iconChoice === 'none' ? '' : quadrantChoice.innerHTML
        card.querySelectorAll('[data-sadhana-icon]').forEach((el) => el.classList.toggle('is-selected', el === quadrantChoice))
      }
      if (accentChoice) {
        // S93: 'none' clears the picked pastel (PATCH accent_color: null); a token sets it.
        card.dataset.sadhanaAccent = accentChoice
        if (accentChoice === 'none') card.style.removeProperty('--q-accent')
        else card.style.setProperty('--q-accent', `var(--${accentChoice})`)
        card.querySelectorAll('[data-sadhana-accent]').forEach((el) => el.classList.toggle('is-selected', el === quadrantChoice))
      }
      const name = card.dataset.sadhanaName || ''
      const body = iconChoice ? { name, icon_id: iconChoice } : { name, accent_color: accentChoice === 'none' ? null : accentChoice }
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
      return
    }

    // Phase 5 item 15 (2026-09-08): the dashboard task's 3-dot progress track.
    // (v) 2026-09-09: sadhana.html's setProgress semantics — clicking the
    // ALREADY-ACTIVE state (anything but untouched) resets the task to untouched;
    // the track rides under the row inside its pill board, always visible. PATCHes
    // { progress } and repaints IN PLACE — active dot + label + the row's state
    // board tint — no full section refresh (the quadrant keeps its scroll state).
    const progDot = e.target.closest('.dash-todo-task [data-prog-state]')
    if (progDot) {
      e.preventDefault()
      const state = progDot.dataset.progState
      const track = progDot.closest('.prog-track')
      const row = progDot.closest('.dash-todo-task')
      const id = track?.dataset.dashProg
      if (!track || !row || !id) return
      // the to-do page's reset rule: the same dot never "sticks" (except untouched)
      const activeDot = track.querySelector('.prog-dot.p-active')
      const current = activeDot?.dataset.progState ?? 'untouched'
      const next = (state === current && state !== 'untouched') ? 'untouched' : state
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ progress: next }),
      })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('progress failed') }
          const stateClass = next === 'in_progress' ? 'st-inprog' : next === 'on_hold' ? 'st-hold' : 'st-untouched'
          row.classList.remove('st-untouched', 'st-inprog', 'st-hold')
          row.classList.add(stateClass)
          track.classList.remove('st-untouched', 'st-inprog', 'st-hold')
          track.classList.add(stateClass)
          track.querySelectorAll('.prog-dot').forEach((d) => {
            const active = d.dataset.progState === next
            d.classList.toggle('p-active', active)
            d.setAttribute('aria-pressed', String(active))
          })
          const lbl = track.querySelector('.prog-lbl')
          if (lbl) lbl.textContent = track.querySelector(`.prog-dot[data-prog-state="${next}"]`)?.getAttribute('title') || lbl.textContent
        })
        .catch(() => toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err'))
      return
    }

    // S82: [data-task-complete] now rides on the CHECKBOX INPUT itself (dashboard to-do
    // rows) — the old <label> wrapper meant ANY click inside the row (title included)
    // completed the task; a miss-click lost it. The sadhana board's .toggle button
    // (board.html legacy surface) still carries the attr on the button — both shapes
    // resolve below. The stale label-forwarding fallback is gone with the label.
    const complete = e.target.closest('[data-task-complete]')
    if (complete) {
      e.preventDefault()
      const id = complete.dataset.taskComplete
      const row = complete.closest('.dash-todo-task, .sadhana-card')
      if (!id || !row || row.classList.contains('is-completing')) return
      const checkbox = complete instanceof HTMLInputElement ? complete : complete.querySelector('input[type="checkbox"]')
      const reopening = checkbox?.dataset.taskDone === '1' || complete.dataset.taskDone === '1'
      if (checkbox) { checkbox.checked = true; checkbox.disabled = true }
      row.classList.add('is-completing')
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('complete failed') }
          // S143: the rail panel follows the complete in the same beat (no physical refresh).
          try { document.dispatchEvent(new CustomEvent('hibana:tasks-changed', { detail: { source: 'board' } })) } catch { /* older engines */ }
          window.setTimeout(() => {
            row.classList.add('is-removing')
            window.setTimeout(() => refreshTaskSurface(row), 320)
          }, 1000)
        })
        .catch(() => {
          row.classList.remove('is-completing')
          if (checkbox) { checkbox.checked = false; checkbox.disabled = false }
          toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err')
        })
      return
    }

    const taskEditOpen = e.target.closest('[data-task-edit-open]')
    if (taskEditOpen) {
      const row = taskEditOpen.closest('.dash-todo-task, .sadhana-card')
      const form = row?.querySelector(`[data-task-edit-form="${taskEditOpen.dataset.taskEditOpen}"]`)
      if (form) {
        form.hidden = false
        taskEditOpen.setAttribute('aria-expanded', 'true')
        form.querySelector('.task-edit-error')?.setAttribute('hidden', '')
        const input = form.querySelector('input[name="title"]')
        if (input && !input.dataset.originalTitle) input.dataset.originalTitle = input.value
        input?.focus()
        input?.select()
      }
      return
    }
    const taskEditCancel = e.target.closest('[data-task-edit-cancel]')
    if (taskEditCancel) {
      const form = taskEditCancel.closest('[data-task-edit-form]')
      if (form) {
        form.hidden = true
        form.closest('.dash-todo-task, .sadhana-card')?.querySelector('[data-task-edit-open]')?.setAttribute('aria-expanded', 'false')
      }
      return
    }
    const taskNoteToggle = e.target.closest('[data-task-note-toggle]')
    if (taskNoteToggle) {
      const row = taskNoteToggle.closest('.dash-todo-task, .sadhana-card')
      const panel = row?.querySelector(`[data-task-notes-panel="${taskNoteToggle.dataset.taskNoteToggle}"]`)
      if (panel) {
        const open = panel.hidden
        panel.hidden = !open
        taskNoteToggle.setAttribute('aria-expanded', String(open))
        if (open) panel.querySelector('textarea')?.focus()
      }
      return
    }
    const taskNoteDelete = e.target.closest('[data-task-note-delete]')
    if (taskNoteDelete) {
      const legacyTask = taskNoteDelete.dataset.noteLegacyTask
      const noteId = taskNoteDelete.dataset.taskNoteDelete
      const url = legacyTask
        ? `/api/sadhana/tasks/${encodeURIComponent(legacyTask)}/notes/legacy`
        : `/api/sadhana/notes/${encodeURIComponent(noteId || '')}`
      taskNoteDelete.disabled = true
      fetch(url, { method: 'DELETE' })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('note delete failed') }; refreshTaskSurface() })
        .catch(() => { taskNoteDelete.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }
    const taskProgress = e.target.closest('[data-task-progress]')
    if (taskProgress) {
      const id = taskProgress.dataset.taskId
      const progress = taskProgress.dataset.taskProgress
      if (!id || !progress) return
      taskProgress.disabled = true
      dashTaskRequest(id, { progress })
        .then(refreshTaskSurface)
        .catch(() => { taskProgress.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const seeMore = e.target.closest('[data-dash-see-more]')
    if (seeMore) {
      const card = seeMore.closest('.dash-todo-quadrant')
      if (!card) return
      const expanded = card.classList.toggle('is-expanded')
      // S106: the 4-visible glance cap. EXPAND unhides every row; COLLAPSE re-hides
      // every row from index 4 onward (the rows the server ships hidden — the DOM
      // order IS the display order). The old handler queried '.dash-todo-task[hidden]'
      // — at collapse time NOTHING has the attribute (all rows were unhidden), so the
      // forEach was a silent NO-OP and the collapse never actually folded the list
      // (a latent S69 bug, never pinned until the S106 spec exercised both clicks).
      card.querySelectorAll('.dash-todo-task').forEach((task, index) => {
        task.hidden = expanded ? false : index >= 4
      })
      if (expanded) {
        seeMore.textContent = _t('dashboard.seeLess', 'Show less')
      } else {
        const hidden = card.querySelectorAll('.dash-todo-task[hidden]').length
        // _t is a plain lookup (no params) — the {n} substitution happens here, the
        // same template shape the server renders ('+{n} more' / '+{n} بیشتر').
        // Farsi digits follow the UI script (the rail's railFaDig precedent).
        const fa = (window.hibanaI18n?.lang?.() || 'en') === 'fa'
        const n = fa ? String(hidden).replace(/\d/g, (x) => '۰۱۲۳۴۵۶۷۸۹'[+x]) : String(hidden)
        seeMore.textContent = _t('dashboard.moreCount', '+{n} more').replace('{n}', n)
      }
      seeMore.setAttribute('aria-expanded', expanded ? 'true' : 'false')
      return
    }

    const moveTask = e.target.closest('[data-dash-move-task]')
    if (moveTask) {
      const task = moveTask.closest('.dash-todo-task')
      const card = task?.closest('.dash-todo-quadrant')
      const list = dashTaskList(card)
      const tasks = list ? [...list.querySelectorAll(':scope > .dash-todo-task')] : []
      const index = task ? tasks.indexOf(task) : -1
      const direction = moveTask.dataset.dashMoveTask
      const adjacent = direction === 'start' ? tasks[index - 1] : tasks[index + 1]
      if (!task || !card || !adjacent || task.classList.contains('is-pinned') !== adjacent.classList.contains('is-pinned')) return
      if (direction === 'start') list.insertBefore(task, adjacent)
      else list.insertBefore(adjacent, task)
      task.classList.add('move-pending')
      persistDashOrder(card).then(() => task.classList.remove('move-pending')).catch(() => { task.classList.remove('move-pending'); refreshDashboard(); toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      closeDashMenu(moveTask)
      return
    }

    const styleTrigger = e.target.closest('[data-dash-style]')
    if (styleTrigger) {
      const card = styleTrigger.closest('.dash-todo-quadrant')
      const pop = card?.querySelector(`[data-dash-style-pop="${styleTrigger.dataset.dashStyle}"]`)
      if (pop) pop.hidden = !pop.hidden
      return
    }
    // Phase 7 item 1: the redesigned pop's لغو button — just closes it (the ذخیره button
    // is the form's submit; the existing submit listener does the PATCH + refresh).
    const styleCancel = e.target.closest('[data-dash-style-cancel]')
    if (styleCancel) {
      const card = styleCancel.closest('.dash-todo-quadrant')
      const pop = card?.querySelector(`[data-dash-style-pop="${styleCancel.dataset.dashStyleCancel}"]`)
      if (pop) pop.hidden = true
      return
    }
    // Phase 6 item 2: the customize popover's symbol button opens the shared
    // full-library emoji picker (emoji-picker.js + emoji-data.js). Picking PATCHes
    // icon_id through the SAME API the old 40-emoji grid used, then repaints the
    // quadrant's trigger + the preview button. The accent swatches are long gone
    // ("color is for icons, now we use emojis").
    const styleOpen = e.target.closest('[data-dash-icon-open]')
    if (styleOpen) {
      const card = styleOpen.closest('.dash-todo-quadrant')
      const quadrant = card?.dataset.dashQuadrant
      const name = card?.dataset.dashName
      if (!card || !quadrant || !name || !window.hibanaEmojiPicker) return
      window.hibanaEmojiPicker.open({
        anchor: styleOpen,
        current: styleOpen.dataset.current || '📌',
        onPick: (emoji) => {
          const trigger = card.querySelector('[data-dash-style]')
          if (trigger) trigger.innerHTML = `<span class="quadrant-emoji">${emoji}</span>`
          styleOpen.dataset.current = emoji
          styleOpen.textContent = emoji
          // S83: a real emoji pick un-arms the EMPTY option in the same popover
          card.querySelectorAll('[data-dash-icon-empty]').forEach((el) => { el.classList.remove('is-selected'); el.setAttribute('aria-pressed', 'false') })
          fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, icon_id: emoji }),
          }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
        },
      })
      return
    }

    // S83 (owner request — "ability to choose EMPTY, no icon and no emoji, for people
    // who prefer minimalism"): the ∅ button beside the emoji picker arms the 'none'
    // sentinel — PATCHes icon_id 'none', clears the quadrant's trigger glyph (the
    // :empty trigger collapses to a hover-ghost), and reflects the armed state.
    const styleEmpty = e.target.closest('[data-dash-icon-empty]')
    if (styleEmpty) {
      const card = styleEmpty.closest('.dash-todo-quadrant')
      const quadrant = card?.dataset.dashQuadrant
      const name = card?.dataset.dashName
      if (!card || !quadrant || !name) return
      const trigger = card.querySelector('[data-dash-style]')
      if (trigger) trigger.innerHTML = ''
      const emoBtn = card.querySelector('[data-dash-icon-open]')
      if (emoBtn) { emoBtn.dataset.current = ''; emoBtn.textContent = '—' }
      styleEmpty.classList.add('is-selected')
      styleEmpty.setAttribute('aria-pressed', 'true')
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, icon_id: 'none' }),
      }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
      return
    }

    // S93 (owner round, item 6 — the 16 pastel swatches in the DASHBOARD quadrant
    // popover): immediate PATCH, exactly like the ∅ icon button above — 'none' clears
    // (accent_color: null), a token sets it; the card's --dash-q-accent flips in place so
    // the tint is visible before the htmx refresh lands.
    const dashAccent = e.target.closest('[data-dash-accent]')
    if (dashAccent) {
      const card = dashAccent.closest('.dash-todo-quadrant')
      const quadrant = card?.dataset.dashQuadrant
      const token = dashAccent.dataset.dashAccent
      if (!card || !quadrant || !token) return
      if (token === 'none') card.style.removeProperty('--dash-q-accent')
      else card.style.setProperty('--dash-q-accent', `var(--${token})`)
      card.querySelectorAll('[data-dash-accent]').forEach((el) => el.classList.toggle('is-selected', el === dashAccent))
      const name = card.dataset.dashName || ''
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, accent_color: token === 'none' ? null : token }),
      }).then((res) => { if (!res.ok) { handle401(res); throw new Error('style update failed') } }).catch(() => toast(_t('dashboard.styleFailed', "Couldn't update the quadrant"), 'err'))
      return
    }

    // (k) 2026-09-06: the circular + FAB pinned to each quadrant's bottom corner
    // (inline-end: left in RTL, right in LTR — pure CSS logical property) reveals
    // the inline quick-add row.
    // (m) 2026-09-06 user request — "submitting must ALSO be possible by clicking the
    // + button again: click + → input appears → click + again → task registers".
    // The FAB is now a two-state control: hidden form → reveal + focus; visible form
    // → requestSubmit (Enter still works; empty input trips the native required
    // bubble). The submit handler's in-flight flag makes a double-click safe.
    const quickAdd = e.target.closest('[data-dash-quickadd-fab]')
    if (quickAdd) {
      const form = quickAdd.closest('.dash-todo-quadrant')?.querySelector(`[data-dash-quickadd-form="${quickAdd.dataset.dashQuickaddFab}"]`)
      if (form) {
        if (form.hidden) {
          form.hidden = false
          form.querySelector('input')?.focus()
        } else {
          form.requestSubmit()
        }
      }
      return
    }

    // (m) 2026-09-06: per-task delete (⋯ menu). Soft-delete → row collapse → refresh;
    // the toast offers Undo (POST /restore) — the board's pattern, no confirm modal.
    const dashDelete = e.target.closest('[data-dash-delete]')
    if (dashDelete) {
      const id = dashDelete.dataset.dashDelete
      closeDashMenu(dashDelete)
      if (!id) return
      const row = dashDelete.closest('.dash-todo-task')
      dashDelete.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('delete failed') }
          row?.classList.add('is-removing')
          setTimeout(refreshDashboard, 320)
          toast(_t('dashboard.taskDeleted', 'Task deleted'), 'info', 6000, [{
            label: _t('notes.undo', 'Undo'),
            onClick: () => {
              fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/restore`, { method: 'POST' })
                .then((res) => { if (!res.ok) { handle401(res); throw new Error('restore failed') }; refreshDashboard() })
                .catch(() => toast(_t('dashboard.taskRestoreFailed', "Couldn't restore the task"), 'err'))
            },
          }])
        })
        .catch(() => { dashDelete.disabled = false; toast(_t('dashboard.taskDeleteFailed', "Couldn't delete the task"), 'err') })
      return
    }

    // (m) 2026-09-06: "Notes" in the ⋯ menu opens the note history panel (same panel
    // as clicking a note chip — works for note-less tasks too, so notes can be added
    // without ever visiting the to-do board).
    // (o) 2026-09-07: openDashNotePanel runs BEFORE closeDashMenu — its synchronous
    // anchor-rect snapshot needs the ⋯ menu still laid out; closing first feeds the
    // placer garbage coordinates (the bottom-right-corner bug).
    const notePanelTrigger = e.target.closest('[data-dash-note-panel]')
    if (notePanelTrigger) {
      openDashNotePanel(notePanelTrigger.dataset.dashNotePanel, notePanelTrigger)
      closeDashMenu(notePanelTrigger)
      return
    }

    const rename = e.target.closest('[data-dash-rename]')
    if (rename) {
      const form = rename.closest('.dash-todo-qtitle')?.querySelector(`[data-dash-rename-form="${rename.dataset.dashRename}"]`)
      if (form) {
        form.hidden = false
        rename.hidden = true
        form.querySelector('input')?.focus()
        form.querySelector('input')?.select()
      }
      return
    }

    const editOpen = e.target.closest('[data-dash-edit-open]')
    if (editOpen) {
      const editor = editOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-edit-form="${editOpen.dataset.dashEditOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.querySelector('.dash-todo-edit-error')?.setAttribute('hidden', '')
        const input = editor.querySelector('input[name="title"]')
        input?.focus()
        input?.select()
      }
      closeDashMenu(editOpen)
      return
    }

    const editCancel = e.target.closest('[data-dash-edit-cancel]')
    if (editCancel) {
      const editor = editCancel.closest('[data-dash-edit-form]')
      if (editor) editor.hidden = true
      return
    }

    const noteOpen = e.target.closest('[data-dash-note-open]')
    if (noteOpen) {
      const editor = noteOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-note-editor="${noteOpen.dataset.dashNoteOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.querySelector('textarea')?.focus()
        noteOpen.setAttribute('aria-expanded', 'true')
        editor.closest('.dash-todo-task')?.querySelectorAll('[data-dash-note-open]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'))
      }
      closeDashMenu(noteOpen)
      return
    }

    const progressOpen = e.target.closest('[data-dash-progress-open]')
    if (progressOpen) {
      const editor = progressOpen.closest('.dash-todo-task')?.querySelector(`[data-dash-progress-editor="${progressOpen.dataset.dashProgressOpen}"]`)
      if (editor) {
        editor.hidden = false
        editor.closest('.dash-todo-task')?.querySelectorAll('[data-dash-progress-open]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'true'))
        editor.querySelector('[data-dash-progress]')?.focus()
      }
      closeDashMenu(progressOpen)
      return
    }

    const progress = e.target.closest('[data-dash-progress]')
    if (progress) {
      const id = progress.dataset.dashProgress
      const state = progress.dataset.progressState
      if (!id || !state) return
      progress.disabled = true
      dashTaskRequest(id, { progress: state })
        .then(refreshDashboard)
        .catch(() => { progress.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const toggle = e.target.closest('[data-dash-task-toggle]')
    if (toggle) {
      const id = toggle.dataset.dashTaskToggle
      if (!id) return
      const row = toggle.closest('.dash-todo-task')
      toggle.disabled = true
      row?.classList.add('is-completing')
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/complete`, { method: 'POST' })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('complete failed') }
          // S143: the rail panel follows the complete in the same beat (no physical refresh).
          try { document.dispatchEvent(new CustomEvent('hibana:tasks-changed', { detail: { source: 'board' } })) } catch { /* older engines */ }
          // Let the completed state register before the row fades and collapses.
          setTimeout(() => {
            row?.classList.add('is-removing')
            setTimeout(refreshDashboard, 320)
          }, 1000)
        })
        .catch(() => {
          row?.classList.remove('is-completing')
          toggle.checked = false
          toggle.disabled = false
          toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err')
        })
      return
    }

    const noteSave = e.target.closest('[data-dash-note-save]')
    if (noteSave) {
      const id = noteSave.dataset.dashNoteSave
      const input = noteSave.closest('.dash-todo-task')?.querySelector(`[data-dash-note-input="${id}"]`)
      if (!id || !input) return
      noteSave.disabled = true
      dashTaskRequest(id, { note: input.value })
        .then(refreshDashboard)
        .catch(() => { noteSave.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }
  })

  document.addEventListener('keydown', (e) => {
    const grid = e.target.closest?.('[role="grid"]')
    if (grid && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const buttons = [...grid.querySelectorAll('button')]
      const current = buttons.indexOf(e.target)
      if (current >= 0) {
        const columns = 4
        const next = e.key === 'ArrowRight' ? current + 1 : e.key === 'ArrowLeft' ? current - 1 : e.key === 'ArrowDown' ? current + columns : current - columns
        if (buttons[next]) {
          e.preventDefault()
          buttons[next].focus()
        }
      }
      return
    }
    if (e.key !== 'Escape') return
    const editor = e.target.closest?.('[data-task-edit-form], [data-task-notes-panel], [data-dash-edit-form], [data-dash-note-editor], [data-dash-progress-editor]')
    if (editor) {
      const input = editor.querySelector('input[name="title"]')
      if (input?.dataset.originalTitle) input.value = input.dataset.originalTitle
      editor.hidden = true
      editor.closest('.dash-todo-task, .sadhana-card')?.querySelectorAll('[data-task-edit-open], [data-task-note-toggle], [data-dash-note-open], [data-dash-progress-editor]').forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'))
      return
    }
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (!input) return
    const form = input.closest('[data-dash-quickadd-form]')
    input.value = ''
    form.hidden = true
    setDashQuickaddReady(input, false) // (o) reset the FAB — the cleared form must not glow on re-reveal
  })
  document.addEventListener('focusout', (e) => {
    // (m) don't auto-hide an EMPTY quick-add when focus moves to the + FAB itself —
    // the second FAB click (submit) must find the form still open; focusout fires
    // before click, so an unguarded hide would flip the FAB back to "reveal".
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (input && !input.value.trim() && !e.relatedTarget?.closest?.('[data-dash-quickadd-fab]')) {
      input.closest('[data-dash-quickadd-form]').hidden = true
      setDashQuickaddReady(input, false) // (o) belt-and-braces: empty input ⇒ quiet FAB
    }
    const taskTitleInput = e.target.closest?.('[data-task-edit-form] input[name="title"]')
    if (taskTitleInput) {
      const form = taskTitleInput.closest('[data-task-edit-form]')
      window.setTimeout(() => {
        if (!form?.hidden && !form.contains(document.activeElement)) form.requestSubmit?.()
      }, 0)
    }
  })

  // ---- (o) 2026-09-07: the quick-add FAB's READY state ------------------------------
  // User request — "when the user writes in the input, the + button must fill and
  // signal it's ready to be clicked and add a task". Typing (or pasting/cutting)
  // lights the FAB as the filled capture circle (.is-ready, app.css); an emptied
  // input settles it back to the quiet outline. The hide paths above clear the
  // state so a re-revealed empty form never glows stale. Whitespace-only input
  // does NOT light it (trim) — matching the submit handler's own trim gate.
  const setDashQuickaddReady = (input, ready) => {
    const form = input?.closest?.('[data-dash-quickadd-form]')
    if (!form) return
    const fab = form.closest('.dash-todo-quadrant')?.querySelector(`[data-dash-quickadd-fab="${form.dataset.dashQuickaddForm}"]`)
    fab?.classList.toggle('is-ready', ready)
  }
  document.addEventListener('input', (e) => {
    const input = e.target.closest?.('[data-dash-quickadd-form] input')
    if (input) setDashQuickaddReady(input, !!input.value.trim())
  })

  // ---- (k) 2026-09-06: task-note chip bubble (dashboard to-do preview) -------------
  // A task with notes renders a clipboard chip beside its title (server HTML). The
  // bubble is a FIXED-position singleton — NOT a child of the task row: the task list
  // scrolls (overflow:auto), so an absolutely-positioned child would clip at the list
  // edge. Hover/focus opens it; any scroll/resize/Escape closes it (the chip would
  // detach from its anchor otherwise). Rect math is physical, so the viewport clamp
  // behaves identically in LTR and RTL.
  // (m) 2026-09-06: the bubble is HOVER-ONLY now — clicking the chip opens the full
  // note-history panel (below), where notes can be added/edited/deleted in place.
  let dashNoteBubble = null
  let dashNoteChipEl = null
  let dashNotePanel = null
  let dashNotePanelOpenedAt = 0 // scrolls in the first ~250ms are layout settling
  const closeDashNoteBubble = () => {
    dashNoteBubble?.remove()
    dashNoteBubble = null
    dashNoteChipEl?.classList.remove('is-open')
    dashNoteChipEl = null
  }
  const closeDashNotePanel = () => {
    dashNotePanel?.remove()
    dashNotePanel = null
  }
  const openDashNoteBubble = (chip) => {
    if (dashNotePanel) return // the history panel owns the screen while open
    const text = chip.dataset.note || ''
    if (!text) return
    closeDashNoteBubble()
    dashNoteChipEl = chip
    chip.classList.add('is-open')
    const bubble = document.createElement('div')
    bubble.className = 'dash-note-bubble'
    bubble.setAttribute('role', 'tooltip')
    const head = document.createElement('span')
    head.className = 'dash-note-bubble-head'
    const count = Number(chip.dataset.noteCount || '1')
    head.textContent = count > 1 ? `${_t('dashboard.noteLatest', 'Latest note')} (${count})` : _t('dashboard.noteLatest', 'Latest note')
    const body = document.createElement('span')
    body.textContent = text // textContent — the note text is never HTML
    bubble.appendChild(head)
    bubble.appendChild(body)
    document.body.appendChild(bubble)
    dashNoteBubble = bubble
    // Measure after paint, then place: prefer BELOW the chip, flip above when out of
    // room, clamp horizontally inside the viewport.
    bubble.style.visibility = 'hidden'
    requestAnimationFrame(() => {
      if (!dashNoteBubble) return
      const rect = chip.getBoundingClientRect()
      const bw = bubble.offsetWidth
      const bh = bubble.offsetHeight
      const gap = 8
      let top = rect.bottom + gap
      if (top + bh > window.innerHeight - 8) top = Math.max(8, rect.top - bh - gap)
      let left = rect.left + rect.width / 2 - bw / 2
      left = Math.max(8, Math.min(left, window.innerWidth - bw - 8))
      bubble.style.top = `${Math.round(top)}px`
      bubble.style.left = `${Math.round(left)}px`
      bubble.style.visibility = ''
    })
  }
  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip && chip !== dashNoteChipEl) openDashNoteBubble(chip)
  })
  document.addEventListener('mouseout', (e) => {
    if (dashNoteChipEl && e.target.closest?.('[data-dash-note-chip]') === dashNoteChipEl && !dashNoteChipEl.contains(e.relatedTarget)) closeDashNoteBubble()
  })
  document.addEventListener('focusin', (e) => {
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip && chip !== dashNoteChipEl) openDashNoteBubble(chip)
    else if (!chip && dashNoteChipEl && !dashNoteChipEl.contains(e.target)) closeDashNoteBubble()
  })
  document.addEventListener('click', (e) => {
    // (m) click = open the FULL history panel (the latest-note bubble stays hover-only).
    const chip = e.target.closest?.('[data-dash-note-chip]')
    if (chip) openDashNotePanel(chip.dataset.dashNoteChip, chip)
  })

  // ---- (m) 2026-09-06: note history panel ------------------------------------------
  // Clicking a note chip (or ⋯ → «یادداشت‌ها») opens a fixed-position singleton with
  // the FULL note history + add / edit / delete — notes can be managed without ever
  // leaving the dashboard (user request). Notes are FETCHED on demand
  // (GET /api/sadhana/tasks/:id/notes) so the dashboard HTML stays light no matter
  // how many notes exist. All user text goes through textContent — never innerHTML.
  const DASH_ICON = {
    x: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/></svg>',
  }
  const dashNoteFmt = (iso) => {
    try {
      const lang = window.hibanaI18n?.lang?.() || 'en'
      return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
    } catch {
      return String(iso || '').slice(0, 16).replace('T', ' ')
    }
  }
  const dashNoteEditStart = (li, note, taskId) => {
    if (li.querySelector('.task-note-editbox')) return
    const copy = li.querySelector('.task-note-copy')
    const acts = li.querySelector('.task-note-acts')
    if (!copy || !acts) return
    const box = document.createElement('div')
    box.className = 'task-note-editbox'
    const ta = document.createElement('textarea')
    ta.value = note.text
    ta.maxLength = 500
    ta.rows = 2
    ta.setAttribute('aria-label', _t('dashboard.editNote', 'Edit note'))
    const row = document.createElement('div')
    row.className = 'task-note-editacts'
    const save = document.createElement('button')
    save.type = 'button'
    save.setAttribute('aria-label', _t('dashboard.saveNote', 'Save note'))
    save.innerHTML = DASH_ICON.check
    save.addEventListener('click', () => {
      const text = ta.value.trim()
      if (!text || text === note.text) { dashNoteEditRestore(li); return }
      save.disabled = true
      // The legacy single note lives on the task row (PATCH /tasks/:id {note});
      // journal notes carry their own id (PATCH /updates/:id {text}).
      const url = note.legacy ? `/api/sadhana/tasks/${encodeURIComponent(taskId)}` : `/api/sadhana/updates/${encodeURIComponent(note.id)}`
      const body = note.legacy ? { note: text } : { text }
      fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((res) => {
          if (!res.ok) { handle401(res); throw new Error('note edit failed') }
          note.text = text
          li.dataset.noteText = text // keep the restore path truthful for the next edit
          dashNoteEditRestore(li)
          refreshDashboard()
        })
        .catch(() => { save.disabled = false; toast(_t('dashboard.noteFailed', "Couldn't save the note"), 'err') })
    })
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.setAttribute('aria-label', _t('dashboard.close', 'Close'))
    cancel.innerHTML = DASH_ICON.x
    cancel.addEventListener('click', () => dashNoteEditRestore(li))
    row.append(save, cancel)
    box.append(ta, row)
    copy.replaceWith(box)
    acts.hidden = true
    ta.focus()
  }
  const dashNoteEditRestore = (li) => {
    // Rebuild the plain copy block (text + timestamp) from the row's stored note text.
    const box = li.querySelector('.task-note-editbox')
    const acts = li.querySelector('.task-note-acts')
    if (!box) return
    const text = li.dataset.noteText || ''
    const stamp = li.dataset.noteStamp || ''
    const copy = document.createElement('div')
    copy.className = 'task-note-copy'
    const time = document.createElement('time')
    time.textContent = stamp
    const span = document.createElement('span')
    span.className = 'task-note-text'
    span.textContent = text
    copy.append(time, span)
    box.replaceWith(copy)
    if (acts) acts.hidden = false
  }
  const dashNoteDelete = (li, note, taskId) => {
    li.querySelectorAll('button').forEach((b) => { b.disabled = true })
    const url = note.legacy ? `/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes/legacy` : `/api/sadhana/notes/${encodeURIComponent(note.id)}`
    fetch(url, { method: 'DELETE' })
      .then((res) => {
        if (!res.ok) { handle401(res); throw new Error('note delete failed') }
        li.remove()
        refreshDashboard()
      })
      .catch(() => { li.querySelectorAll('button').forEach((b) => { b.disabled = false }); toast(_t('dashboard.noteDeleteFailed', "Couldn't delete the note"), 'err') })
  }
  const dashNoteRow = (note, taskId) => {
    const li = document.createElement('li')
    li.className = 'task-note-item'
    li.dataset.noteText = note.text // for cancel/restore — never re-read from HTML
    li.dataset.noteStamp = dashNoteFmt(note.created_at)
    const copy = document.createElement('div')
    copy.className = 'task-note-copy'
    const time = document.createElement('time')
    time.textContent = li.dataset.noteStamp
    const span = document.createElement('span')
    span.className = 'task-note-text'
    span.textContent = note.text
    copy.append(time, span)
    const acts = document.createElement('div')
    acts.className = 'task-note-acts'
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.className = 'task-note-act'
    edit.setAttribute('aria-label', _t('dashboard.editNote', 'Edit note'))
    edit.title = _t('dashboard.editNote', 'Edit note')
    edit.innerHTML = DASH_ICON.pencil
    edit.addEventListener('click', () => dashNoteEditStart(li, note, taskId))
    const del = document.createElement('button')
    del.type = 'button'
    del.className = 'task-note-act danger'
    del.setAttribute('aria-label', _t('dashboard.deleteNote', 'Delete note'))
    del.title = _t('dashboard.deleteNote', 'Delete note')
    del.innerHTML = DASH_ICON.x
    del.addEventListener('click', () => dashNoteDelete(li, note, taskId))
    acts.append(edit, del)
    li.append(copy, acts)
    return li
  }
  // (o) 2026-09-07 fix — "the note panel opens in an odd place (bottom-right corner)
  // instead of showing around the task". Opened from the ⋯ menu, the anchor is a menu
  // item inside the <details>: the click handler used to close the menu FIRST, and
  // Chromium's closed-details implementation (content-visibility: hidden ⇒ contain:
  // layout) keeps the fixed-position pop laid out at STALE coordinates — the anchor's
  // rect reads garbage off-screen values (e2e-measured left=2048, top=574 on a 1366
  // viewport), so the viewport clamp flung the panel into the bottom-right corner.
  // Fix: snapshot the anchor's rect SYNCHRONOUSLY at open time (the click handler now
  // calls openDashNotePanel BEFORE closeDashMenu, while the menu is still laid out)
  // and place against the snapshot — the live element is never re-measured.
  const dashNoteAnchorRect = (anchor) => {
    const r = anchor?.getBoundingClientRect?.()
    if (!r || (!r.width && !r.height) || r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight) return null
    return { top: r.top, bottom: r.bottom, left: r.left, width: r.width }
  }
  const placeDashNotePanel = (panel, rect) => {
    panel.style.visibility = 'hidden'
    requestAnimationFrame(() => {
      if (dashNotePanel !== panel || !panel.isConnected) return
      const r = rect || { top: 0, bottom: 0, left: window.innerWidth / 2, width: 0 }
      const pw = panel.offsetWidth
      const ph = panel.offsetHeight
      const gap = 8
      let top = r.bottom + gap
      if (top + ph > window.innerHeight - 8) top = Math.max(8, Math.min(r.top - ph - gap, window.innerHeight - ph - 8))
      let left = r.left + r.width / 2 - pw / 2
      left = Math.max(8, Math.min(left, window.innerWidth - pw - 8))
      panel.style.top = `${Math.round(top)}px`
      panel.style.left = `${Math.round(left)}px`
      panel.style.visibility = ''
    })
  }
  const openDashNotePanel = async (taskId, anchor) => {
    closeDashNoteBubble()
    closeDashNotePanel()
    if (!taskId) return
    // Snapshot BEFORE any await — in the ⋯-menu path the menu is still open here
    // (the click handler opens the panel first, then collapses the menu).
    const anchorRect = dashNoteAnchorRect(anchor)
    const panel = document.createElement('div')
    panel.className = 'dash-note-pop'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', _t('dashboard.notes', 'Notes'))
    const head = document.createElement('div')
    head.className = 'dash-note-pop-head'
    const title = document.createElement('strong')
    title.textContent = _t('dashboard.notes', 'Notes')
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'dash-note-pop-close'
    closeBtn.setAttribute('aria-label', _t('dashboard.close', 'Close'))
    closeBtn.innerHTML = DASH_ICON.x
    closeBtn.addEventListener('click', closeDashNotePanel)
    head.append(title, closeBtn)
    const list = document.createElement('ol')
    list.className = 'task-notes-list dash-note-pop-list'
    const loading = document.createElement('li')
    loading.className = 'task-notes-empty muted'
    loading.textContent = _t('dashboard.loading', 'Loading…')
    list.append(loading)
    const form = document.createElement('form')
    form.className = 'task-note-add-form dash-note-pop-add'
    const ta = document.createElement('textarea')
    ta.name = 'text'
    ta.maxLength = 500
    ta.rows = 2
    ta.required = true
    ta.placeholder = _t('dashboard.addNotePlaceholder', 'Add a note…')
    ta.setAttribute('aria-label', _t('dashboard.addNote', 'Add note'))
    const addBtn = document.createElement('button')
    addBtn.type = 'submit'
    addBtn.setAttribute('aria-label', _t('dashboard.addNote', 'Add note'))
    addBtn.title = _t('dashboard.addNote', 'Add note')
    addBtn.innerHTML = DASH_ICON.plus
    form.append(ta, addBtn)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const text = ta.value.trim()
      if (!text) { ta.focus(); return }
      addBtn.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      })
        .then(async (res) => {
          if (!res.ok) { handle401(res); throw new Error('note add failed') }
          const created = await res.json()
          list.querySelector('.task-notes-empty')?.remove()
          list.prepend(dashNoteRow({ id: created.id, task_id: taskId, text: created.text || text, created_at: created.ts || new Date().toISOString() }, taskId))
          ta.value = ''
          refreshDashboard() // re-renders chips/counts; the panel stays open for more
        })
        .catch(() => toast(_t('dashboard.noteFailed', "Couldn't save the note"), 'err'))
        .finally(() => { addBtn.disabled = false })
    })
    panel.append(head, list, form)
    document.body.append(panel)
    dashNotePanel = panel
    dashNotePanelOpenedAt = Date.now()
    placeDashNotePanel(panel, anchorRect)
    try {
      const res = await fetch(`/api/sadhana/tasks/${encodeURIComponent(taskId)}/notes`)
      if (!res.ok) { handle401(res); throw new Error('notes load failed') }
      const { notes } = await res.json()
      if (dashNotePanel !== panel) return // closed while loading
      list.textContent = ''
      const ordered = [...(notes || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      if (!ordered.length) {
        const empty = document.createElement('li')
        empty.className = 'task-notes-empty muted'
        empty.textContent = _t('dashboard.noNotes', 'No notes yet')
        list.append(empty)
      } else {
        for (const note of ordered) list.append(dashNoteRow(note, taskId))
      }
      placeDashNotePanel(panel, anchorRect) // re-place: the panel grew when notes loaded
      ta.focus()
    } catch {
      if (dashNotePanel !== panel) return
      list.textContent = ''
      const err = document.createElement('li')
      err.className = 'task-notes-empty muted'
      err.textContent = _t('dashboard.loadFailed', 'Load failed')
      list.append(err)
    }
  }
  // Outside click closes the history panel (clicks on the panel itself, a note chip,
  // or a ⋯-menu Notes trigger are the open/switch paths, not "outside").
  document.addEventListener('click', (e) => {
    if (!dashNotePanel) return
    if (e.target.closest?.('.dash-note-pop, [data-dash-note-chip], [data-dash-note-panel]')) return
    closeDashNotePanel()
  })
  // Page scroll closes it (the fixed panel would detach from its anchor) — but a
  // scroll INSIDE the panel's own list must keep it open (capture sees both), and
  // so must the LAYOUT-SETTLING scroll right after opening: closing the ⋯ menu
  // collapses the quadrant and nudges the page/list — that reflexive scroll used
  // to insta-kill panels opened from the menu (e2e: chip-open survived, menu-open
  // died). A 250ms grace window separates settling from a real user scroll.
  window.addEventListener('scroll', (e) => {
    if (e.target && e.target.closest && e.target.closest('.dash-note-pop')) return
    if (Date.now() - dashNotePanelOpenedAt < 250) return
    closeDashNotePanel()
  }, { capture: true, passive: true })
  // (n) 2026-09-06 fix — "the ⋯ menu opens UNDERNEATH other things, not visible".
  // The pop's CSS is position: FIXED now (the row's overflow:hidden + the list's
  // overflow:auto clipped the old absolute pop into invisibility), so JS owns its
  // viewport placement: on toggle-open, place it at the ⋯ button's coordinates —
  // end-aligned like the old inset-inline-end: 0 (RTL: leading edge on the button's
  // left; LTR: trailing edge on the button's right), clamped to the viewport, and
  // FLIPPED ABOVE the button when the space below runs out (bottom rows). Same
  // clipping-escape pattern as the note panel and the board's style popover.
  // `toggle` doesn't bubble (older engines) → capture delegation catches every
  // details, whichever way it opened (click, keyboard, hash navigation).
  let dashMenuOpenedAt = 0
  const closeOpenDashMenus = (except) => {
    document.querySelectorAll('.dash-todo-menu[open]').forEach((menu) => { if (menu !== except) menu.open = false })
  }
  const placeDashMenu = (menu) => {
    const pop = menu.querySelector('.dash-todo-menu-pop')
    const summary = menu.querySelector('summary')
    if (!pop || !summary) return
    const rect = summary.getBoundingClientRect()
    const width = pop.offsetWidth || 160
    const height = pop.offsetHeight || 132
    const pad = 8
    const rtl = getComputedStyle(document.documentElement).direction === 'rtl'
    let left = rtl ? rect.left : rect.right - width
    left = Math.max(pad, Math.min(left, window.innerWidth - width - pad))
    let top = rect.bottom + 4
    if (top + height > window.innerHeight - pad) top = Math.max(pad, rect.top - height - 4)
    pop.style.left = `${Math.round(left)}px`
    pop.style.top = `${Math.round(top)}px`
  }
  document.addEventListener('toggle', (e) => {
    const menu = e.target
    if (!(menu instanceof HTMLDetailsElement) || !menu.classList?.contains('dash-todo-menu')) return
    if (!menu.open) return
    closeOpenDashMenus(menu) // single-open policy: clicking another row's ⋯ swaps menus
    placeDashMenu(menu)
    dashMenuOpenedAt = Date.now()
  }, true)
  // RACE GUARD (e2e-proven): the toggle event is an ASYNC queued task — a queued
  // scroll listener can slip between the click's default action (open=true) and the
  // toggle task, and the browser then COALESCES the open+close into a single
  // open:false event (menu dies invisibly). The scroll-closer's grace timestamp must
  // therefore be set SYNCHRONOUSLY at click time, not in the async toggle task —
  // and the === 0 check below only protects the FIRST open ever (a RE-open carries
  // a stale timestamp from its previous open, which the sync click stamp fixes).
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dash-todo-menu summary')) dashMenuOpenedAt = Date.now()
  }, true)
  // A fixed pop detaches from its anchor the moment the page/list scrolls → close on
  // real scrolls (the 250ms grace absorbs the layout-settling scroll the (m) lesson
  // pinned: opening/closing a details can nudge the list right after the click).
  window.addEventListener('scroll', () => {
    if (dashMenuOpenedAt === 0) return
    if (Date.now() - dashMenuOpenedAt < 250) return
    closeOpenDashMenus()
  }, { capture: true, passive: true })
  window.addEventListener('resize', () => closeOpenDashMenus())

  window.addEventListener('resize', closeDashNotePanel)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    closeDashNoteBubble()
    closeDashNotePanel()
    closeOpenDashMenus()
  })
  // (m) a click outside any open task ⋯ menu closes it (details has no outside-close).
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('.dash-todo-menu')) return
    closeOpenDashMenus()
  })

  document.addEventListener('submit', (e) => {
    const taskEditForm = e.target.closest?.('[data-task-edit-form]')
    if (taskEditForm) {
      e.preventDefault()
      const id = taskEditForm.dataset.taskEditForm
      const input = taskEditForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      const error = taskEditForm.querySelector('.task-edit-error')
      if (!id || !title) {
        if (error) error.hidden = false
        input?.focus()
        return
      }
      if (error) error.hidden = true
      const button = taskEditForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      dashTaskRequest(id, { title })
        .then(() => refreshTaskSurface(taskEditForm.closest('.dash-todo-task, .sadhana-card')))
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const quadrantRenameForm = e.target.closest?.('[data-sadhana-rename]')
    if (quadrantRenameForm) {
      e.preventDefault()
      const id = quadrantRenameForm.dataset.sadhanaRename
      const input = quadrantRenameForm.querySelector('input[name="name"]')
      const name = input?.value.trim()
      if (!id || !name) { input?.focus(); return }
      const body = { name }
      /* Subtitle travels with the name (2026-09 user request) — only when edited, so a
         name-only submit never pins the empty prefill as a custom blank subheading. */
      const subInput = quadrantRenameForm.querySelector('input[name="subtitle"]')
      if (subInput && subInput.value.trim() !== subInput.defaultValue.trim()) body.subtitle = subInput.value.trim()
      const button = quadrantRenameForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('rename failed') }; refreshTaskSurface() })
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.renameFailed', "Couldn't rename the quadrant"), 'err') })
      return
    }

    const taskNoteForm = e.target.closest?.('[data-task-note-form]')
    if (taskNoteForm) {
      e.preventDefault()
      const id = taskNoteForm.dataset.taskNoteForm
      const input = taskNoteForm.querySelector('textarea[name="text"]')
      const text = input?.value.trim()
      if (!id || !text) { input?.focus(); return }
      const button = taskNoteForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      fetch(`/api/sadhana/tasks/${encodeURIComponent(id)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('note add failed') }; refreshTaskSurface() })
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const editForm = e.target.closest?.('[data-dash-edit-form]')
    if (editForm) {
      e.preventDefault()
      const id = editForm.dataset.dashEditForm
      const input = editForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      const error = editForm.querySelector('.dash-todo-edit-error')
      if (!id || !title) {
        if (error) error.hidden = false
        input?.focus()
        return
      }
      if (error) error.hidden = true
      const button = editForm.querySelector('button[type="submit"]')
      if (button) button.disabled = true
      dashTaskRequest(id, { title })
        .then(refreshDashboard)
        .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.taskUpdateFailed', "Couldn't update the task"), 'err') })
      return
    }

    const quickAddForm = e.target.closest?.('[data-dash-quickadd-form]')
    if (quickAddForm) {
      e.preventDefault()
      // (m) in-flight flag — the second-FAB-click submit path can re-enter while the
      // POST is still pending (the (l) double-add lesson: never re-read a still-filled
      // input). Cleared on failure; on success the htmx swap re-renders a fresh form.
      if (quickAddForm.dataset.inFlight === '1') return
      const quadrant = quickAddForm.dataset.dashQuickaddForm
      const input = quickAddForm.querySelector('input[name="title"]')
      const title = input?.value.trim()
      if (!quadrant || !title) { input?.focus(); return }
      if (input) input.disabled = true
      quickAddForm.dataset.inFlight = '1'
      fetch(`/api/sadhana/quadrants/${encodeURIComponent(quadrant)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
        .then((res) => { if (!res.ok) { handle401(res); throw new Error('quick add failed') }; refreshDashboard() })
        .catch(() => {
          if (input) input.disabled = false
          delete quickAddForm.dataset.inFlight
          toast(_t('dashboard.quickAddFailed', "Couldn't add the task"), 'err')
        })
      return
    }

    const form = e.target.closest?.('[data-dash-rename-form]')
    if (!form) return
    e.preventDefault()
    const id = form.dataset.dashRenameForm
    const input = form.querySelector('input[name="name"]')
    const name = input?.value.trim()
    if (!id || !name) { input?.focus(); return }
    const body = { name }
    /* Subtitle (2026-09 user request): second input in the popover; sent only when it
       changed from the prefilled effective value, so a name-only edit doesn't pin the
       localized default subheading as a custom one (same rule as the board's qe-pop). */
    const subInput = form.querySelector('input[name="subtitle"]')
    if (subInput && subInput.value.trim() !== subInput.defaultValue.trim()) body.subtitle = subInput.value.trim()
    const button = form.querySelector('button[type="submit"]')
    if (button) button.disabled = true
    fetch(`/api/sadhana/quadrants/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => { if (!res.ok) { handle401(res); throw new Error('rename failed') }; refreshDashboard() })
      .catch(() => { if (button) button.disabled = false; toast(_t('dashboard.renameFailed', "Couldn't rename the quadrant"), 'err') })
  }, true)

  let dashTaskDrag = null
  let dashTaskFrom = null
  const clearDashTaskDropTargets = () => document.querySelectorAll('.dash-todo-quadrant.task-drop-target').forEach((el) => el.classList.remove('task-drop-target'))
  const dashTaskList = (card) => card?.querySelector('.dash-todo-list')
  const updateDashTaskEmpty = (list) => {
    if (!list) return
    const tasks = list.querySelectorAll(':scope > .dash-todo-task')
    const empty = list.querySelector(':scope > .dash-todo-empty')
    if (tasks.length) empty?.remove()
    else if (!empty) {
      const li = document.createElement('li')
      li.className = 'dash-todo-empty muted'
      // S94 (item 10): the SAME placeholder copy the server ships (dashboard.quadrantEmpty) —
      // the htmx sweep keeps the centered hint instead of reverting to blank space.
      li.textContent = _t('dashboard.quadrantEmpty', "You haven't added any task yet")
      list.append(li)
    }
  }
  const persistDashOrder = async (card) => {
    const list = dashTaskList(card)
    const quadrant = card?.dataset.dashQuadrant
    const ids = list ? [...list.querySelectorAll(':scope > .dash-todo-task')].map((el) => el.dataset.dashTaskId).filter(Boolean) : []
    if (!quadrant || !ids.length) return
    const res = await fetch('/api/sadhana/tasks/reorder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quadrant: Number(quadrant), ids }),
    })
    if (!res.ok) { handle401(res); throw new Error('task reorder failed') }
  }
  const updateDashTaskCounter = (card) => {
    const count = dashTaskList(card)?.querySelectorAll(':scope > .dash-todo-task').length ?? 0
    // S85: the quadrant counter is the shared board-count PILL (bare number — the
    // "Active N" text format is gone; its meaning lives in the pill's title/aria).
    // Old records kept a stale counter alive: the regex waited for a "…: N" shape
    // that neither "Active 5" nor «تعداد فعال ۵» ever had, so the digit never
    // refreshed between htmx sweeps. Writing the digits directly fixes that too.
    const counter = card?.querySelector('.dash-todo-counter')
    if (!counter) return
    const digits = window.hibanaI18n?.lang() === 'fa' ? String(count).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(count)
    counter.textContent = digits
  }
  const showDashTaskMoveError = (task) => {
    if (!task) return
    task.classList.add('move-error')
    let indicator = task.querySelector('[data-dash-move-error]')
    if (!indicator) {
      indicator = document.createElement('span')
      indicator.className = 'dash-todo-move-error'
      indicator.dataset.dashMoveError = '1'
      indicator.setAttribute('role', 'status')
      indicator.textContent = _t('dashboard.taskUpdateFailed', "Couldn't update the task")
      task.append(indicator)
    }
    window.setTimeout(() => {
      task.classList.remove('move-error')
      indicator.remove()
    }, 2200)
  }
  document.addEventListener('dragstart', (e) => {
    const task = e.target.closest('.dash-todo-task[draggable]')
    if (!task) return
    dashTaskDrag = task
    dashTaskFrom = task.closest('.dash-todo-quadrant')
    task.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', task.dataset.dashTaskId || '') } catch {}
  })
  document.addEventListener('dragover', (e) => {
    if (!dashTaskDrag) return
    const target = e.target.closest('.dash-todo-quadrant')
    const targetList = dashTaskList(target)
    if (!target || !targetList) return
    e.preventDefault()
    clearDashTaskDropTargets()
    target.classList.add('task-drop-target')
  })
  document.addEventListener('dragleave', (e) => {
    const target = e.target.closest('.dash-todo-quadrant')
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('task-drop-target')
  })
  document.addEventListener('drop', (e) => {
    if (!dashTaskDrag) return
    const target = e.target.closest('.dash-todo-quadrant')
    const targetList = dashTaskList(target)
    if (!target || !targetList) return
    e.preventDefault()
    clearDashTaskDropTargets()
    const task = dashTaskDrag
    if (target === dashTaskFrom) {
      const overTask = e.target.closest('.dash-todo-task')
      if (!overTask || overTask === task || overTask.parentElement !== targetList) return
      const next = task.nextSibling
      targetList.insertBefore(task, overTask)
      task.classList.add('move-pending')
      persistDashOrder(target)
        .then(() => task.classList.remove('move-pending'))
        .catch(() => { targetList.insertBefore(task, next && next.parentElement === targetList ? next : null); task.classList.remove('move-pending'); showDashTaskMoveError(task) })
      return
    }
    const sourceCard = dashTaskFrom
    const sourceList = task.parentElement
    const sourceNext = task.nextSibling
    const overTask = e.target.closest('.dash-todo-task')
    targetList.querySelector(':scope > .dash-todo-empty')?.remove()
    targetList.insertBefore(task, overTask && overTask.parentElement === targetList ? overTask : null)
    task.classList.add('move-pending')
    updateDashTaskEmpty(sourceList)
    updateDashTaskEmpty(targetList)
    updateDashTaskCounter(sourceCard)
    updateDashTaskCounter(target)

    const movedId = task.dataset.dashTaskId
    const restore = () => {
      sourceList.querySelector(':scope > .dash-todo-empty')?.remove()
      sourceList.insertBefore(task, sourceNext && sourceNext.parentElement === sourceList ? sourceNext : null)
      updateDashTaskEmpty(sourceList)
      updateDashTaskEmpty(targetList)
      updateDashTaskCounter(sourceCard)
      updateDashTaskCounter(target)
      task.classList.remove('move-pending')
      showDashTaskMoveError(task)
    }
    fetch(`/api/sadhana/tasks/${encodeURIComponent(movedId)}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quadrant: Number(target.dataset.dashQuadrant) }),
    })
      .then((res) => { if (!res.ok) throw new Error('task move failed') })
      .then(() => Promise.all([persistDashOrder(sourceCard), persistDashOrder(target)]))
      .then(() => task.classList.remove('move-pending'))
      .catch(restore)
  })
  document.addEventListener('dragend', () => {
    if (dashTaskDrag) dashTaskDrag.classList.remove('dragging')
    clearDashTaskDropTargets()
    dashTaskDrag = null
    dashTaskFrom = null
  })

  let dashQuadrantDrag = null
  document.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.dash-todo-quadrant[draggable]')
    if (!card || dashTaskDrag) return
    dashQuadrantDrag = card
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', card.dataset.dashQuadrant || '') } catch {}
    card.classList.add('dragging')
  })
  document.addEventListener('dragover', (e) => {
    if (!dashQuadrantDrag) return
    const grid = e.target.closest('.dash-todo-grid')
    if (!grid || grid !== dashQuadrantDrag.parentElement) return
    e.preventDefault()
    const target = e.target.closest('.dash-todo-quadrant[draggable]')
    if (!target || target === dashQuadrantDrag) return
    const rect = target.getBoundingClientRect()
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
    const before = columns <= 1
      ? e.clientY < rect.top + rect.height / 2
      : getComputedStyle(grid).direction === 'rtl'
        ? e.clientX > rect.left + rect.width / 2
        : e.clientX < rect.left + rect.width / 2
    target.parentElement.insertBefore(dashQuadrantDrag, before ? target : target.nextSibling)
    target.classList.add('drag-over')
  })
  document.addEventListener('drop', async (e) => {
    if (!dashQuadrantDrag) return
    const grid = dashQuadrantDrag.parentElement
    if (!grid?.matches('.dash-todo-grid')) return
    e.preventDefault()
    const ids = [...grid.querySelectorAll(':scope > .dash-todo-quadrant')].map((card) => Number(card.dataset.dashQuadrant))
    const dragged = dashQuadrantDrag
    dashQuadrantDrag = null
    dragged.classList.remove('dragging')
    document.querySelectorAll('.dash-todo-quadrant.drag-over').forEach((card) => card.classList.remove('drag-over'))
    if (ids.length !== 4) return
    try {
      const res = await fetch('/api/sadhana/quadrants/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('quadrant reorder failed')
      refreshDashboard()
    } catch {
      toast(_t('dashboard.reorderFailed', "Couldn't reorder the quadrants"), 'err')
      refreshDashboard()
    }
  })
  document.addEventListener('dragend', () => {
    if (dashQuadrantDrag) dashQuadrantDrag.classList.remove('dragging')
    dashQuadrantDrag = null
    document.querySelectorAll('.dash-todo-quadrant.drag-over').forEach((card) => card.classList.remove('drag-over'))
  })

  // ---- Note cards auto-size to their content (a one-word note is one short line) -----
  // The note textarea is rows=1 on the server and grows with its text; a 60vh cap keeps a
  // huge note from swallowing the widget (overflow-y auto scrolls past the cap). Delegated so
  // htmx re-renders of the widget re-apply it.
  const autosizeNote = (el) => {
    el.style.height = 'auto'
    // box-sizing is border-box, so scrollHeight (content + padding) needs the two borders
    // added back; Math.ceil + 1px keeps fractional font metrics from leaving a ~1px overflow
    // that makes Chrome paint a scrollbar on a perfectly-fitted one-line note.
    const cs = getComputedStyle(el)
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    const target = Math.ceil(el.scrollHeight + borders) + 1
    // In the sticky view each note scrolls internally instead of growing unboundedly — cap the
    // auto-grow at the CSS max-height (9rem) so the inline height never fights it (2026-08-25).
    const sticky = !!el.closest('#notebook')?.classList.contains('note-view-sticky')
    el.style.height = (sticky ? Math.min(target, 9 * 16) : Math.min(target, Math.round(window.innerHeight * 0.6))) + 'px'
  }
  document.addEventListener('input', (e) => {
    const t = e.target
    if (t && t.classList && t.classList.contains('note-text')) autosizeNote(t)
  })
  // Markdown reading (2026-08-25): notes render formatted by default. Phase 6 item 6
  // (2026-09-09) splits the click by LENGTH: the card clamps to 3 lines (app.css), so a
  // note whose content overflows the clamp opens the full-note READER MODAL (with an
  // edit shortcut); a short note keeps the classic click-to-edit (Obsidian-style) —
  // blur/change → htmx PATCH → the swap re-renders back to render mode.
  let noteReaderDlg = null
  // S66: reading-time estimate in the reader head — the S63 vault language applied to
  // quick notes (both open paths: the widget card and the archive row). ~200 wpm; only
  // shown once the note is ≥200 words (a 30-word note is "instant" — a number would be
  // noise). Persian digits in the FA locale, the same dig() the vault uses.
  function setReaderMeta(dlg, raw) {
    const meta = dlg.querySelector('.note-reader-meta')
    if (!meta) return
    const text = String(raw || '').trim()
    const words = text ? text.split(/\s+/).length : 0
    const mins = Math.max(1, Math.round(words / 200))
    const dig = (n) => (document.documentElement.lang === 'fa' ? String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : String(n))
    meta.textContent = words >= 200 ? _t('notes.readTime', '~{n} min read').split('{n}').join(dig(mins)) : ''
    meta.hidden = words < 200
  }
  function buildNoteReader() {
    if (noteReaderDlg) return noteReaderDlg
    const dlg = document.createElement('dialog')
    dlg.id = 'note-reader'
    dlg.className = 'note-reader'
    dlg.innerHTML =
      '<div class="note-reader-head">' +
        '<h3 data-i18n="notes.readerTitle">Note</h3>' +
        '<span class="note-reader-meta small muted" hidden></span>' +
        '<button type="button" class="ghost icon-btn" data-note-reader-close aria-label="Close" data-i18n-aria-label="common.close"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="note-reader-body" dir="auto"></div>' +
      '<div class="note-reader-foot">' +
        '<button type="button" class="ghost" data-note-reader-copy data-i18n="notes.copyMd">Copy as Markdown</button>' +
        '<button type="button" class="ghost" data-note-reader-edit data-i18n="notes.editNote">Edit note</button>' +
        '<button type="button" data-note-reader-close data-i18n="common.close">Close</button>' +
      '</div>'
    document.body.appendChild(dlg)
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close() })
    // S65 bug fix (pre-existing since Phase 6): BOTH close buttons must be wired —
    // querySelector only bound the head ✕, leaving the foot "Close" button dead
    // (the most obvious control in the modal did nothing when clicked).
    dlg.querySelectorAll('[data-note-reader-close]').forEach((b) => b.addEventListener('click', () => dlg.close()))
    dlg.querySelector('[data-note-reader-edit]').addEventListener('click', () => {
      const card = document.getElementById('note-' + dlg.dataset.noteId)
      dlg.close()
      if (card) enterNoteEdit(card)
    })
    // S65: Copy as Markdown — the clipboard twin of the vault's S62 copy, for quick
    // notes: paste an idea out of the safe (Telegram/email/docs) without a download.
    // Source = dataset.raw (set by the archive rows AND the widget card opens); the
    // legacy execCommand fallback covers non-secure contexts (S62 pattern).
    dlg.querySelector('[data-note-reader-copy]').addEventListener('click', async () => {
      const raw = dlg.dataset.raw || ''
      if (!raw) return
      const ok = await (async () => {
        try { await navigator.clipboard.writeText(raw); return true } catch {
          try {
            const ta = document.createElement('textarea')
            ta.value = raw
            ta.setAttribute('readonly', '')
            ta.style.cssText = 'position:fixed;inset-inline-start:-9999px;opacity:0'
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            ta.remove()
            return true
          } catch { return false }
        }
      })()
      toast(_t(ok ? 'notes.copiedMd' : 'notes.copyFail', ok ? 'Copied as Markdown' : 'Could not copy.'), ok ? 'ok' : 'err', 2500)
    })
    noteReaderDlg = dlg
    return dlg
  }
  function enterNoteEdit(card) {
    card.classList.add('note-edit')
    const ta = card.querySelector('.note-text')
    if (ta) { ta.focus(); requestAnimationFrame(() => autosizeNote(ta)) }
  }
  function openNoteReader(card, render) {
    const dlg = buildNoteReader()
    dlg.dataset.noteId = card.id.replace(/^note-/, '')
    const body = dlg.querySelector('.note-reader-body')
    body.innerHTML = render.innerHTML // the full rendered markdown (the clamp is visual only)
    // S65: the archive path hides this (its rows aren't the live widget's cards) — every
    // widget open restores it, so the two sources can't leak state into each other.
    const editBtn = dlg.querySelector('[data-note-reader-edit]')
    if (editBtn) editBtn.hidden = false
    // S65 copy source for widget cards: the card IS the live editor — the textarea (note)
    // or the title+items (list) rebuild the paste-ready markdown on the fly.
    if (card.dataset.kind === 'list') {
      const title = (card.querySelector('.note-title') || {}).value || ''
      const items = Array.from(card.querySelectorAll('.hurdle')).map((li) => {
        const txt = li.querySelector('span:last-child')
        return '- [' + (li.classList.contains('done') ? 'x' : ' ') + '] ' + (txt ? txt.textContent : '')
      })
      dlg.dataset.raw = ('# ' + title + '\n' + items.join('\n')).trim()
    } else {
      const ta = card.querySelector('.note-text')
      dlg.dataset.raw = ta ? ta.value : ''
    }
    setReaderMeta(dlg, dlg.dataset.raw || '') // S66: after raw — the estimate reads the source of truth
    dlg.showModal()
  }

  // ---- ⋯ hover menu on note cards (Edit modal + Delete) — user request 2026-09 ----
  // Mirrors the sparks/projects ⋯ menu pattern: a 3-dot button revealed on card hover
  // (CSS opacity), clicking opens a popover with Edit + Delete. Edit opens a modal text
  // editor (not inline) for focused longer editing. Delete reuses the existing path.
  // Injected client-side after every htmx swap so it survives the #notebook re-render.
  // S82 (owner: "the sticky note's ⋯ settings menu opens INSIDE the note — unusable"):
  // the note-card paper keeps overflow:hidden as its hard content boundary, and the
  // sticky carousel's scrollport clips anything that escapes the card anyway — so the
  // pop now LIFTS to document.body with position:fixed while open (the vault-pop
  // precedent on the Notes page): it can never be clipped by the note, its siblings,
  // or the carousel. dockNotePop() returns it to its .spark-menu on close.
  function injectNoteMenus() {
    const nb = document.getElementById('notebook')
    if (!nb) return
    for (const card of nb.querySelectorAll('.note-card:not([data-menu-ok])')) {
      const headbar = card.querySelector('.note-headbar')
      if (!headbar) continue
      const id = card.id.replace(/^note-/, '')
      const menu = document.createElement('div')
      menu.className = 'spark-menu'
      menu.innerHTML =
        '<button type="button" data-menu-open aria-haspopup="true" aria-label="' + _t('notes.moreActions', 'More actions') + '">' +
          '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>' +
        '</button>' +
        '<div class="spark-menu-pop" hidden>' +
          '<button type="button" data-note-menu-edit="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg><span>' + _t('notes.editInModal', 'Edit in modal') + '</span></button>' +
          '<button type="button" class="danger" data-note-menu-delete="' + id + '"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>' + _t('common.delete', 'Delete') + '</span></button>' +
        '</div>'
      headbar.appendChild(menu)
      card.setAttribute('data-menu-ok', '')
    }
  }
  // Lift a note ⋯ pop out of the clipped paper: body + fixed, aligned under its button
  // (inline-end edges match), flipping above when the viewport bottom is near. Stamps
  // the host menu reference so the dock step can find it again.
  function floatNotePop(pop, btn, menu) {
    pop.__menuHost = menu
    pop.classList.add('is-floating')
    document.body.appendChild(pop)
    const r = btn.getBoundingClientRect()
    const pw = pop.offsetWidth || 170
    const ph = pop.offsetHeight || 96
    const rtl = document.documentElement.dir === 'rtl'
    let x = rtl ? r.left : r.right - pw
    x = Math.max(8, Math.min(x, window.innerWidth - pw - 8))
    let y = r.bottom + 6
    if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6)
    pop.style.left = Math.round(x) + 'px'
    pop.style.top = Math.round(y) + 'px'
  }
  // Return a lifted pop to its .spark-menu (restore flow + drop inline coords). If the
  // host already left the DOM (htmx re-rendered the notes), the pop is dropped too.
  function dockNotePop(pop) {
    if (!pop) return
    pop.classList.remove('is-floating')
    pop.style.left = ''
    pop.style.top = ''
    const host = pop.__menuHost
    if (host && host.isConnected) host.appendChild(pop)
    else if (pop.parentElement === document.body) pop.remove()
    pop.__menuHost = null
  }
  // Close note ⋯ popovers on outside click (the sparks/projects pages have their own
  // closeMenus; the dashboard notes need one too). Finds BOTH docked pops and the
  // lifted one (it lives on <body> while open — the #notebook selector alone misses it).
  function closeNoteMenus() {
    document.querySelectorAll('#notebook .spark-menu-pop:not([hidden]), body > .spark-menu-pop.is-floating:not([hidden])').forEach((pop) => {
      pop.hidden = true
      if (pop.classList.contains('is-floating')) dockNotePop(pop)
      const btn = pop.parentElement && pop.parentElement.querySelector('[data-menu-open]')
      if (btn) btn.removeAttribute('data-open')
    })
  }
  document.addEventListener('click', (e) => {
    // Toggle the popover
    const openBtn = e.target.closest('#notebook .spark-menu [data-menu-open]')
    if (openBtn) {
      const menu = openBtn.parentElement
      const pop = menu.querySelector('.spark-menu-pop')
      if (!pop) return
      const willOpen = pop.hidden
      closeNoteMenus()
      pop.hidden = !willOpen
      openBtn.setAttribute('data-open', '')
      if (!willOpen) openBtn.removeAttribute('data-open')
      else floatNotePop(pop, openBtn, menu) // S82: lift it past the paper's clip while open
      e.stopPropagation()
      return
    }
    // Outside click → close (a lifted pop's own buttons count as inside: they live on
    // <body>, so match the .is-floating surface too — the action handlers below run
    // AFTER this closer, on the captured references)
    if (!e.target.closest('#notebook .spark-menu, body > .spark-menu-pop.is-floating')) closeNoteMenus()
    // Edit in modal
    const editBtn = e.target.closest('[data-note-menu-edit]')
    if (editBtn) {
      closeNoteMenus()
      const id = editBtn.getAttribute('data-note-menu-edit')
      const card = document.getElementById('note-' + id)
      if (card) openNoteEditor(card)
      return
    }
    // Delete (reuse existing delete path by re-triggering the note-delete handler)
    const delBtn = e.target.closest('[data-note-menu-delete]')
    if (delBtn) {
      closeNoteMenus()
      const id = delBtn.getAttribute('data-note-menu-delete')
      const card = document.getElementById('note-' + id)
      // Synthesize a click on the existing delete button so the existing handler + Undo toast fire
      const existing = card && card.querySelector('[data-note-delete="' + id + '"]')
      if (existing) existing.click()
      return
    }
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNoteMenus() })
  // S82: the lifted pop is position:fixed — a scrolled carousel (or a resized window)
  // would visually detach it from its note. Close on any scroll/resize instead of
  // letting it float stale (capture-phase catches every scrollport, not just window).
  document.addEventListener('scroll', () => {
    if (document.querySelector('body > .spark-menu-pop.is-floating:not([hidden])')) closeNoteMenus()
  }, { capture: true, passive: true })
  window.addEventListener('resize', () => {
    if (document.querySelector('body > .spark-menu-pop.is-floating:not([hidden])')) closeNoteMenus()
  })

  // ---- Note modal text editor (user request 2026-09) -------------------------
  // A focused modal for editing a note: title (lists only) + a large content textarea.
  // Saves via PATCH /api/notes/:id (the same route the inline htmx autosave uses).
  let noteEditorDlg = null
  function buildNoteEditor() {
    if (noteEditorDlg) return noteEditorDlg
    const dlg = document.createElement('dialog')
    dlg.id = 'note-editor'
    dlg.className = 'dialog'
    dlg.innerHTML =
      '<form class="modal" id="ne-form" novalidate>' +
        '<h3>' + _t('notes.editInModal', 'Edit in modal') + '</h3>' +
        '<label class="ne-title-wrap" hidden>' + _t('sparks.title', 'Title') + ' <input id="ne-title" maxlength="120" autocomplete="off"></label>' +
        '<label>' + _t('notes.noteContent', 'Content') + ' <textarea id="ne-content" rows="10" maxlength="20000" dir="auto" class="ne-content"></textarea></label>' +
        '<p class="error" id="ne-error" role="alert"></p>' +
        '<div class="row">' +
          '<button type="submit" id="ne-save">' + _t('common.save', 'Save') + '</button>' +
          '<button type="button" class="ghost" id="ne-cancel">' + _t('common.cancel', 'Cancel') + '</button>' +
        '</div>' +
      '</form>'
    document.body.appendChild(dlg)
    const close = () => dlg.close()
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close() })
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close() })
    dlg.querySelector('#ne-cancel').addEventListener('click', close)
    dlg.querySelector('#ne-form').addEventListener('submit', async (e) => {
      e.preventDefault()
      const id = dlg.dataset.editId
      if (!id) return
      const card = document.getElementById('note-' + id)
      const isList = card && card.dataset.kind === 'list'
      const patch = {}
      const content = dlg.querySelector('#ne-content').value
      patch.content = content
      if (isList) {
        const title = dlg.querySelector('#ne-title').value.trim()
        if (title) patch.title = title
      }
      const err = dlg.querySelector('#ne-error')
      const save = dlg.querySelector('#ne-save')
      err.textContent = ''
      save.disabled = true
      save.textContent = _t('common.saving', 'Saving…')
      try {
        const res = await fetch('/api/notes/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) throw new Error('save failed')
        // Re-render the notebook via htmx so the card reflects the saved content
        if (window.htmx) window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
        dlg.close()
        toast(_t('notes.savedInModal', 'Note saved'), 'info')
      } catch {
        err.textContent = _t('notes.updateFailed', "Couldn't update the note")
        save.disabled = false
        save.textContent = _t('common.save', 'Save')
      }
    })
    noteEditorDlg = dlg
    return dlg
  }
  function openNoteEditor(card) {
    const dlg = buildNoteEditor()
    const id = card.id.replace(/^note-/, '')
    dlg.dataset.editId = id
    const isList = card.dataset.kind === 'list'
    const titleWrap = dlg.querySelector('.ne-title-wrap')
    if (isList) {
      titleWrap.hidden = false
      const titleInput = card.querySelector('.note-title')
      dlg.querySelector('#ne-title').value = titleInput ? titleInput.value : ''
    } else {
      titleWrap.hidden = true
    }
    // For note kind: read the raw content from the textarea (the source of truth, not the
    // rendered markdown). For list kind: the items are JSON in the title-less textarea.
    const srcTa = card.querySelector('.note-text')
    dlg.querySelector('#ne-content').value = srcTa ? srcTa.value : ''
    dlg.querySelector('#ne-save').disabled = false
    dlg.querySelector('#ne-save').textContent = _t('common.save', 'Save')
    dlg.showModal()
    setTimeout(() => dlg.querySelector('#ne-content').focus(), 50)
  }
  for (const name of ['htmx:afterSwap', 'afterSwap', 'htmx:load', 'load']) {
    document.addEventListener(name, injectNoteMenus)
  }
  if (document.readyState !== 'loading') injectNoteMenus()

  document.addEventListener('click', (e) => {
    const render = e.target.closest('.note-render')
    const card = render?.closest('.note-card[data-kind="note"]')
    if (!card) return
    // long note (content overflows the 3-line clamp / the sticky-view scroll box) → modal
    const clamped = render.scrollHeight > render.clientHeight + 2
    if (clamped && render.hasAttribute('data-note-open')) { openNoteReader(card, render); return }
    enterNoteEdit(card)
  })
  // ---- Quick Notebook view: list ⇄ carousel ⇄ grid (2026-08-25) ----------------------
  // Both the view and the sticky-note size are client preferences (localStorage), re-applied
  // after every htmx swap — the server always renders the defaults, so without this the size
  // silently reset to Medium after a reorder (2026-08-26 user report). Cards become draggable
  // for reorder in the carousel view only (the drag handlers POST the order to /api/notes/reorder).
  const NOTE_VIEW_KEY = 'hibana-note-view'
  const NOTE_SIZE_KEY = 'hibana-note-size'
  // The layout toggle itself is PURE CSS (radios + sibling selectors) so it works even with a
  // stale cached app.js — this JS only persists the choice and enables carousel drag-reorder.
  const applyNoteView = () => {
    const nb = document.getElementById('notebook')
    if (!nb) return
    let view = 'list'
    try { view = localStorage.getItem(NOTE_VIEW_KEY) || 'list' } catch { /* storage unavailable — list view */ }
    const listR = nb.querySelector('#nv-list')
    const stickyR = nb.querySelector('#nv-sticky')
    const gridR = nb.querySelector('#nv-grid')
    if (listR) listR.checked = view === 'list'
    if (stickyR) stickyR.checked = view === 'sticky'
    if (gridR) gridR.checked = view === 'grid'
    nb.classList.toggle('note-view-sticky', view === 'sticky') // JS-only convenience for drag gating
    nb.querySelectorAll('.note-card').forEach((c) => {
      if (view === 'sticky') c.setAttribute('draggable', 'true')
      else c.removeAttribute('draggable')
    })
    const track = nb.querySelector('.note-list')
    if (track) track.scrollLeft = 0
  }
  const applyNoteSize = () => {
    const nb = document.getElementById('notebook')
    if (!nb) return
    let size = 'm'
    try { size = localStorage.getItem(NOTE_SIZE_KEY) || 'm' } catch { /* storage unavailable — medium */ }
    if (!/^[sml]$/.test(size)) size = 'm'
    const r = nb.querySelector(`#ns-${size}`)
    if (r) r.checked = true
  }
  // Session-11: the view/size controls live behind the ⚙ .note-controls-toggle <details>
  // (user decision 2026-09-14). The server renders it CLOSED; the owner's last open/closed
  // choice persists here so htmx re-renders (create/patch/reorder) don't snap the panel
  // shut mid-session — same re-apply pattern as the view/size radios above.
  const NOTE_CONTROLS_OPEN_KEY = 'hibana-note-controls-open'
  const applyNoteControlsOpen = () => {
    const nb = document.getElementById('notebook')
    const d = nb?.querySelector('.note-controls-toggle')
    if (!d) return
    d.open = false
    try { localStorage.setItem(NOTE_CONTROLS_OPEN_KEY, '0') } catch { /* storage unavailable */ }
  }
  // S105 (owner: "changing the view option of quick note shows buggy — the menu goes
  // UNDER other elements"): #notebook carries container-type:inline-size (a stacking
  // context), so the panel's absolute z-index could never paint above later dashboard
  // siblings. The fix is the repo's established lift pattern (.spark-menu-pop.is-
  // floating): while the <details> is OPEN, the panel is reparented to <body> as a
  // position:fixed element under the gear (z-index 90), and returned home on close.
  // The S46.18 collision-aware flip/shift logic survives as viewport clamping on the
  // fixed coordinates.
  const positionFloatingNoteControls = (panel, anchorRect) => {
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    panel.style.inlineSize = `min(20rem, ${vw - 16}px)`
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    // anchor to the inline-END of the gear (right edge in LTR, left in RTL)
    let left = document.documentElement.dir === 'rtl' ? anchorRect.left : anchorRect.right - pw
    left = Math.max(8, Math.min(left, vw - pw - 8))
    let top = anchorRect.bottom + 6
    if (top + ph > vh - 8) top = Math.max(8, anchorRect.top - ph - 6)
    panel.style.left = left + 'px'
    panel.style.top = top + 'px'
    panel.style.right = 'auto'
    panel.style.insetInlineStart = ''
    panel.style.insetInlineEnd = ''
  }
  const liftNoteControlsPanel = (toggle) => {
    const panel = toggle.querySelector('.note-head-controls')
    if (!panel || panel.classList.contains('is-floating')) return
    const r = toggle.getBoundingClientRect()
    panel.classList.add('is-floating')
    document.body.appendChild(panel)
    positionFloatingNoteControls(panel, r)
  }
  const unliftNoteControlsPanel = () => {
    const panel = document.querySelector('body > .note-head-controls.is-floating')
    if (!panel) return
    panel.classList.remove('is-floating')
    panel.style.left = panel.style.top = panel.style.right = panel.style.inlineSize = ''
    panel.style.insetInlineStart = panel.style.insetInlineEnd = ''
    const home = document.querySelector('#notebook .note-controls-toggle')
    if (home && !home.querySelector('.note-head-controls')) home.appendChild(panel)
    else panel.remove()
  }
  const positionNoteControlsPanel = () => {
    const toggle = document.querySelector('#notebook .note-controls-toggle')
    if (!toggle || !toggle.open) return
    const panel = document.querySelector('body > .note-head-controls.is-floating') || toggle.querySelector('.note-head-controls')
    if (!panel) return
    positionFloatingNoteControls(panel, toggle.getBoundingClientRect())
  }
  // 'toggle' does NOT bubble — the capture phase on document still sees every one.
  document.addEventListener('toggle', (e) => {
    const d = e.target
    if (!(d instanceof Element) || !d.matches?.('#notebook .note-controls-toggle')) return
    try { localStorage.setItem(NOTE_CONTROLS_OPEN_KEY, '0') } catch { /* storage unavailable */ }
    // S105: lift the open panel out of the #notebook stacking context (or return it)
    if (d.open) liftNoteControlsPanel(d)
    else unliftNoteControlsPanel()
  }, true)
  // S46.18: re-position on viewport resize (the panel might need to flip after resize)
  let resizeTimer = null
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(positionNoteControlsPanel, 100)
  })
  // S105: the floating panel follows the gear while the page scrolls (fixed coords
  // are viewport-relative — without this the panel detaches from its anchor).
  window.addEventListener('scroll', () => {
    const toggle = document.querySelector('#notebook .note-controls-toggle')
    if (toggle?.open) positionNoteControlsPanel()
  }, { passive: true })
  // S105: an htmx re-render of the notebook replaces the <details> (and
  // applyNoteControlsOpen force-closes the fresh one); a panel left lifted in
  // <body> would orphan — drop it. A later open re-lifts the fresh panel.
  document.addEventListener('htmx:afterSwap', () => {
    document.querySelector('body > .note-head-controls.is-floating')?.remove()
  }, true)
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('#notebook .note-view-radio')) {
      try { localStorage.setItem(NOTE_VIEW_KEY, e.target.checked ? e.target.value : 'list') } catch { /* storage unavailable */ }
      applyNoteView()
      return
    }
    if (e.target.matches?.('#notebook .note-size-radio')) {
      try { localStorage.setItem(NOTE_SIZE_KEY, e.target.checked ? e.target.value : 'm') } catch { /* storage unavailable */ }
    }
  })
  // Carousel arrows (scroll the snap track by one card).
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-note-sticky-prev], [data-note-sticky-next]')
    if (!nav) return
    const track = document.querySelector('#notebook .note-list')
    if (!track) return
    const card = track.querySelector('.note-card')
    const w = card ? card.getBoundingClientRect().width + 12 : 320
    track.scrollBy({ left: (nav.hasAttribute('data-note-sticky-next') ? 1 : -1) * w, behavior: 'smooth' })
  })
  // Sticky-note drag reorder (delegated, survives htmx swaps; only in sticky view).
  let stickyDrag = null
  const clearStickyDrag = () => { if (stickyDrag) stickyDrag.classList.remove('dragging'); stickyDrag = null }
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest('#notebook .note-card[draggable]')
    if (!c || !document.getElementById('nv-sticky')?.checked) return
    if (e.target.closest('button')) return // palette/delete clicks never start a reorder drag
    stickyDrag = c
    c.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    try { e.dataTransfer.setData('text/plain', c.id) } catch {}
  })
  document.addEventListener('dragover', (e) => {
    if (!stickyDrag) return
    e.preventDefault()
    const c = e.target.closest('#notebook .note-card[draggable]')
    if (!c || c === stickyDrag) return
    const track = c.parentElement
    const r = c.getBoundingClientRect()
    track.insertBefore(stickyDrag, e.clientX < r.left + r.width / 2 ? c : c.nextSibling)
  })
  document.addEventListener('drop', async (e) => {
    if (!stickyDrag) return
    e.preventDefault()
    const track = stickyDrag.parentElement
    const ids = [...track.querySelectorAll('.note-card[draggable]')].map((c) => c.id.replace(/^note-/, ''))
    clearStickyDrag()
    if (!ids.length || !window.htmx) return
    try {
      const res = await fetch('/api/notes/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (res.ok) window.htmx.ajax('GET', '/api/notes', { target: '#notebook', swap: 'outerHTML' })
      else toast(_t('notes.reorderFailed', "Couldn't reorder the notes"), 'err')
    } catch {
      toast(_t('notes.reorderFailed', "Couldn't reorder the notes"), 'err')
    }
  })
  // Phase 7 item 11 — «بیشتر…»: measure which note cards are actually clamped by the
  // 3-line cut and un-hide their show-more chip (the server renders it hidden so no
  // stale chip can ever show without a truncation). Runs after every htmx swap and on
  // load, inside rAF so layout is settled (scrollHeight needs the final line boxes).
  // Phase 7 item 13: when htmx lands the dashboard content, the skeleton (and the
  // main's aria-busy) must go together — a stale busy flag traps screen readers in
  // "loading" forever even though the real board is on screen.
  document.addEventListener('htmx:afterSwap', (e) => {
    // Session-11: was getElementById('dash') — null since the duplicate id attribute
    // never survived parsing, leaving aria-busy stuck at "true" forever.
    const dash = document.querySelector('main.shell-dash')
    if (dash && !dash.querySelector('.dash-skeleton')) dash.removeAttribute('aria-busy')
  })
  const markClampedNotes = () => {
    document.querySelectorAll('#notebook .note-card[data-kind="note"]').forEach((card) => {
      const render = card.querySelector('.note-render')
      if (!render) return
      const clamped = render.scrollHeight > render.clientHeight + 2
      card.classList.toggle('has-more', clamped)
    })
  }
  // the chip click routes to the same full-note reader modal as clicking clamped text
  document.addEventListener('click', (e) => {
    const more = e.target.closest('[data-note-more]')
    if (!more) return
    const card = document.getElementById('note-' + more.dataset.noteMore)
    const render = card?.querySelector('.note-render')
    if (card && render) openNoteReader(card, render)
  })
  document.addEventListener('dragend', clearStickyDrag)
  for (const name of ['htmx:afterSwap', 'afterSwap']) {
    document.addEventListener(name, () => {
      applyNoteView()
      applyNoteSize()
      applyNoteControlsOpen()
      requestAnimationFrame(() => document.querySelectorAll('.note-text').forEach(autosizeNote))
      requestAnimationFrame(markClampedNotes)
    })
  }
  // S46.17b: also call on initial load (not just htmx swaps) — ensures the panel is
  // ALWAYS closed on page load, even if localStorage has stale '1' from the old code.
  if (document.readyState !== 'loading') applyNoteControlsOpen()
  else document.addEventListener('DOMContentLoaded', () => applyNoteControlsOpen(), { once: true })
  // ---- S111: PWA share_target landing — "share into Hibana" ----
  // The manifest's share_target points GET title/text/url at /dashboard.html; when the
  // app boots with those params present (the OS share sheet on Android/iOS, or a
  // hand-typed URL), the quick-add modal opens PREFILLED so a captured idea is one Save
  // away — the app's first job (never lose an idea) extended to the share sheet.
  // Runs once per params: the query is stripped when the dialog closes, so a reload
  // never re-triggers. Skipped on public pages (login/signup carry app.js too). If the
  // session is expired, handle401/the SW bounce carries the FULL query inside ?next=,
  // so the share survives the login round-trip and lands here after sign-in.
  function consumeShareTarget() {
    const q = new URLSearchParams(location.search)
    const title = q.get('title') || ''
    const text = q.get('text') || ''
    const url = q.get('url') || ''
    if (!title && !text && !url) return
    if (document.body?.classList.contains('public-page')) return
    const PUBLIC_PATHS = ['/login.html', '/signup.html', '/confirm.html', '/reset.html', '/clip.html', '/404.html']
    if (PUBLIC_PATHS.includes(location.pathname)) return
    let description = text
    if (url && !description.includes(url)) description = description ? description + '\n\n' + url : url
    if (description.length > 2000) description = description.slice(0, 2000)
    let t = title.trim()
    if (!t && url) {
      try { t = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep empty */ }
    }
    if (!t && text) t = text.split('\n')[0].trim()
    if (t.length > 200) t = t.slice(0, 200)
    if (!t && !description) return
    const stripShareParams = () => {
      try { history.replaceState(null, '', location.pathname) } catch { /* history unavailable */ }
    }
    try {
      openQuickAdd({ title: t, description })
    } catch {
      stripShareParams()
      return
    }
    shareCaptureArmed = true // S112: a successful save announces itself on the landing page
    quickAddEl?.addEventListener('close', stripShareParams, { once: true })
  }

  // S112: consume-and-clear the share-captured token — only a document that was REBUILT
  // by a hard reload (window copy of the token gone) announces; the surviving-document
  // case already toasted in the save handler (see above).
  function announceShareCapture() {
    let tok = null
    try {
      tok = sessionStorage.getItem(SHARE_CAPTURED_KEY)
      if (!tok) return
      sessionStorage.removeItem(SHARE_CAPTURED_KEY)
    } catch { return }
    if (window.__hibShareSavedToken === tok) return // same document — already toasted
    window.hibana?.toast(_t('qa.shareCaptured', 'Idea captured from the share sheet'), 'ok', 4200)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announceShareCapture, { once: true })
  else announceShareCapture()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', consumeShareTarget, { once: true })
  else consumeShareTarget()
  Object.assign(window.__hib, { _t, esc, escHtml, toast, handle401, currentTheme, setTheme, paintThemeButton, toggleTheme, buildQuickAdd, openQuickAdd, buildProjectAdd, openProjectAdd, buildTaskAdd, openTaskAdd, buildQuickNoteAdd, openQuickNoteAdd, draftLines, DRAFT_X, renderDraft, syncStatCarousel, initStatCarousel, getCollapsed, setCollapsed, initCollapseButtons, dashQuadPhone, dashQuadGrid, dashQuadIndex, syncDashQuadDots, goToDashQuad, hideDashSwipeHint, wireDashSwipeHint, buildDashQuadDots, refreshDashboard, closeDashMenu, dashTaskRequest, refreshTaskSurface, setDashQuickaddReady, closeDashNoteBubble, closeDashNotePanel, openDashNoteBubble, dashNoteFmt, dashNoteEditStart, dashNoteEditRestore, dashNoteDelete, dashNoteRow, dashNoteAnchorRect, placeDashNotePanel, openDashNotePanel, closeOpenDashMenus, placeDashMenu, clearDashTaskDropTargets, dashTaskList, updateDashTaskEmpty, persistDashOrder, updateDashTaskCounter, showDashTaskMoveError, autosizeNote, buildNoteReader, enterNoteEdit, openNoteReader, injectNoteMenus, closeNoteMenus, buildNoteEditor, applyNoteView, applyNoteSize, applyNoteControlsOpen, markClampedNotes, fabEl, setFabOpen })
  return { toast, handle401, openQuickAdd, openProjectAdd, openTaskAdd, setTheme, toggleTheme, paintThemeButton, currentTheme, esc }
})()
