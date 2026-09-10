// Micro-interactions (Round 3.3) — tiny global delegated listeners for one-shot animations.
// - Sadhana/dashboard task checkbox: on check, add `is-just-done` (plays a pop animation
//   via CSS), remove it after the animation ends. Re-added on every check so it replays.
// Zero deps, zero DB, progressive enhancement.

;(() => {
  // Task-complete pop — delegated on document so it works after every htmx swap and on
  // both the sadhana board and the dashboard to-do preview.
  document.addEventListener('change', (e) => {
    const cb = e.target
    if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox') return
    // Only sadhana/dashboard task checkboxes (they live inside .sadhana-card or .dash-todo-check)
    const scope = cb.closest('.sadhana-card, .dash-todo-check')
    if (!scope) return
    if (!cb.checked) return // only animate on completion
    cb.classList.remove('is-just-done') // reset so it replays
    // Force reflow so the animation restarts
    void cb.offsetWidth
    cb.classList.add('is-just-done')
    cb.addEventListener('animationend', () => cb.classList.remove('is-just-done'), { once: true })
  })

  // Avatar skeleton: mark the nav avatar as loading until app.js sets the initial/img.
  // app.js builds the avatar on DOMContentLoaded; this just pre-paints the skeleton class
  // so there's no flash of empty space.
  document.addEventListener('DOMContentLoaded', () => {
    const avatar = document.querySelector('[data-user] .avatar') || document.querySelector('.avatar')
    if (avatar && !avatar.querySelector('img') && !avatar.textContent.trim()) {
      avatar.classList.add('skeleton-avatar')
    }
  })
})()
