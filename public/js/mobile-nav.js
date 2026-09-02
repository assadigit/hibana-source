// Mobile bottom-tab nav (Phase B2.6; mobile pass 2026-08-29).
// On screens ≤1024px the app goes header-less (the topbar is hidden via app.css),
// so this bar carries ALL navigation: five primary destinations as tabs plus a
// "More" tab that opens a bottom sheet with the rest (Canvas, Calendar, Activity,
// Notebook, Notifications, Reports, Archive, Settings + Language / Theme / Sign out).
// Loaded on authed pages only: the bar is hidden by default and shown via
// .has-mobile-nav on <body>, set here only if the nav partial is present.
//
// Labels are rendered through [data-i18n] on purpose: i18n.js's apply() runs an
// async /api/auth/me fetch before it knows the language, and this bar builds
// synchronously on DOMContentLoaded — build-time t() baked English for Farsi
// users (the "mixed language" bug). [data-i18n] nodes are translated by apply()
// once the language resolves, and re-translated on every language toggle.

;(() => {
  const TABS = [
    { href: '/dashboard.html', i18n: 'nav.dashboard', label: 'Dashboard', icon: '<path d="M4 20V14M10 20V10M16 20V4"/>' },
    { href: '/to-do-list', i18n: 'nav.sadhana', label: 'To-do', icon: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z"/>' },
    { href: '/projects.html', i18n: 'nav.projects', label: 'Projects', icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/>' },
    { href: '/sparks.html', i18n: 'nav.sparks', label: 'Ideas', icon: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>' },
  ]

  // Secondary destinations + account actions — the old topbar user-menu contents.
  // Links keep soft-nav (nav.js intercepts); the sheet closes on any activation.
  // The Admin row (batch r) ships hidden and is unhidden by app.js's role check —
  // [data-admin-link] lives on the sheet row too.
  const SHEET_LINKS = [
    { href: '/canvas.html', i18n: 'nav.canvas', label: 'Canvas', icon: '<path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/>' },
    // Phase 6 item 4: Notebook sits next to Canvas in the mobile sheet too.
    { href: '/whiteboard.html', i18n: 'nav.whiteboard', label: 'Notebook', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
    { href: '/calendar.html', i18n: 'nav.calendar', label: 'Calendar', icon: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>' },
    { href: '/notifications.html', i18n: 'nav.notifications', label: 'Notifications', icon: '<path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 7.8-2.5 9h17c0-1.2-2.5-2.5-2.5-9"/><path d="M10 21a2 2 0 0 0 4 0"/>' },
    { href: '/reports.html', i18n: 'nav.reports', label: 'Reports', icon: '<path d="M4 20V14M10 20V10M16 20V4"/>' },
    { href: '/archive.html', i18n: 'nav.archive', label: 'Archive', icon: '<rect x="2" y="4" width="20" height="4"/><path d="M4 8v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>' },
    { href: '/settings.html', i18n: 'nav.settings', label: 'Settings', icon: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>' },
    { href: '/admin.html', i18n: 'nav.admin', label: 'Admin', adminOnly: true, icon: '<path d="M12 3l8 3v5c0 4.4-3.4 8.4-8 10-4.6-1.6-8-5.6-8-10V6l8-3Z"/><path d="M12 8v4M12 15h.01"/>' },
  ]

  const svg = (icon) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>`

  // Owner-only rows (batch r): unhide if app.js already resolved the role (flag), or
  // when it announces it (event) — whichever comes first relative to this build.
  const revealOwnerRows = () => {
    document.querySelectorAll('[data-admin-link]').forEach((el) => { el.hidden = false })
  }
  if (window.__hibanaOwner) revealOwnerRows()
  document.addEventListener('hibana:role', (e) => { if (e.detail?.role === 'owner') revealOwnerRows() })

  let moreBtn = null
  let sheet = null
  let backdrop = null

  function current(pathname) {
    return pathname === '/app' ? '/dashboard.html' : pathname
  }

  function buildBar() {
    const nav = document.createElement('nav')
    nav.className = 'mobile-nav'
    nav.setAttribute('aria-label', 'Main menu')
    nav.setAttribute('data-i18n-aria-label', 'mobilenav.label')
    const tabs = TABS.map((tab) => {
      const isActive = current(location.pathname) === tab.href || location.pathname === tab.href.replace('.html', '')
      return `<a href="${tab.href}" aria-current="${isActive ? 'page' : 'false'}">
        ${svg(tab.icon)}
        <span class="mobile-nav-label" data-i18n="${tab.i18n}">${tab.label}</span>
      </a>`
    }).join('')
    nav.innerHTML = `${tabs}
      <button type="button" class="mobile-nav-more" aria-haspopup="dialog" aria-expanded="false" aria-controls="mobile-more-sheet">
        ${svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>')}
        <span class="mobile-nav-label" data-i18n="nav.more">More</span>
      </button>`
    document.body.appendChild(nav)
    document.body.classList.add('has-mobile-nav')
    moreBtn = nav.querySelector('.mobile-nav-more')
    moreBtn.addEventListener('click', () => toggleSheet())
  }

  function buildSheet() {
    backdrop = document.createElement('div')
    backdrop.className = 'mobile-more-backdrop'
    backdrop.addEventListener('click', () => closeSheet())

    sheet = document.createElement('div')
    sheet.className = 'mobile-more-sheet'
    sheet.id = 'mobile-more-sheet'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    sheet.setAttribute('aria-label', 'More')
    sheet.setAttribute('data-i18n-aria-label', 'nav.more')
    sheet.innerHTML = `
      <div class="mobile-more-head" data-i18n="nav.more">More</div>
      ${SHEET_LINKS.map((row) => `<a class="mobile-more-row"${row.adminOnly ? ' data-admin-link hidden' : ''} href="${row.href}">
        ${svg(row.icon)}
        <span data-i18n="${row.i18n}">${row.label}</span>
      </a>`).join('')}
      <div class="mobile-more-div" role="separator"></div>
      <button type="button" class="mobile-more-row" data-mobile-lang>
        ${svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z"/>')}
        <span data-i18n="nav.lang">فارسی</span>
      </button>
      <button type="button" class="mobile-more-row" data-mobile-theme>
        ${svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')}
        <span data-i18n="nav.theme">Theme</span>
      </button>
      <button type="button" class="mobile-more-row mobile-more-danger" data-mobile-logout>
        ${svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}
        <span data-i18n="nav.signout">Sign out</span>
      </button>`

    document.body.append(backdrop, sheet)

    // Any link row: close the sheet — soft-nav swaps <main> without a reload, so an
    // open sheet would otherwise linger over the freshly loaded page. This must be a
    // DOCUMENT-level CAPTURE listener: nav.js intercepts internal links at the
    // document capture phase and calls stopPropagation(), which kills any bubble-phase
    // listener attached to the sheet itself. Same-node listeners still run, and this
    // one is on the same node (document), so it fires after nav.js's interceptor.
    document.addEventListener('click', (e) => {
      if (!sheet.classList.contains('open')) return
      const a = e.target instanceof Element ? e.target.closest('a') : null
      if (a && sheet.contains(a)) closeSheet()
    }, true)

    // Language: mirror the topbar quick-toggle (persist → re-apply dictionary →
    // re-render server fragments in place).
    sheet.querySelector('[data-mobile-lang]').addEventListener('click', async () => {
      const next = (window.hibanaI18n?.lang() ?? 'en') === 'fa' ? 'en' : 'fa'
      try {
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language_pref: next }),
        })
      } catch { /* still apply the client dictionary so the toggle works offline */ }
      if (window.hibanaI18n) await window.hibanaI18n.apply()
      closeSheet()
      if (window.hibanaNav) window.hibanaNav.reload()
      else window.location.reload()
    })

    // Theme: same engine as the topbar sun button.
    sheet.querySelector('[data-mobile-theme]').addEventListener('click', () => {
      window.hibana?.toggleTheme()
      closeSheet()
    })

    // Sign out: same flow as the topbar user menu.
    sheet.querySelector('[data-mobile-logout]').addEventListener('click', () => {
      fetch('/api/auth/logout', { method: 'POST' }).then(() => (window.location.href = '/login.html'))
    })

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheet?.classList.contains('open')) closeSheet()
    })
  }

  function toggleSheet() {
    if (sheet?.classList.contains('open')) closeSheet()
    else openSheet()
  }

  function openSheet() {
    if (!sheet) return
    sheet.classList.add('open')
    backdrop.classList.add('open')
    moreBtn?.setAttribute('aria-expanded', 'true')
    // Focus the first focusable row so keyboard/SR users land inside the dialog.
    const first = sheet.querySelector('a, button')
    first?.focus({ preventScroll: true })
  }

  function closeSheet() {
    if (!sheet) return
    sheet.classList.remove('open')
    backdrop.classList.remove('open')
    moreBtn?.setAttribute('aria-expanded', 'false')
    moreBtn?.focus({ preventScroll: true })
  }

  function build() {
    if (document.querySelector('.mobile-nav')) return
    buildBar()
    buildSheet()
  }

  // Only build when the page has the nav partial (authed pages inject [data-nav])
  // Wait for DOMContentLoaded so the nav partial has a chance to load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.querySelector('[data-nav]')) build()
    })
  } else {
    if (document.querySelector('[data-nav]')) build()
  }
  // The nav partial loads async via fetch in app.js; re-check after a tick
  if (document.querySelector('[data-nav]') && !document.querySelector('.mobile-nav')) {
    setTimeout(() => {
      if (document.querySelector('[data-nav]')) build()
    }, 500)
  }
})()
