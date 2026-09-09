// Touch/pen drag fallback for the HTML5-DnD rows (roast plan P6).
// Extracted from app.js (Phase B1.2) — standalone IIFE, zero window.hibana deps.
//
// Native drag & drop never fires from a touchscreen, so the dashboard boxes, kanban /
// card-grid reorder, sparks shelf and hurdle lists were mouse-only. A 250ms long-press
// on a draggable row arms a drag; the finger then drives synthetic dragstart/dragover/
// drop/dragend events carrying a real DataTransfer, so every existing delegated drop
// handler works unchanged (targets come from elementFromPoint, coordinates are real).
// A quick tap keeps its normal behavior (no arm, no click suppression).
;(() => {
  const ARM_MS = 250
  const MOVE_CANCEL_PX = 12 // moving before arming means it was a scroll → cancel
  const BLOCK_CLICK_MS = 700 // after a real drag, swallow the stray click on the row link

  let s = null // { src, dt, sx, sy, timer, armed } — one drag at a time
  let blockClickUntil = 0

  function cleanup() {
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    if (s.src) s.src.style.touchAction = ''
    s = null
  }

  function fire(type, target, x, y) {
    if (!target || target.nodeType !== 1) return
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
    // DataTransfer isn't part of DragEventInit in every engine — attach it explicitly.
    Object.defineProperty(ev, 'dataTransfer', { value: s.dt })
    target.dispatchEvent(ev)
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return // mouse keeps native HTML5 DnD
    const src = e.target.closest('[draggable="true"], [data-project-id], [data-hurdle-id]')
    if (!src) return
    if (e.target.closest('button, select, input, textarea, .spark-menu')) return // controls stay interactive
    cleanup()
    const dt = new DataTransfer()
    dt.setData('text/plain', src.dataset.projectId || src.dataset.hurdleId || '')
    s = { src, dt, sx: e.clientX, sy: e.clientY, timer: null, armed: false }
    src.style.touchAction = 'none' // the long-press-then-drag must not scroll the page
    s.timer = setTimeout(() => {
      if (!s || s.armed) return
      s.armed = true
      blockClickUntil = Date.now() + BLOCK_CLICK_MS
      fire('dragstart', s.src, s.sx, s.sy)
    }, ARM_MS)
  }, { passive: true })

  document.addEventListener('pointermove', (e) => {
    if (!s) return
    if (!s.armed) {
      if (Math.hypot(e.clientX - s.sx, e.clientY - s.sy) > MOVE_CANCEL_PX) cleanup()
      return
    }
    s.sx = e.clientX
    s.sy = e.clientY
    fire('dragover', document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY)
  }, { passive: true })

  document.addEventListener('pointerup', (e) => {
    if (!s) return
    if (s.armed) {
      fire('drop', document.elementFromPoint(e.clientX, e.clientY), e.clientX, e.clientY)
      fire('dragend', s.src, e.clientX, e.clientY)
    }
    cleanup()
  }, { passive: true })

  document.addEventListener('pointercancel', cleanup)

  // A completed drag can leave a stray click on the row's link — swallow it briefly.
  document.addEventListener(
    'click',
    (e) => {
      if (Date.now() < blockClickUntil) {
        blockClickUntil = 0
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
      }
    },
    true,
  )
})()
