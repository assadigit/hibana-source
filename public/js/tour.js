// Onboarding tour + dashboard counter animation (Round 5).
// - Tour: a one-time coachmark overlay for first-time users. Highlights
//   the command palette (Ctrl+K), the quick-add FAB, and the theme toggle. 4 steps + done.
//   Triggered on first dashboard visit unless the user has dismissed it. Gated by
//   localStorage AND account age (S70): a veteran on a fresh browser profile is never
//   re-coached (the account is >14 days old via /api/auth/me → silently marked done).
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

  // ---- Onboarding tour (R5.1; S89 rewrite) --------------------------------------
  // Only on the dashboard, only once per browser (localStorage). Skips if the user has
  // already dismissed it or if the key elements aren't present.
  function shouldShowTour() {
    try { return !localStorage.getItem(TOUR_KEY) } catch { return false }
  }
  function markTourDone() {
    try { localStorage.setItem(TOUR_KEY, '1') } catch {}
  }

  // S89 (owner: "work rigorously on guided-tour, it should show the main abilities and
  // whereabouts of this app"): the 4-step chrome-only tour grew into a full walk of the
  // app — the rail and every core section on it, the side panel each icon opens, quick
  // capture, the account menu (where Canvas/Notebook now live), and the theme. Every
  // target degrades to null (centered card + still-useful copy) when its element is
  // absent — mobile hides the rail, and the tour can be replayed from any page.
  const railIcon = (panel) => () => {
    const el = document.querySelector('.rail .rail-btn[data-rail-panel="' + panel + '"]')
    return el && el.getBoundingClientRect().width > 0 ? el : null
  }
  const STEPS = [
    {
      target: () => null,
      title: () => _t('tour.welcome', 'Welcome to Hibana'),
      body: () => _t('tour.welcomeBody', 'A two-minute walk through the places you’ll live in — the rail on the left, the panel each icon opens, and capture everywhere. Skip anytime.'),
    },
    {
      target: () => {
        const el = document.querySelector('nav.rail')
        return el && el.getBoundingClientRect().width > 0 ? el : null
      },
      title: () => _t('tour.rail', 'The navigation rail'),
      body: () => _t('tour.railBody', 'Every section sits on this rail — one icon and label per destination. The filled square marks where you are; clicking an icon opens its list panel beside the rail.'),
    },
    {
      target: () => {
        const el = document.querySelector('.rail-search')
        return el && el.getBoundingClientRect().width > 0 ? el : null
      },
      title: () => _t('tour.search', 'Search & commands'),
      body: () => _t('tour.searchBody', 'Click here — or press Ctrl+K (⌘K) anywhere — to search every project, note and task, and jump straight to it.'),
    },
    {
      target: railIcon('dashboard'),
      title: () => _t('tour.dash', 'Dashboard'),
      body: () => _t('tour.dashBody', 'Your day at a glance: continue where you left off, today’s to-dos, and live stats for every active project.'),
    },
    {
      target: railIcon('todo'),
      title: () => _t('tour.todo', 'To-do list'),
      body: () => _t('tour.todoBody', 'A four-box board for your life areas — rename the boxes (Personal Life, Finance…). The panel beside this icon lists every task under its box.'),
    },
    {
      target: railIcon('projects'),
      title: () => _t('tour.projects', 'Projects'),
      body: () => _t('tour.projectsBody', 'Each project carries a progress board, sprints, files and history. Open one from this icon’s panel.'),
    },
    {
      target: railIcon('sparks'),
      title: () => _t('tour.ideas', 'Ideas'),
      body: () => _t('tour.ideasBody', 'The spark shelf: capture first, file into folders later. The panel groups your ideas under their folders.'),
    },
    {
      target: railIcon('notes'),
      title: () => _t('tour.notes', 'Notes'),
      body: () => _t('tour.notesBody', 'The long-form vault — folders, markdown, checklists, code blocks and the AI wand.'),
    },
    {
      target: railIcon('calendar'),
      title: () => _t('tour.calendar', 'Calendar'),
      body: () => _t('tour.calendarBody', 'Deadlines from projects and to-dos in one month view. Farsi users get the Jalali calendar throughout.'),
    },
    {
      target: () => document.querySelector('.fab[data-fab-toggle]') || document.querySelector('.fab-stack'),
      title: () => _t('tour.fab', 'Quick capture'),
      body: () => _t('tour.fabBody', 'The + button captures a new task, idea or note in seconds — from any page. Ctrl+N works too.'),
    },
    {
      target: () => {
        // the avatar (account menu) — highlight the chip itself; on mobile there is
        // no avatar in the chrome → centered card still explains the menu.
        const el = document.querySelector('.rail-user-chip') || document.querySelector('[data-user]')
        return el && el.getBoundingClientRect().width > 0 ? el : null
      },
      title: () => _t('tour.account', 'Your account'),
      body: () => _t('tour.accountBody', 'Hover your avatar for notifications, reports, the gallery, Canvas & Notebook, and Settings — language and theme live in Settings.'),
    },
    {
      target: () => {
        const t = document.querySelector('[data-theme-toggle]')
        return t && t.getBoundingClientRect().width > 0 ? t : null
      },
      title: () => _t('tour.theme', 'Light / dark'),
      body: () => _t('tour.themeBody', 'One click switches between light and Claude dark. On mobile the toggle lives in the More (⋯) menu.'),
    },
    {
      target: () => null,
      title: () => _t('tour.done', 'You’re all set'),
      body: () => _t('tour.doneBody', 'Press ? anytime for every keyboard shortcut — and replay this tour from the Help icon at the bottom of the rail.'),
    },
  ]

  let tourEl = null
  let stepIdx = 0
  let tourRaf = 0

  // S89: POSITIONING, done rigorously. The old placer had two leaks that pushed the
  // card beyond the viewport (the owner's report): (1) the CENTERED branch set
  // transform: translate(-50%,-50%) and the ANCHORED branch never reset it — going
  // Back / dot-jumping from a centered step to an anchored one shifted the card by
  // half its own size, straight off screen; (2) the vertical clamp assumed a ~200px
  // card. Now: the transform is always reset when anchoring, the card's REAL
  // offsetWidth/Height are measured after its content paints, everything is clamped
  // against 12px viewport margins, and a narrow left-edge target (a rail icon) opens
  // the card BESIDE itself instead of clamping against the left margin. A resize or
  // any scroll re-renders the current step (rAF-debounced) so the coachmark follows.
  const placeCardBeside = (cardEl, target) => {
    const M = 12
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = target.getBoundingClientRect()
    cardEl.style.transform = ''
    cardEl.style.maxWidth = Math.min(340, vw - 2 * M) + 'px'
    cardEl.style.maxHeight = (vh - 2 * M) + 'px'
    cardEl.style.overflowY = 'auto'
    const cw = cardEl.offsetWidth
    const ch = cardEl.offsetHeight
    // horizontal: centered on the target, unless the target is a narrow element
    // hugging the left edge (the rail + its icons) — then the card opens to its
    // RIGHT so the rail column stays visible under the veil.
    let left
    if (r.width <= 96 && r.right < vw * 0.35 && r.right + 14 + cw <= vw - M) {
      left = r.right + 14
    } else {
      left = Math.min(Math.max(r.left + r.width / 2 - cw / 2, M), Math.max(M, vw - cw - M))
    }
    // vertical: below when it fits, else above, else clamped into view.
    let top
    if (r.bottom + 12 + ch <= vh - M) top = r.bottom + 12
    else if (r.top - 12 - ch >= M) top = r.top - 12 - ch
    else top = Math.max(M, Math.min(r.bottom + 12, vh - ch - M))
    cardEl.style.left = left + 'px'
    cardEl.style.top = top + 'px'
    cardEl.style.bottom = 'auto'
  }

  const placeCardCentered = (cardEl) => {
    cardEl.style.left = '50%'
    cardEl.style.top = '50%'
    cardEl.style.bottom = 'auto'
    cardEl.style.transform = 'translate(-50%, -50%)'
    cardEl.style.maxWidth = Math.min(380, window.innerWidth - 24) + 'px'
    cardEl.style.maxHeight = (window.innerHeight - 24) + 'px'
    cardEl.style.overflowY = 'auto'
  }

  const scheduleTourRender = () => {
    if (tourRaf || !tourEl) return
    tourRaf = requestAnimationFrame(() => { tourRaf = 0; if (tourEl) renderStep() })
  }

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
    // S89: the coachmark follows the viewport — a resize or ANY scroll (capture:
    // inner containers too) re-renders the current step against fresh rects.
    window.addEventListener('resize', scheduleTourRender)
    window.addEventListener('scroll', scheduleTourRender, { passive: true, capture: true })
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
    // S89: 13 steps wrap to two rows on a narrow card (flex-wrap in CSS).
    card.querySelector('.tour-progress').innerHTML = STEPS.map((_, i) => `<button type="button" class="tour-dot ${i === stepIdx ? 'active' : ''}" data-step="${i}" ${i === stepIdx ? 'aria-current="step"' : ''} aria-label="${_t('tour.step', 'Step')} ${i + 1}"></button>`).join('')
    // Position: anchor to the target when it is VISIBLE in this viewport; otherwise
    // a centered card (mobile hides the rail; some pages lack a given target).
    const target = step.target()
    if (target && target.getBoundingClientRect && target.getBoundingClientRect().width > 0 && target.getBoundingClientRect().height > 0) {
      const r = target.getBoundingClientRect()
      // Highlight the target
      tourEl.style.setProperty('--tour-highlight', `inset 0 0 0 9999px rgb(0 0 0 / 0.55)`)
      const cardEl = tourEl.querySelector('.tour-card')
      placeCardBeside(cardEl, target)
      target.classList.add('tour-target')
      // Remove highlight from previous targets
      STEPS.forEach((s) => { const t = s.target(); if (t && t !== target) t.classList.remove('tour-target') })
      void r // (rect read above guards visibility; placeCardBeside re-reads it)
    } else {
      const cardEl = tourEl.querySelector('.tour-card')
      placeCardCentered(cardEl)
      STEPS.forEach((s) => { const t = s.target(); if (t) t.classList.remove('tour-target') })
    }
  }

  function endTour() {
    if (!tourEl) return
    markTourDone()
    STEPS.forEach((s) => { const t = s.target(); if (t) t.classList.remove('tour-target') })
    document.removeEventListener('keydown', tourKeyHandler)
    window.removeEventListener('resize', scheduleTourRender)
    window.removeEventListener('scroll', scheduleTourRender, true)
    if (tourRaf) { cancelAnimationFrame(tourRaf); tourRaf = 0 }
    tourEl.remove()
    tourEl = null
  }

  // Trigger on dashboard load (first time only)
  document.addEventListener('DOMContentLoaded', () => {
    if (!shouldShowTour()) return
    // Only show on the dashboard (pathname /app or /dashboard.html)
    const p = location.pathname
    if (p !== '/app' && p !== '/dashboard.html' && p !== '/dashboard') return
    // S70: the tour used to fire on ANY fresh browser profile (new device, cleared
    // storage, e2e) — even for a veteran months in (verified live: a 4-month-old test
    // account got coached on a fresh agent-browser session). The tour is FIRST-visit
    // coaching, so gate it on the account's age too: /api/auth/me carries created_at;
    // an account older than 14 days is a veteran on a new profile — mark the tour done
    // silently and never coach them again. Fetch failure → previous behavior (show);
    // offline-first users lose nothing (the SW serves /api/auth/me network-first).
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (location.pathname !== p) return // soft-nav raced us — abandon
        const created = body?.user?.created_at
        if (created && Date.now() - new Date(created).getTime() > 14 * 24 * 3600 * 1000) {
          markTourDone()
          return
        }
        armTour(p)
      })
      .catch(() => armTour(p))
  })

  // Wait for the nav + FAB to be present (nav loads async via fetch)
  function armTour(p) {
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
  }

  // Expose for programmatic re-trigger (e.g. a "Show tour again" button in settings)
  window.hibanaTour = { start: startTour, reset: () => { try { localStorage.removeItem(TOUR_KEY) } catch {} } }
})()
