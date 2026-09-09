// PWA install prompt (Round 7.2 + 2026-09-09 cadence fix).
// Captures the beforeinstallprompt event (Chrome/Edge/Android), stashes it, and exposes
// a way to trigger the native install dialog. Two surfaces use it:
//   1. A toast on the dashboard ("Install Hibana for offline access" + Install / Not now /
//      Don't show again). Shows at most once per REMINDER_INTERVAL_MS (~30 days), and never
//      again once the user clicks "Don't show again".
//   2. An "Install app" button in Settings → Help (if the prompt is available).
// On Firefox/Safari (no beforeinstallprompt), both surfaces no-op gracefully.
// Zero deps, zero DB, progressive enhancement.

;(() => {
  const _t = (k, f) => window.hibanaI18n?.t(k) || f
  let deferredPrompt = null

  // --- Cadence keys (2026-09-09 fix: was showing every refresh because DISMISS_KEY was
  //     only set on explicit dismiss; a fresh load re-fired the toast every time) ---
  const NEVER_KEY = 'hibana-install-never'        // '1' = user clicked "Don't show again" → permanent
  const NEXT_KEY = 'hibana-install-next'           // ISO timestamp = when to show the next reminder
  // 30 days. The user said "every once a few while, like 1 per month" — 30d matches that.
  const REMINDER_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000

  const now = () => Date.now()

  // Should we show the reminder right now? Returns false if the user said "never" or if
  // the next-reminder timestamp is still in the future.
  const shouldRemind = () => {
    try {
      if (localStorage.getItem(NEVER_KEY) === '1') return false
      const next = localStorage.getItem(NEXT_KEY)
      if (next) {
        const t = Number(next)
        if (!Number.isNaN(t) && t > now()) return false
      }
    } catch {}
    return true
  }

  // Schedule the next reminder REMINDER_INTERVAL_MS out. Called after we show the toast
  // (so the same toast can't fire twice in one session) and after "Not now" (so the next
  // reminder is a month away, not never — the user might change their mind later).
  const scheduleNext = () => {
    try { localStorage.setItem(NEXT_KEY, String(now() + REMINDER_INTERVAL_MS)) } catch {}
  }

  const neverAgain = () => {
    try { localStorage.setItem(NEVER_KEY, '1') } catch {}
  }

  // Capture the event as early as possible (before any UI loads).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // stop the browser's default mini-infobar
    deferredPrompt = e
    if (!shouldRemind()) return
    const p = location.pathname
    if (p !== '/app' && p !== '/dashboard.html' && p !== '/dashboard') return
    // Wait for the dashboard to render (the toast needs window.hibana).
    setTimeout(showInstallToast, 2500)
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    // Once installed, never remind again — the user already has the app.
    try { localStorage.setItem(NEVER_KEY, '1') } catch {}
    window.hibana?.toast?.(_t('install.installed', 'Hibana installed — find it on your home screen.'), 'info', 5000)
  })

  function showInstallToast() {
    if (!deferredPrompt) return
    if (!window.hibana?.toast) return
    // Schedule the next reminder right now so a second beforeinstallprompt in the same
    // session can't re-fire the toast (the event fires on every navigation in Chrome).
    scheduleNext()
    // Use the upgraded toast with action buttons (from R2.4) + the "Don't show again" button.
    window.hibana.toast(
      _t('install.prompt', 'Install Hibana for offline access?'),
      'info',
      12000,
      [
        { label: _t('install.install', 'Install'), kind: 'primary', onClick: triggerInstall },
        { label: _t('install.notNow', 'Not now'), onClick: dismissInstall },
        { label: _t('install.neverAgain', "Don't show again"), kind: 'ghost', onClick: neverAgainInstall },
      ],
    )
  }

  async function triggerInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      // appinstalled event will fire; no further action needed.
    } else {
      // User declined — schedule the next reminder a month out (not permanent).
      scheduleNext()
    }
    deferredPrompt = null
  }

  function dismissInstall() {
    // "Not now" = snooze for a month. The user might want it later.
    scheduleNext()
  }

  function neverAgainInstall() {
    // "Don't show again" = permanent. localStorage persists across sessions.
    neverAgain()
  }

  // Expose for the Settings button + for testing/clearing the cadence.
  window.hibanaInstall = {
    canInstall: () => !!deferredPrompt,
    trigger: triggerInstall,
    showPrompt: showInstallToast,
    // Dev/debug: reset the cadence + never flag (used by a console call, not UI).
    reset: () => { try { localStorage.removeItem(NEVER_KEY); localStorage.removeItem(NEXT_KEY) } catch {} },
  }
})()
