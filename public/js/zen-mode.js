// Global Focus / Zen Mode (Ctrl+.) — Round 1 new feature.
// Hides nav + chrome for deep work on any authed page. Toggle with Ctrl+. (or Cmd+. on Mac).
// ESC exits. A floating "exit zen" pill stays visible so the user can always get back.
// Zero deps, zero DB, progressive enhancement (pages work fine without it).

;(() => {
  let zenOn = false
  let exitPill = null

  function buildExitPill() {
    if (exitPill) return
    exitPill = document.createElement('button')
    exitPill.className = 'zen-exit'
    exitPill.type = 'button'
    exitPill.setAttribute('aria-label', 'Exit focus mode')
    exitPill.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg><span>Esc</span>'
    exitPill.addEventListener('click', off)
    document.body.appendChild(exitPill)
  }

  function on() {
    if (zenOn) return
    zenOn = true
    document.body.classList.add('zen-mode')
    buildExitPill()
  }

  function off() {
    if (!zenOn) return
    zenOn = false
    document.body.classList.remove('zen-mode')
  }

  function toggle() { zenOn ? off() : on() }

  // Ctrl+. (or Cmd+. on Mac) toggles. ESC exits (only when zen is on — don't steal ESC
  // from dialogs/overlays otherwise).
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '.') {
      e.preventDefault()
      toggle()
      return
    }
    if (e.key === 'Escape' && zenOn && !document.querySelector('dialog[open]')) {
      off()
    }
  })

  // Expose for the command palette / programmatic use
  window.hibanaZen = { on, off, toggle, isOn: () => zenOn }
})()
