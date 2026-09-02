// PWA install prompt (Round 7.2).
// Captures the beforeinstallprompt event (Chrome/Edge/Android), stashes it, and exposes
// a way to trigger the native install dialog. Two surfaces use it:
//   1. A one-time toast on the dashboard ("Install Hibana for offline access" + Install button).
//   2. An "Install app" button in Settings → Help (if the prompt is available).
// On Firefox/Safari (no beforeinstallprompt), both surfaces no-op gracefully.
// Zero deps, zero DB, progressive enhancement.

;(() => {
  const _t = (k, f) => window.hibanaI18n?.t(k) || f
  let deferredPrompt = null
  const DISMISS_KEY = 'hibana-install-dismissed'

  // Capture the event as early as possible (before any UI loads).
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // stop the browser's default mini-infobar
    deferredPrompt = e
    // Show the one-time toast on the dashboard, unless dismissed.
    try {
      if (localStorage.getItem(DISMISS_KEY)) return
    } catch {}
    const p = location.pathname
    if (p !== '/app' && p !== '/dashboard.html' && p !== '/dashboard') return
    // Wait for the dashboard to render (the toast needs window.hibana).
    setTimeout(showInstallToast, 2500)
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    window.hibana?.toast?.(_t('install.installed', 'Hibana installed — find it on your home screen.'), 'info', 5000)
  })

  function showInstallToast() {
    if (!deferredPrompt) return
    if (!window.hibana?.toast) return
    // Use the upgraded toast with action buttons (from R2.4).
    window.hibana.toast(
      _t('install.prompt', 'Install Hibana for offline access?'),
      'info',
      12000,
      [
        { label: _t('install.install', 'Install'), kind: 'primary', onClick: triggerInstall },
        { label: _t('install.notNow', 'Not now'), onClick: dismissInstall },
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
      // User declined — don't show the toast again this session.
      try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
    }
    deferredPrompt = null
  }

  function dismissInstall() {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }

  // Expose for the Settings button.
  window.hibanaInstall = {
    canInstall: () => !!deferredPrompt,
    trigger: triggerInstall,
    showPrompt: showInstallToast,
  }
})()
