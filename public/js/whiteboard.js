// The Notebook — a separate blank page for fast brain-dumps (a digital notebook sheet, spec §12
// follow-up): very pale grid, black + blue pens, eraser, click-anywhere text, undo/redo. It uses
// the same durable LWW + tombstone sync as the Canvas but scoped to its own board (migration 0009),
// so the notebook never mixes with the boundless board and nothing is ever lost.

window.addEventListener('hibana-nb-init', async () => {
  const nb = window.hibanaNotebook
  if (!window.fabric || !nb) return
  await nb.init('#nb-board', { toolbar: document.getElementById('nb-toolbar'), page: document.getElementById('nb-page'), font: document.getElementById('nb-font') })
})

window.hibanaNotebook = (() => {
  const BOARD = 'notebook'
  const BLACK = '#1c1c1a'
  const BLUE = '#2f6fd1'
  const _t = (k, f) => (window.hibanaI18n && window.hibanaI18n.t(k)) || f

  // Text font: Bebas Notes by default (user request); "Classic" opts back into the previous
  // font. Choice persists per board in localStorage and applies live to text objects.
  // Bebas uses the family's Light face (300) — the regular weight reads too heavy (user
  // request); Classic keeps the normal weight.
  const FONT_KEY = 'hibana-font-notebook'
  let fontMode = localStorage.getItem(FONT_KEY) || 'bebas'
  const textFont = () => (fontMode === 'classic' ? "'Manrope', 'VazirFA', system-ui, sans-serif" : "'Bebas Notes', 'VazirFA', 'Manrope', system-ui, sans-serif")
  const textWeight = () => (fontMode === 'bebas' ? 300 : 400)
  let canvas = null
  let page = null
  let mode = 'move'
  let color = BLACK
  const elems = new Map() // id → data (source of truth, kept in sync with the server)
  const objects = new Map() // id → fabric object
  const history = new (window.hibanaHistory.History)() // shared two-stack undo/redo (Session 27 extraction — semantics identical to the inline stacks it replaced)
  let toolbarEl = null
  const IMG_RADIUS = 14 // placed pictures keep the app's soft corners (no sharp edges)

  const send = (path, opts = {}) => fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  const now = () => new Date().toISOString()

  // Simple debounce (canvas.js's twin helper — the notebook lacked it entirely, which is
  // how Phase 6 item 1's data loss happened: typed content only saved on
  // text:editing:exited, an event that never fires when the user navigates away).
  function debounce(fn, ms) {
    let t = null
    return (...args) => {
      if (t) clearTimeout(t)
      t = setTimeout(() => { t = null; fn(...args) }, ms)
    }
  }

  function save(data) {
    elems.set(data.id, data)
    window.hibanaQueue?.enqueue({ kind: 'canvas', op: data.deleted ? 'delete' : 'upsert', data: { ...data, board: BOARD } })
    // Deletes flush immediately (fire-and-forget) so the tombstone lands before any
    // reload can re-read the stale row (delete bug 2026-08-24).
    if (data.deleted) window.hibanaQueue?.flush?.()
  }

  // ---- rendering -----------------------------------------------------------
  function pointsToPath(points) {
    if (!points || points.length === 0 || typeof points[0] === 'number') return ''
    let d = `M ${points[0][0]} ${points[0][1]}`
    for (const [x, y] of points.slice(1)) d += ` L ${x} ${y}`
    return d
  }
  function serializePath(path) {
    // 2026-09-12 fix: path commands are ARRAYS (['M',x,y] / ['L',x,y] / ['Q',cx,cy,x,y] /
    // ['C',c1x,c1y,c2x,c2y,x,y] — canvas.js's serializer reads the same shape). The old
    // c.x/c.y reads returned undefined for every command, serializing every stroke as
    // [[null,null],…] — corrupt data that reloads as a degenerate NaN path.
    const pts = []
    for (const c of path.path ?? []) {
      if (c[0] === 'M' || c[0] === 'L') pts.push([c[1], c[2]])
      else if (c[0] === 'Q') pts.push([c[3], c[4]])
      else if (c[0] === 'C') pts.push([c[5], c[6]])
    }
    return JSON.stringify(pts)
  }

  // Bidi text direction (ported from canvas.js): the editing direction is decided by the
  // first strong character of the text (dir="auto" semantics), never by page language —
  // so typing English on a Farsi board flows left-to-right and Farsi stays right-to-left.
  const textDir = (text) => {
    for (const ch of String(text || '')) {
      const c = ch.codePointAt(0)
      if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) return 'ltr' // Latin
      if (c >= 0x0600 && c <= 0x06ff) return 'rtl' // Arabic/Farsi
    }
    return null // no strong character yet — keep the current direction
  }
  const wireTextDir = (obj) => {
    const apply = () => {
      const ta = obj.hiddenTextarea
      if (!ta) return
      const d = textDir(obj.text)
      if (d) ta.dir = d
    }
    obj.on('editing:entered', apply)
    obj.on('changed', apply)
  }

  // Sticky notes (batch s, 2026-09 user request: "copy it from the canvas") — the notebook
  // port of the Canvas board's polished StickyNote component: flat warm pastel paper, a
  // close × in the top-right header, and a comfortable body font. The paper grows with its
  // text (as a SQUARE — session 17); selection is Fabric's default bounding box. See
  // makeStickyNote in public/js/canvas.js — the geometry and every hard-won fix below
  // (wrap-width pinning, objectCaching, in-place growth) are copied verbatim from that
  // battle-tested implementation.
  //
  // Session 17 (2026-09-18, owner reference mockup): the ONE sticky style app-wide — true
  // square paper, near-sharp 2px corners, layered directional shadow (light from the
  // top-left: a tight contact layer on the paper rect + a large soft layer on a back rect
  // that hides behind the paper). Matches app.css's session-17 rule + canvas.js exactly.
  const STICKY_PAPER = '#FFF59D'
  const STICKY_RADIUS = 2 // session 17: near-sharp paper corners (was 10)
  const STICKY_HEADER = 26 // header strip for the close ×
  function makeStickyNote({ content = '', color = STICKY_PAPER, x = 0, y = 0, width = 180, height = 180 }) {
    // Session 17: square-normalize whatever geometry arrives (old saved notes were
    // 180×120 or grown rectangles) — one side = the larger of the two.
    const side = Math.max(Math.round(width || 180), Math.round(height || 0), 120)
    // The × carries a faint circular background, same as the canvas board's sticky close.
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
    // Pin the wrap width (canvas.js 2026-08-26 user report): a Textbox re-measures itself
    // on every keystroke and drifts wider than the paper, which stops the wrapping. Re-pinning
    // keeps the text inside the padding box — text always wraps at the boundary.
    // Session 17: `let` + pin-FIRST so the square growth's re-wrap measures at the new width.
    let wrapWidth = side - 20
    const baseInit = text.initDimensions.bind(text)
    text.initDimensions = () => {
      text.width = wrapWidth
      baseInit()
    }
    // Session 17: right-size the square (same search as canvas.js): the minimal square
    // s with STICKY_HEADER + h(s-20) + 14 ≤ s, binary-searched — h(w) shrinks as the wrap
    // widens, so growing to the height the current wrap demands would overshoot badly.
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
    // Phase 5 item 18 (2026-09-08): the soft drop shadow belongs to the PAPER ONLY (on the
    // group, every TEXT GLYPH carried its own shadow too — blurry, "bold-ish" text).
    // Session 17: this is now the TIGHT CONTACT layer; the big soft layer sits on
    // shadowBox behind it. Net: CSS `1px 3px 4px rgba(0,0,0,.10), 4px 12px 20px rgba(0,0,0,.12)`.
    box.shadow = new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.10)', blur: 4, offsetX: 1, offsetY: 3, affectStroke: false })
    // objectCaching:false (canvas.js 2026-09-02 "text doesn't register" report): a cached
    // group never re-renders its bitmap while the inner textbox is being edited, so every
    // keystroke vanished into the stale cache. Notes are small — drawing live is cheap.
    //
    // RESIZE DECISION (batch s, kept simple+robust): hasControls:false makes the sticky
    // NON-resizable — movable only (angle stays 0; the rotate handle is a control too).
    // Growth stays AUTOMATIC via fitPaper, which is the only sizing path that round-trips
    // through the pinned wrap width. objectToData still bakes scaleX/scaleY into width/height,
    // so any code-path scaling is absorbed on save without normalization.
    const group = new fabric.Group([shadowBox, box, closeBg, close, text], { left: x, top: y, editable: true, objectCaching: false, hasControls: false })
    group.__close = { left: paperSize - 30, top: 0, width: 30, height: 30 } // × hit region, paper coords (top-left origin)
    // The paper keeps a minimum size but grows with the text, so content never escapes the
    // note; `changed` fires on every keystroke while editing, so the grown size is what gets
    // saved and reloads restore the note exactly as the user left it.
    // Session 17: growth stays SQUARE — height never grows alone. Both edges grow by the
    // same amount, the wrap re-pins to the wider paper, the × rides the inline-end edge.
    const fitPaper = () => {
      // Session 17: square + right-sized (same search as canvas.js). Grow-only: when the
      // text fits at the current wrap, sideFor returns the current side — no change.
      const target = sideFor(box.width)
      if (target > box.height + 0.5) {
        // Grow DOWNWARD from the paper's current top edge, IN PLACE (canvas.js 2026-08-26
        // request; 2026-08-29 rework — never call group._calcBounds(), it re-derives left/top
        // from the children and teleports the note). Instead: resize the paper, grow the group
        // frame by the same amount, and lift every child by half the growth so the top edge
        // lands exactly where it was. Grow-only — a note never shrinks back.
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
      // Always invalidate + repaint (realtime typing): even when the paper doesn't grow, the
      // freshly typed glyphs must land on screen this frame.
      group.dirty = true
      if (canvas) canvas.requestRenderAll()
    }
    fitPaper()
    text.on('changed', fitPaper)
    wireTextDir(text)
    // exposed for the editing twin (below) + objectToData's color/content reads. __shadowPaper
    // rides along so any recolor repaints BOTH rects of the layered shadow (session 17).
    group.__paper = box
    group.__shadowPaper = shadowBox
    group.__innerText = text
    group.__fitPaper = fitPaper
    return group
  }

  // Text boxes keep their drawn WIDTH fixed (user request 2026-08-24): text wraps at the
  // box edge. The HEIGHT, however, grows vertically to fit the content (user request R10):
  // if the user types more text than the initial boundary, the box expands downward so
  // nothing is clipped. Width never grows sideways (wrapping prevents that); height is
  // auto-fit. splitByGrapheme = character-level wrapping (overflow-wrap: anywhere) so a
  // single unbroken word still wraps.
  function makeTextBox(data, textOpts) {
    const w = Math.max(28, data.width)
    const h = Math.max(14, data.height || 28)
    const obj = new fabric.Textbox(data.content || '', { ...textOpts, width: w, splitByGrapheme: true })
    obj.__fixedWidth = w
    obj.__minHeight = h
    obj.width = w
    obj.height = h
    obj.clipPath = new fabric.Rect({ left: -w / 2, top: -h / 2, width: w, height: h })
    const base = obj.initDimensions.bind(obj)
    obj.initDimensions = () => {
      base()
      // Re-pin the WIDTH only. Let the HEIGHT auto-fit to the text (Math.max with the
      // user's drawn min height so it never shrinks below the boundary but grows).
      obj.width = obj.__fixedWidth
      obj.height = Math.max(obj.__minHeight, Math.round(obj.height))
      obj.clipPath.set({ left: -obj.width / 2, top: -obj.height / 2, width: obj.width, height: obj.height })
    }
    return obj
  }

  function makeObject(data) {
    let obj
    if (data.type === 'sticky') {
      // sticky note (batch s): the ported canvas StickyNote component — paper hex in
      // data.color (default pastel yellow), the text in data.content. hasControls:false on
      // the group (see makeStickyNote): movable, auto-growing, never hand-resized.
      obj = makeStickyNote({
        content: data.content || '',
        color: data.color || STICKY_PAPER,
        x: data.x, y: data.y,
        width: Math.max(80, data.width || 180),
        height: Math.max(60, data.height || 120),
      })
      obj.kind = 'sticky'
      obj.content = data.content || ''
    } else if (data.type === 'stroke') {
      const points = data.content && data.content.startsWith('[') ? JSON.parse(data.content) : []
      obj = new fabric.Path(pointsToPath(points), {
        left: data.x, top: data.y, fill: '', stroke: data.color || BLACK, strokeWidth: 3, objectCaching: false,
      })
      obj.content = data.content
    } else {
      // notebook 'note' elements: every text box is a fixed-size wrapping Textbox — a drag
      // defines its size, a click gets a default 240×60 box; text wraps at the edge and
      // clips at the fixed height.
      const textOpts = { left: data.x, top: data.y, fontSize: data.font_size || 18, fill: data.color || BLACK, fontFamily: textFont(), fontWeight: textWeight() }
      obj = makeTextBox(data.width && data.height ? data : { ...data, width: 240, height: 60 }, textOpts)
      obj.kind = 'text'
      obj.content = data.content || ''
    }
    obj.id = data.id
    obj.zIndex = data.z_index ?? 0
    obj.createdAt = data.created_at
    return obj
  }

  function putObject(data) {
    if (!data || data.deleted) return // deleted records never render (guard for every caller)
    if (objects.has(data.id)) return
    if (data.type === 'image') return loadImageObject(data) // async — renders once the URL loads
    const obj = makeObject(data)
    objects.set(data.id, obj)
    canvas.add(obj)
    canvas.renderAll()
  }

  function removeObject(id) {
    const obj = objects.get(id)
    if (obj) { canvas.remove(obj); objects.delete(id); canvas.renderAll() }
  }

  // ---- image elements (placed from a URL — spec follow-up) ---------------------
  // (k) 2026-09-06: CORS-first loading (same fix as canvas.js). The notebook's
  // "place image from link" was reported broken — the links were fine, the CSP
  // img-src 'self' policy blocked every external picture (browser fires onerror →
  // "check the link" toast). The CSP now allows https: images (app.ts + _headers);
  // this loader ALSO tries an anonymous-CORS load first so hosts that support it
  // stay export-safe, falling back to a plain display-only load for the rest.
  function loadRemoteImage(url) {
    const tryLoad = (withCors) => new Promise((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')) }, 15000)
      img.onload = () => { clearTimeout(timer); if (!withCors) img.__noCors = true; resolve(img) }
      img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')) }
      if (withCors) img.crossOrigin = 'anonymous'
      img.src = url
    })
    return tryLoad(true).catch(() => tryLoad(false))
  }

  // P4.1 (F-H2): dark-mode ink filter inverts placed photos. The CSS on #nb-board is
  // `filter: var(--nb-ink)` where --nb-ink = `invert(1) hue-rotate(180deg) brightness(0.9)`
  // in dark mode. This makes pen strokes / text / sticky paper render as ink-in-dark (the
  // intended look), but it ALSO inverts placed photos — a screenshot becomes a negative.
  // The fix: apply a COUNTER-filter at the Fabric-object level so the composition is
  // identity on images only. CSS `invert(1) hue-rotate(180deg)` = hue_rotate(invert(p)).
  // To undo it, the Fabric filter must produce p' = invert(hue_rotate(180)(p)) so that
  // hue_rotate(180)(invert(p')) = p. So: HueRotation(π) FIRST, then Invert. (brightness(0.9)
  // tail is NOT countered — it slightly dims the image in dark mode, which is acceptable;
  // countering it would require a Brightness filter and adds complexity for a 10% dim.)
  function boardIsDark() {
    const el = document.getElementById('nb-board')
    if (!el) return false
    const v = getComputedStyle(el).getPropertyValue('--nb-ink')?.trim()
    return !!v && v !== 'none' && v !== ''
  }

  function applyDarkInvertCounterFilter(obj) {
    if (!boardIsDark()) return
    obj.filters = obj.filters ?? []
    // Order matters: HueRotation FIRST, then Invert (see the math comment above).
    // L14 fix (2026-09-10): fabric v6 moved filters from fabric.Image.filters.* to fabric.filters.*
    // The shim provides both paths, but the canonical v6 path is fabric.filters.*
    const filters = window.fabric?.filters ?? fabric.Image?.filters ?? {}
    obj.filters.push(new filters.HueRotation({ rotation: Math.PI }))
    obj.filters.push(new filters.Invert())
    obj.applyFilters()
  }

  // Re-apply (or clear) the counter-filter on every image when the theme changes.
  function reapplyDarkInvertFilters() {
    if (!canvas) return
    const dark = boardIsDark()
    canvas.getObjects().forEach((obj) => {
      if (obj.type !== 'image') return
      obj.filters = []
      if (dark) applyDarkInvertCounterFilter(obj)
      else obj.applyFilters()
    })
    canvas.renderAll()
  }

  // Rounded frame box holds the picture contain-fit (object-fit: contain) — the whole
  // image is visible and centered inside the frame whatever its aspect; the contain math
  // runs at draw time off width/height × scale, so frame resizes re-fit the picture
  // immediately. The clipPath is the centered frame rect (rounded).
  function buildImageObject(raw, opts = {}) {
    const width = opts.width || raw.width
    const height = opts.height || raw.height
    const obj = new fabric.Image(raw, { left: opts.left ?? 0, top: opts.top ?? 0, width, height })
    obj._renderFill = function (ctx) {
      const e = this._element
      const sw = e && (e.naturalWidth || e.width) || 0
      const sh = e && (e.naturalHeight || e.height) || 0
      if (!sw || !sh) return
      const frameW = this.width * this.scaleX
      const frameH = this.height * this.scaleY
      const k = Math.min(frameW / sw, frameH / sh)
      const w = (sw * k) / this.scaleX
      const h = (sh * k) / this.scaleY
      ctx.drawImage(e, 0, 0, sw, sh, -w / 2, -h / 2, w, h)
    }
    obj.clipPath = new fabric.Rect({ left: -width / 2, top: -height / 2, width, height, rx: IMG_RADIUS, ry: IMG_RADIUS })
    applyDarkInvertCounterFilter(obj)
    return obj
  }

  // Render an image element that came back from the server (stored dims — no new save).
  async function loadImageObject(data) {
    if (objects.has(data.id)) return
    try {
      const raw = await loadRemoteImage(data.content)
      const obj = buildImageObject(raw, { left: data.x, top: data.y, width: data.width, height: data.height })
      obj.id = data.id
      obj.zIndex = data.z_index ?? 0
      obj.createdAt = data.created_at
      obj.content = data.content
      objects.set(data.id, obj)
      canvas.add(obj)
      canvas.renderAll()
    } catch { /* a broken image link just doesn't render */ }
  }

  // P4.3 (F-M17): image-from-link popover (replaces the native prompt()). The popover
  // markup lives in whiteboard.html as [data-image-pop]; this shows it, focuses the input,
  // and handles the form submit. Escape + click-outside close it.
  let imagePopEl = null
  function showImagePopover() {
    if (!imagePopEl) imagePopEl = document.querySelector('[data-image-pop]')
    if (!imagePopEl) return
    imagePopEl.hidden = false
    const input = imagePopEl.querySelector('[data-image-url]')
    const err = imagePopEl.querySelector('[data-image-error]')
    if (err) err.hidden = true
    if (input) {
      input.value = ''
      setTimeout(() => input.focus(), 0) // focus after the hidden attribute clears
    }
  }
  function hideImagePopover() {
    if (!imagePopEl) imagePopEl = document.querySelector('[data-image-pop]')
    if (imagePopEl) imagePopEl.hidden = true
  }

  // Tool button: open the image popover (was a native prompt()).
  function addImageByUrl() {
    showImagePopover()
  }
  // Called from the form submit handler — places the image from the popover's URL input.
  async function placeImageFromPop() {
    if (!imagePopEl) imagePopEl = document.querySelector('[data-image-pop]')
    const input = imagePopEl?.querySelector('[data-image-url]')
    const errEl = imagePopEl?.querySelector('[data-image-error]')
    if (!input) return
    const url = input.value.trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      if (errEl) { errEl.textContent = _t('canvas.imageBadUrl', 'Paste a direct picture link starting with https://'); errEl.hidden = false }
      return
    }
    hideImagePopover()
    try {
      const raw = await loadRemoteImage(url)
      const maxDim = 400 // sheet-sized; never upscale a small image
      const scale = Math.min(1, maxDim / Math.max(raw.width, raw.height))
      const width = Math.max(1, Math.round(raw.width * scale))
      const height = Math.max(1, Math.round(raw.height * scale))
      const obj = buildImageObject(raw, { left: canvas.getWidth() / 2 - width / 2, top: canvas.getHeight() / 2 - height / 2, width, height })
      const id = crypto.randomUUID()
      const t = now()
      const data = { id, type: 'image', x: obj.left, y: obj.top, width, height, color: '', content: url, z_index: 0, deleted: 0, created_at: t, updated_at: t, board: BOARD }
      obj.id = id
      obj.zIndex = 0
      obj.createdAt = t
      obj.content = url
      objects.set(id, obj)
      elems.set(id, data)
      canvas.add(obj)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
      save(data)
      history.commit('add', data)
      setTool('move') // settle into move so the picture can be dragged
      if (toolbarEl) toolbarEl.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'move'))
    } catch (err) {
      window.hibana?.toast(_t('canvas.imageFailed', "Couldn't load that image — check the link"), 'err')
    }
  }

  function objectToData(obj) {
    if (obj.type === 'image') {
      return {
        id: obj.id, type: 'image', x: obj.left, y: obj.top,
        width: Math.round((obj.width || 0) * (obj.scaleX || 1)), height: Math.round((obj.height || 0) * (obj.scaleY || 1)),
        color: '', content: obj.content || '',
        font_size: null,
        z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
      }
    }
    if (obj.kind === 'sticky' || obj.__close) {
      // sticky note (batch s): the group is the record — position/size from the group frame
      // (scale baked in defensively; hasControls:false means no user scaling), paper hex from
      // __paper, text from the hidden inner textbox (falling back to the cached content if a
      // twin editor is live). x/y stay the group's own left/top, exactly like the canvas
      // board's note round-trip, so reloads land the paper where it was saved.
      return {
        id: obj.id, type: 'sticky', x: obj.left, y: obj.top,
        width: Math.round((obj.width || 180) * (obj.scaleX || 1)), height: Math.round((obj.height || 120) * (obj.scaleY || 1)),
        color: (obj.__paper && obj.__paper.fill) || STICKY_PAPER, content: (obj.__innerText && obj.__innerText.text) || obj.content || '',
        font_size: null,
        z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
      }
    }
    if (obj.kind === 'text') {
      // Manual resize (corner handles, like Paint/Photoshop) scales the object; bake the
      // effective size into the record and normalize the transform so saves never compound
      // and reloads render at exactly the size the user left it.
      const fontSize = Math.max(6, Math.min(400, Math.round((obj.fontSize || 18) * (obj.scaleY || 1))))
      if (obj.__minHeight) obj.__minHeight = Math.max(14, Math.round(obj.__minHeight * (obj.scaleY || 1)))
      if (obj.__fixedWidth) obj.__fixedWidth = Math.max(28, Math.round(obj.__fixedWidth * (obj.scaleX || 1)))
      obj.set({ fontSize, scaleX: 1, scaleY: 1 })
      if (typeof obj.initDimensions === 'function') obj.initDimensions() // pins size + re-syncs the clip
      obj.setCoords?.()
      const b = obj.getBoundingRect()
      return {
        id: obj.id, type: 'note', x: b.left, y: b.top, width: obj.width || b.width, height: obj.type === 'textbox' ? Math.round(obj.height) : null,
        color: obj.fill || color, content: obj.text || obj.content || '', font_size: fontSize,
        z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
      }
    }
    const b = obj.getBoundingRect()
    return {
      id: obj.id, type: 'stroke', x: b.left, y: b.top, width: null, height: null,
      color: obj.stroke || color, content: obj.content || '', font_size: null,
      z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
    }
  }

  // ---- sticky-note editing twin (batch s — ported from canvas.js) --------------------
  // Fabric cannot reliably edit a Text that lives INSIDE a Group: the hidden textarea
  // positions itself off the note and keystrokes stop registering. Instead of fighting
  // that, a double-click lifts the text into a temporary TOP-LEVEL Textbox twin positioned
  // exactly over the original — Fabric's fully-supported editing path (caret, IME, bidi via
  // wireTextDir, native Ctrl+Z/X/C/V/A through the hidden textarea). Every keystroke mirrors
  // into the hidden original in realtime; on exit the twin commits through the notebook's
  // own save/undo flow (mirrors the text tool's text:editing:exited below) and removes itself.
  let stickyEdit = null // { group, inner, editor } — active sticky-note twin

  // left/top for an editing twin. THE (t) FIX (2026-09-01, ported from canvas.js — this
  // board's twin had the SAME half-size up-left shift, which is why typing "didn't work
  // inside" whiteboard stickies: the twin rendered off the paper, so the typed text and
  // caret landed outside the note). In this fabric build calcTransformMatrix() maps the
  // host's CENTER-local space to the scene (translation = getCenterPoint()), and a group's
  // children left/top live in exactly that space — inner.left/top (origin left/top) IS the
  // inner's top-left corner relative to the host's center. Mapping the child's left/top
  // through the host matrix lands the twin's own top-left exactly on the inner's rendered
  // top-left — exact under rotation + scale, because the twin (top-level, origin left/top,
  // same angle/scale) has its top-left corner AT (left, top). The old "same-shape probe"
  // subtraction measured the probe's CENTER (w/2, h/2), not its origin, shifting every twin
  // up-left by half the inner's size.
  function twinTopLeft(host, inner) {
    const m = host.calcTransformMatrix()
    return fabric.util.transformPoint({ x: inner.left || 0, y: inner.top || 0 }, m)
  }

  function makeEditTwin(host, inner, extra = {}) {
    const tl = twinTopLeft(host, inner)
    return new fabric.Textbox(inner.text || '', {
      left: tl.x, top: tl.y,
      width: inner.width || 160,
      fontSize: inner.fontSize || 18,
      lineHeight: inner.lineHeight || 1.16,
      fill: inner.fill || '#3f3f46',
      fontFamily: inner.fontFamily || 'Times New Roman',
      textAlign: inner.textAlign || 'left',
      splitByGrapheme: true,
      scaleX: host.scaleX || 1, scaleY: host.scaleY || 1,
      angle: host.angle || 0,
      editable: true, hasControls: false, hasBorders: false,
      objectCaching: false,
      ...extra,
    })
  }

  function beginStickyEdit(group) {
    if (stickyEdit || !group || !group.getObjects) return
    const inner = group.getObjects().find((o) => o.type === 'textbox')
    if (!inner) return
    const editor = makeEditTwin(group, inner)
    wireTextDir(editor)
    inner.visible = false // the twin renders in its place while editing
    group.dirty = true
    canvas.add(editor)
    stickyEdit = { group, inner, editor }
    canvas.setActiveObject(editor)
    editor.enterEditing()
    const end = (editor.text || '').length
    editor.setSelectionStart(end)
    editor.setSelectionEnd(end)
    canvas.requestRenderAll()
    // realtime mirror: every keystroke lands on the paper this frame
    editor.on('changed', () => {
      inner.set('text', editor.text) // re-measures (wrap width stays pinned)
      group.__fitPaper?.() // paper grows in place, as a square (session 17)
      // Session 17: a grown square re-pins the paper's wrap width — keep the live twin
      // wrapping at the SAME width so the caret/line breaks match the paper (canvas.js
      // carries the same sync).
      if (Math.abs((editor.width || 0) - (inner.width || 0)) > 1) {
        editor.set({ width: inner.width })
        if (typeof editor.initDimensions === 'function') editor.initDimensions()
      }
      canvas.requestRenderAll()
    })
    // commit on exit through the notebook's own save/undo flow (mirrors the text tool's
    // text:editing:exited handler: empty → discard, else save + one undo entry)
    editor.on('editing:exited', () => {
      const se = stickyEdit
      if (!se || se.editor !== editor) return
      stickyEdit = null
      inner.set('text', editor.text || '')
      inner.visible = true
      group.dirty = true
      canvas.remove(editor)
      if (objects.has(group.id)) { // × may have tombstoned the note mid-edit
        const data = objectToData(group)
        group.content = data.content
        if (!data.content.trim()) {
          // nothing typed — discard the note. Unlike the text tool (whose object is only
          // saved on exit), a sticky is already synced at commit, so the discard must
          // tombstone it or a reload would resurrect the empty paper; its own fresh 'add'
          // undo entry is popped so no phantom undo step stays behind.
          const cur = elems.get(group.id)
          removeObject(group.id)
          elems.delete(group.id)
          if (cur) save({ ...cur, deleted: 1, updated_at: now() })
          history.dropLastAdd(group.id)
          canvas.discardActiveObject()
        } else {
          save(data)
          history.commitAdd(group.id, data) // upgrade the commit snapshot instead of stacking a second undo step
          // reselect the note ONLY when nothing else was just selected (clicking another
          // object or empty sheet while editing must keep that outcome)
          if (canvas.getActiveObject() === editor) canvas.setActiveObject(group)
        }
      } else {
        canvas.discardActiveObject()
      }
      canvas.requestRenderAll()
    })
  }

  async function load() {
    const res = await send(`/api/canvas/full?board=${BOARD}`)
    try {
      if (!res.ok) return
      const { elements } = await res.json()
      for (const e of elements) {
        // Same resurrection guards as the canvas board (delete bug 2026-08-24): never
        // re-add a deleted record, and never let an older server snapshot overwrite a
        // newer local tombstone/edit (client-side LWW).
        if (e.deleted) continue
        const local = elems.get(e.id)
        if (local && local.updated_at > e.updated_at) continue
        elems.set(e.id, e)
        putObject(e)
      }
      canvas.renderAll()
    } finally {
      // the sheet is blank by design, but the fetch must not look like a stalled page
      const pill = document.querySelector('[data-board-loading]')
      if (pill) pill.remove()
    }
  }

  // ---- tools ---------------------------------------------------------------
  function setTool(t) {
    mode = t
    canvas.isDrawingMode = t === 'pen'
    canvas.selection = t === 'move'
    canvas.defaultCursor = t === 'eraser' ? 'cell' : t === 'move' ? 'default' : 'crosshair'
    if (t === 'pen') {
      // 2026-09-12 pen fix: Fabric v6+ no longer auto-creates a PencilBrush on the canvas —
      // without this the very assignment below threw on undefined (since the fabric v6/v7
      // security upgrade) and strokes silently drew nothing. Create it on first use.
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.color = color
      canvas.freeDrawingBrush.width = 3
    }
  }

  // Swipe-eraser: anything the pointer crosses is tombstoned (durable + undoable).
  const eraseIds = new Set()
  function eraseAt(e) {
    const p = canvas.getPointer(e.e)
    for (const obj of canvas.getObjects()) {
      if (!obj.id || eraseIds.has(obj.id)) continue
      const b = obj.getBoundingRect()
      if (p.x < b.left - 6 || p.x > b.left + b.width + 6 || p.y < b.top - 6 || p.y > b.top + b.height + 6) continue
      eraseIds.add(obj.id)
      const data = elems.get(obj.id)
      removeObject(obj.id)
      if (data) {
        save({ ...data, deleted: 1, updated_at: now() })
        history.log('erase', data)
      }
    }
    canvas.renderAll()
  }

  // Delete the selected objects (toolbar button + Delete/Backspace key, user request):
  // same durable tombstone + undo path as the swipe eraser.
  function deleteActive() {
    const sel = canvas.getActiveObjects()
    if (sel.length === 0) return
    for (const obj of sel) {
      const data = elems.get(obj.id)
      if (!data) continue
      removeObject(obj.id)
      save({ ...data, deleted: 1, updated_at: now() })
      history.log('erase', data)
    }
    canvas.discardActiveObject()
    canvas.renderAll()
  }

  let clipboard = null // serialized copies (Ctrl+C / Ctrl+X) for Ctrl+V
  let textDraft = null // { x0, y0, rect } — in-progress text-box drag (Figma-style)

  // Delete / Backspace deletes the selection; Escape deselects; Ctrl/⌘+Z/Y undo/redo;
  // Ctrl/⌘+C/X/V copy, cut and paste objects. Never fires while typing (inputs, Fabric's
  // IText editor via its hidden textarea) or with a dialog open.
  function onBoardKeydown(e) {
    const t = e.target
    if (e.isComposing || document.querySelector('dialog[open]')) return
    const key = e.key
    // Escape while the Fabric text editor is open: exit editing and drop the selection —
    // Fabric keeps the text object active after exitEditing, so a plain Escape feels stuck.
    if (key === 'Escape') {
      const active = canvas.getActiveObject()
      const editingText = t instanceof HTMLTextAreaElement && !!t.dataset?.fabricHiddentextarea
      if (editingText || (active && active.isEditing)) {
        if (active && active.isEditing) active.exitEditing()
        canvas.discardActiveObject()
        canvas.renderAll()
        e.preventDefault()
        e.stopPropagation() // capture-phase: don't let Fabric's own textarea handler re-handle it
        return
      }
    }
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
    const mod = e.ctrlKey || e.metaKey
    if (key === 'Delete' || key === 'Backspace') {
      if (!canvas || canvas.getActiveObjects().length === 0) return
      e.preventDefault()
      deleteActive()
      return
    }
    if (key === 'Escape') {
      if (textDraft) {
        if (textDraft.rect) canvas.remove(textDraft.rect)
        textDraft = null
        canvas.renderAll()
      }
      if (canvas.getActiveObject()) {
        e.preventDefault()
        canvas.discardActiveObject()
        canvas.renderAll()
      }
      return
    }
    if (key === ' ') return
    const k = key.toLowerCase()

    // Ctrl/⌘+A — select every element on the sheet (2026-09-02 user request: conventional
    // shortcuts everywhere). preventDefault keeps the browser's page-text select-all away.
    if (mod && k === 'a') {
      e.preventDefault()
      const sel = [...objects.values()]
      if (!sel.length) return
      canvas.discardActiveObject()
      canvas.setActiveObject(new fabric.ActiveSelection(sel, { canvas }))
      canvas.requestRenderAll()
      return
    }

    // Figma tool keys + nudge (no modifier). Order matters: these run before the
    // modifier-only branch below — but ONLY without Ctrl/⌘ so the clipboard combos
    // (Ctrl+C/X/V) can never be hijacked by a tool switch (the canvas board's exact rule).
    // batch s fix: the old `if (!mod || key === ' ') return` gate above this block made
    // every plain tool key dead code AND let Ctrl+V fall into the 'v' tool switch — paste
    // was hijacked into the move tool. Plain keys now flow here, the combos below carry
    // their own `mod` guards, and 'n' (batch s) selects the sticky-note tool.
    if (!mod) {
      const highlight = (name) => {
        const root = toolbarEl || document.querySelector('.canvas-toolbar')
        root?.querySelectorAll('[data-tool]').forEach((x) => {
          const tool = x.dataset.tool === 'black' || x.dataset.tool === 'blue' ? 'pen' : x.dataset.tool
          x.classList.toggle('active', tool === name)
        })
      }
      if (k === 'v') { e.preventDefault(); setTool('move'); highlight('move'); return }
      if (k === 't') { e.preventDefault(); setTool('text'); highlight('text'); return }
      if (k === 'n') { e.preventDefault(); setTool('note'); highlight('note'); return }
      if (k === 'b' || k === 'p') { e.preventDefault(); setTool('pen'); highlight('pen'); return }
      if (k === 'e') { e.preventDefault(); setTool('eraser'); highlight('eraser'); return }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        if (canvas.getActiveObjects().length === 0) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
        nudgeActive(dx, dy)
        return
      }
    }

    // modifier-only shortcuts (Ctrl/⌘ + key) — every branch below requires `mod`, now that
    // plain keys flow through the tool block above
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return }
    if (mod && e.code === 'BracketRight') { e.preventDefault(); moveZ(e.shiftKey ? 2 : 1); return }
    if (mod && e.code === 'BracketLeft') { e.preventDefault(); moveZ(e.shiftKey ? -2 : -1); return }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
    if (mod && k === 'y') { e.preventDefault(); redo(); return }
    if (mod && k === 'c') { e.preventDefault(); copySelection(); return }
    if (mod && k === 'x') { e.preventDefault(); copySelection(); deleteActive(); return }
    if (mod && k === 'v') { e.preventDefault(); pasteClipboard() }
  }

  // Figma-style clipboard: copy/cut keep the serialized records; paste clones them at an
  // offset with fresh ids through the normal add path (idempotent, undoable, offline-queued).
  function copySelection() {
    const sel = canvas.getActiveObjects()
    if (sel.length === 0) return
    clipboard = sel.map((o) => objectToData(o))
    window.hibana?.toast(_t('canvas.copied', 'Copied'), 'info', 1200)
  }
  function pasteClipboard() {
    if (!clipboard || clipboard.length === 0) return
    const t = now()
    for (const item of clipboard) {
      const data = { ...item, id: crypto.randomUUID(), x: item.x + 24, y: item.y + 24, created_at: t, updated_at: t }
      elems.set(data.id, data)
      putObject(data)
      save(data)
      history.log('add', data)
    }
    history.clearRedo()
    const first = canvas.getActiveObjects()[0] ?? objects.get(clipboard[0]?.id)
    if (first) canvas.setActiveObject(first)
    canvas.requestRenderAll()
  }

  // ---- Figma shortcuts (user request — same set as the Canvas, minus pan/zoom: this sheet
  // has a fixed size, so H / Space-drag / zoom keys don't apply here) --------------------
  function nudgeActive(dx, dy) {
    const sel = canvas.getActiveObjects()
    if (!sel.length) return
    for (const obj of sel) {
      obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy })
      obj.setCoords()
    }
    canvas.requestRenderAll()
    for (const obj of sel) if (obj.id) save(objectToData(obj))
  }

  function duplicateSelection() {
    const sel = canvas.getActiveObjects()
    if (!sel.length) return
    const t = now()
    const clones = []
    for (const obj of sel) {
      const item = objectToData(obj)
      const data = { ...item, id: crypto.randomUUID(), x: item.x + 24, y: item.y + 24, created_at: t, updated_at: t }
      elems.set(data.id, data)
      putObject(data)
      save(data)
      history.log('add', data)
      clones.push(objects.get(data.id))
    }
    history.clearRedo()
    canvas.setActiveObject(clones.length === 1 ? clones[0] : new fabric.ActiveSelection(clones, { canvas }))
    canvas.requestRenderAll()
  }

  // Ctrl/⌘+[ ] layer moves; the stack is renumbered and every record saved so the new order
  // survives a reload (the server re-orders by z_index).
  function moveZ(dir) {
    const sel = canvas.getActiveObjects()
    if (!sel.length) return
    for (const obj of sel) {
      if (dir === 2) canvas.bringToFront(obj)
      else if (dir === 1) canvas.bringForward(obj)
      else if (dir === -1) canvas.sendBackwards(obj)
      else canvas.sendToBack(obj)
    }
    const all = canvas.getObjects()
    for (let i = 0; i < all.length; i++) all[i].zIndex = i
    canvas.requestRenderAll()
    for (const obj of all) {
      const rec = elems.get(obj.id)
      if (rec && rec.z_index !== obj.zIndex) save({ ...rec, z_index: obj.zIndex, updated_at: now() })
    }
  }

  function undo() {
    history.undo((entry) => {
      if (entry.kind === 'add') {
        const data = elems.get(entry.data.id)
        removeObject(entry.data.id)
        if (data) save({ ...data, deleted: 1, updated_at: now() })
      } else { // erase → restore the object
        elems.set(entry.data.id, entry.data)
        putObject(entry.data)
        save({ ...entry.data, deleted: 0, updated_at: now() })
      }
      return entry // the same entry rides back onto the redo stack
    })
  }

  function redo() {
    history.redo((entry) => {
      if (entry.kind === 'add') {
        elems.set(entry.data.id, entry.data)
        putObject(entry.data)
        save({ ...entry.data, deleted: 0, updated_at: now() })
      } else { // erase again
        const data = elems.get(entry.data.id)
        removeObject(entry.data.id)
        if (data) save({ ...data, deleted: 1, updated_at: now() })
      }
      return entry
    })
  }

  async function init(selector, ui) {
    // Resolve the canvas host element before constructing Fabric: passing a '#id' string is a
    // silent no-op in some published Fabric builds (cdnjs mislabels 5.1.0 as 5.3.0), so we
    // always hand Fabric the real DOM element (works in every 5.x).
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector
    canvas = new fabric.Canvas(host, { selection: true, preserveObjectStacking: true })

    // Font-metrics race (wrap-bug fix 2026-08-25): Fabric measures text with the fallback
    // font when an object exists before the webfont finishes loading, and caches those
    // widths in fabric.charWidthsCache forever — every later wrap decision and caret
    // position is then computed from metrics that don't match the rendered glyphs.
    // When fonts land, drop the cache and re-measure every text object once.
    const reflowTextMetrics = () => {
      fabric.charWidthsCache = {}
      let touched = false
      const remeasure = (o) => {
        if (!['textbox', 'i-text', 'text'].includes(o.type)) return
        o.initDimensions()
        o.dirty = true
        o.fire('changed') // sticky-note papers auto-grow on this (fitPaper); others ignore it
        touched = true
      }
      canvas.getObjects().forEach((o) => {
        remeasure(o)
        if (o.getObjects) o.getObjects().forEach(remeasure)
      })
      if (touched) canvas.requestRenderAll()
    }
    if (document.fonts) {
      document.fonts.ready.then(reflowTextMetrics)
      document.fonts.addEventListener?.('loadingdone', reflowTextMetrics)
    }

    // P4.1 (F-H2): re-apply the dark-invert counter-filter on theme change. Watches both
    // the manual toggle (html[data-theme] attribute) and the system preference. On toggle,
    // every image object's filters are cleared + re-applied (or removed if switching to light).
    new MutationObserver(reapplyDarkInvertFilters).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener?.('change', reapplyDarkInvertFilters)

    page = ui.page
    sizeToPage()
    window.addEventListener('resize', sizeToPage)
    await load()

    // #1 crash-guard autosave (Phase 6 item 1, ported from canvas.js): the RENDER updates
    // per keystroke (Fabric native); only the SAVE is decoupled — a debounced mid-edit
    // save guards against navigation/crash losing a long note. Without this, typed text
    // only persisted on editing:exited, which never fires when the user clicks a nav
    // link mid-typing — the page unloads first and the note reverts to its last save.
    const midEditSave = debounce((owner) => {
      if (!owner?.id || !elems.has(owner.id)) return
      const data = objectToData(owner)
      if (data.type === 'note' && !data.content.trim()) return // fresh empty box — the exit path discards it
      owner.content = data.content
      save(data)
    }, 2000)
    canvas.on('text:changed', (e) => {
      // Session 24c (user request): digits match the SCRIPT of the text, not the UI
      // language. Processed LINE BY LINE so a mixed-script text element (Farsi line +
      // English line) converts digits per-line, not globally:
      //   "سلام 123\nHello 123" → "سلام ۱۲۳\nHello 123"
      // A line with Farsi/Arabic letters → Latin digits → Persian. A Latin-only (or
      // numbers-only) line → digits stay Latin.
      const t = e.target
      if (t && t.text && /[0-9]/.test(t.text)) {
        const faDig = (s) => s.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
        const hasFarsi = (s) => /[\u0600-\u06FF]/.test(s)
        const newText = t.text.split('\n').map((line) => (hasFarsi(line) ? faDig(line) : line)).join('\n')
        if (newText !== t.text) {
          const selStart = t.selectionStart
          const selEnd = t.selectionEnd
          t.set('text', newText)
          t.selectionStart = selStart
          t.selectionEnd = selEnd
          t.dirty = true
          canvas.requestRenderAll()
        }
      }
      // sticky twin: the debounced crash-guard save runs against the NOTE (the twin
      // itself has no id)
      if (stickyEdit && e.target === stickyEdit.editor) {
        if (objects.has(stickyEdit.group.id)) midEditSave(stickyEdit.group)
        return
      }
      if (e.target?.id && elems.has(e.target.id)) midEditSave(e.target)
    })
    // Second safety net for the same bug: the moment the page is hidden (tab switch or
    // navigating away — fires while the page is still alive, unlike unload), commit any
    // live text edits IMMEDIATELY (bypass the 2s debounce) and flush the queue. Combined
    // with queue.js's pagehide sendBeacon, typed content can no longer vanish between
    // “Saved” and the next visit.
    const commitLiveEdits = () => {
      try {
        if (stickyEdit) {
          const { group, editor } = stickyEdit
          if (objects.has(group.id) && (editor.text || '').trim()) {
            const data = objectToData(group)
            group.content = data.content
            save(data)
          }
        }
        const active = canvas.getActiveObject?.()
        if (active?.isEditing && active.id && elems.has(active.id)) {
          const data = objectToData(active)
          if (data.content.trim()) { active.content = data.content; save(data) }
        }
        window.hibanaQueue?.flush?.()
      } catch { /* never block the navigation */ }
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) commitLiveEdits() })
    window.addEventListener('pagehide', commitLiveEdits)
    // queue.js's pagehide beacon listener runs BEFORE this file's own pagehide listener
    // (queue.js loads first) — registering the commit as the PRE-BEACON hook feeds the
    // beacon: commitLiveEdits enqueues synchronously into the queue's mirror, and the
    // beacon carries the batch out during unload. Without this ordering the beacon
    // read an empty mirror and only the note's CREATION (enqueued earlier) landed.
    window.hibanaQueuePreBeacon = commitLiveEdits

    // pen stroke
    canvas.on('path:created', (e) => {
      const path = e.path
      const b = path.getBoundingRect()
      const data = {
        id: crypto.randomUUID(), type: 'stroke', x: b.left, y: b.top, width: null, height: null,
        color, content: serializePath(path), z_index: 0, deleted: 0,
        created_at: now(), updated_at: now(), board: BOARD,
      }
      path.id = data.id
      path.set({ left: b.left, top: b.top }).setCoords()
      objects.set(data.id, path)
      save(data)
      history.commit('add', data)
    })

    // moved / resized
    canvas.on('object:modified', () => {
      for (const obj of canvas.getActiveObjects()) if (obj.id) save(objectToData(obj))
    })

    // text tool: click-drag draws a rectangular text container (Figma/Photoshop style) —
    // text wraps to its width and all 8 corner + side handles stay visible while selected.
    // A plain click keeps the auto-sizing text object for convenience.
    // 2026-09-02 (user request): clicking an EXISTING object selects it (select-tool
    // behavior) — no more empty box stacking on top; double-click edits its text.
    canvas.on('mouse:down', (e) => {
      if (mode !== 'text' || canvas.isDragging) return
      if (e.target) return // click on content → Fabric selects it; dblclick edits
      const p = canvas.getPointer(e.e)
      textDraft = { x0: p.x, y0: p.y, rect: null }
    })
    canvas.on('mouse:move', (e) => {
      if (mode !== 'text' || !textDraft) return
      const p = canvas.getPointer(e.e)
      const w = Math.abs(p.x - textDraft.x0)
      const h = Math.abs(p.y - textDraft.y0)
      if (w < 5 && h < 5) return // still a click, no rectangle yet
      if (!textDraft.rect) {
        textDraft.rect = new fabric.Rect({
          left: Math.min(textDraft.x0, p.x), top: Math.min(textDraft.y0, p.y),
          width: w, height: h,
          fill: 'rgba(122, 162, 247, 0.08)', stroke: 'rgba(122, 162, 247, 0.9)',
          strokeDashArray: [6, 5], strokeWidth: 1.5, rx: 3, ry: 3,
          selectable: false, evented: false, objectCaching: false,
        })
        canvas.add(textDraft.rect)
      } else {
        textDraft.rect.set({ left: Math.min(textDraft.x0, p.x), top: Math.min(textDraft.y0, p.y), width: w, height: h })
        textDraft.rect.setCoords()
      }
      canvas.requestRenderAll()
    })
    const finishTextGesture = (p) => {
      if (!textDraft) return
      const x0 = textDraft.x0
      const y0 = textDraft.y0
      if (textDraft.rect) canvas.remove(textDraft.rect)
      textDraft = null
      const w = Math.abs(p.x - x0)
      const h = Math.abs(p.y - y0)
      const isBox = w >= 28 && h >= 14 // a real drag, not a click
      const id = crypto.randomUUID()
      const data = {
        id, type: 'note', x: Math.min(x0, p.x), y: Math.min(y0, p.y),
        width: isBox ? Math.round(w) : null, height: isBox ? Math.round(h) : null,
        color, content: '', z_index: 0, deleted: 0,
        created_at: now(), updated_at: now(), board: BOARD,
      }
      elems.set(id, data)
      const obj = makeObject(data)
      objects.set(id, obj)
      canvas.add(obj)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
      obj.enterEditing()
    }
    canvas.on('mouse:up', (e) => {
      if (mode !== 'text' || !textDraft) return
      finishTextGesture(canvas.getPointer(e.e))
    })
    canvas.on('text:editing:exited', (e) => {
      const obj = e.target
      if (!obj || !obj.id) return
      const data = objectToData(obj)
      if (!data.content.trim()) {
        // nothing typed — discard without syncing an empty element
        removeObject(obj.id)
        elems.delete(obj.id)
        return
      }
      obj.content = data.content
      save(data)
      history.commit('add', data)
    })

    // note tool (batch s — the notebook port of the canvas note tool, with one deliberate
    // difference per the i18n title "click for default"): hold + drag draws the note to
    // size, while a plain click (or any drag too small to commit, < 40px) drops the DEFAULT
    // 180×120 sticky at the gesture's top-left. Clicking existing content grabs it instead
    // (move) — it must never spawn a second note. The commit saves immediately (unlike the
    // text tool, which only saves on editing exit) and opens the edit twin so typing starts
    // right away; the twin's editing:exited handler re-saves the typed content.
    let noteDraft = null // { x0, y0, rect } — in-progress note drag
    canvas.on('mouse:down', (e) => {
      if (mode !== 'note' || canvas.isDragging) return
      if (e.target) return // click on content → Fabric selects it; dblclick edits
      const p = canvas.getPointer(e.e)
      noteDraft = { x0: p.x, y0: p.y, rect: null }
    })
    canvas.on('mouse:move', (e) => {
      if (mode !== 'note' || !noteDraft) return
      const p = canvas.getPointer(e.e)
      const w = Math.abs(p.x - noteDraft.x0)
      const h = Math.abs(p.y - noteDraft.y0)
      if (w < 5 && h < 5) return // still a click, no preview yet
      if (!noteDraft.rect) {
        noteDraft.rect = new fabric.Rect({
          left: Math.min(noteDraft.x0, p.x), top: Math.min(noteDraft.y0, p.y),
          width: w, height: h,
          fill: 'rgba(28, 28, 26, 0.04)', stroke: 'rgba(28, 28, 26, 0.6)',
          strokeDashArray: [6, 5], strokeWidth: 1.5, rx: 6, ry: 6,
          selectable: false, evented: false, objectCaching: false,
        })
        canvas.add(noteDraft.rect)
      } else {
        noteDraft.rect.set({ left: Math.min(noteDraft.x0, p.x), top: Math.min(noteDraft.y0, p.y), width: w, height: h })
        noteDraft.rect.setCoords()
      }
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', (e) => {
      if (mode !== 'note' || !noteDraft) return
      const p = canvas.getPointer(e.e)
      const draft = noteDraft
      noteDraft = null
      if (draft.rect) canvas.remove(draft.rect)
      const w = Math.abs(p.x - draft.x0)
      const h = Math.abs(p.y - draft.y0)
      const sized = w >= 40 && h >= 40 // a real drag sizes the note (canvas-board rule)
      // Session 17: the drag rectangle (or the click default) becomes a SQUARE — the note
      // takes the larger of the drawn width/height on BOTH axes, like the canvas board.
      const side = Math.max(80, Math.round(sized ? Math.max(w, h) : 180))
      const id = crypto.randomUUID()
      const t = now()
      const data = {
        id, type: 'sticky',
        x: Math.min(draft.x0, p.x), y: Math.min(draft.y0, p.y),
        width: side,
        height: side,
        color: STICKY_PAPER, content: '', z_index: 0, deleted: 0,
        created_at: t, updated_at: t, board: BOARD,
      }
      elems.set(id, data)
      const obj = makeObject(data)
      objects.set(id, obj)
      canvas.add(obj)
      save(data)
      history.commit('add', data)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
      beginStickyEdit(obj) // open the edit twin right away — type immediately
    })

    // Sticky-note close (×) — ported from canvas.js: the hit test runs in the CAPTURE phase
    // on the fabric wrapper (capture on an ancestor always precedes the target's listeners),
    // so the × deletes the note without the click first selecting/dragging it;
    // stopPropagation() keeps Fabric out of this mousedown entirely. The hit itself is mapped
    // into the note's local space through the inverse transform (exact even if a future
    // transform appears; identity on this fixed sheet). Works in every tool except
    // pen/eraser (those keep their own paths). Deletion rides the notebook's own tombstone +
    // undo path, exactly like deleteActive().
    const closeRegionHit = (ev) => {
      const p = canvas.getPointer(ev)
      for (const g of canvas.getObjects()) {
        if (!g.__close || !g.id) continue
        const inv = fabric.util.invertTransform(g.calcTransformMatrix())
        const lp = fabric.util.transformPoint(p, inv)
        const c = g.__close
        const px = lp.x + (g.width || 0) / 2
        const py = lp.y + (g.height || 0) / 2
        if (px >= c.left && px <= c.left + c.width && py >= c.top && py <= c.top + c.height) return g
      }
      return null
    }
    const deleteViaClose = (g) => {
      if (!g || !g.id || !objects.has(g.id)) return false // idempotent (touch fallback)
      if (stickyEdit && stickyEdit.group === g) stickyEdit.editor.exitEditing() // twin cleanup (its text save lands first; the tombstone below wins by LWW)
      const data = elems.get(g.id)
      removeObject(g.id)
      if (data) {
        save({ ...data, deleted: 1, updated_at: now() })
        history.log('erase', data)
      }
      return true
    }
    canvas.wrapperEl.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return
      if (mode === 'eraser' || mode === 'pen') return // those tools keep their own paths
      if (!(ev.target instanceof HTMLCanvasElement)) return
      const g = closeRegionHit(ev)
      if (!g) return
      deleteViaClose(g)
      ev.stopPropagation() // Fabric never sees this mousedown — no selection, no drag
      ev.preventDefault()
    }, true)
    // Touch fallback: fabric synthesizes mouse:down from touchstart, which never reaches the
    // capture listener above (no real mouse event precedes it on touch). deleteViaClose is
    // idempotent, so a hybrid double-fire is harmless.
    canvas.on('mouse:down', (e) => {
      if (canvas.isDragging || mode === 'eraser' || mode === 'pen') return
      const t = e.target
      const g = t?.group ?? t
      if (!g || g.type !== 'group' || !g.__close || !g.id) return
      const inv = fabric.util.invertTransform(g.calcTransformMatrix())
      const lp = fabric.util.transformPoint(canvas.getPointer(e.e), inv)
      const c = g.__close
      const px = lp.x + (g.width || 0) / 2
      const py = lp.y + (g.height || 0) / 2
      if (px < c.left || px > c.left + c.width || py < c.top || py > c.top + c.height) return
      deleteViaClose(g)
    })

    // double-click any text box to type into it again; double-click a sticky note opens its
    // edit twin (Fabric can't edit text inside a group — see makeEditTwin above)
    canvas.on('mouse:dblclick', (e) => {
      const target = e.target
      if (!target) return
      const inner = target.getObjects ? target.getObjects().find((o) => o.type === 'textbox') : null
      if (inner && target.__close) return beginStickyEdit(target)
      const txt = target.type === 'textbox' || target.type === 'i-text' ? target : null
      if (!txt) return
      canvas.setActiveObject(txt)
      txt.enterEditing()
    })

    // eraser
    canvas.on('mouse:down', (e) => { if (mode === 'eraser' && !canvas.isDragging) { eraseIds.clear(); eraseAt(e) } })
    canvas.on('mouse:move', (e) => { if (mode === 'eraser' && e.e.buttons === 1) eraseAt(e) })

    // toolbar
    toolbarEl = ui.toolbar
    if (ui.font) {
      ui.font.value = fontMode
      ui.font.addEventListener('change', () => {
        fontMode = ui.font.value === 'classic' ? 'classic' : 'bebas'
        localStorage.setItem(FONT_KEY, fontMode)
        for (const obj of objects.values()) {
          if (obj.kind === 'text') {
            obj.set({ fontFamily: textFont(), fontWeight: textWeight() })
            if (typeof obj.initDimensions === 'function') obj.initDimensions()
            obj.setCoords?.()
          }
        }
        canvas.requestRenderAll()
      })
    }
    ui.toolbar.querySelector('[data-action="undo"]').addEventListener('click', undo)
    ui.toolbar.querySelector('[data-action="redo"]').addEventListener('click', redo)
    ui.toolbar.querySelector('[data-action="delete"]').addEventListener('click', deleteActive)
    ui.toolbar.querySelector('[data-action="addimage"]')?.addEventListener('click', addImageByUrl)
    // P4.3 (F-M17): wire the image popover form submit + Escape/click-outside to close.
    imagePopEl = document.querySelector('[data-image-pop]')
    if (imagePopEl) {
      imagePopEl.querySelector('[data-image-form]')?.addEventListener('submit', (e) => {
        e.preventDefault()
        placeImageFromPop()
      })
      imagePopEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); hideImagePopover() }
      })
      // Click outside the popover closes it (but not clicks on the addimage button itself).
      document.addEventListener('click', (e) => {
        if (imagePopEl.hidden) return
        if (imagePopEl.contains(e.target) || e.target.closest('[data-action="addimage"]')) return
        hideImagePopover()
      })
    }
    ui.toolbar.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.dataset.tool === 'black') color = BLACK
        else if (b.dataset.tool === 'blue') color = BLUE
        const t = b.dataset.tool === 'black' || b.dataset.tool === 'blue' ? 'pen' : b.dataset.tool
        setTool(t)
        ui.toolbar.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b))
      })
    })
    document.addEventListener('keydown', onBoardKeydown, true)
  }

  function sizeToPage() {
    const w = page.clientWidth
    const h = page.clientHeight
    if (!canvas || !w || !h) return
    canvas.setDimensions({ width: w, height: h })
    canvas.calcOffset()
    canvas.renderAll()
  }

  return { init, getCanvas: () => canvas }
})()
