// Vim-style "g then letter" go-to shortcuts (Round 7.1).
// Press `g`, then within 1s press a letter to jump to a page:
//   g d → dashboard, g p → projects, g s → sparks (ideas), g t → to-do list,
//   g c → canvas, g n → notebook, g r → reports, g a → archive,
//   g e → settings, g l → calendar, g f → notifications.
// The `g` keypress shows a brief "g…" hint pill bottom-center; if no follow-up key arrives
// within 1s, it cancels silently. Never triggers when typing in an input/textarea/select.
// Zero deps, zero DB, progressive enhancement.

;(() => {
  const _t = (k, f) => window.hibanaI18n?.t(k) || f

  const TARGETS = {
    d: '/dashboard.html', p: '/projects.html', s: '/sparks.html', t: '/to-do-list',
    c: '/canvas.html', n: '/whiteboard.html', r: '/reports.html', a: '/archive.html',
    e: '/settings.html', l: '/calendar.html', f: '/notifications.html',
  }

  let armed = false
  let timer = null
  let hintPill = null

  function showHint() {
    if (hintPill) return
    hintPill = document.createElement('div')
    hintPill.className = 'goto-hint'
    hintPill.setAttribute('aria-live', 'polite')
    hintPill.textContent = 'g…'
    document.body.appendChild(hintPill)
    requestAnimationFrame(() => hintPill.classList.add('visible'))
  }

  function hideHint() {
    if (!hintPill) return
    const el = hintPill
    hintPill = null
    el.classList.remove('visible')
    setTimeout(() => el.remove(), 150)
  }

  function disarm() {
    armed = false
    if (timer) { clearTimeout(timer); timer = null }
    hideHint()
  }

  function go(path) {
    disarm()
    if (window.hibanaNav) window.hibanaNav.go(path)
    else window.location.href = path
  }

  document.addEventListener('keydown', (e) => {
    // Never intercept when typing in an input/textarea/contenteditable, or with modifiers.
    if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    // If a dialog is open, don't hijack the keystroke.
    if (document.querySelector('dialog[open]')) return

    if (!armed) {
      // Arm on `g` (lowercase only — Shift+G is reserved for browser)
      if (e.key === 'g' && !e.shiftKey) {
        e.preventDefault()
        armed = true
        showHint()
        timer = setTimeout(disarm, 1000)
      }
      return
    }

    // Armed: listen for the second key. Cancel on Escape.
    if (e.key === 'Escape') { e.preventDefault(); disarm(); return }
    const target = TARGETS[e.key.toLowerCase()]
    if (target) {
      e.preventDefault()
      go(target)
    } else {
      // Unknown key → cancel silently (don't navigate)
      disarm()
    }
  })

  // Expose for the command palette / programmatic use
  window.hibanaGoTo = { targets: TARGETS, go }
})()
