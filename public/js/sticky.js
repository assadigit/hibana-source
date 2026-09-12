// public/js/sticky.js — the ONE StickyNote factory shared by both boards (Session 28).
//
// History: this component was born on the Canvas board (canvas.js, "batch s" →
// session-17 square rework) and was then COPIED VERBATIM to the Notebook
// (whiteboard.js) when stickies landed there. Two copies of ~140 lines of
// battle-tested geometry (wrap-width pinning, square binary-search sizing,
// in-place downward growth, layered shadows, objectCaching:false) is exactly the
// divergence trap the Session 27→28 handovers flagged: every fix must now be
// applied twice, and the copies had already drifted (the notebook added the
// dark-mode theming refs; the canvas kept resizable controls).
//
// The consolidation: the factory lives HERE once; each board keeps a ~5-line
// wrapper that injects its surface differences:
//   hasControls   — canvas: true (resizable, default chrome); notebook: false (move-only)
//   requestRender — thunk resolving the board's fabric canvas (called from fitPaper)
//   wireTextDir   — the board's bidi helper for the inner textbox
// The notebook additionally applies applyStickyTheme() after construction when its
// sheet is dark (its dark mode is a CSS invert — see whiteboard.js).
//
// The exposed group contract (consumed by BOTH boards' editing twins, recolor
// palettes, theme observers and serializers — do not rename casually):
//   __paper        the paper Rect (recolor target, sizing reference)
//   __shadowPaper  the back Rect carrying the large soft shadow layer (recolor target)
//   __innerText    the Textbox (twin reads text/fill/width; serializer reads .text)
//   __close        { left, top, width, height } × hit region in paper coords
//   __closeBg/__closeX  the × affordance elements (theme observers recolor them)
//   __lightColor   the canonical pastel (theming round-trips the live fill)
//   __fitPaper()   grow-in-place entry point (editing twins call it on 'changed')
//
// Loaded by canvas.html + whiteboard.html before their board scripts (defer order).
window.hibanaSticky = (() => {
  const STICKY_PAPER = '#FFF59D'
  const STICKY_RADIUS = 2 // session 17: near-sharp paper corners (was 10)
  const STICKY_HEADER = 26 // header strip for the close ×

  function makeStickyNote({
    content = '',
    color = STICKY_PAPER,
    x = 0,
    y = 0,
    width = 180,
    height = 180,
    hasControls = true,
    requestRender = null,
    wireTextDir = null,
  }) {
    const render = () => { try { requestRender?.() } catch { /* board not ready */ } }
    // Session 17: the paper is a square — normalize whatever geometry arrives (old saved
    // notes were 180×120 or grown rectangles) to ONE side = the larger of the two. The
    // wrap width, × position and hit region all key off the square side below.
    const side = Math.max(Math.round(width || 180), Math.round(height || 0), 120)
    // The × carries the same faint circular background as the quick-notes delete chip
    // (2026-08-26 style unification) — one close affordance across both boards.
    const closeBg = new fabric.Circle({
      left: side - 27, top: 3, radius: 9,
      fill: 'rgba(0, 0, 0, 0.06)', selectable: false, evented: false,
    })
    const close = new fabric.Text('×', {
      left: side - 24, top: 5, fontSize: 13, fontWeight: 700,
      fill: 'rgba(63, 63, 70, 0.85)', selectable: false, evented: false, fontFamily: 'system-ui, sans-serif',
    })
    const text = new fabric.Textbox(content, {
      left: 10, top: STICKY_HEADER + 4, fontSize: 18, lineHeight: 1.3,
      fill: '#3f3f46', width: side - 20, splitByGrapheme: true, selectable: false,
    })
    // Pin the wrap width (2026-08-26 user report): a Textbox re-measures itself on every
    // keystroke and drifts wider than the paper, which stops the wrapping and lets the text
    // escape the note's edge on a single line. Re-pinning after each measure keeps the text
    // inside the padding box — text always wraps at the boundary (splitByGrapheme).
    // Session 17: wrapWidth is now a `let` — the paper grows as a SQUARE (fitPaper), so
    // the wrap re-pins to the widened paper on growth.
    let wrapWidth = side - 20
    const baseInit = text.initDimensions.bind(text)
    text.initDimensions = () => {
      // Session 17: pin FIRST, measure second — fitPaper re-pins wrapWidth and one
      // initDimensions call re-wraps AND re-measures at the new width.
      text.width = wrapWidth
      baseInit()
    }
    // Session 17: right-size the square. The text height h(w) SHRINKS as the wrap w
    // widens, so "grow to the height the current wrap demands" overshoots badly (the
    // re-wrapped text is far shorter). Instead the MINIMAL square s with
    // STICKY_HEADER + h(s-20) + 14 ≤ s is binary-searched between the incoming side
    // (may not fit) and the side the current wrap demands (always fits — h is
    // monotone non-increasing in w). Construction AND growth both use it, so a long
    // note lands on a snug square instead of a huge empty one.
    const measureAt = (w) => {
      text.width = w
      baseInit() // raw measure at w (bypasses the pin)
      return text.height || 0
    }
    const sideFor = (minSide) => {
      let lo = minSide
      let hi = Math.max(minSide, STICKY_HEADER + measureAt(minSide - 20) + 14)
      let guard = 0
      while (STICKY_HEADER + measureAt(hi - 20) + 14 > hi && guard++ < 4) hi = hi * 1.5 + 40
      const fits = (s) => STICKY_HEADER + measureAt(s - 20) + 14 <= s + 0.5
      for (let i = 0; i < 22 && hi - lo > 2; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid)) hi = mid
        else lo = mid
      }
      text.initDimensions() // restore the live measure at the CURRENT wrap
      return Math.max(minSide, Math.ceil(hi))
    }
    const paperSize = sideFor(side)
    wrapWidth = paperSize - 20
    text.initDimensions() // re-wrap at the final square's padding box
    // shadowBox: the back rect carrying the LARGE SOFT layer of the session-17 shadow.
    const shadowBox = new fabric.Rect({
      width: paperSize, height: paperSize,
      fill: color, rx: STICKY_RADIUS, ry: STICKY_RADIUS,
    })
    shadowBox.shadow = new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.12)', blur: 20, offsetX: 4, offsetY: 12, affectStroke: false })
    const box = new fabric.Rect({
      width: paperSize, height: paperSize,
      fill: color, rx: STICKY_RADIUS, ry: STICKY_RADIUS,
    })
    // Phase 5 item 18 (2026-09-08): the drop shadow belongs to the PAPER ONLY. It used to
    // sit on the group, and fabric applies the ctx shadow while drawing every child — so
    // each TEXT GLYPH carried its own shadow too (blurry, "bold-ish" text). Moving it onto
    // the Rect keeps the paper's lift while the text renders crisp.
    // Session 17: this is now the TIGHT CONTACT layer (small offset, small blur); the big
    // soft layer lives on shadowBox behind it. Compositing: shadowBox paints first (its
    // shadow + its fill), then box paints (its contact shadow lands outside the paper edge
    // on the soft shadow / board, its fill covers everything beneath) — the result matches
    // CSS `box-shadow: 1px 3px 4px rgba(0,0,0,.10), 4px 12px 20px rgba(0,0,0,.12)`.
    box.shadow = new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.10)', blur: 4, offsetX: 1, offsetY: 3, affectStroke: false })
    // objectCaching:false (2026-09-02 user report "text doesn't register"): a cached group
    // never re-renders its bitmap while the inner textbox is being edited, so every
    // keystroke vanished into the stale cache. Notes are small — drawing live is cheap.
    //
    // hasControls is per-board (Session 28 consolidation): the Canvas keeps the default
    // resizable chrome; the Notebook pins false — movable only, because its growth is
    // AUTOMATIC via fitPaper (the only sizing path that round-trips through the pinned
    // wrap width — hand-resizing would fight it). angle stays 0 there too (the rotate
    // handle is a control).
    const group = new fabric.Group([shadowBox, box, closeBg, close, text], { left: x, top: y, editable: true, objectCaching: false, hasControls })
    group.__close = { left: paperSize - 30, top: 0, width: 30, height: 30 } // × hit region, paper coords (top-left origin)
    // The paper keeps a minimum size but grows with the text, so content never escapes the
    // note; `changed` fires on every keystroke while editing, so the grown size is what gets
    // saved and reloads restore the note exactly as the user left it.
    // Session 17: growth stays SQUARE — height NEVER grows alone (that was the old
    // rectangle behavior). If the text would overflow the current square, BOTH edges grow
    // by the same amount, the wrap width re-pins to the wider paper, and the × rides the
    // inline-end edge. Every sticky the user ever sees on a board is a perfect square.
    const fitPaper = () => {
      // Session 17: square + right-sized. sideFor(box.width) measures at the CURRENT
      // wrap; if the text fits, it returns box.width (no growth — grow-only invariant).
      const target = sideFor(box.width)
      if (target > box.height + 0.5) {
        // Grow DOWNWARD from the paper's current top edge, IN PLACE (2026-08-26 user
        // request; 2026-09-29 rework). The old implementation called group._calcBounds(),
        // which in this Fabric build re-derives left/top from the children's LOCAL
        // coordinates — the note teleported sideways/downward whenever text overflowed
        // and the × hit region desynced from the paper (× stopped deleting). Instead:
        // resize the paper, grow the group frame by the same amount, and lift every
        // child by half the growth so the top edge lands exactly where it was.
        const grow = target - box.height
        box.set({ height: target, width: target, top: box.top - grow / 2 })
        shadowBox.set({ height: target, width: target, top: shadowBox.top - grow / 2 })
        for (const child of [closeBg, close]) child.set({ left: child.left + grow, top: child.top - grow / 2 })
        text.set({ top: text.top - grow / 2 })
        group.set({ height: group.height + grow, width: group.width + grow })
        group.__close = { left: target - 30, top: 0, width: 30, height: 30 }
        wrapWidth = target - 20
        text.initDimensions() // re-wrap AND re-measure at the wider paper
        group.setCoords()
      }
      // Always invalidate + repaint (realtime typing, 2026-09-02): even when the paper
      // doesn't grow, the freshly typed glyphs must land on screen this frame.
      group.dirty = true
      render()
    }
    fitPaper()
    text.on('changed', fitPaper)
    if (wireTextDir) wireTextDir(text)
    // exposed for the editing twin + recolor palette (2026-09-02 batch). __shadowPaper
    // rides along so recolors repaint BOTH rects of the layered shadow (session 17).
    group.__paper = box
    group.__shadowPaper = shadowBox
    group.__innerText = text
    // 2026-09-12 (dark-mode fix, was notebook-only): the close × refs for theme
    // observers + the CANONICAL pastel (what saves round-trip — the live fill may be
    // themed dark). Harmless on the Canvas (never themed; objectToData ignores them).
    group.__closeBg = closeBg
    group.__closeX = close
    group.__lightColor = color
    group.__fitPaper = fitPaper
    return group
  }

  return { makeStickyNote, STICKY_PAPER, STICKY_RADIUS, STICKY_HEADER }
})()
