// Onboarding tour + dashboard counter animation (Round 5).
// - Tour: a one-time coachmark overlay for first-time users (localStorage-gated). Highlights
//   the command palette (Ctrl+K), the quick-add FAB, and the theme toggle. 4 steps + done.
//   Triggered on first dashboard visit unless the user has dismissed it.
// - Counter: animates the dashboard stat-box counts from 0 to their final value on load.
// Zero deps, zero DB, progressive enhancement (pages work fine without it).

;(() => {
  const _t = (k, f) => window.hibanaI18n?.t(k) || f
  const TOUR_KEY = 'hibana-tour-done'

  // ---- Dashboard counter animation (R5.2) -----------------------------------
  // Runs after the dashboard htmx swap. Animates every .stat-count from 0 to its text value.
  function animateCounters() {
    const lang = window.hibanaI18n?.lang?.() || 'en'
    const faDig = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
    document.querySelectorAll('.stat-count').forEach((el) => {
      const raw = el.textContent.trim()
      // Parse the final number (handle both Latin and Persian digits)
      const target = parseInt(String(raw).replace(/[^\d۰-۹]/g, ''), 10)
      if (isNaN(target) || target === 0) return
      const duration = 600
      const start = performance.now()
      const isFa = lang === 'fa'
      el.classList.add('counting')
      function tick(now) {
        const t = Math.min(1, (now - start) / duration)
        // ease-out cubic
        const eased = 1 - Math.pow(1 - t, 3)
        const val = Math.round(target * eased)
        el.textContent = isFa ? faDig(String(val)) : String(val)
        if (t < 1) requestAnimationFrame(tick)
        else el.classList.remove('counting')
      }
      requestAnimationFrame(tick)
    })
  }

  // Run counters after every dashboard htmx swap + initial load.
  document.addEventListener('htmx:afterSwap', (e) => {
    if (e.target?.id === 'dash' || e.detail?.target?.id === 'dash') {
      setTimeout(animateCounters, 50)
    }
  })
  document.addEventListener('DOMContentLoaded', () => {
    // The dashboard loads via htmx on main.shell-dash; the swap handler above fires. But also run
    // once after a delay in case the htmx event already fired before this script loaded.
    setTimeout(() => { if (document.querySelector('.stat-count')) animateCounters() }, 800)
  })

  // ---- Onboarding tour (R5.1) ------------------------------------------------
  // Only on the dashboard, only once per browser (localStorage). Skips if the user has
  // already dismissed it or if the key elements aren't present.
  function shouldShowTour() {
    try { return !localStorage.getItem(TOUR_KEY) } catch { return false }
  }
  function markTourDone() {
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
  }

  const STEPS = [
    { target: () => document.querySelector('.fab[data-fab-toggle]') || document.querySelector('.fab-stack'), title: () => _t('tour.fab', 'Quick capture'), body: () => _t('tour.fabBody', 'Tap the + button to capture a new idea or project in seconds.') },
    { target: () => {
      // On mobile the topbar (and its theme toggle) is hidden — the toggle lives in
      // the bottom-bar More sheet there. No visible anchor → centered card.
      const t = document.querySelector('[data-theme-toggle]')
      return t && t.getBoundingClientRect().width > 0 ? t : null
    }, title: () => _t('tour.theme', 'Light / dark'), body: () => _t('tour.themeBody', 'Toggle the theme here. Farsi users also get the Jalali calendar.') },
    { target: () => null, title: () => _t('tour.cmdk', 'Command palette'), body: () => _t('tour.cmdkBody', 'Press Ctrl+K (or /) to search projects and jump anywhere instantly.') },
    { target: () => null, title: () => _t('tour.done', 'You’re all set'), body: () => _t('tour.doneBody', 'Press ? anytime to see all keyboard shortcuts. Happy building!') },
  ]

  let tourEl = null
  let stepIdx = 0

  function startTour() {
    if (tourEl) return
    stepIdx = 0
    tourEl = document.createElement('div')
    tourEl.className = 'tour-overlay'
    tourEl.innerHTML = `
      <div class="tour-card" role="dialog" aria-labelledby="tour-title">
        <h3 id="tour-title" class="tour-title"></h3>
        <p class="tour-body"></p>
        <div class="tour-progress"></div>
        <div class="tour-actions">
          <button type="button" class="ghost small tour-skip">${_t('tour.skip', 'Skip')}</button>
          <span class="tour-spacer"></span>
          <button type="button" class="ghost small tour-prev" hidden>${_t('tour.prev', 'Back')}</button>
          <button type="button" class="tour-next"></button>
        </div>
      </div>`
    document.body.appendChild(tourEl)
    tourEl.querySelector('.tour-skip').addEventListener('click', endTour)
    tourEl.querySelector('.tour-prev').addEventListener('click', () => { if (stepIdx > 0) { stepIdx--; renderStep() } })
    tourEl.querySelector('.tour-next').addEventListener('click', nextStep)
    tourEl.addEventListener('click', (e) => { if (e.target === tourEl) endTour() })
    // 2026-09-12 polish: the progress dots are real step-jump buttons (delegated —
    // renderStep() re-creates them on every step change). 24px hit area via CSS
    // padding + background-clip; keyboard users get the same jump via Tab + Enter
    // (and the arrow keys keep working alongside).
    tourEl.querySelector('.tour-card').addEventListener('click', (e) => {
      const dot = e.target.closest('.tour-dot')
      if (!dot || !tourEl) return
      const i = Number(dot.dataset.step)
      if (Number.isInteger(i) && i >= 0 && i < STEPS.length && i !== stepIdx) { stepIdx = i; renderStep() }
    })
    document.addEventListener('keydown', tourKeyHandler)
    renderStep()
  }

  function tourKeyHandler(e) {
    if (e.key === 'Escape') { e.preventDefault(); endTour() }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nextStep() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (stepIdx > 0) { stepIdx--; renderStep() } }
  }

  function nextStep() {
    if (stepIdx < STEPS.length - 1) { stepIdx++; renderStep() }
    else endTour()
  }

  function renderStep() {
    if (!tourEl) return
    const step = STEPS[stepIdx]
    const card = tourEl.querySelector('.tour-card')
    card.querySelector('.tour-title').textContent = step.title()
    card.querySelector('.tour-body').textContent = step.body()
    const next = card.querySelector('.tour-next')
    next.textContent = stepIdx < STEPS.length - 1 ? _t('tour.next', 'Next') : _t('tour.done', 'Done')
    card.querySelector('.tour-prev').hidden = stepIdx === 0
    // Progress dots — buttons (jump to step). aria-current marks the live step;
    // the visible label stays dots-only (the count is implicit in the row length).
    card.querySelector('.tour-progress').innerHTML = STEPS.map((_, i) => `<button type="button" class="tour-dot ${i === stepIdx ? 'active' : ''}" data-step="${i}" ${i === stepIdx ? 'aria-current="step"' : ''} aria-label="${_t('tour.step', 'Step')} ${i + 1}"></button>`).join('')
    // Position: try to anchor to the target element; fall back to center.
    const target = step.target()
    if (target && target.getBoundingClientRect) {
      const r = target.getBoundingClientRect()
      // Highlight the target
      tourEl.style.setProperty('--tour-highlight', `inset 0 0 0 9999px rgb(0 0 0 / 0.55)`)
      // Use box-shadow to "cut a hole" — simpler: position the card near the target.
      const cardEl = tourEl.querySelector('.tour-card')
      const cardW = Math.min(320, window.innerWidth - 32)
      cardEl.style.maxWidth = cardW + 'px'
      // Place above or below the target depending on space
      const placeBelow = r.top < window.innerHeight / 2
      cardEl.style.left = Math.max(16, Math.min(r.left + r.width / 2 - cardW / 2, window.innerWidth - cardW - 16)) + 'px'
      if (placeBelow) {
        cardEl.style.top = Math.min(r.bottom + 12, window.innerHeight - 220) + 'px'
        cardEl.style.bottom = 'auto'
      } else {
        cardEl.style.bottom = Math.min(window.innerHeight - r.top + 12, window.innerHeight - 220) + 'px'
        cardEl.style.top = 'auto'
      }
      target.classList.add('tour-target')
      // Remove highlight from previous targets
      STEPS.forEach((s) => { const t = s.target(); if (t && t !== target) t.classList.remove('tour-target') })
    } else {
      // No target → center
      const cardEl = tourEl.querySelector('.tour-card')
      cardEl.style.left = '50%'
      cardEl.style.top = '50%'
      cardEl.style.bottom = 'auto'
      cardEl.style.transform = 'translate(-50%, -50%)'
      cardEl.style.maxWidth = '380px'
    }
  }

  function endTour() {
    if (!tourEl) return
    markTourDone()
    STEPS.forEach((s) => { const t = s.target(); if (t) t.classList.remove('tour-target') })
    document.removeEventListener('keydown', tourKeyHandler)
    tourEl.remove()
    tourEl = null
  }

  // Trigger on dashboard load (first time only)
  document.addEventListener('DOMContentLoaded', () => {
    if (!shouldShowTour()) return
    // Only show on the dashboard (pathname /app or /dashboard.html)
    const p = location.pathname
    if (p !== '/app' && p !== '/dashboard.html' && p !== '/dashboard') return
    // Wait for the nav + FAB to be present (nav loads async via fetch)
    setTimeout(() => {
      // S64: a soft navigation may have left the dashboard during the 1200ms wait —
      // the tour is dashboard first-visit coaching, never wrong-page chrome. Re-check
      // WHERE we are before painting the overlay (the observed failure: a nav to
      // /projects.html mid-wait left an invisible click-blocking wall behind).
      if (location.pathname !== p) return
      if (document.querySelector('[data-fab-toggle]') || document.querySelector('.fab-stack')) {
        startTour()
      }
    }, 1200)
  })

  // Expose for programmatic re-trigger (e.g. a "Show tour again" button in settings)
  window.hibanaTour = { start: startTour, reset: () => { try { localStorage.removeItem(TOUR_KEY) } catch {} } }
})()
