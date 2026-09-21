// The Canvas — boundless brain-dump space (spec §3). Fabric.js 5, vanilla stack.
//  - viewport-window loading: only elements near the visible area are fetched/rendered
//  - every discrete action autosaves (debounced during motion) → IndexedDB queue → server
//  - pen is desktop-only; sticky notes work on touch (pan/zoom by default)

window.addEventListener('hibana-canvas-init', async () => {
  const el = window.hibanaCanvas
  if (!window.fabric || !el) return
  await el.init('#board', { toolbar: document.getElementById('canvas-toolbar'), palette: document.getElementById('palette'), font: document.getElementById('canvas-font') })
})

window.hibanaCanvas = (() => {
  const _t = (k, f) => window.hibanaI18n?.t(k) || f
  let canvas = null
  let mode = 'select'
  // Default ink follows the theme (2026-08-25 request): black on light, white on dark —
  // until the user explicitly picks a swatch, which then wins until the next reload.
  const themeDark = () => {
    const t = document.documentElement.dataset.theme
    if (t === 'dark' || t === 'claude-dark') return true // S87: claude-dark is THE dark mode
    if (t === 'light') return false
    return matchMedia('(prefers-color-scheme: dark)').matches
  }
  const defaultInk = () => (themeDark() ? '#ffffff' : '#1c1c1a')
  let color = defaultInk()
  let colorPicked = false
  let penWidth = 4
  let arrowDraft = null // { A: [x,y], obj } — in-progress arrow preview
  let textDraft = null // { x0, y0, rect } — in-progress text-box drag (Figma-style)
  let frameDraft = null // { x0, y0, rect } — in-progress frame drag (module scope: cancelDrafts clears it)
  let clipboard = null // serialized copies (Ctrl+C / Ctrl+X) for Ctrl+V
  let markingDelete = false
  let spaceHeld = false // Figma-style: hold Space to grab-and-pan (user request)
  const history = new (window.hibanaHistory.History)() // shared two-stack undo/redo (Session 27 — same helper as the notebook; semantics identical to the inline stacks it replaced)
  const elems = new Map() // id → element data (source of truth, stays in sync with server)
  const objects = new Map() // id → fabric object
  const pendingFetch = new Set() // bbox requests in flight
  let toolbarEl = null // the toolbar element, captured at init (for tool-state changes)
  // Assigned inside init; called from setActiveTool (module scope) to show/hide the
  // text-property cluster (font size + family) with the text tool / text selection.
  let syncTextProps = () => {}

  // ---- squig batch (2026-08-31): shapes · alignment · comments · blocks · paper · export --
  let shapeDraft = null // { tool: 'rect'|'oval'|'circle', x0, y0, obj } — in-progress shape drag
  const GRID_PX = 10 // squig's "big nudge" pitch — shapes land on it, distance labels prove it
  const GUIDE_COLOR = '#ec4899' // Figma-pink alignment guides + distance labels (user request)
  const guides = [] // transient snap guides/labels (no .id → excluded from everything persistent)
  // Board appearance (per-browser, squig paper picker): plain is the legacy default,
  // checkered is the squig "subtle paper" look — the new default (user request).
  const PAPER_KEY = 'hibana-paper'
  const DOTS_KEY = 'hibana-dots'
  const SNAP_KEY = 'hibana-snap'
  let paperMode = 'plain'
  let dotsOn = true
  let snapEnabled = true
  try {
    const savedPaper = localStorage.getItem(PAPER_KEY)
    paperMode = ['plain', 'white', 'checkered', 'shaded'].includes(savedPaper) ? savedPaper : 'checkered'
    dotsOn = localStorage.getItem(DOTS_KEY) !== '0'
    snapEnabled = localStorage.getItem(SNAP_KEY) !== '0'
  } catch { /* private mode — defaults */ }
  // Popover elements (canvas.html), wired in init
  let blocksPopEl = null
  let paperPopEl = null
  let exportPopEl = null
  let commentPopEl = null
  let commentPopText = null
  let activeCommentPop = null // { obj, isNew } — obj is a real pin, or a TEMP pin (no id) for a new comment
  let lastPinZoom = null // pins keep a constant ON-SCREEN size — rescaled when zoom changes
  let blockPlaceCount = 0 // cascade offset so rapid placements don't stack perfectly

  // ---- per-element lock (2026-08-26 user request) --------------------------------
  // A locked element stays VISIBLE and SELECTABLE (so it can be found again) but move,
  // resize, rotate, text-edit and delete are all blocked — including via the eraser,
  // Ctrl+A select-all and bulk delete. The state persists on the element record.
  const applyLock = (o) => {
    const l = !!o.__locked
    o.lockMovementX = l
    o.lockMovementY = l
    o.lockRotation = l
    o.lockScalingX = l
    o.lockScalingY = l
    o.hasControls = !l
    o.hoverCursor = l ? 'default' : 'move'
    if (l && o.isEditing) o.exitEditing()
  }
  // 🔒 badge overlays: derived from __locked at render time — never persisted themselves.
  const lockBadges = new Map() // id -> fabric.Text
  const syncLockBadges = () => {
    if (!canvas) return
    const seen = new Set()
    for (const [id, o] of objects) {
      if (!o.__locked) continue
      seen.add(id)
      let badge = lockBadges.get(id)
      if (!badge) {
        badge = new fabric.Text('🔒', { fontSize: 13, selectable: false, evented: false, objectCaching: false })
        canvas.add(badge)
        lockBadges.set(id, badge)
      }
      const b = o.getBoundingRect()
      badge.set({ left: b.left - 1, top: b.top - 16 })
    }
    for (const [id, badge] of lockBadges) {
      if (!seen.has(id)) {
        canvas.remove(badge)
        lockBadges.delete(id)
      }
    }
  }
  const IMG_RADIUS = 14 // placed pictures keep the app's soft corners (no sharp edges)

  const PALETTE = ['#fef08a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#fed7aa', '#e9d5ff']

  // Board text font: Bebas Notes by default (user request); "Classic" opts back into the
  // previous font. The choice persists per board in localStorage and applies live to text.
  const FONT_KEY = 'hibana-font-canvas'
  let fontMode = localStorage.getItem(FONT_KEY) || 'bebas'
  const textFont = () => (fontMode === 'classic' ? "'Manrope', 'VazirFA', system-ui, sans-serif" : "'Bebas Notes', 'VazirFA', 'Manrope', system-ui, sans-serif")
  // Bebas renders too heavy at the regular weight (user request) — the family includes a
  // Light face (300) that reads like a marker; Classic keeps the normal weight.
  const textWeight = () => (fontMode === 'bebas' ? 300 : 400)
  // GOLDEN RULE (2026-08-26): Latin text always types and lays out LTR, Farsi RTL — decided
  // by the first strong character of the text (dir="auto" semantics), never by page language.
  // While a note is being edited, its hidden textarea follows the text's own direction, so
  // typing English on a Farsi board flows left-to-right and Farsi stays right-to-left.
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
      const d = textDir(obj.text)
      if (!d) return
      // S32 — the GENERAL LAW on canvas (CSS unicode-bidi:plaintext can't reach a
      // <canvas>): the RENDERED text follows its own first strong character too.
      // fabric's text render path reads the object's `direction` property (it sets
      // the canvas element's dir + ctx.direction + textAlign before drawing each
      // line), so a Latin note draws LTR — period at the sentence end — even on the
      // Farsi board, and a Farsi note draws RTL (was: fabric's 'ltr' default flipped
      // Farsi edge punctuation). Same rule as the hidden editing textarea below.
      obj.set('direction', d)
      if (obj.hiddenTextarea) obj.hiddenTextarea.dir = d
    }
    obj.on('editing:entered', apply)
    obj.on('changed', apply)
    apply() // also at wire time — loaded notes get their direction before first paint
  }
  // Text size (2026-08-26 user request): its own control, independent of the pen's
  // stroke-width dots. Applies to new text boxes and live to the selected text object.
  let textSize = parseInt(localStorage.getItem('hibana-font-size-canvas') || '16', 10) || 16
  // Text alignment (S40 user request — "add text alignment option to editor options in
  // both whiteboard and canvas"): same semantics as the size control — the default for
  // NEW text boxes, applied live to the selected one and persisted (0055 text_align).
  const VALID_ALIGNS = ['left', 'center', 'right']
  let textAlign = VALID_ALIGNS.includes(localStorage.getItem('hibana-text-align-canvas')) ? localStorage.getItem('hibana-text-align-canvas') : 'left'

  const send = (path, opts = {}) =>
    fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })

  // ---- persistence + queue ------------------------------------------------
  const save = (data, op = 'upsert') => {
    elems.set(data.id, data)
    window.hibanaQueue.enqueue({ kind: 'canvas', op, data })
    // Deletes flush immediately (fire-and-forget): the delete render triggers a viewport
    // refetch, and a stale read race would resurrect the item until the 1.5s debounce
    // lands the tombstone server-side (delete bug 2026-08-24 — fixed here + in loadChunk).
    if (op === 'delete') window.hibanaQueue.flush?.()
    window.hibana?.toast(op === 'delete' ? _t('canvas.deleted', 'Deleted (undo unavailable after sync)') : _t('canvas.saved', 'Saved'), 'ok', 1500)
  }

  // Unlimited undo/redo: every action records its previous state, so undoing walks all the
  // way back to the first state of the session. Each entry is one element's data (cheap),
  // and the stacks are never capped.
  const pushHistory = (kind, data) => history.commit(kind, data)
  const snapshotOf = (id) => (elems.has(id) ? { ...elems.get(id) } : null)
  const tombstone = (id) => {
    const cur = elems.get(id)
    removeObject(id)
    if (cur) save({ ...cur, deleted: 1, updated_at: new Date().toISOString() }, 'delete')
  }
  const restore = (data) => {
    if (!data) return
    removeObject(data.id)
    elems.set(data.id, data)
    putObject(data)
    save({ ...data, deleted: 0, updated_at: new Date().toISOString() })
  }

  // true when two element records differ beyond the timestamp — updated_at always changes
  // between snapshots, so a click without a real change must not record junk history
  const dataChanged = (a, b) => {
    if (!a || !b) return true
    const { updated_at: _x, ...ar } = a
    const { updated_at: _y, ...br } = b
    return JSON.stringify(ar) !== JSON.stringify(br)
  }

  function objectToData(obj) {
    if (obj.type === 'image') {
      // image elements persist their display size (base size × scale) so a control-resize
      // round-trips; content is the source URL.
      return {
        id: obj.id,
        type: 'image',
        x: obj.left,
        y: obj.top,
        width: Math.round((obj.width || 0) * (obj.scaleX || 1)),
        height: Math.round((obj.height || 0) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: '',
        content: obj.content || '',
        font_size: null,
        z_index: obj.zIndex || 0,
        deleted: 0,
        updated_at: new Date().toISOString(),
        created_at: obj.createdAt || new Date().toISOString(),
      }
    }
    let fontSize = null
    if (obj.kind === 'text') {
      // Manual resize (corner handles, like Paint/Photoshop) scales the object; bake the
      // effective size into the record and normalize the transform so saves never compound
      // and reloads render at exactly the size the user left it.
      fontSize = Math.max(6, Math.min(400, Math.round((obj.fontSize || 16) * (obj.scaleY || 1))))
      if (obj.__minHeight) obj.__minHeight = Math.max(14, Math.round(obj.__minHeight * (obj.scaleY || 1)))
      if (obj.__fixedWidth) {
        obj.__fixedWidth = Math.max(28, Math.round(obj.__fixedWidth * (obj.scaleX || 1)))
        obj.width = obj.__fixedWidth // apply the bake to the LIVE wrap width (initDimensions no longer re-pins)
      }
      obj.set({ fontSize, scaleX: 1, scaleY: 1 })
      // Session 19 (user request): after baking the scale into fontSize + __fixedWidth,
      // re-measure so the text REFLOWS at the new width (wraps to fewer/more lines). v7's
      // Text.set('width'|'fontSize') also triggers initDimensions — the explicit call is
      // belt-and-suspenders for property combinations that skip it.
      if (typeof obj.initDimensions === 'function') obj.initDimensions()
      obj.setCoords?.()
    }
    const inner = obj.getObjects ? (obj.getObjects().find((o) => o.type === 'textbox') ?? obj) : obj
    const isText = obj.kind === 'text'
    if (obj.__kind === 'frame') {
      const r = obj.getObjects().find((o) => o.type === 'rect')
      return {
        id: obj.id,
        type: 'frame',
        locked: obj.__locked ? 1 : 0,
        x: obj.left,
        y: obj.top,
        width: Math.round((r?.width || 0) * (obj.scaleX || 1)),
        height: Math.round((r?.height || 0) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: '',
        content: obj.content || '',
        font_size: null,
        z_index: obj.zIndex || 0,
        deleted: 0,
        updated_at: new Date().toISOString(),
        created_at: obj.createdAt || new Date().toISOString(),
      }
    }
    if (obj.__kind === 'shape') {
      // display size = base size × scale, baked in (same pattern as images/text) so a
      // control-resize round-trips and reloads at exactly the size the user left it
      return {
        id: obj.id,
        type: 'shape',
        x: obj.left,
        y: obj.top,
        width: Math.round((obj.width || 0) * (obj.scaleX || 1)),
        height: Math.round((obj.height || 0) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: obj.__shapeColor || '',
        content: obj.content || '',
        font_size: null,
        locked: obj.__locked ? 1 : 0,
        z_index: obj.zIndex || 0,
        deleted: 0,
        updated_at: new Date().toISOString(),
        created_at: obj.createdAt || new Date().toISOString(),
      }
    }
    if (obj.__kind === 'comment') {
      // pins are point elements: x/y anchor them, content is the comment text
      return {
        id: obj.id,
        type: 'comment',
        x: obj.left,
        y: obj.top,
        width: null,
        height: null,
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: '',
        content: obj.content || '',
        font_size: null,
        locked: obj.__locked ? 1 : 0,
        z_index: obj.zIndex || 0,
        deleted: 0,
        updated_at: new Date().toISOString(),
        created_at: obj.createdAt || new Date().toISOString(),
      }
    }
    if (obj.__kind === 'block') {
      // template kind + current size — the grey geometry is rebuilt from these on load.
      // Measure the OUTER RECT child (geometric width), not the group bbox (which includes
      // the 1.5px child strokes and would drift ~+1.5px per save/reload cycle — the same
      // lesson the frame branch already encodes).
      const r = obj.getObjects ? obj.getObjects().find((o) => o.type === 'rect') : null
      return {
        id: obj.id,
        type: 'block',
        x: obj.left,
        y: obj.top,
        width: Math.round((r?.width || obj.width || 0) * (obj.scaleX || 1)),
        height: Math.round((r?.height || obj.height || 0) * (obj.scaleY || 1)),
        angle: Math.round(obj.angle || 0), // 0049: rotation round-trips
        color: '',
        content: obj.content || 'button',
        font_size: null,
        locked: obj.__locked ? 1 : 0,
        z_index: obj.zIndex || 0,
        deleted: 0,
        updated_at: new Date().toISOString(),
        created_at: obj.createdAt || new Date().toISOString(),
      }
    }
    // W2 fix (S29): sticky notes resize by SCALE (group semantics) — bake the display
    // size (base × scale, min 80) into the record like the image/shape branches, so a
    // control-resize round-trips instead of silently reverting on every reload. Text
    // notes are already scale-normalized above (scaleX=1 → the bake is a no-op); paths
    // and arrows stay point-anchored (null dims).
    const isSticky = !isText && obj.__innerText != null
    const bakeDim = (base, scale) =>
      isSticky ? Math.max(80, Math.round((base || 0) * (scale || 1))) : base || null
    return {
      id: obj.id,
      type: obj.__kind === 'arrow' ? 'stroke' : obj.type === 'path' ? 'stroke' : 'note',
      x: obj.left,
      y: obj.top,
      width: obj.type === 'path' || obj.__kind === 'arrow' ? null : bakeDim(obj.width, obj.scaleX),
      height: obj.type === 'path' || obj.__kind === 'arrow' ? null : bakeDim(obj.height, obj.scaleY),
      angle: Math.round(obj.angle || 0), // 0049: rotation round-trips (arrows are rotation-locked, stay 0)
      color: isText ? 'text' : obj.__noteColor || obj.fill || color,
      content: inner.text != null ? inner.text : obj.content || '',
      font_size: isText ? fontSize : null,
      // 0055 (S40): fabric text alignment round-trips; 'left' (the fabric default)
      // stores as NULL so legacy rows and the default case stay byte-identical.
      text_align: isText && obj.textAlign && obj.textAlign !== 'left' ? obj.textAlign : null,
      locked: obj.__locked ? 1 : 0,
      z_index: obj.zIndex || 0,
      deleted: 0,
      updated_at: new Date().toISOString(),
      created_at: obj.createdAt || new Date().toISOString(),
    }
  }

  // ---- rendering ------------------------------------------------------------
  // Arrow outline: a closed 5-point polygon (shaft edges that flare into the head),
  // built from two absolute endpoints + pen width. Returns the absolute-point array.
  // Arrow geometry (2026-08-26 rework): a TRUE arrow marker, not a tapered brush stroke —
  // a constant-width stroked shaft plus a small OPEN chevron (two short segments meeting at
  // the tip), the standard vector marker-end pattern. Returns scene-space points.
  const ARROW_HEAD = 13 // chevron wing length (px)
  const ARROW_SPREAD = 0.46 // wing angle off the shaft (≈26°)
  function arrowGeometry(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1]
    const len = Math.hypot(dx, dy)
    if (!Number.isFinite(len) || len < 8) return null
    const phi = Math.atan2(dy, dx)
    const wing = (phi + Math.PI) // point back along the shaft
    const w1 = [to[0] + Math.cos(wing - ARROW_SPREAD) * ARROW_HEAD, to[1] + Math.sin(wing - ARROW_SPREAD) * ARROW_HEAD]
    const w2 = [to[0] + Math.cos(wing + ARROW_SPREAD) * ARROW_HEAD, to[1] + Math.sin(wing + ARROW_SPREAD) * ARROW_HEAD]
    return { from, to, w1, w2 }
  }

  function makeArrowObject(data) {
    let pts = [], w = 3
    try {
      const parsed = JSON.parse(data.content)
      if (parsed && Array.isArray(parsed.pts)) {
        // normalize {x,y} objects (from an early arrow build) into [x,y] tuples
        w = parsed.w || 3
        pts = parsed.pts
          .map((p) => (Array.isArray(p) ? p : [p?.x, p?.y]))
          .filter((p) => p[0] != null && p[1] != null)
      }
    } catch { /* malformed content — draw nothing */ }
    const geo = arrowGeometry(pts[0] || [0, 0], pts[1] || [10, 0])
    if (!geo) return null
    const all = [geo.from, geo.to, geo.w1, geo.w2]
    const minX = Math.min(...all.map((p) => p[0])), minY = Math.min(...all.map((p) => p[1]))
    // One path draws shaft + chevron: stroked, never filled — thin constant width.
    const path = [
      ['M', geo.from[0] - minX, geo.from[1] - minY],
      ['L', geo.to[0] - minX, geo.to[1] - minY],
      ['M', geo.w1[0] - minX, geo.w1[1] - minY],
      ['L', geo.to[0] - minX, geo.to[1] - minY],
      ['L', geo.w2[0] - minX, geo.w2[1] - minY],
    ]
    const shape = new fabric.Path(path, {
      fill: '', stroke: data.color || '#1c1c1a', strokeWidth: 2,
      strokeLineCap: 'round', strokeLineJoin: 'round', objectCaching: false,
    })
    const group = new fabric.Group([shape], {
      left: data.x ?? minX, top: data.y ?? minY,
      lockScalingX: true, lockScalingY: true, lockRotation: true,
      lockSkewingX: true, lockSkewingY: true,
      hasControls: false,
    })
    group.__kind = 'arrow'
    group.__noteColor = data.color || '#1c1c1a'
    group.content = data.content
    group.__lastLeft = group.left
    group.__lastTop = group.top
    return group
  }

  // live preview while dragging an arrow — same geometry as makeArrowObject, translucent + inert
  function buildArrowPreview(from, to) {
    const geo = arrowGeometry(from, to)
    if (!geo) return null
    const all = [geo.from, geo.to, geo.w1, geo.w2]
    const minX = Math.min(...all.map((p) => p[0])), minY = Math.min(...all.map((p) => p[1]))
    const path = [
      ['M', geo.from[0] - minX, geo.from[1] - minY],
      ['L', geo.to[0] - minX, geo.to[1] - minY],
      ['M', geo.w1[0] - minX, geo.w1[1] - minY],
      ['L', geo.to[0] - minX, geo.to[1] - minY],
      ['L', geo.w2[0] - minX, geo.w2[1] - minY],
    ]
    const shape = new fabric.Path(path, {
      fill: '', stroke: color, strokeWidth: 2, strokeLineCap: 'round', strokeLineJoin: 'round',
      opacity: 0.55, objectCaching: false,
    })
    return new fabric.Group([shape], {
      left: minX, top: minY,
      lockScalingX: true, lockScalingY: true, lockRotation: true,
      lockSkewingX: true, lockSkewingY: true,
      hasControls: false, selectable: false, evented: false,
    })
  }

  // arrows store absolute endpoints in content — when the group moves, re-derive them
  function translateArrow(obj) {
    const dx = obj.left - obj.__lastLeft
    const dy = obj.top - obj.__lastTop
    try {
      const parsed = JSON.parse(obj.content)
      if (Array.isArray(parsed?.pts)) {
        obj.content = JSON.stringify({ k: 'arrow', w: parsed.w || 3, pts: parsed.pts.map((p) => { const [x, y] = Array.isArray(p) ? p : [p?.x, p?.y]; return [x + dx, y + dy] }) })
      }
    } catch { /* malformed content — leave as-is */ }
    obj.__lastLeft = obj.left
    obj.__lastTop = obj.top
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
  // rebuilt on text/style edits). Rebind EVERY horizontal
  // handle (corners + edges) to
  // fabric's own width action (mr's actionHandler: pointer→width, opposite edge pinned
  // via wrapWithFixedAnchor, fires object:resizing), then re-run the wrap on every tick:
  // __fixedWidth ← width, initDimensions() re-wraps (fewer lines as the box widens,
  // taller as it narrows), the height auto-fits and the clipPath re-syncs. Vertical
  // handles go away — the height is content-driven, never hand-set (same contract as
  // typing). Scale stays 1 forever, so objectToData's fontSize/__fixedWidth bake is a
  // no-op and the width round-trips through the record.
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
    // clipPath starts at the min height; initDimensions grows it to the text height.
    obj.clipPath = new fabric.Rect({ left: -w / 2, top: -h / 2, width: w, height: h })
    const base = obj.initDimensions.bind(obj)
    obj.initDimensions = () => {
      // WIDTH-TRANSPARENT (Session 28-R3 resize fix): never write obj.width here — the
      // wrap measures at the LIVE width. v7's Text.set('width') runs initDimensions +
      // setCoords synchronously, so a width-set from a resize handle re-wraps here; an
      // old __fixedWidth re-pin (Session 19) would clobber the new width back and the
      // resize would no-op (changeObjectWidth returns "unchanged"). The pin syncs the
      // OTHER way now: the 'resizing' handler mirrors obj.width into __fixedWidth, and
      // objectToData's multi-select bake applies the baked width explicitly.
      base()
      // Let the HEIGHT auto-fit: Fabric Textbox.height reflects the text block height
      // after base(); use Math.max(minHeight, measured) so the box never shrinks below
      // the user's drawn boundary but grows when content exceeds it.
      obj.height = Math.max(obj.__minHeight, Math.round(obj.height))
      obj.clipPath.set({ left: -obj.width / 2, top: -obj.height / 2, width: obj.width, height: obj.height })
    }
    // Session 28 (user report, canvas board parity with the notebook fix): fit ONCE at
    // construction — a loaded note renders ALL its saved content even when re-measured
    // text is taller than the persisted height (grow-only: max(saved, measured)).
    obj.initDimensions()
    wireTextBoxResize(obj)
    wireTextDir(obj)
    return obj
  }

  // StickyNote — the ONE shared StickyNote factory (Session 28): this component was
  // born HERE (2026-08-25 spec → session-17 square rework) and copied verbatim to the
  // Notebook in "batch s"; the two ~140-line copies had already drifted. The geometry
  // now lives ONCE in public/js/sticky.js — makeStickyNote there owns the wrap-width
  // pinning, the square binary-search sizing, the in-place downward growth, the layered
  // session-17 shadows and objectCaching:false. This wrapper injects this board's only
  // surface difference: the DEFAULT resizable selection chrome (hasControls stays true —
  // the canvas sticky is user-resizable; the notebook pins move-only). The dark-mode × /
  // canonical-pastel refs (__closeBg/__closeX/__lightColor) are set for every board now —
  // unused here (this sheet doesn't CSS-invert), harmless (objectToData ignores them).
  const STICKY_PAPER = window.hibanaSticky.STICKY_PAPER
  function makeStickyNote(opts) {
    return window.hibanaSticky.makeStickyNote({
      ...opts,
      requestRender: () => { if (canvas) canvas.requestRenderAll() },
      wireTextDir,
    })
  }

  // Frame (2026-08-26 user request): a user-drawn region that OWNS what sits on it —
  // moving the frame carries its content, and the text tool only writes on a selected
  // frame. Dashed mid-gray border + a tiny label; subtle fill works on both themes.
  const FRAME_STROKE = '#9b9b97'
  function makeFrameObject(data) {
    const w = Math.max(80, data.width || 300)
    const h = Math.max(60, data.height || 200)
    const rect = new fabric.Rect({
      width: w, height: h,
      fill: 'rgba(155, 155, 151, 0.05)',
      stroke: FRAME_STROKE, strokeWidth: 1.5,
      strokeDashArray: [7, 5],
      rx: 4, ry: 4,
    })
    // Frame names (2026-09-02 request): the frame's label is its NAME — stored on the
    // element's content, editable via dblclick (twin below). Fresh frames show the
    // localized default until the user names them.
    const name = String(data.content || '').trim()
    const label = new fabric.Text(name || _t('canvas.newFrame', 'New frame'), {
      left: 8, top: 6, fontSize: 12,
      fill: FRAME_STROKE, selectable: false, evented: false, fontFamily: 'system-ui, sans-serif',
    })
    // S32 — the frame NAME follows its own script (the general bidi law; the edit twin
    // already did this via wireTextDir — the resting label now matches it).
    const labelDir = textDir(name)
    if (labelDir) label.set('direction', labelDir)
    const group = new fabric.Group([rect, label], { left: data.x, top: data.y })
    group.__kind = 'frame'
    group.__frameLabel = label
    group.content = data.content || ''
    group.__lastLeft = group.left
    group.__lastTop = group.top
    return group
  }

  // ---- squig batch (2026-08-31): shape / comment-pin / wireframe-block factories --------
  // Shapes (user request: "clean shapes matching Hibana, with the existing 7-color palette
  // for stroke + fill"): with a palette swatch picked → solid pastel fill + a ~38%-darker
  // border of the same hue; with no explicit pick → a HOLLOW outline in the theme ink
  // (the squig look, and it restyles when the theme flips because c='' recomputes at render).
  const shapeMeta = (data) => {
    let meta = null
    try { meta = JSON.parse(data.content) } catch { /* legacy/empty → defaults below */ }
    const s = meta && ['rect', 'oval', 'circle'].includes(meta.s) ? meta.s : 'rect'
    const c = typeof meta?.c === 'string' && /^#[0-9a-f]{3,8}$/i.test(meta.c) ? meta.c : ''
    return { s, c: c || (/^#[0-9a-f]{3,8}$/i.test(data.color || '') ? data.color : '') }
  }
  const shadeHex = (hex, k = 0.38) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''))
    if (!m) return hex || '#1c1c1a'
    const n = parseInt(m[1], 16)
    const r = Math.round(((n >> 16) & 255) * (1 - k))
    const g = Math.round(((n >> 8) & 255) * (1 - k))
    const b = Math.round((n & 255) * (1 - k))
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
  }
  function makeShapeObject(data) {
    const { s, c } = shapeMeta(data)
    const w = Math.max(2, data.width || (s === 'circle' ? 110 : 120))
    const h = Math.max(2, data.height || (s === 'circle' ? 110 : s === 'oval' ? 90 : 90))
    const fill = c || 'transparent'
    const stroke = c ? shadeHex(c) : defaultInk()
    const common = {
      left: data.x, top: data.y, fill, stroke, strokeWidth: 2,
      strokeUniform: true, objectCaching: false,
    }
    // Phase 7 item 10: the 64px corners read "too round" (user) — a modern standard
    // 12px keeps a soft-but-square personality; SVG clamps to half the smaller side.
    const obj = s === 'rect'
      ? new fabric.Rect({ ...common, width: w, height: h, rx: 12, ry: 12 })
      : new fabric.Ellipse({ ...common, rx: w / 2, ry: h / 2 })
    obj.__kind = 'shape'
    obj.content = JSON.stringify({ s, c })
    obj.__shapeColor = c
    return obj
  }

  // Comment pins (user request: Figma-style). Private for now, but the record keeps the
  // owner via user_id like every element, so a future shared board can resolve authors.
  // The pin keeps a CONSTANT on-screen size: scale is pinned to 1/zoom (re-synced by
  // syncPinSizes on zoom changes) so it never shrinks away when zoomed out.
  const PIN_R = 13
  const PIN_FILL = '#f97316' // warm Hibana-family orange
  function makeCommentObject(data) {
    const circle = new fabric.Circle({ left: PIN_R, top: PIN_R, radius: PIN_R, originX: 'center', originY: 'center', fill: PIN_FILL, stroke: '#fff', strokeWidth: 2 })
    // speech-bubble glyph (white, ~16×13, centered in the 26px pin)
    const glyph = new fabric.Path('M7 6.5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-6l-3.5 3v-3H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z', {
      left: 13, top: 12.5, originX: 'center', originY: 'center', fill: '#fff', stroke: '', strokeWidth: 0,
    })
    const group = new fabric.Group([circle, glyph], {
      left: data.x, top: data.y,
      hasControls: false, lockScalingX: true, lockScalingY: true, lockRotation: true,
      lockSkewingX: true, lockSkewingY: true, objectCaching: false,
    })
    group.__kind = 'comment'
    group.content = data.content || ''
    if (canvas) group.set({ scaleX: 1 / canvas.getZoom(), scaleY: 1 / canvas.getZoom() })
    return group
  }

  // Lo-fi wireframe blocks (user request: 16 essentials). Every block is a grey
  // geometry-only template rebuilt from (width, height) on each load — nothing but the
  // kind + size persists, so a resized block reloads at exactly the size it was left at.
  // Theme-aware greys (computed like defaultInk): light grey fill + mid-grey stroke.
  const wireKit = () => {
    const dark = themeDark()
    const stroke = dark ? '#a3a39d' : '#8a8a86'
    const fill = dark ? '#31312d' : '#eceae5'
    return {
      r: (x, y, w, h, r = 0) => new fabric.Rect({ left: x, top: y, width: w, height: h, rx: r, ry: r, fill, stroke, strokeWidth: 1.5, strokeUniform: true }),
      l: (x1, y1, x2, y2) => new fabric.Line([x1, y1, x2, y2], { stroke, strokeWidth: 1.5, strokeLineCap: 'round', strokeUniform: true }),
      c: (cx, cy, r) => new fabric.Circle({ left: cx - r, top: cy - r, radius: r, fill, stroke, strokeWidth: 1.5 }),
    }
  }
  const BLOCKS = {
    button: { w: 120, h: 40, build: (W, H, T) => [T.r(0, 0, W, H, 10)] },
    input: { w: 220, h: 40, build: (W, H, T) => [T.r(0, 0, W, H, 6), T.l(10, H / 2, Math.max(24, W * 0.4), H / 2)] },
    textarea: { w: 220, h: 96, build: (W, H, T) => [T.r(0, 0, W, H, 6), T.l(10, 16, W - 10, 16), T.l(10, 32, W - 10, 32), T.l(10, 48, W * 0.55, 48), T.l(10, 64, W * 0.4, 64)] },
    checkbox: { w: 96, h: 24, build: (W, H, T) => [T.r(0, 3, 18, 18, 4), T.l(26, 12, W, 12)] },
    radio: { w: 96, h: 24, build: (W, H, T) => [T.c(9, 12, 9), T.l(26, 12, W, 12)] },
    toggle: { w: 44, h: 24, build: (W, H, T) => [T.r(0, 0, 44, 24, 12), T.c(32, 12, 8)] },
    image: { w: 200, h: 140, build: (W, H, T) => [T.r(0, 0, W, H, 6), T.l(0, 0, W, H), T.l(W, 0, 0, H)] },
    avatar: { w: 48, h: 48, build: (W, H, T) => [T.c(24, 24, 23), T.c(24, 17, 7), T.r(12, 30, 24, 10, 5)] },
    card: { w: 240, h: 170, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.r(10, 10, W - 20, H * 0.48, 4), T.l(10, H * 0.48 + 24, W * 0.62, H * 0.48 + 24), T.l(10, H * 0.48 + 40, W * 0.4, H * 0.48 + 40)] },
    navbar: { w: 400, h: 56, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.c(16, H / 2, 3), T.c(27, H / 2, 3), T.c(38, H / 2, 3), T.l(W - 96, H / 2, W - 56, H / 2), T.r(W - 40, H / 2 - 13, 28, 26, 7)] },
    sidebar: { w: 200, h: 150, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.l(14, 26, W - 14, 26), T.l(14, 58, W - 14, 58), T.l(14, 90, W - 14, 90), T.l(14, 122, W - 40, 122)] },
    hero: { w: 480, h: 240, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.l(W * 0.28, H * 0.32, W * 0.72, H * 0.32), T.l(W * 0.38, H * 0.46, W * 0.62, H * 0.46), T.r(W / 2 - 55, H * 0.62, 110, 34, 8)] },
    twocol: { w: 480, h: 280, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.r(12, 12, (W - 36) / 2, H - 24, 6), T.r(W / 2 + 6, 12, (W - 36) / 2, H - 24, 6)] },
    threecol: { w: 520, h: 280, build: (W, H, T) => [T.r(0, 0, W, H, 8), T.r(12, 12, (W - 48) / 3, H - 24, 6), T.r(W / 3 + 6, 12, (W - 48) / 3, H - 24, 6), T.r((2 * W) / 3, 12, (W - 48) / 3, H - 24, 6)] },
    mobile: { w: 200, h: 400, build: (W, H, T) => [T.r(0, 0, W, H, 24), T.l(W * 0.38, 14, W * 0.62, 14), T.l(W * 0.4, H - 14, W * 0.6, H - 14)] },
    tablerow: { w: 320, h: 92, build: (W, H, T) => [T.r(0, 0, W, 28, 6), T.r(0, 32, W, 28, 6), T.r(0, 64, W, 28, 6), T.l(W / 3, 0, W / 3, H), T.l((2 * W) / 3, 0, (2 * W) / 3, H)] },
  }
  const BLOCK_GROUPS = [
    { key: 'blocks.basics', kinds: ['button', 'input', 'textarea', 'checkbox', 'radio', 'toggle', 'image', 'avatar'] },
    { key: 'blocks.layout', kinds: ['navbar', 'sidebar', 'twocol', 'threecol', 'mobile', 'tablerow'] },
    { key: 'blocks.sections', kinds: ['card', 'hero'] },
  ]
  function makeBlockObject(data) {
    const kind = BLOCKS[data.content] ? data.content : 'button'
    const def = BLOCKS[kind]
    const w = Math.max(24, data.width || def.w)
    const h = Math.max(24, data.height || def.h)
    const group = new fabric.Group(def.build(w, h, wireKit()), { left: data.x, top: data.y, objectCaching: false })
    group.__kind = 'block'
    group.content = kind
    return group
  }

  // ---- snap guides + pink distance labels (Figma behavior, user request) ----------------
  // Drawn as plain fabric objects with NO .id: every existing code path (persistence,
  // eraser, select-all, frame membership, export bounds) keys on .id, so transients are
  // automatically invisible to all of them. Cleared on drop / tool switch / export.
  const addGuide = (o) => {
    o.selectable = false
    o.evented = false
    o.hoverCursor = ''
    canvas.add(o)
    guides.push(o)
  }
  function clearGuides() {
    for (const g of guides) canvas.remove(g)
    guides.length = 0
  }
  function guideLabel(text, cx, cy, zoom = 1) {
    const t = new fabric.Text(String(text), { fontSize: 11, fontWeight: '600', fill: '#fff', fontFamily: 'system-ui, sans-serif' })
    const r = new fabric.Rect({ width: t.width + 10, height: 17, rx: 4, ry: 4, fill: GUIDE_COLOR, originX: 'center', originY: 'center' })
    t.set({ originX: 'center', originY: 'center' })
    const g = new fabric.Group([r, t], { left: cx, top: cy, originX: 'center', originY: 'center', objectCaching: false })
    if (zoom !== 1) g.set({ scaleX: 1 / zoom, scaleY: 1 / zoom }) // constant on-screen size
    return g
  }
  const roundTo = (v, step) => Math.round(v / step) * step

  function makeObject(data) {
    let obj
    if (data.type === 'stroke') {
      let w = 3, points = []
      try {
        const parsed = typeof data.content === 'string' ? JSON.parse(data.content) : null
        if (parsed && !Array.isArray(parsed)) {
          // new format: { w, pts } or { k: 'arrow', w, pts }
          if (parsed.k === 'arrow') return makeArrowObject(data)
          w = parsed.w || 3
          points = Array.isArray(parsed.pts) ? parsed.pts : []
        } else {
          // legacy format: [[x,y], ...]
          points = parsed || []
        }
      } catch { /* malformed content → empty path */ }
      obj = new fabric.Path(pointsToPath(points), {
        left: data.x, top: data.y, fill: '', stroke: data.color || '#1c1c1a', strokeWidth: w, objectCaching: false,
      })
      obj.content = data.content
      obj.__noteColor = data.color || '#1c1c1a' // keep the stroke color on moves (was the live `color` var — clobbered it)
    } else if (data.color === 'text') {
      // Text tool: every text box is a fixed-size wrapping Textbox — a drag defines its size,
      // a click gets a default 240×60 box; text wraps at the edge and clips at the fixed height.
      // 0055 (S40): persisted text alignment rides the saved record (NULL/'left' = default).
      const textOpts = { left: data.x, top: data.y, fontSize: data.font_size || 16, fill: '#1c1c1a', fontFamily: textFont(), fontWeight: textWeight(), textAlign: data.text_align || 'left' }
      obj = makeTextBox(data.width && data.height ? data : { ...data, width: 240, height: 60 }, textOpts)
      obj.kind = 'text'
      obj.content = data.content || ''
    } else if (data.type === 'frame') {
      obj = makeFrameObject(data)
    } else if (data.type === 'shape') {
      obj = makeShapeObject(data)
    } else if (data.type === 'comment') {
      obj = makeCommentObject(data)
    } else if (data.type === 'block') {
      obj = makeBlockObject(data)
    } else {
      // Sticky note: the reusable StickyNote component — the session-17 square paper
      // with the layered directional shadow, default blue selection chrome. The paper
      // color comes from what was saved (or the current pick); the shared pen ink never
      // colors paper. makeStickyNote square-normalizes whatever geometry arrives.
      const noteColor = data.color || (colorPicked ? color : STICKY_PAPER)
      const group = makeStickyNote({
        content: data.content || '', color: noteColor,
        x: data.x, y: data.y, width: data.width || 180, height: data.height || 180,
      })
      group.__noteColor = noteColor
      group.content = data.content
      obj = group
    }
    obj.id = data.id
    obj.zIndex = data.z_index ?? 0
    obj.createdAt = data.created_at
    obj.__locked = !!data.locked // 0024: per-element lock survives save/reload
    // 0049: restore persisted rotation (mtr handle). Arrows stay rotation-locked by
    // design (makeArrowObject sets lockRotation + hasControls:false → angle stays 0).
    if (data.angle) { obj.rotate(data.angle); obj.setCoords?.() }
    applyLock(obj)
    return obj
  }

  // ---- editing twins (sticky-note text + frame names — 2026-09-02 requests) ----------
  // Fabric cannot reliably edit a Text that lives INSIDE a Group: the hidden textarea
  // positions itself off the note and keystrokes stop registering/rendering (the
  // "double-click activates but nothing types" report). Instead of fighting that, a
  // double-click lifts the text into a temporary TOP-LEVEL Textbox twin positioned
  // exactly over the original — Fabric's fully-supported editing path (caret, IME,
  // bidi via wireTextDir, native Ctrl+Z/X/C/V/A through the hidden textarea). Every
  // keystroke mirrors into the hidden original in realtime; on exit the twin commits
  // through the normal save/history path and removes itself.
  let stickyEdit = null // { group, inner, editor } — active sticky-note twin
  let frameNameEdit = null // { frame, label, editor } — active frame-name twin
  let stickyPaletteEl = null // floating recolor palette (wired in init)

  // left/top for an editing twin. THE (t) FIX (2026-09-01, reported twice — "the textarea
  // isn't inside the sticky note, it has an offset"): in this fabric build
  // calcTransformMatrix() maps the host's CENTER-local space to the scene (its
  // translation is getCenterPoint(), see _calcTranslateMatrix in the vendored build), and
  // a group's children left/top live in exactly that space — inner.left/top (origin
  // left/top) IS the inner's top-left corner relative to the host's center. So mapping
  // the child's left/top through the host matrix lands the twin's own top-left exactly on
  // the inner's rendered top-left — exact under rotation + scale + flip, because the twin
  // (top-level, origin left/top, same angle/scale) has its top-left corner AT (left, top)
  // by fabric's origin semantics. The old "same-shape probe" subtraction assumed the
  // matrix translation was the probe's ORIGIN (0,0); it is the probe's CENTER (w/2, h/2),
  // so it shifted every twin up-left by half the inner's size — 90.5×10.67px on a default
  // note, precisely the reported offset (verified numerically on both boards).
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

  function beginStickyTextEdit(group) {
    if (stickyEdit || frameNameEdit || !group || !group.getObjects || group.__locked) return
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
      // wrapping at the SAME width so the caret/line breaks match what the paper shows
      // (on exit the inner text re-wraps there too, so no jarring reflow).
      if (Math.abs((editor.width || 0) - (inner.width || 0)) > 1) {
        editor.set({ width: inner.width })
        if (typeof editor.initDimensions === 'function') editor.initDimensions()
      }
      canvas.requestRenderAll()
    })
    editor.on('editing:exited', () => {
      const se = stickyEdit
      if (!se || se.editor !== editor) return
      stickyEdit = null
      inner.set('text', editor.text || '')
      inner.visible = true
      group.dirty = true
      canvas.remove(editor)
      syncStickyPalette()
      if (objects.has(group.id)) { // × may have tombstoned the note mid-edit
        const before = snapshotOf(group.id)
        const data = objectToData(group)
        group.content = data.content
        if (dataChanged(before, data)) {
          save(data)
          if (before) pushHistory('modify', before) // text edits are undoable
        }
        // reselect the note ONLY when nothing else was just selected (clicking
        // another object or empty canvas while editing must keep that outcome)
        if (canvas.getActiveObject() === editor) canvas.setActiveObject(group)
      } else {
        canvas.discardActiveObject()
      }
      canvas.requestRenderAll()
    })
  }

  function beginFrameNameEdit(frame) {
    if (frameNameEdit || stickyEdit || !frame || !frame.getObjects || frame.__locked) return
    const label = frame.getObjects().find((o) => o.type === 'text')
    if (!label) return
    const editor = makeEditTwin(frame, label, {
      fontSize: label.fontSize || 12,
      fill: label.fill || FRAME_STROKE,
      fontFamily: label.fontFamily || 'system-ui, sans-serif',
      width: Math.max(140, (frame.width || 240) - 16),
      splitByGrapheme: false,
    })
    wireTextDir(editor)
    label.visible = false
    frame.dirty = true
    canvas.add(editor)
    frameNameEdit = { frame, label, editor }
    canvas.setActiveObject(editor)
    editor.enterEditing()
    editor.selectAll() // quick rename — typing replaces the whole name
    canvas.requestRenderAll()
    editor.on('editing:exited', () => {
      const fe = frameNameEdit
      if (!fe || fe.editor !== editor) return
      frameNameEdit = null
      const name = String(editor.text || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
      frame.content = name // frame names persist on the element record's content
      label.set('text', name || _t('canvas.newFrame', 'New frame'))
      // S32 — the renamed label re-resolves its direction from the new text's script.
      const labelDir = textDir(name)
      if (labelDir) label.set('direction', labelDir)
      label.visible = true
      frame.dirty = true
      canvas.remove(editor)
      if (objects.has(frame.id)) {
        const before = snapshotOf(frame.id)
        const data = objectToData(frame)
        frame.content = data.content
        if (dataChanged(before, data)) {
          save(data)
          if (before) pushHistory('modify', before) // renames are undoable
        }
        if (canvas.getActiveObject() === editor) canvas.setActiveObject(frame)
      } else {
        canvas.discardActiveObject()
      }
      canvas.requestRenderAll()
    })
  }

  // ---- sticky-note recolor palette (2026-09-02 request) -------------------------------
  // The app's note colors (dashboard quick-notes yellow + the board pastels). The
  // palette floats ABOVE the selected sticky (Session 28 user request); a click recolors
  // the paper through the normal persist/history path so it survives save/reload + undo.
  const NOTE_COLORS = ['#FFF59D', '#fef08a', '#fbcfe8', '#bbf7d0', '#bfdbfe', '#fed7aa', '#e9d5ff']
  const selectedSticky = () => {
    const a = canvas?.getActiveObject?.()
    return a && a.type === 'group' && a.__close && a.id && !a.__locked && objects.has(a.id) ? a : null
  }
  function syncStickyPalette() {
    if (!stickyPaletteEl || !canvas) return
    const g = stickyEdit ? null : selectedSticky()
    if (!g) { stickyPaletteEl.hidden = true; return }
    // note bbox → screen coords: object matrix then viewport transform (manual math —
    // deterministic across fabric builds), then into #canvas-wrap's coordinate space.
    const m = g.calcTransformMatrix()
    const [va, , , vd, ve, vf] = canvas.viewportTransform
    const hw = (g.width || 0) / 2, hh = (g.height || 0) / 2
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
      const p = fabric.util.transformPoint({ x, y }, m)
      return { x: p.x * va + ve, y: p.y * vd + vf }
    })
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const wrap = stickyPaletteEl.parentElement
    const wr = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 }
    stickyPaletteEl.hidden = false
    const left = Math.min(...xs) - wr.left
    const bottom = Math.max(...ys) - wr.top
    const top = Math.min(...ys) - wr.top
    stickyPaletteEl.style.left = Math.round(Math.max(8, Math.min(left - 4, wr.width - stickyPaletteEl.offsetWidth - 8))) + 'px'
    // Session 28 (user request: "the menu for edit/etc of sticky notes must come top"):
    // the recolor palette rides ABOVE the note like a toolbar pinned to its top edge;
    // it flips BELOW only when the note hugs the wrap's top edge and there is no room.
    stickyPaletteEl.style.top = Math.round(top - stickyPaletteEl.offsetHeight - 8 < 8 ? Math.max(8, bottom + 8) : top - stickyPaletteEl.offsetHeight - 8) + 'px'
    const cur = String(g.__noteColor || '').toLowerCase()
    stickyPaletteEl.querySelectorAll('button[data-note-color]').forEach((b) => {
      b.classList.toggle('active', b.dataset.noteColor.toLowerCase() === cur)
    })
  }
  function recolorSticky(g, c) {
    if (!g || !c || g.__locked) return
    // Session 17: BOTH rects of the layered shadow repaint (the back rect hides behind
    // the paper but must match its fill, or the recolor leaves a stale rim at the edges).
    g.__paper?.set({ fill: c })
    g.__shadowPaper?.set({ fill: c })
    g.__noteColor = c // travels with the record (objectToData reads __noteColor)
    g.dirty = true
    persistActive() // save + undo history — the color survives save/reload
    canvas.requestRenderAll()
    syncStickyPalette()
  }

  // ---- squig batch (2026-08-31): board popovers + comment pin popover + PNG export ------
  // Popover management: blocks / paper / export live inside #canvas-wrap, anchored under
  // their toolbar button; the comment popover anchors to its pin and follows pan/zoom.
  function closeBoardPops() {
    for (const el of [blocksPopEl, paperPopEl, exportPopEl, imagePopEl]) {
      if (el && !el.hidden) el.hidden = true
    }
    closeCommentPop(true) // an open comment always commits its text first
    toolbarEl?.querySelectorAll('button[data-action]').forEach((b) => b.classList.remove('pop-open'))
  }
  function anchorPop(el, btn) {
    if (!el || !btn) return
    const wrap = el.parentElement ? el.parentElement.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth }
    const br = btn.getBoundingClientRect()
    const left = Math.max(8, Math.min(br.left - wrap.left, wrap.width - el.offsetWidth - 8))
    el.style.left = Math.round(left) + 'px'
    el.style.top = Math.round(Math.max(8, br.bottom - wrap.top + 8)) + 'px'
  }
  function togglePop(el, btn, onOpen) {
    if (!el) return
    const willOpen = el.hidden
    closeBoardPops()
    if (!willOpen) return
    onOpen?.()
    el.hidden = false
    anchorPop(el, btn)
    btn?.classList.add('pop-open')
  }

  // Comment pin popover -------------------------------------------------------------
  let suppressPopClick = false // the click that follows the opening mousedown must not close the popover again
  function openCommentPop(pin, isNew) {
    if (!commentPopEl || !commentPopText) return
    if (activeCommentPop && activeCommentPop.obj !== pin) closeCommentPop(true) // commit the previous
    activeCommentPop = { obj: pin, isNew: !!isNew }
    commentPopText.value = pin.content || ''
    commentPopEl.hidden = false
    suppressPopClick = true
    syncCommentPop()
    commentPopText.focus()
  }
  function syncCommentPop() {
    if (!activeCommentPop || !commentPopEl || commentPopEl.hidden) return
    const o = activeCommentPop.obj
    const p = o.getCenterPoint()
    const [a, , , d, e, f] = canvas.viewportTransform
    const wrap = commentPopEl.parentElement.getBoundingClientRect()
    const sx = p.x * a + e - wrap.left
    const sy = p.y * d + f - wrap.top
    const pw = commentPopEl.offsetWidth || 240
    const ph = commentPopEl.offsetHeight || 150
    const left = Math.round(Math.max(8, Math.min(sx - pw / 2, wrap.width - pw - 8)))
    let top = Math.round(sy - 13 - 10 - ph) // above the pin (pin radius stays 13 on screen)
    if (top < 8) top = Math.round(Math.min(sy + 13 + 10, wrap.height - ph - 8)) // no room → below
    commentPopEl.style.left = left + 'px'
    commentPopEl.style.top = Math.max(8, top) + 'px'
  }
  function closeCommentPop(commit = true) {
    if (!activeCommentPop) return
    const { obj, isNew } = activeCommentPop
    activeCommentPop = null
    if (commentPopEl) commentPopEl.hidden = true
    const text = (commentPopText?.value || '').trim()
    if (!commit) return
    if (!text) {
      // empty text: an abandoned NEW pin never existed; an emptied EXISTING pin is deleted
      if (isNew) canvas.remove(obj)
      else if (obj.content) deleteCommentPin(obj)
      return
    }
    if (text === obj.content) return
    if (isNew) {
      const id = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const data = { id, type: 'comment', x: obj.left, y: obj.top, width: null, height: null, color: '', content: text, z_index: 0, deleted: 0, created_at: nowIso, updated_at: nowIso }
      obj.id = id
      obj.zIndex = 0
      obj.createdAt = nowIso
      obj.content = text
      delete obj.__temp
      objects.set(id, obj)
      elems.set(id, data)
      save(data)
      pushHistory('add', data)
      canvas.requestRenderAll()
    } else if (obj.id && objects.has(obj.id)) {
      const before = snapshotOf(obj.id)
      obj.content = text
      const data = objectToData(obj)
      if (dataChanged(before, data)) {
        save(data)
        if (before) pushHistory('modify', before)
      }
    }
  }
  function deleteCommentPin(pin) {
    if (!pin) return
    if (pin.__temp || !pin.id || !objects.has(pin.id)) { canvas.remove(pin); canvas.requestRenderAll(); return }
    const data = elems.get(pin.id)
    removeObject(pin.id)
    if (data) {
      save({ ...data, deleted: 1, updated_at: new Date().toISOString() }, 'delete')
      pushHistory('erase', data)
    }
  }

  // Wireframe blocks popover ---------------------------------------------------------
  function buildBlocksPop() {
    if (!blocksPopEl) return
    blocksPopEl.innerHTML = ''
    for (const grp of BLOCK_GROUPS) {
      const title = document.createElement('div')
      title.className = 'pop-group-title'
      title.textContent = _t(grp.key, grp.key)
      blocksPopEl.appendChild(title)
      const grid = document.createElement('div')
      grid.className = 'blocks-grid'
      for (const kind of grp.kinds) {
        const b = document.createElement('button')
        b.type = 'button'
        b.dataset.block = kind
        b.textContent = _t(`block.${kind}`, kind)
        grid.appendChild(b)
      }
      blocksPopEl.appendChild(grid)
    }
    blocksPopEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-block]')
      if (btn) placeBlock(btn.dataset.block)
    })
  }
  function placeBlock(kind) {
    const def = BLOCKS[kind]
    if (!def || !canvas) return
    const c = canvas.getViewportCenter ? canvas.getViewportCenter() : { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }
    const off = (blockPlaceCount++ % 5) * 24 // cascade so rapid placements don't stack
    const id = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const data = {
      id, type: 'block',
      x: snapEnabled ? roundTo(c.x - def.w / 2 + off, GRID_PX) : c.x - def.w / 2 + off,
      y: snapEnabled ? roundTo(c.y - def.h / 2 + off * 0.6, GRID_PX) : c.y - def.h / 2 + off * 0.6,
      width: def.w, height: def.h, color: '', content: kind,
      z_index: 0, deleted: 0, created_at: nowIso, updated_at: nowIso,
    }
    elems.set(id, data)
    const obj = makeObject(data)
    objects.set(id, obj)
    canvas.add(obj)
    save(data)
    pushHistory('add', data)
    canvas.setActiveObject(obj)
    canvas.requestRenderAll()
    window.hibana?.toast(_t('canvas.blockPlaced', 'Placed — drag to arrange'), 'info', 1400)
  }

  // Paper picker ----------------------------------------------------------------------
  function applyPaper() {
    const wrap = document.getElementById('canvas-wrap')
    if (wrap) {
      wrap.classList.remove('paper-white', 'paper-checkered', 'paper-shaded', 'dots-off')
      if (paperMode !== 'plain') wrap.classList.add(`paper-${paperMode}`)
      if (!dotsOn) wrap.classList.add('dots-off')
    }
    if (paperPopEl) {
      paperPopEl.querySelectorAll('button[data-paper]').forEach((b) => b.classList.toggle('active', b.dataset.paper === paperMode))
      const dots = paperPopEl.querySelector('[data-dots-toggle]')
      if (dots) dots.checked = dotsOn
      const snap = paperPopEl.querySelector('[data-snap-toggle]')
      if (snap) snap.checked = snapEnabled
    }
  }

  // PNG export -------------------------------------------------------------------------
  const paperBaseColor = () => {
    const el = canvas?.lowerCanvasEl
    if (!el) return '#ffffff'
    return getComputedStyle(el).backgroundColor || '#ffffff'
  }
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
  // Export at a deterministic 2× SCENE resolution: temporarily pin the viewport to
  // identity (so the crop math is scene-space 1:1), reset pin scales to 1, hide the
  // decorative lock badges + any live guides, and paint the paper's base color behind
  // everything. Restore it all afterwards.
  function regionDataUrl(bounds, pad = 24) {
    const prevVpt = canvas.viewportTransform.slice()
    const pins = canvas.getObjects().filter((o) => o.__kind === 'comment')
    const prevPin = pins.map((o) => ({ o, x: o.scaleX, y: o.scaleY }))
    const badges = [...lockBadges.values()]
    const prevBadgeVis = badges.map((o) => o.visible)
    const prevBg = canvas.backgroundColor
    clearGuides()
    for (const o of pins) o.set({ scaleX: 1, scaleY: 1 })
    for (const o of badges) o.set({ visible: false })
    canvas.backgroundColor = paperBaseColor()
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    try {
      return canvas.toDataURL({
        format: 'png', multiplier: 2, enableRetinaScaling: false,
        left: bounds.left - pad, top: bounds.top - pad,
        width: bounds.width + pad * 2, height: bounds.height + pad * 2,
      })
    } finally {
      canvas.setViewportTransform(prevVpt)
      canvas.backgroundColor = prevBg
      for (const p of prevPin) p.o.set({ scaleX: p.x, scaleY: p.y })
      badges.forEach((o, i) => o.set({ visible: prevBadgeVis[i] }))
      canvas.requestRenderAll()
    }
  }
  function exportTaintError(err) {
    // (k) A non-CORS image (the loader's fallback path flags it __tainted) makes the
    // canvas TAINTED — toDataURL throws SecurityError. Point at the real cause
    // instead of a generic failure so the user knows which link is the blocker.
    if (err && (err.name === 'SecurityError' || /tainted/i.test(String(err?.message || '')))) {
      const t = canvas.getObjects().filter((o) => o.__tainted).length
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
  // Session 28: clipboard copy — same normalization + crop as the download, then the
  // blob rides navigator.clipboard.write (paste straight into Telegram/Slack/docs).
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
    // Session 28 polish: leading icon per action (download vs clipboard) — same markup the
    // notebook's export rows use (export-main + export-ic, styled in canvas.css).
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
    mkRow(_t('canvas.exportFull', 'Whole board'), `${Math.round(full.width)}×${Math.round(full.height)}`, () => {
      exportPopEl.hidden = true
      exportRegionPng(full, `hibana-canvas-${exportStamp()}.png`, 40)
    })
    const sel = canvas.getActiveObjects().filter((o) => o.id)
    if (sel.length) {
      const sb = unionBounds(sel)
      mkRow(`${_t('canvas.exportSel', 'Selection')} (${sel.length})`, `${Math.round(sb.width)}×${Math.round(sb.height)}`, () => {
        exportPopEl.hidden = true
        exportRegionPng(sb, `hibana-selection-${exportStamp()}.png`)
      })
    }
    for (const f of objects.values()) {
      if (f.__kind !== 'frame') continue
      const fb = f.getBoundingRect(true)
      const name = String(f.content || '').trim().slice(0, 28) || _t('canvas.frameWord', 'Frame')
      mkRow(`${_t('canvas.exportFrame', 'Frame')}: ${name}`, `${Math.round(fb.width)}×${Math.round(fb.height)}`, () => {
        exportPopEl.hidden = true
        exportRegionPng(fb, `hibana-frame-${exportStamp()}.png`, 0) // the frame IS the bounds
      })
    }
    // Session 28: clipboard copy — targets the selection when one exists, else the whole
    // board (paste straight into Telegram/Slack/docs without a download round-trip).
    const clipBounds = sel.length ? unionBounds(sel) : full
    mkRow(
      _t('canvas.copyPng', 'Copy PNG to clipboard'),
      sel.length ? `${sel.length}` : _t('canvas.exportFull', 'Whole board'),
      () => { exportPopEl.hidden = true; void copyRegionPng(clipBounds) },
      'copy',
    )
  }

  function pointsToPath(points) {
    if (!points.length || typeof points[0] === 'number') return '' // already an SVG path string if not parsed as array of points
    let d = `M ${points[0][0]} ${points[0][1]}`
    for (const [x, y] of points.slice(1)) d += ` L ${x} ${y}`
    return d
  }

  function putObject(data) {
    if (!data || data.deleted) return // deleted records never render (guard for every caller)
    if (objects.has(data.id)) return
    if (data.type === 'image') return loadImageObject(data) // async — renders once the URL loads
    const obj = makeObject(data)
    objects.set(data.id, obj)
    canvas.add(obj)
    // Comment pins float ABOVE all content (Figma behavior): a pin buried under a later
    // block/wireframe would be unreachable; annotations always read on top.
    if (data.type === 'comment') canvas.bringToFront(obj)
  }

  function removeObject(id) {
    const obj = objects.get(id)
    if (obj) {
      markingDelete = true
      // If the deleted object is (part of) the active selection, drop the selection FIRST —
      // otherwise Fabric's outline/handles linger on screen until the next render (the
      // "skeleton" that used to stick around 1-2s until the queue-flush refetch).
      const active = canvas.getActiveObject()
      if (active && (active === obj || active.getObjects?.().includes(obj))) canvas.discardActiveObject()
      canvas.remove(obj)
      objects.delete(id)
      markingDelete = false
      canvas.requestRenderAll() // vanish NOW — no fade, no waiting for the refetch (2026-08-26)
    }
  }

  // ---- image elements (placed from a URL — spec follow-up) --------------------
  // (k) 2026-09-06: CORS-first loading. An anonymous-CORS load keeps the canvas
  // UNTAINTED — PNG export (canvas.toDataURL) keeps working — but only hosts that send
  // Access-Control-Allow-Origin succeed. Every other host falls back to a plain
  // (display-only) load: the picture renders fine, we just flag the object __tainted so
  // the export path can explain precisely WHY a PNG download failed instead of a
  // generic "Export failed". Without this, loading with crossOrigin always (or never)
  // would break either display or export for entire classes of image hosts.
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

  // A fabric image with rounded corners. The frame box (width × height, what the resize
  // handles wrap) holds the picture contain-fit — object-fit: contain — so the WHOLE image
  // is always visible and centered, whatever the box's aspect vs the picture's. The contain
  // math runs at draw time off the live width/height × scale, so resizing the frame
  // re-fits the picture immediately (uniform or side handles — never a stretch). The
  // clipPath is the centered frame rect (rounded), keeping the letterbox area clean.
  function buildImageObject(raw, opts = {}) {
    const boxW = opts.width || raw.width
    const boxH = opts.height || raw.height
    const obj = new fabric.Image(raw, { left: opts.left ?? 0, top: opts.top ?? 0, width: boxW, height: boxH })
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
    obj.clipPath = new fabric.Rect({ left: -boxW / 2, top: -boxH / 2, width: boxW, height: boxH, rx: IMG_RADIUS, ry: IMG_RADIUS })
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
      obj.__tainted = !!raw.__noCors // display-only: a non-CORS host taints the canvas
      // 0049: restore persisted rotation on the async image load path (makeObject's
      // rotate only covers the synchronous branches — images land here).
      if (data.angle) { obj.rotate(data.angle); obj.setCoords() }
      objects.set(data.id, obj)
      canvas.add(obj)
      canvas.requestRenderAll()
    } catch { /* a broken image link just doesn't render */ }
  }

  // (k) 2026-09-06: image popover (replaces the old prompt()). The toolbar image button
  // opens [data-image-pop]; the URL input + Add place the picture at the viewport
  // center. Inline error keeps the popover open on a bad link so the URL stays editable.
  let imagePopEl = null
  function setImageError(msg) {
    const errEl = imagePopEl?.querySelector('[data-image-error]')
    if (!errEl) return
    if (msg) { errEl.textContent = msg; errEl.hidden = false }
    else errEl.hidden = true
  }
  async function placeImageFromPop() {
    const input = imagePopEl?.querySelector('[data-image-url]')
    const addBtn = imagePopEl?.querySelector('[data-image-add]')
    if (!input) return
    const url = (input.value || '').trim()
    // Same-origin picture paths (/icons/x.png) stay legal; external must be http(s).
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) {
      setImageError(_t('canvas.imageBadUrl', 'Paste a direct picture link starting with https://'))
      input.focus()
      return
    }
    setImageError('')
    if (input) input.disabled = true
    if (addBtn) addBtn.disabled = true
    try {
      const raw = await loadRemoteImage(url)
      const maxDim = 480 // board-sized; never upscale a small image
      const scale = Math.min(1, maxDim / Math.max(raw.width, raw.height))
      const width = Math.max(1, Math.round(raw.width * scale))
      const height = Math.max(1, Math.round(raw.height * scale))
      const c = canvas.getViewportCenter ? canvas.getViewportCenter() : { x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }
      const obj = buildImageObject(raw, { left: c.x - width / 2, top: c.y - height / 2, width, height })
      const id = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const data = { id, type: 'image', x: obj.left, y: obj.top, width, height, color: '', content: url, z_index: 0, deleted: 0, created_at: nowIso, updated_at: nowIso }
      obj.id = id
      obj.zIndex = 0
      obj.createdAt = nowIso
      obj.content = url
      obj.__tainted = !!raw.__noCors
      objects.set(id, obj)
      elems.set(id, data)
      canvas.add(obj)
      save(data)
      pushHistory('add', data)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
      if (imagePopEl) imagePopEl.hidden = true
      input.value = ''
      setActiveTool('select') // settle back to move-resize so the picture can be dragged
      if (obj.__tainted) {
        // Placed, but this host doesn't send CORS headers — the board now renders it,
        // yet a PNG export will be blocked by the browser. Say so once, up front.
        window.hibana?.toast(_t('canvas.imageNoCors', 'Image placed — it displays, but a host without CORS blocks PNG export'), 'info', 3600)
      }
    } catch (err) {
      setImageError(_t('canvas.imageFailed', "Couldn't load that image — check the link"))
      input.focus()
      input.select()
    } finally {
      if (input) input.disabled = false
      if (addBtn) addBtn.disabled = false
    }
  }

  // Switch the active tool + toolbar highlight (shared by the toolbar buttons and by actions
  // like add-image that settle back to select).
  function setActiveTool(name) {
    cancelDrafts()
    mode = name
    canvas.isDrawingMode = name === 'pen' && !isTouch()
    if (name === 'pen' && !isTouch()) {
      // 2026-09-12 pen fix: Fabric v6+ no longer auto-creates a PencilBrush on the canvas —
      // without this the width/color assignments below threw on undefined (since the fabric
      // v6/v7 security upgrade) and every pen stroke silently drew nothing.
      if (!canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas)
      canvas.freeDrawingBrush.width = penWidth
      // The brush must draw the SELECTED color — previously the brush used Fabric's default
      // black while strokes were saved with the palette (yellow) color, so drawings came
      // back recolored on reload. Brush color and saved color must stay the same (user bug).
      canvas.freeDrawingBrush.color = color
    }
    canvas.selection = name === 'select' || name === 'pan' || name === 'note'
    // crosshair-family tools grab the whole gesture (no rubber-band, no target finding):
    // arrow/shape/comment draws must work over frames and other objects alike
    const crosshair = name === 'arrow' || name === 'frame' || name === 'rect' || name === 'oval' || name === 'circle' || name === 'comment'
    canvas.skipTargetFind = crosshair
    canvas.defaultCursor = name === 'pan' ? 'grab' : name === 'eraser' ? 'cell' : name === 'text' ? 'text' : crosshair ? 'crosshair' : 'default'
    if (toolbarEl) {
      toolbarEl.querySelectorAll('[data-tool]').forEach((x) => {
        x.classList.toggle('active', x.dataset.tool === name)
        x.classList.toggle('arrow-on', x.dataset.tool === name && name === 'arrow')
      })
    }
    syncTextProps()
  }

  // ---- viewport loading (spec §3.5 — never load the whole canvas lazily) ----
  function visibleBBox() {
    const t = canvas.viewportTransform
    const iw = canvas.getWidth() / t[0]
    const ih = canvas.getHeight() / t[3]
    const x0 = -t[4] / t[0]
    const y0 = -t[5] / t[3]
    return { minX: x0, maxX: x0 + iw, minY: y0, maxY: y0 + ih }
  }

  const loadChunk = debounce(async () => {
    const b = visibleBBox()
    const key = `${Math.round(b.minX / 400)},${Math.round(b.minY / 400)}`
    if (pendingFetch.has(key)) return
    pendingFetch.add(key)
    try {
      const q = new URLSearchParams({ minX: b.minX - 200, maxX: b.maxX + 200, minY: b.minY - 200, maxY: b.maxY + 200 }).toString()
      const res = await send(`/api/canvas?${q}`)
      if (!res.ok) return
      const { elements } = await res.json()
      for (const e of elements) {
        // Two guards against resurrecting a deleted element (delete bug 2026-08-24):
        // 1. the server snapshot may predate the still-queued tombstone (the delete render
        //    triggers a refetch before the 1.5s flush) — never re-add a deleted record;
        // 2. client-side LWW: never let an older server row overwrite a newer local one
        //    (a tombstone or edit enqueued after this snapshot was taken).
        if (e.deleted) continue
        const local = elems.get(e.id)
        if (local && local.updated_at > e.updated_at) continue
        elems.set(e.id, e)
        putObject(e)
      }
      // comment pins float above ALL content (Figma behavior) — re-float them after each
      // batch, since pins added early in the batch would otherwise end up under later blocks
      for (const o of objects.values()) {
        if (o.__kind === 'comment') canvas.bringToFront(o)
      }
      // the boundless board is empty until the first chunk lands — drop the loading pill
      const pill = document.querySelector('[data-board-loading]')
      if (pill) pill.remove()
    } finally {
      pendingFetch.delete(key)
    }
  }, 300)

  function debounce(fn, ms) {
    let t
    return (...args) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...args), ms)
    }
  }

  // ---- init -----------------------------------------------------------------
  async function init(selector, ui) {
    // Resolve the canvas host element before constructing Fabric: passing a '#id' string is a
    // silent no-op in some published Fabric builds (cdnjs mislabels 5.1.0 as 5.3.0), so we
    // always hand Fabric the real DOM element (works in every 5.x).
    const host = typeof selector === 'string' ? document.querySelector(selector) : selector
    // S43 (mobile audit): Fabric sizes its wrapper from the host's width/height
    // ATTRIBUTES (the markup ships 1200×800) — NOT the CSS box (#board is
    // inset:0/100% of #canvas-wrap). On a 390px phone the wrapper was born 1200px
    // wide, the document overflowed, and mobile Chrome expanded the layout viewport
    // (auto-fit) — which POISONS window.innerWidth (it reported 1200, so the resize
    // listener below then baked the poison in at 1200×2501: an unusable zoomed-out
    // board). Sync the attributes to the real layout box FIRST so Fabric is born
    // viewport-sized; the listener below then measures the WRAP (never innerWidth).
    if (host) {
      const hostBox = host.getBoundingClientRect()
      if (hostBox.width > 1 && hostBox.height > 1) {
        host.width = Math.max(1, Math.round(hostBox.width))
        host.height = Math.max(1, Math.round(hostBox.height))
      }
    }
    canvas = new fabric.Canvas(host, { preserveObjectStacking: true })

    // Font-metrics race (wrap-bug fix 2026-08-25): Fabric measures text with the fallback
    // font when an object exists before the webfont finishes loading, and caches those
    // widths internally forever — every later wrap decision and caret position is then
    // computed from metrics that don't match the rendered glyphs (measured live: the cache
    // held "times new roman" widths while Bebas Notes rendered).
    // When fonts land — initial load or any later face — drop the cache and re-measure
    // every text object once. Textboxes with a pinned-width initDimensions override
    // re-wrap correctly because the pin re-applies after the base re-measure.
    // L14 fix (2026-09-10): fabric v6 removed charWidthsCache — the cache is now internal
    // to the FabricObject/Textbox class. Clearing it requires calling the internal method.
    // Best-effort: if the v5 API exists, use it; otherwise skip (v6 handles this internally).
    const reflowTextMetrics = () => {
      // v5: fabric.charWidthsCache = {};  v6: no-op (internal cache, handled per-object)
      if (window.fabric?.charWidthsCache !== undefined) window.fabric.charWidthsCache = {}
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

    // initial load: just the visible viewport
    await loadChunk()
    // Session 28 (cropped-notes fix, canvas parity): cached fonts resolve fonts.ready
    // BEFORE loadChunk() puts elements on the canvas — the reflow pass then saw nothing.
    // Re-run it now that the first chunk exists (idempotent, grow-only heights).
    reflowTextMetrics()

    // pan: space-drag (Figma-style, user request), middle-drag, or the pan tool
    canvas.on('mouse:down', (e) => {
      const ev = e.e
      canvas.isDragging = ev.buttons === 4 || ev.spaceKey || mode === 'pan'
      if (canvas.isDragging) {
        canvas.selection = false
        canvas.lastPosX = ev.clientX
        canvas.lastPosY = ev.clientY
        canvas.upperCanvasEl.style.cursor = 'grabbing'
      }
    })
    canvas.on('mouse:move', (e) => {
      if (canvas.isDragging) {
        const vpt = canvas.viewportTransform
        vpt[4] += e.e.clientX - canvas.lastPosX
        vpt[5] += e.e.clientY - canvas.lastPosY
        canvas.requestRenderAll()
        canvas.lastPosX = e.e.clientX
        canvas.lastPosY = e.e.clientY
      }
    })
    canvas.on('mouse:up', () => {
      canvas.isDragging = false
      canvas.selection = true
      canvas.upperCanvasEl.style.cursor = spaceHeld ? 'grab' : ''
    })

    // Space held = grab anywhere on the canvas; the capture-phase mousedown marks the native
    // event with spaceKey BEFORE Fabric's own mouse:down listener runs, so the pan branch
    // above fires from any tool. Skip inputs/selects/dialogs so Space keeps its native role
    // there (typing, pickers).
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat) return
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t && t.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      spaceHeld = true
      e.preventDefault() // no page scroll, no focused-button activation while grabbing
      if (canvas) canvas.upperCanvasEl.style.cursor = 'grab'
    }, true)
    document.addEventListener('keyup', (e) => {
      if (e.code !== 'Space') return
      spaceHeld = false
      if (canvas && !canvas.isDragging) canvas.upperCanvasEl.style.cursor = ''
    }, true)
    document.addEventListener('mousedown', (e) => {
      if (!spaceHeld || e.button !== 0) return
      if (!(e.target instanceof Element) || !e.target.closest('canvas')) return
      e.spaceKey = true // consumed by the mouse:down handler above
    }, true)

    // zoom via wheel; viewport change → load nearby elements
    canvas.on('mouse:wheel', (e) => {
      e.e.preventDefault()
      const delta = e.e.deltaY > 0 ? 0.9 : 1.1
      const pt = { x: e.e.offsetX, y: e.e.offsetY }
      canvas.zoomToPoint(pt, canvas.getZoom() * delta)
      loadChunk()
    })

    // Dot grid stays glued to the canvas: re-derive the CSS tile size/offset from the
    // viewport transform on every render, so zooming/panning moves the dots with the
    // content instead of leaving a disconnected static pattern behind (2026-08-26).
    // 2026-08-30: single uniform dot layer at 28 scene-px pitch (user's reference
    // screenshot — no major/minor hierarchy anymore).
    // 2026-09-02 (reported twice): the old sibling .canvas-dots div sat UNDER the fabric
    // container and users kept seeing a flat grey board. The pattern now lives ON the
    // fabric lower canvas itself (app.css `#canvas-wrap .lower-canvas`) — the exact
    // surface every element draws over, so nothing can ever cover it.
    const dotsEl = canvas.lowerCanvasEl
    const updateDots = () => {
      if (!dotsEl) return
      const [a, , , , e, f] = canvas.viewportTransform
      const size = 28 * a // uniform tile at 28 scene-px spacing
      dotsEl.style.backgroundSize = `${size}px ${size}px`
      dotsEl.style.backgroundPosition = `${e}px ${f}px`
    }
    // ---- squig batch (2026-08-31): Figma alignment + 10px grid snap + pink distance labels ----
    // Registered BEFORE the frame-drag handler below ON PURPOSE: frame members are
    // repositioned absolutely (origin + current frame delta) on every object:moving, so
    // snapping the frame's position FIRST means members always land on the snapped spot.
    const movingMembers = (obj) => (obj && obj.type === 'activeSelection' && obj.getObjects ? obj.getObjects() : [obj])
    const snapTargets = (obj) => {
      const skip = new Set(movingMembers(obj))
      return canvas.getObjects().filter((o) => o.id && !skip.has(o))
    }
    // geometry box WITHOUT the stroke — the "exactly 10px between rectangles" story must
    // hold on the shape EDGES (a 2px stroke would otherwise read the gap as 8). Rotated
    // objects fall back to the stroke-inclusive bounding rect (rotation makes the cheap
    // path wrong; the ±1px stroke tolerance is fine there).
    const boxOf = (o) => {
      if (!o.angle) return { left: o.left, top: o.top, width: (o.width || 0) * (o.scaleX || 1), height: (o.height || 0) * (o.scaleY || 1) }
      return o.getBoundingRect(true)
    }
    const applyMoveSnap = (e) => {
      const obj = e.target
      if (!obj || obj.__locked || canvas.isDragging) return
      if (obj.__kind === 'comment') return // pins are annotations — never snapped or measured (Figma behavior)
      clearGuides()
      const zoom = canvas.getZoom() || 1
      const threshold = 6 / zoom // ~6 SCREEN px, whatever the zoom
      const others = snapTargets(obj)
      // all math in SCENE space: boxOf() ignores the viewport transform (same contract
      // the frame-drag membership test relies on), so deltas apply 1:1 to obj.left/top
      // and guides/labels land where the elements actually are.
      const b = boxOf(obj)
      // X axis: alignment (left/center/right vs every other element's) beats grid snap
      let bestX = null
      let bestY = null
      for (const o of others) {
        const ob = boxOf(o)
        const xs1 = [b.left, b.left + b.width / 2, b.left + b.width]
        const xs2 = [ob.left, ob.left + ob.width / 2, ob.left + ob.width]
        const ys1 = [b.top, b.top + b.height / 2, b.top + b.height]
        const ys2 = [ob.top, ob.top + ob.height / 2, ob.top + ob.height]
        for (const mv of xs1) for (const tv of xs2) {
          const d = tv - mv
          if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.delta))) {
            bestX = { delta: d, at: tv, y0: Math.min(b.top, ob.top), y1: Math.max(b.top + b.height, ob.top + ob.height) }
          }
        }
        for (const mv of ys1) for (const tv of ys2) {
          const d = tv - mv
          if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.delta))) {
            bestY = { delta: d, at: tv, x0: Math.min(b.left, ob.left), x1: Math.max(b.left + b.width, ob.left + ob.width) }
          }
        }
      }
      if (bestX) obj.set({ left: obj.left + bestX.delta })
      else if (snapEnabled) {
        const t = roundTo(b.left, GRID_PX)
        obj.set({ left: obj.left + (t - b.left) })
      }
      if (bestY) obj.set({ top: obj.top + bestY.delta })
      else if (snapEnabled) {
        const t = roundTo(b.top, GRID_PX)
        obj.set({ top: obj.top + (t - b.top) })
      }
      obj.setCoords()
      const b2 = boxOf(obj)
      // alignment guides (Figma pink, dashed) spanning the two aligned objects;
      // strokeUniform + label scale 1/zoom keep everything at a constant SCREEN weight
      if (bestX) addGuide(new fabric.Line([bestX.at, bestX.y0, bestX.at, bestX.y1], { stroke: GUIDE_COLOR, strokeWidth: 1, strokeDashArray: [4, 4], strokeUniform: true, objectCaching: false }))
      if (bestY) addGuide(new fabric.Line([bestY.x0, bestY.at, bestY.x1, bestY.at], { stroke: GUIDE_COLOR, strokeWidth: 1, strokeDashArray: [4, 4], strokeUniform: true, objectCaching: false }))
      // distance labels to the nearest neighbor on each side (only with real overlap)
      const drawGap = (gap, ax, bx, cy, horizontal) => {
        if (gap == null || gap < 0 || gap > 300) return
        const mid = (ax + bx) / 2
        if (horizontal) {
          addGuide(new fabric.Line([ax, cy, bx, cy], { stroke: GUIDE_COLOR, strokeWidth: 1, strokeUniform: true, objectCaching: false }))
          addGuide(guideLabel(Math.round(gap), mid, cy, zoom))
        } else {
          addGuide(new fabric.Line([cy, ax, cy, bx], { stroke: GUIDE_COLOR, strokeWidth: 1, strokeUniform: true, objectCaching: false }))
          addGuide(guideLabel(Math.round(gap), cy, mid, zoom))
        }
      }
      let L = null, R = null, T = null, Bt = null
      for (const o of others) {
        const ob = boxOf(o)
        const vOverlap = ob.top < b2.top + b2.height && ob.top + ob.height > b2.top
        const hOverlap = ob.left < b2.left + b2.width && ob.left + ob.width > b2.left
        if (vOverlap) {
          const gr = ob.left - (b2.left + b2.width) // gap to the right neighbor
          if (gr >= 0 && (!R || gr < R.g)) R = { g: gr, edge: ob.left }
          const gl = b2.left - (ob.left + ob.width) // gap to the left neighbor
          if (gl >= 0 && (!L || gl < L.g)) L = { g: gl, edge: ob.left + ob.width }
        }
        if (hOverlap) {
          const gb = ob.top - (b2.top + b2.height)
          if (gb >= 0 && (!Bt || gb < Bt.g)) Bt = { g: gb, edge: ob.top }
          const gt = b2.top - (ob.top + ob.height)
          if (gt >= 0 && (!T || gt < T.g)) T = { g: gt, edge: ob.top + ob.height }
        }
      }
      if (R) drawGap(R.g, b2.left + b2.width, R.edge, b2.top + b2.height / 2, true)
      if (L) drawGap(L.g, L.edge, b2.left, b2.top + b2.height / 2, true)
      if (Bt) drawGap(Bt.g, b2.top + b2.height, Bt.edge, b2.left + b2.width / 2, false)
      if (T) drawGap(T.g, T.edge, b2.top, b2.left + b2.width / 2, false)
      canvas.requestRenderAll()
    }
    canvas.on('object:moving', applyMoveSnap)
    // resize snap: sizes land on 10px multiples while scaling (wireframe-friendly)
    canvas.on('object:scaling', (e) => {
      if (!snapEnabled) return
      const obj = e.target
      if (!obj || obj.__locked) return
      const w = (obj.width || 0) * (obj.scaleX || 1)
      const h = (obj.height || 0) * (obj.scaleY || 1)
      if (obj.width && w > 20) obj.set({ scaleX: Math.max(0.02, roundTo(w, GRID_PX) / obj.width) })
      if (obj.height && h > 20) obj.set({ scaleY: Math.max(0.02, roundTo(h, GRID_PX) / obj.height) })
    })
    canvas.on('object:modified', clearGuides) // guides + labels vanish on drop

    // pins keep a constant ON-SCREEN size: rescale 1/zoom whenever the zoom changes
    const syncPinSizes = () => {
      const z = canvas.getZoom() || 1
      if (z === lastPinZoom) return
      lastPinZoom = z
      for (const o of objects.values()) {
        if (o.__kind === 'comment') o.set({ scaleX: 1 / z, scaleY: 1 / z })
      }
    }

    canvas.on('after:render', () => { loadChunk(); updateDots(); syncLockBadges(); syncStickyPalette(); syncPinSizes(); syncCommentPop() })

    // Session 19: toggle the empty-canvas hint. `after:render` fires on every change
    // (add/remove/clear/modify), so this is the one reliable hook to keep the hint in
    // sync with canvas.getObjects().length. Excludes the transient lock-badge helpers.
    canvas.on('after:render', () => {
      const wrap = document.getElementById('canvas-wrap')
      if (!wrap) return
      const realObjects = canvas.getObjects().filter((o) => !o.__isLockBadge && !o.__isGuide)
      wrap.classList.toggle('has-content', realObjects.length > 0)
    })

    // autosave events
    canvas.on('path:created', (e) => {
      const path = e.path
      const b = path.getBoundingRect()
      const strokeColor = path.stroke || color // the color the pen actually drew (== the brush color)
      const data = {
        id: crypto.randomUUID(),
        type: 'stroke',
        x: b.left, y: b.top, width: null, height: null,
        color: strokeColor, content: serializePath(path, penWidth),
        z_index: 0, deleted: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      path.id = data.id
      path.content = data.content // keep the width+points on later moves
      path.__noteColor = strokeColor // persist the actual drawn color on moves (was the live `color` var)
      path.set({ left: b.left, top: b.top }).setCoords()
      objects.set(data.id, path)
      elems.set(data.id, data)
      save(data)
      pushHistory('add', data)
    })

    canvas.on('object:modified', persistDebounced) // debounced during continuous drag (spec §3.3)

    // arrow tool: drag from start to end → a filled arrow with a head (flows/diagrams)
    canvas.on('mouse:down', (e) => {
      if (mode !== 'arrow' || canvas.isDragging) return
      arrowDraft = { A: canvas.getPointer(e.e), obj: null }
    })
    canvas.on('mouse:move', (e) => {
      if (mode !== 'arrow' || !arrowDraft) return
      if (arrowDraft.obj) canvas.remove(arrowDraft.obj)
      const show = buildArrowPreview(arrowDraft.A, canvas.getPointer(e.e))
      arrowDraft.obj = show
      if (show) canvas.requestRenderAll()
    })
    canvas.on('mouse:up', (e) => {
      if (mode !== 'arrow' || !arrowDraft) return
      const draft = arrowDraft
      arrowDraft = null
      if (draft.obj) {
        canvas.remove(draft.obj)
        draft.obj = null
      }
      const B = canvas.getPointer(e.e)
      const obj = makeArrowObject({ content: JSON.stringify({ k: 'arrow', w: penWidth, pts: [[draft.A.x, draft.A.y], [B.x, B.y]] }), color })
      if (!obj) return
      const id = crypto.randomUUID()
      obj.id = id
      obj.createdAt = new Date().toISOString()
      const data = {
        id,
        type: 'stroke',
        x: obj.left, y: obj.top, width: null, height: null,
        color, content: JSON.stringify({ k: 'arrow', w: penWidth, pts: [[draft.A.x, draft.A.y], [B.x, B.y]] }),
        z_index: 0, deleted: 0,
        created_at: obj.createdAt, updated_at: obj.createdAt,
      }
      obj.__lastLeft = obj.left
      obj.__lastTop = obj.top
      objects.set(id, obj)
      elems.set(id, data)
      canvas.add(obj)
      save(data)
      pushHistory('add', data)
      canvas.selection = false // stay in arrow mode: no rubber-band after the gesture
    })

    // note tool: hold + drag draws the note to size (2026-08-25 request) — the drag
    // rectangle defines the note's width and height at the moment of creation. A plain
    // click (no real drag) still drops the default 180×120 note. Clicking an existing
    // object grabs it instead (move) — it must never spawn a second note.
    let noteDraft = null // { x0, y0, rect } — in-progress note drag
    canvas.on('mouse:down', (e) => {
      if (mode !== 'note' || canvas.isDragging) return
      // Frames are SURFACES, not obstacles (2026-08-26): clicking inside a frame must draw
      // the note on it — only real objects grab the click.
      if (e.target && e.target.__kind !== 'frame') return
      const p = canvas.getPointer(e.e)
      noteDraft = { x0: p.x, y0: p.y, rect: null }
      canvas.selection = false // suppress rubber-band for this gesture (restored on mouse:up)
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
      // Machine-gun fix (2026-08-26 user request): a plain click must NOT spawn a note —
      // only a real drag commits one, and the drag rectangle sets its size.
      if (w < 40 || h < 40) return
      // Session 17: the drag rectangle becomes a SQUARE — the note takes the larger of
      // the drawn width/height on BOTH axes (the DOM sticky papers' aspect-ratio 1/1,
      // mirrored on canvas). Minimum side 80px as before.
      const side = Math.max(80, Math.round(w), Math.round(h))
      const id = crypto.randomUUID()
      const data = {
        id, type: 'note',
        x: Math.min(draft.x0, p.x), y: Math.min(draft.y0, p.y),
        width: side,
        height: side,
        color: colorPicked ? color : STICKY_PAPER, content: '', z_index: 0, deleted: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      elems.set(id, data)
      putObject(data)
      save(data)
      pushHistory('add', data)
      canvas.setActiveObject(objects.get(id))
      canvas.requestRenderAll()
    })

    // frame tool: drag draws the frame region (2026-08-26 user request) — same gesture
    // language as the note tool. A plain click draws nothing (a frame is a deliberate act).
    canvas.on('mouse:down', (e) => {
      if (mode !== 'frame' || canvas.isDragging) return
      // frames may overlap other frames — only real content objects block the gesture
      if (e.target && e.target.__kind !== 'frame') return
      const p = canvas.getPointer(e.e)
      frameDraft = { x0: p.x, y0: p.y, rect: null }
      canvas.selection = false // no rubber-band during the frame gesture
    })
    canvas.on('mouse:move', (e) => {
      if (mode !== 'frame' || !frameDraft) return
      const p = canvas.getPointer(e.e)
      const w = Math.abs(p.x - frameDraft.x0)
      const h = Math.abs(p.y - frameDraft.y0)
      if (w < 5 && h < 5) return
      if (!frameDraft.rect) {
        frameDraft.rect = new fabric.Rect({
          left: Math.min(frameDraft.x0, p.x), top: Math.min(frameDraft.y0, p.y),
          width: w, height: h,
          fill: 'rgba(155, 155, 151, 0.05)', stroke: FRAME_STROKE, strokeWidth: 1.5,
          strokeDashArray: [7, 5], rx: 4, ry: 4,
          selectable: false, evented: false, objectCaching: false,
        })
        canvas.add(frameDraft.rect)
      } else {
        frameDraft.rect.set({ left: Math.min(frameDraft.x0, p.x), top: Math.min(frameDraft.y0, p.y), width: w, height: h })
        frameDraft.rect.setCoords()
      }
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', (e) => {
      if (mode !== 'frame' || !frameDraft) return
      const p = canvas.getPointer(e.e)
      const draft = frameDraft
      frameDraft = null
      if (draft.rect) canvas.remove(draft.rect)
      canvas.selection = true
      const w = Math.abs(p.x - draft.x0)
      const h = Math.abs(p.y - draft.y0)
      if (w < 40 || h < 40) return // a click, not a frame
      const id = crypto.randomUUID()
      const data = {
        id, type: 'frame',
        x: Math.round(Math.min(draft.x0, p.x)), y: Math.round(Math.min(draft.y0, p.y)),
        width: Math.round(w), height: Math.round(h),
        color: '', content: '', z_index: 0, deleted: 0,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      elems.set(id, data)
      const obj = makeObject(data)
      objects.set(id, obj)
      canvas.add(obj)
      canvas.sendToBack(obj) // frames live UNDER their content
      save(data)
      pushHistory('add', data)
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
    })

    // shape tools (squig batch 2026-08-31; batch (s) merged the circle tool into oval —
    // hold Shift for a perfect circle): drag draws the shape to size — both edges
    // snap to the 10px grid so "three rectangles exactly 10px apart" is trivially true —
    // Shift constrains rect→square / oval→circle. 'circle' stays a LEGACY shape kind
    // (old saved circles keep rendering, and an oval committed WITH Shift persists as
    // 'circle'). A plain click drops a default-sized shape (Figma/squig convention).
    // After a committed draw the tool settles back to select (Figma: draw → arrange).
    const shapePreview = (tool, x, y, w, h) => {
      const fill = colorPicked ? color : 'transparent'
      const stroke = colorPicked ? shadeHex(color) : defaultInk()
      // Phase 7 item 10: 64 → 12 to match makeShapeObject (preview and persisted render
      // must stay identical — one visual system).
      if (tool === 'rect') return new fabric.Rect({ left: x, top: y, width: w, height: h, rx: 12, ry: 12, fill, stroke, strokeWidth: 2, strokeUniform: true, selectable: false, evented: false, objectCaching: false })
      return new fabric.Ellipse({ left: x, top: y, rx: w / 2, ry: h / 2, fill, stroke, strokeWidth: 2, strokeUniform: true, selectable: false, evented: false, objectCaching: false })
    }
    canvas.on('mouse:down', (e) => {
      if (mode !== 'rect' && mode !== 'oval' && mode !== 'circle') return
      if (canvas.isDragging) return
      if (e.target && e.target.__kind !== 'frame') return // click on content → let select handle it
      const p = canvas.getPointer(e.e)
      shapeDraft = { tool: mode, x0: snapEnabled ? roundTo(p.x, GRID_PX) : p.x, y0: snapEnabled ? roundTo(p.y, GRID_PX) : p.y, obj: null }
      canvas.selection = false // no rubber-band during the draw
    })
    canvas.on('mouse:move', (e) => {
      if ((mode !== 'rect' && mode !== 'oval' && mode !== 'circle') || !shapeDraft) return
      const p = canvas.getPointer(e.e)
      let px = snapEnabled ? roundTo(p.x, GRID_PX) : p.x
      let py = snapEnabled ? roundTo(p.y, GRID_PX) : p.y
      if (mode === 'circle' || e.e.shiftKey) {
        // equal sides (direction preserved from the origin toward the pointer); snap the
        // constrained size too so circles/squares stay on the 10px grid — but never snap
        // a zero-size press UP to 10 (a plain click must fall through to the default size)
        let s = Math.max(Math.abs(px - shapeDraft.x0), Math.abs(py - shapeDraft.y0))
        if (snapEnabled && s >= GRID_PX) s = roundTo(s, GRID_PX)
        px = shapeDraft.x0 + Math.sign(px - shapeDraft.x0 || 1) * s
        py = shapeDraft.y0 + Math.sign(py - shapeDraft.y0 || 1) * s
      }
      const w = Math.abs(px - shapeDraft.x0)
      const h = Math.abs(py - shapeDraft.y0)
      if (w < 5 && h < 5) return // still a click
      const x = Math.min(shapeDraft.x0, px)
      const y = Math.min(shapeDraft.y0, py)
      if (!shapeDraft.obj) {
        shapeDraft.obj = shapePreview(shapeDraft.tool, x, y, w, h)
        canvas.add(shapeDraft.obj)
      } else {
        shapeDraft.obj.set({ left: x, top: y, ...(shapeDraft.tool === 'rect' ? { width: w, height: h } : { rx: w / 2, ry: h / 2 }) })
        shapeDraft.obj.setCoords()
      }
      canvas.requestRenderAll()
    })
    canvas.on('mouse:up', (e) => {
      if ((mode !== 'rect' && mode !== 'oval' && mode !== 'circle') || !shapeDraft) return
      const draft = shapeDraft
      shapeDraft = null
      if (draft.obj) canvas.remove(draft.obj)
      canvas.selection = true
      const p = canvas.getPointer(e.e)
      // re-run the EXACT preview math (snap + constrain) so what commits is what was shown
      let px = snapEnabled ? roundTo(p.x, GRID_PX) : p.x
      let py = snapEnabled ? roundTo(p.y, GRID_PX) : p.y
      if (draft.tool === 'circle' || e.e.shiftKey) {
        let s = Math.max(Math.abs(px - draft.x0), Math.abs(py - draft.y0))
        if (snapEnabled && s >= GRID_PX) s = roundTo(s, GRID_PX)
        px = draft.x0 + Math.sign(px - draft.x0 || 1) * s
        py = draft.y0 + Math.sign(py - draft.y0 || 1) * s
      }
      let w = Math.abs(px - draft.x0)
      let h = Math.abs(py - draft.y0)
      // plain click (drag < 5px) → default sizes, grid-friendly (120×90 rect/oval, 110 circle)
      if (w < 5 && h < 5) {
        w = draft.tool === 'circle' ? 110 : 120
        h = draft.tool === 'circle' ? 110 : draft.tool === 'oval' ? 90 : 90
        px = draft.x0 + w
        py = draft.y0 + h
      }
      if (w < 6 || h < 6) return
      const id = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const c = colorPicked ? color : ''
      // batch (s) merge: an oval committed WITH Shift (w === h) is a perfect circle →
      // persist it as 'circle' so reloads + future logic see the intent; plain ovals
      // stay 'oval', and the legacy circle-tool path (draft.tool === 'circle') is untouched.
      const shapeKind = draft.tool === 'oval' && e.e.shiftKey && w === h ? 'circle' : draft.tool
      const data = {
        id, type: 'shape',
        x: Math.min(draft.x0, px), y: Math.min(draft.y0, py),
        width: Math.round(w), height: Math.round(h),
        color: c, content: JSON.stringify({ s: shapeKind, c }),
        z_index: 0, deleted: 0, created_at: nowIso, updated_at: nowIso,
      }
      elems.set(id, data)
      const obj = makeObject(data)
      objects.set(id, obj)
      canvas.add(obj)
      save(data)
      pushHistory('add', data)
      setActiveTool('select') // Figma: draw once, then arrange
      canvas.setActiveObject(obj)
      canvas.requestRenderAll()
    })

    // comment tool (squig batch): click → an orange pin + a popover to type into.
    // The pin starts as a TEMP object (no id): nothing persists until text is committed,
    // so an abandoned comment leaves no tombstone churn.
    canvas.on('mouse:down', (e) => {
      if (mode !== 'comment' || canvas.isDragging) return
      // skipTargetFind is ON for the comment tool (crosshair family — see setActiveTool),
      // so fabric never resolves e.target and the old `e.target.id` guard was dead code:
      // clicking an EXISTING pin opened an empty draft on top of it (looked like the
      // comment was lost — the 2026-08-31 (j) fix). Hit-test the pins ourselves and
      // open the hit pin for editing instead.
      const p = canvas.getPointer(e.e)
      const hitPin = canvas.getObjects().find((o) => {
        if (o.__kind !== 'comment' || o.__temp || !o.visible) return false
        const b = o.getBoundingRect(true, true) // scene-space box
        return p.x >= b.left && p.x <= b.left + b.width && p.y >= b.top && p.y <= b.top + b.height
      })
      if (hitPin) { openCommentPop(hitPin, false); return }
      const nowIso = new Date().toISOString()
      const data = { id: crypto.randomUUID(), type: 'comment', x: p.x - 13 / (canvas.getZoom() || 1), y: p.y - 13 / (canvas.getZoom() || 1), width: null, height: null, color: '', content: '', z_index: 0, deleted: 0, created_at: nowIso, updated_at: nowIso }
      const obj = makeCommentObject(data)
      obj.__temp = true
      canvas.add(obj)
      openCommentPop(obj, true)
    })
    // clicking an existing pin (any non-comment tool) opens its popover — but only when
    // the gesture was a click, not a drag (track the press point)
    let pinPress = null
    canvas.on('mouse:down', (e) => {
      pinPress = e.target && e.target.__kind === 'comment' ? { x: e.e.clientX ?? 0, y: e.e.clientY ?? 0 } : null
    })
    canvas.on('mouse:up', (e) => {
      if (!pinPress || mode === 'comment') { pinPress = null; return }
      const moved = Math.hypot((e.e.clientX ?? 0) - pinPress.x, (e.e.clientY ?? 0) - pinPress.y)
      const t = e.target
      pinPress = null
      if (moved > 4) return
      const pin = t && t.__kind === 'comment' ? t : (t && t.group && t.group.__kind === 'comment' ? t.group : null)
      if (pin) openCommentPop(pin, false)
    })

    // Moving a frame CARRIES its content (2026-08-26 user request): on grab, snapshot every
    // object whose center sits inside the frame; while it moves, translate them by the same
    // delta; on release, persist the frame + each carried member. Membership is dynamic —
    // things added on the frame later are picked up on the next grab.
    let frameDrag = null
    canvas.on('mouse:down', (e) => {
      const t = e.target
      if (!t || t.__kind !== 'frame') { frameDrag = null; return }
      const b = t.getBoundingRect(true)
      const members = canvas.getObjects()
        .filter((o) => o !== t && o.id && !o.__locked && elems.has(o.id))
        .filter((o) => {
          const c = o.getCenterPoint()
          return c.x >= b.left && c.x <= b.left + b.width && c.y >= b.top && c.y <= b.top + b.height
        })
        .map((o) => ({ obj: o, x: o.left, y: o.top }))
      frameDrag = { frame: t, members, origin: { x: t.left, y: t.top } }
    })
    canvas.on('object:moving', (e) => {
      if (!frameDrag || e.target !== frameDrag.frame) return
      const dx = frameDrag.frame.left - frameDrag.origin.x
      const dy = frameDrag.frame.top - frameDrag.origin.y
      for (const m of frameDrag.members) {
        m.obj.set({ left: m.x + dx, top: m.y + dy })
        m.obj.setCoords()
      }
    })
    canvas.on('object:modified', (e) => {
      if (!frameDrag || e.target !== frameDrag.frame) return
      const drag = frameDrag
      frameDrag = null
      const fData = objectToData(drag.frame)
      drag.frame.content = fData.content
      save(fData)
      for (const m of drag.members) {
        if (m.obj.__kind === 'arrow') translateArrow(m.obj) // arrows carry absolute endpoints
        const d = objectToData(m.obj)
        m.obj.content = d.content
        save(d)
      }
    })

    // Sticky-note close (×): the hit test runs in the CAPTURE phase on the fabric
    // wrapper — BEFORE Fabric's own mousedown listener (capture on an ancestor always
    // precedes the target's listeners) — so the × deletes the note without the click
    // first selecting/dragging it (2026-09-02 report: "the click selects the note
    // first"). stopPropagation() keeps Fabric out of this mousedown entirely. The hit
    // itself is mapped into the note's local space through the inverse transform, so it
    // stays correct under pan/zoom/rotate; scale never blurs the region because it's
    // unscaled. Works in EVERY tool except pen/eraser/arrow (those keep their own
    // paths). Deletion rides the same tombstone + undo path as the toolbar/keyboard.
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
        save({ ...data, deleted: 1, updated_at: new Date().toISOString() }, 'delete')
        pushHistory('erase', data)
      }
      return true
    }
    canvas.wrapperEl.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || canvas.isDragging || ev.spaceKey) return
      if (mode === 'eraser' || mode === 'pen' || mode === 'arrow') return
      if (!(ev.target instanceof HTMLCanvasElement)) return
      if (deleteViaClose(closeRegionHit(ev))) {
        ev.stopPropagation() // Fabric never sees this mousedown — no selection, no drag
        ev.preventDefault()
      }
    }, true)
    // Touch fallback: fabric synthesizes mouse:down from touchstart, which never
    // reaches the capture listener above (no real mouse event precedes it on touch).
    // deleteViaClose is idempotent, so a hybrid double-fire is harmless.
    canvas.on('mouse:down', (e) => {
      if (canvas.isDragging || mode === 'eraser' || mode === 'pen' || mode === 'arrow') return
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

    // text tool: click-drag draws a rectangular text container (Figma/Photoshop style) — text
    // wraps to its width, and all corner + side resize handles stay visible while selected.
    // A plain click keeps the old auto-sizing text object for convenience.
    // 2026-08-29: free-standing text again — identical to the Notebook's text tool
    // (the old "text lives on frames" gate was removed on user request; frames remain
    // optional grouping surfaces, nothing more).
    // 2026-09-02 (user request): clicking an EXISTING object selects it (select-tool
    // behavior) instead of stacking a new empty box on top — double-click edits text.
    // Frames stay surfaces: text can still be placed on them.
    canvas.on('mouse:down', (e) => {
      if (mode !== 'text' || canvas.isDragging) return
      if (e.target && e.target.__kind !== 'frame') return // click on content → select it
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
        id, type: 'note', color: 'text',
        x: Math.min(x0, p.x), y: Math.min(y0, p.y),
        width: isBox ? Math.round(w) : null, height: isBox ? Math.round(h) : null,
        content: '', font_size: textSize, z_index: 0, deleted: 0,
        // S40: new text boxes are born with the toolbar's alignment default (0055).
        text_align: textAlign && textAlign !== 'left' ? textAlign : null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      elems.set(id, data)
      pushHistory('add', data)
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
    // #1 (2026-08-26): the RENDER updates per keystroke (Fabric native, no debounce); only
    // the SAVE is decoupled — a debounced mid-edit autosave guards against a crash or a
    // closed tab losing a long note. The on-screen display never waits on this path.
    const midEditSave = debounce((owner) => {
      if (!elems.has(owner.id)) return // removed meanwhile (fresh empty box discarded)
      const data = objectToData(owner)
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
      const owner = e.target?.group ?? e.target
      if (owner?.id && elems.has(owner.id)) midEditSave(owner)
    })
    // persist text when the user stops typing (text tool + sticky notes both fire this)
    canvas.on('text:editing:exited', (e) => {
      const t = e.target
      if (!t) return
      const owner = t.group ?? t
      if (!owner?.id) return
      // Deleted via × while still editing (2026-08-29): the note is already tombstoned —
      // saving the edit-exit snapshot afterwards would resurrect it on the server.
      if (!objects.has(owner.id)) { t.selectable = false; return }
      const data = objectToData(owner)
      if (owner.kind === 'text' && !data.content.trim()) {
        // nothing typed into a fresh text box → discard without syncing
        removeObject(owner.id)
        elems.delete(owner.id)
        history.dropLastAdd(owner.id)
        return
      }
      const before = snapshotOf(owner.id)
      owner.content = data.content
      save(data)
      // content edits (sticky notes + text) are undoable like any other action
      if (before && dataChanged(before, data)) pushHistory('modify', before)
      if (t.group) t.selectable = false // keep grouped-note text non-selectable after editing
    })
    // sticky notes: single CLICK selects the note (Fabric-native target finding in
    // select mode — move/resize ready, never edit mode); DOUBLE-CLICK enters inline
    // editing through a temporary top-level twin (Fabric cannot edit text inside a
    // group — see makeEditTwin). Frames: dblclick renames the frame via its label
    // twin. Free-standing text boxes (text tool): dblclick is Fabric-native editing.
    canvas.on('mouse:dblclick', (e) => {
      if (canvas.isDragging || stickyEdit || frameNameEdit) return
      const target = e.target
      if (!target) return
      if (target.__kind === 'frame') return beginFrameNameEdit(target)
      const inner = target.getObjects ? target.getObjects().find((o) => o.type === 'textbox') : null
      if (inner && target.__close) return beginStickyTextEdit(target)
      if (target.type === 'textbox' && !target.__locked) {
        canvas.setActiveObject(target)
        target.enterEditing()
        canvas.requestRenderAll()
      }
    })

    // eraser: drag over objects to wipe them (tombstone-delete; undoable)
    const eraseIds = new Set()
    const eraseAt = (e) => {
      const p = canvas.getPointer(e.e)
      for (const obj of canvas.getObjects()) {
        if (!obj.id || obj.__locked || eraseIds.has(obj.id)) continue // locked never erased
        const b = obj.getBoundingRect()
        if (p.x < b.left - 6 || p.x > b.left + b.width + 6 || p.y < b.top - 6 || p.y > b.top + b.height + 6) continue
        eraseIds.add(obj.id)
        const data = elems.get(obj.id)
        removeObject(obj.id)
        if (data) {
          save({ ...data, deleted: 1, updated_at: new Date().toISOString() })
          pushHistory('erase', data)
        }
      }
      canvas.renderAll()
    }
    canvas.on('mouse:down', (e) => { if (mode === 'eraser' && !canvas.isDragging) { eraseIds.clear(); eraseAt(e) } })
    canvas.on('mouse:move', (e) => { if (mode === 'eraser' && e.e.buttons === 1 && !canvas.isDragging) eraseAt(e) })

    // toolbar wiring
    toolbarEl = ui.toolbar
    ui.toolbar.querySelectorAll('[data-tool]').forEach((b) => {
      b.addEventListener('click', () => setActiveTool(b.dataset.tool))
    })
    ui.toolbar.querySelectorAll('[data-width]').forEach((b) => {
      b.addEventListener('click', () => {
        penWidth = parseFloat(b.dataset.width) || 4
        ui.toolbar.querySelectorAll('[data-width]').forEach((x) => x.classList.toggle('active', x === b))
        if (mode === 'pen' && !isTouch() && canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = penWidth
        // S46: keep the popover summary in sync + close the popover after a pick
        const pop = b.closest('.tb-popover')
        const sumDot = pop && pop.querySelector('.tb-pop-summary .tb-pop-dot')
        if (sumDot) sumDot.style.setProperty('--dot-size', b.style.getPropertyValue('--dot-size') || '8px')
        if (pop) pop.open = false
      })
    })
    ui.palette.querySelectorAll('[data-color]').forEach((b) => {
      b.addEventListener('click', () => {
        color = b.dataset.color
        colorPicked = true
        ui.palette.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x === b))
        // if the pen is already selected, the next stroke uses the newly picked color too
        if (mode === 'pen' && !isTouch() && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = color
        // S46: keep the popover summary swatch in sync + close the popover after a pick
        const pop = b.closest('.tb-popover')
        const sumSw = pop && pop.querySelector('.tb-pop-summary .tb-pop-swatch')
        if (sumSw) sumSw.style.background = color
        if (pop) pop.open = false
      })
    })
    // Theme-follow for the default ink: re-apply black/white when the theme flips, until
    // the user has picked a swatch of their own.
    const applyThemeInk = () => {
      if (colorPicked) return
      color = defaultInk()
      ui.palette.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('active', x.dataset.color === color))
      if (mode === 'pen' && !isTouch() && canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = color
      // S46: keep the palette popover summary swatch in sync with the theme-default ink
      const sumSw = ui.palette.querySelector('.tb-pop-summary .tb-pop-swatch')
      if (sumSw) sumSw.style.background = color
    }
    // S46: dynamic popover positioning — on each <details> open, measure the trigger +
    // list and pick left/right alignment so the list never overflows the viewport. The
    // toolbar wraps on mobile (a trigger's x varies by viewport), so a fixed CSS anchor
    // can't cover every case. requestAnimationFrame waits one frame for the list to lay
    // out before we measure it.
    document.querySelectorAll('.tb-popover').forEach((pop) => {
      pop.addEventListener('toggle', () => {
        if (!pop.open) return
        requestAnimationFrame(() => {
          const list = pop.querySelector('.tb-pop-list')
          const sum = pop.querySelector('.tb-pop-summary')
          if (!list || !sum) return
          list.style.left = ''
          list.style.right = ''
          const sr = sum.getBoundingClientRect()
          const lr = list.getBoundingClientRect()
          const vw = document.documentElement.clientWidth || window.innerWidth
          if (sr.left + lr.width > vw - 8) {
            list.style.left = 'auto'
            list.style.right = '0'
          } else {
            list.style.left = '0'
            list.style.right = 'auto'
          }
        })
      })
    })
    // Hollow shape strokes follow the theme TOO (2026-08-31 dark-mode fix): a hollow shape
    // bakes the theme ink at creation, so a mid-session flip to dark would leave near-black
    // strokes invisible on dark paper. Restyle every no-palette hollow shape live; filled
    // shapes keep their saved colors (pastels read fine on both papers, like sticky notes).
    const applyThemeBoard = () => {
      if (!canvas) return
      const ink = defaultInk()
      let touched = false
      for (const o of objects.values()) {
        if (o.__kind === 'shape' && !o.__shapeColor && o.stroke !== ink) {
          o.set({ stroke: ink })
          touched = true
        }
      }
      if (touched) canvas.requestRenderAll()
    }
    new MutationObserver(applyThemeBoard).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyThemeBoard)
    applyThemeBoard()
    new MutationObserver(applyThemeInk).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyThemeInk)
    applyThemeInk()
    // Text font picker (user request): Bebas by default, Classic opt-out.
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
    // Text-size control (2026-08-26 user request): independent of the pen stroke-width.
    // Applies to new text boxes; when a text object is selected it resizes live.
    const fontSizeEl = toolbarEl.querySelector('[data-font-size]')
    if (fontSizeEl) {
      fontSizeEl.value = String(textSize)
      fontSizeEl.addEventListener('change', () => {
        textSize = parseInt(fontSizeEl.value, 10) || 16
        try { localStorage.setItem('hibana-font-size-canvas', String(textSize)) } catch { /* private mode */ }
        let touched = false
        for (const obj of canvas.getActiveObjects()) {
          if (obj.kind === 'text') {
            obj.set({ fontSize: textSize })
            if (typeof obj.initDimensions === 'function') obj.initDimensions()
            obj.setCoords?.()
            touched = true
          }
        }
        if (touched) { canvas.requestRenderAll(); persistActive() }
      })
    }
    // Text-alignment control (S40): three-state toggle. Sets the default for NEW text
    // boxes; when a text object is selected the click realigns it live and persists
    // through the normal save path (objectToData carries text_align, migration 0055).
    const alignButtons = [...toolbarEl.querySelectorAll('[data-text-align]')]
    const syncAlignButtons = (active) => {
      for (const b of alignButtons) b.classList.toggle('active', b.dataset.textAlign === (active || 'left'))
    }
    for (const b of alignButtons) {
      b.addEventListener('click', () => {
        const align = VALID_ALIGNS.includes(b.dataset.textAlign) ? b.dataset.textAlign : 'left'
        textAlign = align
        try { localStorage.setItem('hibana-text-align-canvas', align) } catch { /* private mode */ }
        syncAlignButtons(align)
        let touched = false
        for (const obj of canvas.getActiveObjects()) {
          if (obj.kind === 'text') {
            obj.set({ textAlign: align })
            obj.setCoords?.()
            touched = true
          }
        }
        if (touched) { canvas.requestRenderAll(); persistActive() }
      })
    }
    syncAlignButtons(textAlign)
    // The text-property cluster only shows when it's relevant: the text tool is active,
    // or a text object is selected (2026-08-26 toolbar declutter).
    const syncTextPropsLocal = () => {
      const a = canvas.getActiveObject()
      toolbarEl.classList.toggle('text-props-on', mode === 'text' || a?.kind === 'text')
      if (a?.kind === 'text' && fontSizeEl) fontSizeEl.value = String(Math.round(a.fontSize || textSize))
      // S40: the align buttons reflect the selected text object's alignment (falling
      // back to the stored default when nothing relevant is selected).
      syncAlignButtons(a?.kind === 'text' && a.textAlign ? a.textAlign : textAlign)
    }
    syncTextProps = syncTextPropsLocal
    canvas.on('selection:created', syncTextPropsLocal)
    canvas.on('selection:updated', syncTextPropsLocal)
    canvas.on('selection:cleared', syncTextPropsLocal)
    // Sticky recolor palette: build the swatches once, show/position on sticky
    // selection (and after:render, so it follows pan/zoom), recolor on click through
    // the normal persist/history path (2026-09-02 request).
    stickyPaletteEl = document.querySelector('[data-sticky-palette]')
    if (stickyPaletteEl) {
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
      canvas.on('selection:created', syncStickyPalette)
      canvas.on('selection:updated', syncStickyPalette)
      canvas.on('selection:cleared', syncStickyPalette)
    }

    // ---- squig batch wiring (2026-08-31): popovers, paper, comment editor -------------
    blocksPopEl = document.querySelector('[data-blocks-pop]')
    paperPopEl = document.querySelector('[data-paper-pop]')
    exportPopEl = document.querySelector('[data-export-pop]')
    commentPopEl = document.querySelector('[data-comment-pop]')
    commentPopText = commentPopEl?.querySelector('[data-comment-text]') ?? null
    imagePopEl = document.querySelector('[data-image-pop]')
    buildBlocksPop()
    applyPaper() // paper classes + popover control states (call AFTER popovers resolve)

    // (k) image popover: the Add button submits the form; Enter in the input submits
    // too (implicit submission). Escape closes via the board-popover rules. NOTE:
    // togglePop runs onOpen BEFORE revealing the popover — focusing a hidden input is
    // a no-op, so the focus defers one tick past the reveal.
    if (imagePopEl) {
      imagePopEl.querySelector('[data-image-form]')?.addEventListener('submit', (e) => {
        e.preventDefault()
        placeImageFromPop()
      })
    }

    if (commentPopEl && commentPopText) {
      commentPopText.setAttribute('dir', 'auto') // golden rule: text direction follows its own first strong character
      commentPopEl.querySelector('[data-comment-save]')?.addEventListener('click', () => closeCommentPop(true))
      commentPopEl.querySelector('[data-comment-close]')?.addEventListener('click', () => closeCommentPop(true))
      commentPopEl.querySelector('[data-comment-delete]')?.addEventListener('click', () => {
        const pin = activeCommentPop?.obj
        closeCommentPop(false)
        deleteCommentPin(pin)
      })
      commentPopText.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); closeCommentPop(true) }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeCommentPop(true); commentPopText.blur() }
      })
    }
    if (paperPopEl) {
      paperPopEl.querySelectorAll('button[data-paper]').forEach((b) => {
        b.addEventListener('click', () => {
          paperMode = b.dataset.paper
          try { localStorage.setItem(PAPER_KEY, paperMode) } catch { /* private mode */ }
          applyPaper()
        })
      })
      paperPopEl.querySelector('[data-dots-toggle]')?.addEventListener('change', (e) => {
        dotsOn = !!e.target.checked
        try { localStorage.setItem(DOTS_KEY, dotsOn ? '1' : '0') } catch { /* private mode */ }
        applyPaper()
      })
      paperPopEl.querySelector('[data-snap-toggle]')?.addEventListener('change', (e) => {
        snapEnabled = !!e.target.checked
        try { localStorage.setItem(SNAP_KEY, snapEnabled ? '1' : '0') } catch { /* private mode */ }
      })
    }
    ui.toolbar.querySelector('[data-action=blocks]')?.addEventListener('click', (e) => togglePop(blocksPopEl, e.currentTarget))
    ui.toolbar.querySelector('[data-action=paper]')?.addEventListener('click', (e) => togglePop(paperPopEl, e.currentTarget))
    ui.toolbar.querySelector('[data-action=export]')?.addEventListener('click', (e) => togglePop(exportPopEl, e.currentTarget, buildExportRows))
    // (k) image popover: focus the input on open + clear any stale error (deferred one
    // tick — the popover is still hidden while onOpen runs; focus on a hidden input
    // is silently dropped by the browser).
    ui.toolbar.querySelector('[data-action=addimage]')?.addEventListener('click', (e) => togglePop(imagePopEl, e.currentTarget, () => {
      setImageError('')
      window.setTimeout(() => imagePopEl?.querySelector('[data-image-url]')?.focus(), 0)
    }))
    // outside click closes the board popovers (and commits an open comment). Clicks on
    // popover content or toolbar action buttons are handled by their own listeners.
    document.addEventListener('click', (e) => {
      if (suppressPopClick) { suppressPopClick = false; return } // the opening click itself
      if (!(e.target instanceof Element)) return
      if (e.target.closest('.board-popover')) return
      if (e.target.closest('button[data-action]')) return
      closeBoardPops()
    })
    ui.toolbar.querySelector('[data-action=zoomin]').addEventListener('click', () => {
      canvas.zoomToPoint({ x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }, canvas.getZoom() * 1.25)
      loadChunk()
    })
    ui.toolbar.querySelector('[data-action=zoomout]').addEventListener('click', () => {
      canvas.zoomToPoint({ x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }, canvas.getZoom() * 0.8)
      loadChunk()
    })
    ui.toolbar.querySelector('[data-action=fit]').addEventListener('click', () => {
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
      loadChunk()
    })
    ui.toolbar.querySelector('[data-action=lock]')?.addEventListener('click', () => {
      const objs = canvas.getActiveObjects().filter((o) => o.id)
      if (!objs.length) return window.hibana?.toast(_t('canvas.lockNone', 'Select an element first'), 'err')
      const anyUnlocked = objs.some((o) => !o.__locked) // mixed selection → lock everything
      for (const o of objs) {
        o.__locked = anyUnlocked
        applyLock(o)
      }
      canvas.requestRenderAll()
      syncLockBadges()
      persistActive() // the lock state persists with the element
    })
    ui.toolbar.querySelector('[data-action=delete]').addEventListener('click', deleteActive)
    ui.toolbar.querySelector('[data-action=promote]').addEventListener('click', promoteActive)
    ui.toolbar.querySelector('[data-action=quicknote]')?.addEventListener('click', quicknoteActive)
    ui.toolbar.querySelector('[data-action=undo]').addEventListener('click', undoCanvas)
    ui.toolbar.querySelector('[data-action=redo]').addEventListener('click', redoCanvas)
    // The ⋯ overflow closes after an action and on outside click (menu convention).
    const moreMenu = toolbarEl.querySelector('.tb-more')
    moreMenu?.addEventListener('click', (e) => { if (e.target.closest('button')) moreMenu.open = false })
    document.addEventListener('click', (e) => { if (moreMenu?.open && !moreMenu.contains(e.target)) moreMenu.open = false })
    document.addEventListener('keydown', onBoardKeydown, true)

    // hide pen on touch devices (spec §3.1: drawing is desktop-only)
    if (isTouch()) {
      ui.toolbar.querySelectorAll('.pen-only').forEach((el) => (el.hidden = true))
    }

    // S43: sizeToWrap (not window.innerWidth — a wide board USED to expand the
    // mobile layout viewport, and innerWidth then reported the EXPANDED size:
    // resizing to innerWidth baked the overflow in forever. The wrap's own client
    // box is the truth — the whiteboard's proven sizeToPage pattern).
    function sizeToWrap() {
      const wrap = document.getElementById('canvas-wrap')
      const w = wrap?.clientWidth || document.documentElement.clientWidth
      const h = wrap?.clientHeight || Math.max(240, window.innerHeight - 96)
      if (!canvas || !w || !h) return
      if (canvas.getWidth() === w && canvas.getHeight() === h) return
      canvas.setDimensions({ width: w, height: h })
      canvas.calcOffset()
      loadChunk()
    }
    window.addEventListener('resize', () => { sizeToWrap() })
    sizeToWrap()
  }

  function serializePath(path, w) {
    // content format v2: { w, pts } — the pen width travels with the stroke (spec §4.11:
    // content = point-path JSON; legacy bare-array content still loads via makeObject)
    const pts = []
    // Fabric 5.3 path commands are arrays: ['M', x, y] / ['L', x, y], smooth segments
    // end at ['Q', cx, cy, x, y] or ['C', c1x, c1y, c2x, c2y, x, y]
    for (const c of path.path ?? []) {
      if (c[0] === 'M' || c[0] === 'L') pts.push([c[1], c[2]])
      else if (c[0] === 'Q') pts.push([c[3], c[4]])
      else if (c[0] === 'C') pts.push([c[5], c[6]])
    }
    return JSON.stringify({ w, pts })
  }

  function isTouch() {
    return window.matchMedia('(pointer: coarse)').matches
  }

  function deleteActive() {
    const sel = canvas.getActiveObjects()
    for (const obj of sel) {
      if (!obj.id) continue
      if (obj.__locked) continue // locked elements are never deleted (2026-08-26)
      const data = elems.get(obj.id)
      removeObject(obj.id)
      if (data) {
        save({ ...data, deleted: 1, updated_at: new Date().toISOString() }, 'delete')
        pushHistory('erase', data)
      }
    }
  }

  // Persist whatever changed on the active object(s) — the same record+history path as
  // Fabric's object:modified handler (which this backs), reused by keyboard actions like
  // nudge and z-order moves so they stay durable + undoable.
  function persistActive() {
    for (const obj of canvas.getActiveObjects()) {
      if (!obj || !obj.id) continue
      if (obj.__kind === 'arrow') translateArrow(obj)
      const before = snapshotOf(obj.id)
      const data = objectToData(obj)
      obj.content = data.content
      // only record + save when something actually changed (e.g. a click without a move)
      if (dataChanged(before, data)) {
        save(data)
        if (before) pushHistory('modify', before)
      }
    }
  }
  const persistDebounced = debounce(persistActive, 400)

  // ---- Figma shortcuts (user request) -----------------------------------------------
  // Arrow keys nudge the selection (Shift = 10px, Figma-style); Ctrl/⌘+D duplicates it.
  function nudgeActive(dx, dy) {
    const sel = canvas.getActiveObjects()
    if (!sel.length) return
    for (const obj of sel) {
      obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy })
      obj.setCoords()
    }
    canvas.requestRenderAll()
    persistDebounced()
  }

  function duplicateSelection() {
    const sel = canvas.getActiveObjects()
    if (!sel.length) return
    const t = new Date().toISOString()
    const clones = []
    for (const obj of sel) {
      const item = objectToData(obj)
      const data = { ...item, id: crypto.randomUUID(), x: item.x + 24, y: item.y + 24, created_at: t, updated_at: t }
      elems.set(data.id, data)
      putObject(data)
      save(data)
      pushHistory('add', data)
      clones.push(objects.get(data.id))
    }
    canvas.setActiveObject(clones.length === 1 ? clones[0] : new fabric.ActiveSelection(clones, { canvas }))
    canvas.requestRenderAll()
  }

  // Ctrl/⌘+[ ] layer moves. The server re-orders by z_index on every load, so the whole
  // stack is renumbered and every changed record saved — order survives a reload.
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
    for (const obj of sel) {
      if (!obj.id) continue
      const before = snapshotOf(obj.id)
      const data = objectToData(obj)
      obj.content = data.content
      if (dataChanged(before, data)) {
        save(data)
        if (before) pushHistory('modify', before)
      }
    }
    for (const obj of all) {
      if (sel.includes(obj)) continue
      const rec = elems.get(obj.id)
      if (rec && rec.z_index !== obj.zIndex) save({ ...rec, z_index: obj.zIndex, updated_at: new Date().toISOString() })
    }
  }

  function zoomBy(f) {
    canvas.zoomToPoint({ x: canvas.getWidth() / 2, y: canvas.getHeight() / 2 }, canvas.getZoom() * f)
    loadChunk()
  }
  function resetView() {
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    canvas.requestRenderAll()
    loadChunk()
  }
  // Figma Shift+1: zoom to the selection (falls back to resetting the view).
  function zoomToSelection() {
    const obj = canvas.getActiveObject()
    if (!obj) return resetView()
    const b = obj.getBoundingRect()
    const vw = canvas.getWidth()
    const vh = canvas.getHeight()
    const pad = 60
    if (!b.width && !b.height) return resetView()
    const scale = Math.min(1.5, Math.max(0.05, Math.min(vw / (b.width + pad * 2), vh / (b.height + pad * 2))))
    const t = canvas.viewportTransform.slice()
    t[0] = scale
    t[3] = scale
    t[4] = vw / 2 - (b.left + b.width / 2) * scale
    t[5] = vh / 2 - (b.top + b.height / 2) * scale
    canvas.setViewportTransform(t)
    loadChunk()
  }

  // Delete / Backspace removes selection; Escape cancels any draft + deselects; Ctrl/⌘+Z/Y
  // undo/redo; Ctrl/⌘+C/X/V copy, cut and paste objects. Never fires while typing
  // (inputs, Fabric's IText editor via its hidden textarea) or with a dialog open.
  // Figma-flavored extras (user request): V/H/T/B/E tool keys, arrows nudge (Shift=10px),
  // Ctrl/⌘+D duplicate, Ctrl/⌘+[ ] layers, Ctrl/⌘+0/=/- zoom, Shift+1/2 fit selection/all.
  function onBoardKeydown(e) {
    const t = e.target
    if (e.isComposing || document.querySelector('dialog[open]')) return
    const key = e.key
    // Escape while the Fabric text editor is open: exit editing and drop the selection —
    // Fabric keeps the text object active after exitEditing, so a plain Escape feels stuck.
    if (key === 'Escape') {
      const active = canvas.getActiveObject()
      // NB: the attribute is data-fabric-hiddentextarea="" — the dataset value is an
      // EMPTY string, so the old !!t.dataset.fabricHiddentextarea check never matched.
      const editingText = t instanceof HTMLTextAreaElement && 'fabricHiddentextarea' in (t.dataset || {})
      if (editingText || (active && active.isEditing)) {
        if (active && active.isEditing) active.exitEditing()
        canvas.discardActiveObject()
        canvas.requestRenderAll()
        e.preventDefault()
        e.stopPropagation() // capture-phase: don't let Fabric's own textarea handler re-handle it
        return
      }
    }
    // While a Fabric text editor has focus (its hidden textarea), the editing combos
    // keep working through Fabric's own coverage — Ctrl+A → keysMap selectAll,
    // Ctrl+C/X → fabric's copy/cut listeners on the textarea, Ctrl+V → native paste
    // (fabric's input handler resyncs the whole value, with style-carrying paste),
    // Ctrl+Z → native textarea undo (same resync path). This handler must simply NOT
    // hijack them: the guard below returns before any tool/canvas shortcut runs.
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return
    const mod = e.ctrlKey || e.metaKey
    if (key === 'Delete' || key === 'Backspace') {
      if (!canvas || canvas.getActiveObjects().length === 0) return
      e.preventDefault()
      deleteActive()
      return
    }
    if (key === 'Escape') {
      cancelDrafts()
      closeBoardPops() // squig popovers (blocks/paper/export close; the comment popover commits)
      if (canvas.getActiveObject()) {
        e.preventDefault()
        canvas.discardActiveObject()
        canvas.requestRenderAll()
      }
      return
    }
    // Guard repair (squig batch 2026-08-31): the old `if (!mod || key === ' ') return`
    // made every "no modifier" Figma tool key below DEAD and — worse — hijacked Ctrl+V
    // (the v-tool branch ran first, so pasteClipboard never fired). Now: plain keys reach
    // the tool block, modifier combos reach the shortcuts, and both stay in their lane.
    if (!mod && key === ' ') return
    const k = key.toLowerCase()
    // Ctrl+A — select all UNLOCKED elements in the current view (2026-08-26). preventDefault
    // keeps the browser's native select-all-text out of the way; locked elements are excluded.
    if (mod && k === 'a') {
      e.preventDefault()
      const sel = [...objects.values()].filter((o) => !o.__locked)
      if (!sel.length) return
      canvas.discardActiveObject()
      canvas.setActiveObject(new fabric.ActiveSelection(sel, { canvas }))
      canvas.requestRenderAll()
      return
    }

    // Figma tool keys + nudge (no modifier). Order matters: these run before the
    // modifier-only branch below — but ONLY without Ctrl/⌘ so the clipboard combos
    // (Ctrl+C/X/V) can never be hijacked by a tool switch.
    if (!mod) {
      if (k === 'v') { e.preventDefault(); setActiveTool('select'); return }
      if (k === 'h') { e.preventDefault(); setActiveTool('pan'); return }
      if (k === 't') { e.preventDefault(); setActiveTool('text'); return }
      if (k === 'b' || k === 'p') { e.preventDefault(); setActiveTool('pen'); return }
      if (k === 'e') { e.preventDefault(); setActiveTool('eraser'); return }
      // squig batch: R = rectangle, O = oval, C = comment (the Figma keys)
      if (k === 'r') { e.preventDefault(); setActiveTool('rect'); return }
      if (k === 'o') { e.preventDefault(); setActiveTool('oval'); return }
      if (k === 'c') { e.preventDefault(); setActiveTool('comment'); return }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        if (canvas.getActiveObjects().length === 0) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0
        const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0
        nudgeActive(dx, dy)
        return
      }
      if (e.shiftKey && key === '1') { e.preventDefault(); zoomToSelection(); return }
      if (e.shiftKey && key === '2') { e.preventDefault(); resetView(); return }
    }

    // modifier-only shortcuts (Ctrl/⌘ + key) — every branch below requires `mod`, now
    // that plain keys flow through the tool block above
    if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); return }
    if (mod && e.code === 'BracketRight') { e.preventDefault(); moveZ(e.shiftKey ? 2 : 1); return }
    if (mod && e.code === 'BracketLeft') { e.preventDefault(); moveZ(e.shiftKey ? -2 : -1); return }
    if (mod && k === '0') { e.preventDefault(); resetView(); return }
    if (mod && (k === '=' || key === '+')) { e.preventDefault(); zoomBy(1.25); return }
    if (mod && k === '-') { e.preventDefault(); zoomBy(0.8); return }
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redoCanvas(); else undoCanvas(); return }
    if (mod && k === 'y') { e.preventDefault(); redoCanvas(); return }
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
    const t = new Date().toISOString()
    for (const item of clipboard) {
      const data = { ...item, id: crypto.randomUUID(), x: item.x + 24, y: item.y + 24, created_at: t, updated_at: t }
      elems.set(data.id, data)
      putObject(data)
      save(data)
      pushHistory('add', data)
    }
    const first = canvas.getActiveObjects()[0] ?? objects.get(clipboard[0]?.id)
    if (first) canvas.setActiveObject(first)
    canvas.requestRenderAll()
  }
  function cancelDrafts() {
    if (textDraft) {
      if (textDraft.rect) canvas.remove(textDraft.rect)
      textDraft = null
    }
    if (arrowDraft?.obj) {
      canvas.remove(arrowDraft.obj)
      arrowDraft = null
    }
    if (frameDraft?.rect) {
      canvas.remove(frameDraft.rect)
      frameDraft = null
    }
    if (shapeDraft) {
      if (shapeDraft.obj) canvas.remove(shapeDraft.obj)
      shapeDraft = null
    }
    clearGuides()
    closeBoardPops() // blocks/paper/export hide; an open comment commits its text
  }

  // Unlimited undo/redo: every step pushes the inverse onto the redo stack, so undoing walks
  // all the way back to the first state of the session (and redo forward again). LWW on
  // updated_at means the server converges no matter what order the offline queue flushes.
  function undoCanvas() {
    history.undo((entry) => {
      if (entry.kind === 'add') {
        const inverse = { kind: 'erase', data: entry.data }
        tombstone(entry.data.id)
        return inverse
      }
      if (entry.kind === 'erase') {
        const inverse = { kind: 'add', data: entry.data }
        restore(entry.data)
        return inverse
      }
      const inverse = { kind: 'modify', data: snapshotOf(entry.data.id) } // capture BEFORE restore overwrites the record
      restore(entry.data)
      return inverse
    })
  }
  function redoCanvas() {
    history.redo((entry) => {
      if (entry.kind === 'add') {
        const inverse = { kind: 'erase', data: entry.data }
        restore(entry.data)
        return inverse
      }
      if (entry.kind === 'erase') {
        const inverse = { kind: 'erase', data: entry.data }
        restore(entry.data)
        return inverse
      }
      const inverse = { kind: 'modify', data: snapshotOf(entry.data.id) } // capture BEFORE restore
      restore(entry.data)
      return inverse
    })
  }

  async function promoteActive() {
    const obj = canvas.getActiveObject()
    if (!obj?.id) return window.hibana?.toast(_t('canvas.selectNote', 'Select a note first'), 'err')
    const data = elems.get(obj.id)
    if (data.type !== 'note') return window.hibana?.toast(_t('canvas.notesOnly', 'Only notes can be promoted'), 'err')
    const title = prompt(_t('canvas.promptTitle', 'Title for the new Idea'), data.content?.slice(0, 50) || _t('canvas.promptDefault', 'Promoted from canvas')) ?? ''
    const res = await send(`/api/canvas/elements/${obj.id}/promote`, { method: 'POST', body: JSON.stringify({ title }) })
    if (!res.ok) return window.hibana?.toast(_t('canvas.promoteFailed', 'Promotion failed'), 'err')
    const { projectId } = await res.json()
    // H2 fix: escape the server-rendered projectId (UUID) before interpolating into the toast's innerHTML
    const esc = window.hibana?.esc ?? ((s) => String(s ?? ''))
    window.hibana?.toast(`${_t('canvas.promoted', 'Promoted!')} <a href="/project.html?id=${esc(projectId)}">${_t('canvas.openSpark', 'Open the Idea →')}</a>`)
    // keeps the note; mark it visually (spec §3.1: nothing disappears)
    obj.set({ stroke: '#16a34a', strokeWidth: 1 })
    canvas.requestRenderAll()
  }

  // Phase 7 item 9 — «تبدیل به یادداشت»: the SELECTED sticky note is copied into the Quick
  // Notebook (POST /api/notes, kind note) so it shows on the dashboard. The sticky itself
  // stays on the board (promote-style: nothing disappears — spec §3.1), earning the same
  // green stroke marker as a promoted-to-Idea note.
  async function quicknoteActive() {
    const obj = canvas.getActiveObject()
    if (!obj?.id) return window.hibana?.toast(_t('canvas.selectNote', 'Select a note first'), 'err')
    const data = elems.get(obj.id)
    if (data.type !== 'note') return window.hibana?.toast(_t('canvas.notesOnly', 'Only notes can be promoted'), 'err')
    const content = String(data.content || '').trim()
    if (!content) return window.hibana?.toast(_t('canvas.noteEmpty', 'The sticky note is empty'), 'err')
    if (quickNoteBusy) return
    quickNoteBusy = true
    try {
      const res = await send('/api/notes', { method: 'POST', body: JSON.stringify({ kind: 'note', content }) })
      if (!res.ok) return window.hibana?.toast(_t('canvas.toNoteFailed', "Couldn't add the quick note"), 'err')
      window.hibana?.toast(`${_t('canvas.toNoteDone', 'Added to your Quick Notes')} — <a href="/dashboard.html">${_t('canvas.openDash', 'Open the dashboard →')}</a>`)
      obj.set({ stroke: '#16a34a', strokeWidth: 1 })
      canvas.requestRenderAll()
    } finally {
      quickNoteBusy = false
    }
  }
  let quickNoteBusy = false


  return { init, getElement: (id) => elems.get(id), getCanvas: () => canvas }
})()