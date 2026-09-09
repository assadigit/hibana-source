// Hard-load bootstrap fix: page Alpine components must register BEFORE Alpine scans the tree.
//
// On a full page load Alpine starts the moment its deferred script runs — which happens before
// nav.js (loaded later) drains the page-def queue, so page components were "unknown" on a
// refresh (only soft navigation worked). Alpine fires `alpine:init` during its startup, right
// before it scans the tree, and this script (loaded synchronously, before Alpine) is guaranteed
// to be listening. Draining the queued page defs here registers their Alpine.data components
// in time. Soft-navigation is unaffected (nav.js applies defs and inits the fresh subtree).
//
// Pages must be mounted with the SAME context nav.js provides ({ on() }): every page script
// registers delegated listeners through ctx.on, and without it hard loads threw
// "Cannot read properties of undefined (reading 'on')" mid-mount — silently killing everything
// mounted after the first listener (card menus, drag-and-drop, view switching). The mounted
// page is handed to nav.js via window.__hibanaBoot so a later soft navigation unmounts it
// instead of leaking document listeners into the next page.
//
// Phase 6 item 12 (2026-09-09): paint the user's page-width choice (localStorage
// 'hibana-page-width' — 'standard' | 'full') on <html> BEFORE first render. Synchronous,
// runs in every page's <head>, so the width never flashes from the old per-page default.
//
// M5 fix (2026-09-10): also paint the user's language + direction synchronously from
// localStorage 'hibana-lang' BEFORE first render. i18n.js's apply() is async (awaits
// /api/auth/me), so without this every page started as lang=en dir=ltr and flashed to
// fa/rtl when apply() resolved — a visible LTR/English FOUC for Farsi users on every
// navigation. The cached value is updated by i18n.js on every successful apply(); if it's
// stale (e.g. the user changed language on another device), apply() corrects it in <300ms.
try {
  const w = localStorage.getItem('hibana-page-width')
  document.documentElement.dataset.pageWidth = w === 'full' ? 'full' : 'standard'
} catch { /* storage unavailable — the CSS default (standard) applies */ }

try {
  const cachedLang = localStorage.getItem('hibana-lang')
  if (cachedLang === 'fa' || cachedLang === 'en') {
    document.documentElement.lang = cachedLang
    document.documentElement.dir = cachedLang === 'fa' ? 'rtl' : 'ltr'
    // Pre-load the Vazir font for Farsi so the first paint already has the right typeface
    if (cachedLang === 'fa') {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.dataset.vazir = '1'
      link.href = '/vendor/vazir/font-face.css'
      document.head.appendChild(link)
    }
  }
} catch { /* storage unavailable — i18n.js apply() handles it async */ }

// CRITICAL i18n pre-paint (2026-09, fixes the Latin→Farsi flash on navigation):
// The server renders all [data-i18n] elements in English (the hardcoded HTML text).
// i18n.js's apply() is deferred + awaits /api/auth/me, so FA users see English text
// for ~300ms before apply() swaps it — a visible flash on every navigation.
// This inline critical dict translates the MOST VISIBLE chrome (nav links, page
// headings, common buttons) ASAP after the body parses, BEFORE the browser paints.
// i18n.js's apply() then refines everything (full 1300+ key dict) when it resolves.
//
// Timing: boot.js runs in <head> (before body parses). We can't translate body
// elements yet. requestAnimationFrame fires AFTER the DOM is parsed but BEFORE the
// browser paints — so the user sees FA text on the very first paint, no Latin flash.
// (DOMContentLoaded fires AFTER paint — too late.)
try {
  const cachedLang = localStorage.getItem('hibana-lang')
  if (cachedLang === 'fa') {
    const CRITICAL_FA = {
      'nav.dashboard': 'پیشخوان', 'nav.sadhana': 'لیست کارها', 'nav.projects': 'پروژه‌ها',
      'nav.sparks': 'ایده‌ها', 'nav.canvas': 'بوم', 'nav.whiteboard': 'برگه یادداشت',
      'nav.calendar': 'تقویم', 'nav.notifications': 'اعلان‌ها', 'nav.reports': 'گزارش‌ها',
      'nav.archive': 'بایگانی', 'nav.settings': 'تنظیمات', 'nav.clients': 'مشتریان',
      'nav.admin': 'مدیریت', 'common.save': 'ذخیره', 'common.cancel': 'انصراف',
      'common.delete': 'حذف', 'common.close': 'بستن', 'common.edit': 'ویرایش',
      'common.add': 'افزودن', 'common.loading': 'در حال بارگذاری…',
      'a11y.skipToMain': 'پرش به محتوای اصلی',
      'settings.preferences': 'ترجیحات', 'settings.views': 'گزینه‌های نمایش',
      'settings.account': 'حساب', 'settings.telegram': 'تلگرام', 'settings.data': 'داده',
    }
    const applyCritical = () => {
      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const fa = CRITICAL_FA[el.dataset.i18n]
        if (fa) el.textContent = fa
      })
      document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
        const fa = CRITICAL_FA[el.getAttribute('data-i18n-aria-label')]
        if (fa) el.setAttribute('aria-label', fa)
      })
    }
    // Run SYNCHRONOUSLY the moment the body is parsed, before first paint.
    // boot.js is in <head> (runs before body parses), so we wait for readystatechange
    // === 'interactive' (body parsed, before paint). This is BEFORE i18n.js apply()
    // (which is deferred + awaits /api/auth/me). The critical dict covers the visible
    // chrome; apply() refines everything else.
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', () => {
        if (document.readyState !== 'loading') applyCritical()
      }, { capture: true })
    } else {
      applyCritical()
    }
  }
} catch { /* i18n.js apply() handles it async */ }

// Service Worker update → reload once so the new HTML/JS replaces the stale cached
// version. Without this, a user with an active old SW keeps seeing the old settings.html
// (etc.) even after a deploy — the old SW serves the cached shell, the new SW installs
// in the background but only takes control on the NEXT navigation, and if the tab stays
// open the user is stuck on stale UI. skipWaiting() + clients.claim() make the new SW
// activate immediately, and this listener catches that controllerchange and reloads so
// the fresh shell is what the user sees. Reload fires at most once per SW version (the
// flag is keyed by the SW's script URL, which changes with each hibana-vNNN bump).
//
// 2026-09-09 (aggressive update): also actively poll for SW updates on every page load.
// navigator.serviceWorker.getRegistration().update() forces the browser to re-fetch
// sw.js and compare — if a new SW is found, it installs + activates (skipWaiting +
// clients.claim), which fires controllerchange → the listener above reloads the page.
// This catches the case where the user stays on a long-lived tab and never navigates
// (the old SW would otherwise stay active until the next hard navigation).
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    try {
      const last = sessionStorage.getItem('hibana-sw-reload')
      // Throttle: don't reload more than once per 5s (the event can fire twice on some
      // browsers during a single SW swap). The sessionStorage flag survives the reload.
      if (last && Date.now() - Number(last) < 5000) return
      sessionStorage.setItem('hibana-sw-reload', String(Date.now()))
      location.reload()
    } catch { /* sessionStorage unavailable — reload anyway */ location.reload() }
  })
  // On every page load, force the SW to check for an update. If a new hibana-vNNN is
  // deployed, this triggers install → skipWaiting → activate → clients.claim → the
  // controllerchange listener reloads the page with the fresh shell. The update()
  // call is async + best-effort; a failure must never break the page.
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistration?.().then((reg) => {
      if (reg) reg.update().catch(() => {})
    }).catch(() => {})
  })
}

document.addEventListener('alpine:init', () => {
  const q = window.__hibanaPageQueue || []
  if (!q.length) return
  window.__hibanaPageQueue = []
  for (const def of q) {
    if (!def || typeof def.mount !== 'function') continue
    const listeners = []
    const ctx = {
      on(type, fn, opts) {
        document.addEventListener(type, fn, opts)
        listeners.push([type, fn, opts])
      },
    }
    const customUnmount = def.mount(ctx)
    window.__hibanaBoot = {
      name: def.name,
      unmount() {
        for (const [t, f, o] of listeners) document.removeEventListener(t, f, o)
        listeners.length = 0
        if (typeof customUnmount === 'function') customUnmount()
      },
    }
  }
})