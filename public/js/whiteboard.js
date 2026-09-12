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

  // W3 fix (S29): the snapshot/diff twins of canvas.js — object:modified needs them to
  // decide "real change vs click noise" and to capture the pre-modify record for undo.
  const snapshotOf = (id) => (elems.has(id) ? { ...elems.get(id) } : null)
  const dataChanged = (a, b) => {
    if (!a || !b) return true
    const { updated_at: _x, ...ar } = a
    const { updated_at: _y, ...br } = b
    return JSON.stringify(ar) !== JSON.stringify(br)
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

  // Sticky notes — the ONE shared StickyNote factory (Session 28): the component was
  // born on the Canvas board and copied verbatim here in "batch s"; the two ~140-line
  // copies had already drifted (this sheet added the dark-mode theming refs, that board
  // kept resizable controls). The geometry now lives ONCE in public/js/sticky.js —
  // makeStickyNote there owns the wrap-width pinning, the square binary-search sizing,
  // the in-place downward growth, the layered session-17 shadows and objectCaching:false.
  // This wrapper injects the notebook's surface differences only:
  //   hasControls:false — move-only (growth is automatic via fitPaper; the sizing path
  //                       that round-trips through the pinned wrap width — hand-resizing
  //                       would fight it; angle stays 0 as the rotate handle is a control)
  //   dark-mode theming — this sheet's dark mode is a CSS invert (--nb-ink), so the
  //                       sticky self-themes by recolor (paper/ink/×) while the canonical
  //                       pastel rides __lightColor for save round-trips (2026-09-12 fix).
  const STICKY_PAPER = window.hibanaSticky.STICKY_PAPER
  function makeStickyNote(opts) {
    const group = window.hibanaSticky.makeStickyNote({
      ...opts,
      hasControls: false,
      requestRender: () => { if (canvas) canvas.requestRenderAll() },
      wireTextDir,
    })
    if (boardIsDark()) applyStickyTheme(group, true)
    return group
  }

  // Text boxes keep their drawn WIDTH fixed (user request 2026-08-24): text wraps at the
  // box edge. The HEIGHT, however, grows vertically to fit the content (user request R10):
  // if the user types more text than the initial boundary, the box expands downward so
  // nothing is clipped. Width never grows sideways (wrapping prevents that); height is
  // auto-fit. splitByGrapheme = character-level wrapping (overflow-wrap: anywhere) so a
  // single unbroken word still wraps.
  //
  // Width-driven text-box resize (2026-09-12 user report: "the resize handles look
  // decorative — resizing never changes the wrapping"). Fabric v7's Textbox defaults
  // give the four CORNERS scalingEqually (the letters stretch, the wrap stays frozen)
  // and only ml/mr a width action — and nothing re-measures the wrap on a width change
  // anyway (v7 has no initDimensions call in the resize path; the lines cache is only
  // rebuilt on text/style edits). Rebind EVERY horizontal handle (corners + edges) to
  // fabric's own width action (mr's actionHandler: pointer→width, opposite edge pinned
  // via wrapWithFixedAnchor, fires object:resizing), then re-run the wrap on every tick:
  // __fixedWidth ← width, initDimensions() re-wraps (fewer lines as the box widens,
  // taller as it narrows), the height auto-fits and the clipPath re-syncs. Vertical
  // handles go away — the height is content-driven, never hand-set (same contract as
  // typing). Scale stays 1 forever, so objectToData's fontSize/__fixedWidth bake is a
  // no-op and the width round-trips through the record. (Same helper as canvas.js —
  // kept in sync deliberately; the boards' makeTextBox twins are already duplicated.)
  function wireTextBoxResize(obj) {
    const widthAction = obj.controls?.mr?.actionHandler
    if (!widthAction) return // fabric layout drift → default handles, no reflow
    const cursors = { tl: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', br: 'nwse-resize', ml: 'ew-resize', mr: 'ew-resize' }
    for (const key of Object.keys(cursors)) {
      const c = obj.controls[key]
      if (!c) continue
      c.actionHandler = widthAction
      c.actionName = 'resizing'
      c.cursorStyleHandler = () => cursors[key] // width resize is axis-x; ignore angle cursors
    }
    obj.setControlsVisibility({ mt: false, mb: false }) // height is auto-fit
    obj.on('resizing', () => {
      if (obj.isEditing) return // while editing, the box owns its own geometry
      // fabric's set('width') already re-measured (initDimensions + setCoords run inside
      // Text.set) — sync the pin + clamp, then refresh the control coords for the new
      // height so the handles track the box mid-drag.
      obj.width = Math.max(28, Math.round(obj.width))
      obj.__fixedWidth = obj.width
      obj.setCoords()
    })
  }

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
      // WIDTH-TRANSPARENT (Session 28-R3 resize fix): never write obj.width here — the
      // wrap measures at the LIVE width (set at construction, or by a resize handle via
      // v7's Text.set('width') which re-runs initDimensions + setCoords synchronously —
      // an old __fixedWidth re-pin here would clobber the new width and the resize would
      // no-op). The pin syncs the other way: the 'resizing' handler mirrors obj.width
      // into __fixedWidth; objectToData's multi-select bake applies the baked width.
      base()
      // Let the HEIGHT auto-fit to the text (Math.max with the user's drawn min height
      // so it never shrinks below the boundary but grows).
      obj.height = Math.max(obj.__minHeight, Math.round(obj.height))
      obj.clipPath.set({ left: -obj.width / 2, top: -obj.height / 2, width: obj.width, height: obj.height })
    }
    // Session 28 (user report: "parts of my notes are cropped — the container only shows
    // a portion"): the box used to load at the SAVED height with the clipPath pinned to
    // it — if the re-measured text is taller (fabric-metric drift after the v5→v7
    // migration, a font-preference change, a different wrap), everything past the saved
    // height stayed invisible with no way to reach it. Fit ONCE at construction so a
    // loaded note always shows all of its saved content (grow-only: max(saved, measured)).
    obj.initDimensions()
    wireTextBoxResize(obj)
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
    // 0049: restore persisted rotation (mtr handle). Notebook stickies are hasControls:false
    // (never rotated by hand); text notes + pen strokes + images can carry an angle.
    if (data.angle) { obj.rotate(data.angle); obj.setCoords?.() }
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

  // Dark-mode sticky theming (2026-09-12, review round): the notebook sheet's blanket CSS
  // invert (--nb-ink) flips pen strokes + text notes to light — but it ALSO flips sticky
  // papers to near-black with a low-contrast pale ink (VLM-verified: "hard to read"), and
  // the dark-gray close × became nearly invisible. Fabric filters only exist on Image
  // objects (the counter-filter trick below can't apply to Groups), so the sticky carries
  // its OWN theme: the paper switches to the app-wide dark-sticky register (themes.css:
  // #6B6450 muted yellow + #EDE8DE light ink — same recipe as the DOM sticky notes) and the
  // ink/×/close-background flip with it. The PASTEL stays canonical: __lightColor rides
  // through objectToData, so a note created + saved in dark mode never reloads as a dark
  // paper in light mode (and re-themes correctly on reload into dark).
  const STICKY_DARK_PAPER = '#6B6450' // themes.css dark sticky-yellow register
  const STICKY_DARK_INK = '#EDE8DE' // themes.css dark sticky ink (4.83:1 worst-case AA)
  const STICKY_LIGHT_INK = '#3f3f46'
  function applyStickyTheme(group, dark) {
    if (!group || !group.__paper) return
    const base = group.__lightColor || group.__paper.fill || STICKY_PAPER
    if (dark) {
      group.__paper.fill = STICKY_DARK_PAPER
      group.__shadowPaper.fill = STICKY_DARK_PAPER
      if (group.__innerText) group.__innerText.fill = STICKY_DARK_INK
      if (group.__closeBg) group.__closeBg.fill = 'rgba(255, 255, 255, 0.10)'
      if (group.__closeX) group.__closeX.fill = 'rgba(237, 232, 222, 0.9)'
    } else {
      group.__paper.fill = base
      group.__shadowPaper.fill = base
      if (group.__innerText) group.__innerText.fill = STICKY_LIGHT_INK
      if (group.__closeBg) group.__closeBg.fill = 'rgba(0, 0, 0, 0.06)'
      if (group.__closeX) group.__closeX.fill = 'rgba(63, 63, 70, 0.85)'
    }
    group.dirty = true
    // Fabric child caching: the paper/shadow/×/text objects keep their own bitmaps —
    // marking only the group dirty leaves the children rendering their OLD fill. Every
    // themed child must be dirtied or the recolor never reaches the pixels.
    for (const child of [group.__paper, group.__shadowPaper, group.__innerText, group.__closeBg, group.__closeX]) {
      if (child) child.dirty = true
    }
    if (canvas) canvas.requestRenderAll()
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

  // Re-apply (or clear) the counter-filter on every image + the sticky theme when the
  // theme changes (2026-09-12: stickies joined — they theme by recolor, images by the
  // invert counter-filter; both ride the same observer in init).
  function reapplyDarkInvertFilters() {
    if (!canvas) return
    const dark = boardIsDark()
    canvas.getObjects().forEach((obj) => {
      if (obj.type === 'image') {
        obj.filters = []
        if (dark) applyDarkInvertCounterFilter(obj)
        else obj.applyFilters()
      } else if (obj.__paper) {
        applyStickyTheme(obj, dark)
      }
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
    obj.__noCors = !!raw.__noCors // Session 28: surfaces in the export-taint toast count
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
      // 0049: restore persisted rotation on the async image load path (makeObject's
      // rotate only covers the synchronous branches — images land here).
      if (data.angle) { obj.rotate(data.angle); obj.setCoords() }
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
    hideExportPopover() // one board popover at a time
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

  // ---- PNG export (Session 28): whole-page / selection download + clipboard copy ------
  // Parity with the Canvas board's export popover (squig batch 2026-08-31), adapted for
  // THIS sheet's two structural differences:
  //   1. fixed page — no viewportTransform juggling (canvas.js pins the vpt to identity
  //      before cropping; here it already is), no frames, no comment-pin scale pins.
  //   2. dark mode is a CSS invert on #nb-board (--nb-ink), which a PNG bitmap CANNOT
  //      carry — toDataURL renders the AUTHORED colors. Exporting "what the sheet looks
  //      like in dark mode" would need the filter in the bitmap (impossible without
  //      re-compositing offscreen). Instead the export always renders the CANONICAL
  //      LIGHT view — exactly what a light-mode user sees: images' dark counter-filters
  //      cleared (they assume the sheet invert on top), stickies re-themed to their
  //      light pastel via __lightColor, authored ink, light paper base. One predictable
  //      output from both themes (matches how the paper sticky look is canonical).
  let exportPopEl = null
  const LIGHT_PAPER = '#fdfdfb' // themes.css light --nb-paper
  const exportStamp = () => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  }
  function unionBounds(objs) {
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
    for (const o of objs) {
      const bb = o.getBoundingRect(true)
      l = Math.min(l, bb.left)
      t = Math.min(t, bb.top)
      r = Math.max(r, bb.left + bb.width)
      b = Math.max(b, bb.top + bb.height)
    }
    if (l === Infinity) return null
    return { left: l, top: t, width: r - l, height: b - t }
  }
  function setExportLightView() {
    // Enter the canonical light composition (restore rides reapplyDarkInvertFilters(),
    // which re-derives image counter-filters + sticky theme from the live sheet state).
    canvas.getObjects().forEach((obj) => {
      if (obj.type === 'image') {
        obj.filters = []
        obj.applyFilters()
      } else if (obj.__paper) {
        applyStickyTheme(obj, false)
      }
    })
  }
  function regionDataUrl(bounds, pad = 24) {
    const dark = boardIsDark()
    const prevBg = canvas.backgroundColor
    if (dark) setExportLightView()
    canvas.backgroundColor = LIGHT_PAPER
    try {
      return canvas.toDataURL({
        format: 'png', multiplier: 2, enableRetinaScaling: false,
        left: bounds.left - pad, top: bounds.top - pad,
        width: bounds.width + pad * 2, height: bounds.height + pad * 2,
      })
    } finally {
      canvas.backgroundColor = prevBg
      if (dark) reapplyDarkInvertFilters()
      canvas.requestRenderAll()
    }
  }
  function exportTaintError(err) {
    // A non-CORS image (the loader's fallback flags it __noCors) makes the canvas
    // TAINTED — toDataURL throws SecurityError. Point at the real cause so the user
    // knows which link is the blocker (same handling as the Canvas board).
    if (err && (err.name === 'SecurityError' || /tainted/i.test(String(err?.message || '')))) {
      const t = canvas.getObjects().filter((o) => o.__noCors).length
      const base = _t('canvas.exportTainted', 'Export blocked: an image link without CORS is on the board — it displays, but the browser forbids reading the canvas for PNG')
      window.hibana?.toast(t > 1 ? `${base} (${t})` : base, 'err', 4200)
    } else {
      window.hibana?.toast(_t('canvas.exportFailed', 'Export failed'), 'err')
    }
  }
  function exportRegionPng(bounds, name, pad = 24) {
    if (!bounds || bounds.width < 1 || bounds.height < 1) return
    try {
      const url = regionDataUrl(bounds, pad)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.hibana?.toast(_t('canvas.exported', 'PNG downloaded'), 'info', 2200)
    } catch (err) {
      exportTaintError(err)
    }
  }
  async function copyRegionPng(bounds) {
    if (!bounds || bounds.width < 1 || bounds.height < 1) return
    if (!navigator.clipboard || !window.ClipboardItem) {
      window.hibana?.toast(_t('canvas.copyUnsupported', 'Clipboard images are not supported in this browser'), 'err', 3200)
      return
    }
    let url
    try {
      url = regionDataUrl(bounds, 24)
    } catch (err) {
      exportTaintError(err)
      return
    }
    try {
      const blob = await (await fetch(url)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      window.hibana?.toast(_t('canvas.copiedPng', 'Copied to clipboard'), 'info', 2200)
    } catch {
      // Permission denied / focus loss / transient clipboard lock — not a taint problem.
      window.hibana?.toast(_t('canvas.copyFail', 'Clipboard copy failed'), 'err')
    }
  }
  function buildExportRows() {
    const rowsEl = exportPopEl?.querySelector('[data-export-rows]')
    if (!rowsEl) return
    rowsEl.innerHTML = ''
    const real = canvas.getObjects().filter((o) => o.id)
    // Session 28 polish: leading icon per action (download vs clipboard) — reads at a glance.
    const ICONS = {
      download: '<svg class="export-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4 17v1.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>',
      copy: '<svg class="export-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    }
    const mkRow = (label, sub, fn, icon = 'download') => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'export-row'
      const main = document.createElement('span')
      main.className = 'export-main'
      main.innerHTML = ICONS[icon] || ''
      const l = document.createElement('span')
      l.className = 'export-label'
      l.textContent = label
      main.appendChild(l)
      const s = document.createElement('span')
      s.className = 'export-sub'
      s.textContent = sub
      b.appendChild(main)
      b.appendChild(s)
      b.addEventListener('click', fn)
      rowsEl.appendChild(b)
    }
    if (!real.length) {
      const empty = document.createElement('div')
      empty.className = 'pop-hint'
      empty.textContent = _t('canvas.exportEmpty', 'Nothing on the board yet')
      rowsEl.appendChild(empty)
      return
    }
    const full = unionBounds(real)
    mkRow(_t('canvas.exportPage', 'Whole page'), `${Math.round(full.width)}×${Math.round(full.height)}`, () => {
      hideExportPopover()
      exportRegionPng(full, `hibana-notebook-${exportStamp()}.png`, 40)
    })
    const sel = canvas.getActiveObjects().filter((o) => o.id)
    if (sel.length) {
      const sb = unionBounds(sel)
      mkRow(`${_t('canvas.exportSel', 'Selection')} (${sel.length})`, `${Math.round(sb.width)}×${Math.round(sb.height)}`, () => {
        hideExportPopover()
        exportRegionPng(sb, `hibana-selection-${exportStamp()}.png`)
      })
    }
    // Clipboard copy targets the selection when one exists, else the whole page.
    const clipBounds = sel.length ? unionBounds(sel) : full
    mkRow(
      _t('canvas.copyPng', 'Copy PNG to clipboard'),
      sel.length ? `${sel.length}` : _t('canvas.exportPage', 'Whole page'),
      () => { hideExportPopover(); void copyRegionPng(clipBounds) },
      'copy',
    )
  }
  function showExportPopover() {
    if (!exportPopEl) exportPopEl = document.querySelector('[data-export-pop]')
    if (!exportPopEl) return
    hideImagePopover() // one board popover at a time
    buildExportRows()
    // In dark mode the PNG renders the CANONICAL LIGHT view (the CSS invert can't ride a
    // bitmap) — say so instead of letting the user wonder why the export isn't dark.
    const hint = exportPopEl.querySelector('.pop-hint')
    if (hint) {
      hint.textContent = boardIsDark()
        ? _t('canvas.exportHintLight', '2× resolution · light paper background')
        : _t('canvas.exportHint', '2× resolution · paper background')
    }
    exportPopEl.hidden = false
  }
  function hideExportPopover() {
    if (!exportPopEl) exportPopEl = document.querySelector('[data-export-pop]')
    if (exportPopEl) exportPopEl.hidden = true
    // drop the toolbar affordance wherever the close came from (row click, Escape, outside)
    toolbarEl?.querySelector('[data-action="export"]')?.classList.remove('pop-open')
  }

  // ---- sticky recolor palette (Session 28): parity with the Canvas board ----------------
  // The Canvas shows a floating pastel palette under a selected sticky (canvas.js
  // syncStickyPalette / recolorSticky); the notebook sticky could only ever be the default
  // yellow. Same 7 pastels, same placement language (under the note, flips above when the
  // sheet has no room below). Board differences vs the Canvas version:
  //   - fixed sheet: no viewportTransform in the math (bbox is already page-space);
  //   - dark mode: this sheet's dark look is a CSS invert + per-object theming, so a
  //     recolor sets the CANONICAL pastel on __lightColor (what objectToData saves) and
  //     then re-themes via applyStickyTheme when the sheet is dark;
  //   - the recolor is the notebook's first UNDOABLE MODIFY: undo/redo grew a symmetric
  //     'modify' branch (revert-to-carried-record + swap) to support it.
  const NOTE_COLORS = ['#FFF59D', '#fef08a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#fed7aa', '#e9d5ff']
  let stickyPaletteEl = null
  const selectedSticky = () => {
    const a = canvas?.getActiveObject?.()
    return a && a.type === 'group' && a.__close && a.id ? a : null
  }
  function buildStickyPalette() {
    if (!stickyPaletteEl) return
    stickyPaletteEl.innerHTML = ''
    for (const c of NOTE_COLORS) {
      const b = document.createElement('button')
      b.type = 'button'
      b.dataset.noteColor = c
      b.style.background = c
      b.title = _t('canvas.noteColor', 'Note color')
      b.setAttribute('aria-label', _t('canvas.noteColor', 'Note color'))
      stickyPaletteEl.appendChild(b)
    }
    stickyPaletteEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-note-color]')
      if (!btn) return
      recolorSticky(selectedSticky(), btn.dataset.noteColor)
    })
  }
  function syncStickyPalette() {
    if (!stickyPaletteEl || !canvas) return
    const g = stickyEdit ? null : selectedSticky()
    if (!g) { stickyPaletteEl.hidden = true; return }
    // note bbox is already PAGE-space on this fixed sheet (no viewport transform) — offset
    // it by the canvas element's own offset inside the palette's offset parent (#nb-page).
    const bb = g.getBoundingRect()
    const cr = canvas.lowerCanvasEl.getBoundingClientRect()
    const host = stickyPaletteEl.parentElement
    const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 }
    const ox = cr.left - hr.left, oy = cr.top - hr.top
    const left = bb.left + ox
    const bottom = bb.top + bb.height + oy
    const top = bb.top + oy
    stickyPaletteEl.hidden = false
    stickyPaletteEl.style.left = Math.round(Math.max(8, Math.min(left - 4, hr.width - stickyPaletteEl.offsetWidth - 8))) + 'px'
    // Session 28 (user request: "the menu for edit/etc of sticky notes must come top"):
    // the palette rides ABOVE the note like a toolbar pinned to its top edge; it flips
    // BELOW only when the note hugs the sheet's top and there is no room above.
    stickyPaletteEl.style.top = Math.round(top - stickyPaletteEl.offsetHeight - 8 < 8 ? Math.max(8, bottom + 8) : top - stickyPaletteEl.offsetHeight - 8) + 'px'
    const cur = String(g.__lightColor || '').toLowerCase()
    stickyPaletteEl.querySelectorAll('button[data-note-color]').forEach((b) => {
      b.classList.toggle('active', b.dataset.noteColor.toLowerCase() === cur)
    })
  }
  function recolorSticky(g, c) {
    if (!g || !c) return
    const before = elems.get(g.id)
    // Session 17 (shared factory): BOTH rects of the layered shadow repaint, or the recolor
    // leaves a stale rim at the paper's edges.
    g.__paper?.set({ fill: c })
    g.__shadowPaper?.set({ fill: c })
    g.__lightColor = c // the canonical pastel — objectToData saves THIS (the live fill may be dark-themed)
    if (boardIsDark()) applyStickyTheme(g, true) // re-derive the dark paper/ink/× from the new pastel
    // (the RR-1 lesson: group.dirty alone renders stale child fills — dirty every child)
    for (const child of [g.__paper, g.__shadowPaper, g.__innerText, g.__closeBg, g.__closeX]) {
      if (child) child.dirty = true
    }
    g.dirty = true
    canvas.requestRenderAll()
    const data = objectToData(g)
    elems.set(g.id, data)
    save(data)
    if (before) history.commit('modify', before) // recolors are undoable (Session 28)
    syncStickyPalette()
  }

  function objectToData(obj) {
    if (obj.type === 'image') {
      return {
        id: obj.id, type: 'image', x: obj.left, y: obj.top,
        width: Math.round((obj.width || 0) * (obj.scaleX || 1)), height: Math.round((obj.height || 0) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: '', content: obj.content || '',
        font_size: null,
        z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
      }
    }
    if (obj.kind === 'sticky' || obj.__close) {
      // sticky note (batch s): the group is the record — position/size from the group frame
      // (scale baked in defensively; hasControls:false means no user scaling), paper hex from
      // __lightColor (the CANONICAL pastel — the live fill may be dark-themed; saves must
      // round-trip the light-mode color), text from the hidden inner textbox (falling back
      // to the cached content if a twin editor is live).
      return {
        id: obj.id, type: 'sticky', x: obj.left, y: obj.top,
        width: Math.round((obj.width || 180) * (obj.scaleX || 1)), height: Math.round((obj.height || 120) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips (hasControls:false keeps it 0 in practice)
        color: obj.__lightColor || (obj.__paper && obj.__paper.fill) || STICKY_PAPER, content: (obj.__innerText && obj.__innerText.text) || obj.content || '',
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
      if (obj.__fixedWidth) {
        obj.__fixedWidth = Math.max(28, Math.round(obj.__fixedWidth * (obj.scaleX || 1)))
        obj.width = obj.__fixedWidth // apply the bake to the LIVE wrap width (initDimensions no longer re-pins)
      }
      obj.set({ fontSize, scaleX: 1, scaleY: 1 })
      if (typeof obj.initDimensions === 'function') obj.initDimensions() // re-wraps at the baked width + re-syncs the clip
      obj.setCoords?.()
      const b = obj.angle ? null : obj.getBoundingRect()
      return {
        id: obj.id, type: 'note',
        // 0049: under rotation the ORIGIN (obj.left/top — the rotate pivot) is what
        // reconstructs exactly via makeObject's rotate(); the AABB was only safe at angle 0.
        x: b ? b.left : obj.left, y: b ? b.top : obj.top, width: obj.width || b?.width, height: obj.type === 'textbox' ? Math.round(obj.height) : null,
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: obj.fill || color, content: obj.text || obj.content || '', font_size: fontSize,
        z_index: obj.zIndex || 0, deleted: 0, created_at: obj.createdAt || now(), updated_at: now(), board: BOARD,
      }
    }
    const b = obj.angle ? null : obj.getBoundingRect()
    return {
      id: obj.id, type: 'stroke',
      // 0049: same origin-vs-AABB rule as the text branch — exact reconstruction under rotation.
      x: b ? b.left : obj.left, y: b ? b.top : obj.top, width: null, height: null,
      angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
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
      // An open export popover closes first (the image popover self-closes on its own
      // Escape/click-outside handlers — it holds focus while open; this one doesn't).
      if (exportPopEl && !exportPopEl.hidden) {
        hideExportPopover()
        e.preventDefault()
        return
      }
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
      } else if (entry.kind === 'modify') {
        // Session 28 (sticky recolor): revert to the BEFORE record the entry carries; the
        // AFTER record (still live in elems) rides back onto the redo stack — the swap is
        // symmetric, so undo and redo share the exact same shape for modify entries.
        const inverse = { kind: 'modify', data: elems.get(entry.data.id) || entry.data }
        elems.set(entry.data.id, entry.data)
        removeObject(entry.data.id)
        putObject(entry.data)
        save({ ...entry.data, deleted: 0, updated_at: now() })
        return inverse
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
      } else if (entry.kind === 'modify') {
        // re-apply the AFTER record; capture the current (pre-apply) record for the next undo
        const inverse = { kind: 'modify', data: elems.get(entry.data.id) || entry.data }
        elems.set(entry.data.id, entry.data)
        removeObject(entry.data.id)
        putObject(entry.data)
        save({ ...entry.data, deleted: 0, updated_at: now() })
        return inverse
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
    // Session 28 (cropped-notes fix, belt-and-braces): when the webfonts were CACHED,
    // document.fonts.ready resolves before `await load()` above adds the elements — the
    // reflow pass then saw an empty canvas and never re-measured the loaded notes. Run
    // it once more now that every element exists (idempotent: measures at the pinned
    // width, grows heights only).
    reflowTextMetrics()
    // Session 28: the sheet sizes to its content after the first layout pass (tall notes
    // grow the page — see fitSheetToContent below), and keeps tracking content changes.
    fitSheetToContent()
    canvas.on('object:added', scheduleSheetFit)
    canvas.on('object:removed', scheduleSheetFit)
    canvas.on('object:modified', scheduleSheetFit)
    canvas.on('text:changed', scheduleSheetFit) // sticky papers grow while typing

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

    // moved / resized / rotated — W3 fix (S29): mirrors canvas.js persistActive (snapshot
    // before → save → history.commit('modify') when the record actually changed), so
    // notebook moves/resizes/rotations are undoable with the rest of the board instead
    // of silently skipping the undo stack (the old handler saved without committing).
    canvas.on('object:modified', () => {
      for (const obj of canvas.getActiveObjects()) {
        if (!obj || !obj.id) continue
        const before = snapshotOf(obj.id)
        const data = objectToData(obj)
        obj.content = data.content
        if (dataChanged(before, data)) {
          save(data)
          if (before) history.commit('modify', before)
        }
      }
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
    // Session 28 sticky recolor palette: build the swatches once; after:render keeps it
    // glued ABOVE the selected note (follows moves — this sheet has no pan/zoom, but the
    // note itself moves) and hides it while the edit twin is open.
    stickyPaletteEl = document.querySelector('[data-sticky-palette]')
    if (stickyPaletteEl) {
      buildStickyPalette()
      canvas.on('after:render', syncStickyPalette)
    }
    // Session 28 export popover: toggle from the toolbar; click-outside closes it.
    // The button carries .pop-open while its popover is open (same affordance as the
    // Canvas board's popovers — canvas.css styles it).
    const exportBtn = ui.toolbar.querySelector('[data-action="export"]')
    exportBtn?.addEventListener('click', () => {
      const willOpen = exportPopEl?.hidden !== false
      if (willOpen) showExportPopover()
      else hideExportPopover()
      exportBtn?.classList.toggle('pop-open', willOpen)
    })
    document.addEventListener('click', (e) => {
      if (!exportPopEl || exportPopEl.hidden) return
      if (exportPopEl.contains(e.target) || e.target.closest('[data-action="export"]')) return
      hideExportPopover()
      exportBtn?.classList.remove('pop-open')
    })
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

  // Session 28 (closes the cropped-notes report): the sheet GROWS to fit its content.
  // The canvas is a fixed bitmap sized to the page element — a note taller than the
  // viewport used to be cut off at the sheet's bottom edge with no way to reach the
  // tail. The page's height now tracks the content's bottom edge (+ breathing room);
  // the window scrolls when the sheet is taller than the viewport (CSS: body scrolls,
  // toolbar stays pinned). Debounced so drag-live updates stay cheap.
  let sheetFitTimer = null
  function fitSheetToContent() {
    if (!canvas || !page) return
    let bottom = 0
    for (const o of canvas.getObjects()) {
      if (!o.id) continue // drafts, guides and palettes never drive the sheet size
      const b = o.getBoundingRect()
      bottom = Math.max(bottom, b.top + b.height)
    }
    // Never shrink below what the viewport would give the sheet (the flex baseline).
    const minH = page.clientHeight || 0
    const target = Math.ceil(Math.max(minH, bottom + 96))
    const current = Math.round(page.getBoundingClientRect().height)
    if (target > current + 2) {
      page.style.minHeight = target + 'px'
      sizeToPage()
    }
  }
  const scheduleSheetFit = () => {
    clearTimeout(sheetFitTimer)
    sheetFitTimer = setTimeout(fitSheetToContent, 200)
  }

  return { init, getCanvas: () => canvas }
})()
