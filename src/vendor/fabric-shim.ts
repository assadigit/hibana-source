// Fabric v7 → v5 compatibility shim (v7.4.0 fixes SVG XSS CVE GHSA-hfvx-25r5-qc3w + GHSA-w22m-hvvm-xmwx) (L14 / P3-a, 2026-09-10).
//
// Fabric v6 is ESM-only (no UMD global), which conflicts with Hibana's no-build frontend.
// This shim imports the v6 classes and assigns them to `window.fabric`, so canvas.js and
// whiteboard.js keep using the same `fabric.Rect`, `fabric.util.transformPoint`, etc.
// namespace without any changes.
//
// The build script (scripts/build.mjs) bundles this file into public/vendor/fabric.min.js
// as an IIFE that sets the global. Canvas.js and whiteboard.js load it via <script src>.
//
// API differences handled:
//   - fabric.charWidthsCache was REMOVED in v6. The canvas.js cache-clearing code is
//     removed (dead code — v6 handles text caching internally).
//   - fabric.Image.filters.* moved to fabric.filters.* in v6. The shim exposes both
//     paths (fabric.filters AND fabric.Image.filters) for backwards compatibility.
//   - All other classes (Canvas, Rect, Group, Line, Text, Path, Textbox, Circle,
//     Ellipse, ActiveSelection, Shadow, Image) have identical constructor signatures
//     for the API surface Hibana uses.

import {
  Canvas,
  Rect,
  Group,
  Line,
  Text,
  Path,
  Textbox,
  Circle,
  Ellipse,
  ActiveSelection,
  Shadow,
  Image,
  util,
  filters,
  Point,
  Color,
  Gradient,
  Pattern,
  FabricObject,
  IText,
  Polygon,
  Polyline,
  Triangle,
  StaticCanvas,
  PencilBrush,
  PatternBrush,
  SprayBrush,
  CircleBrush,
  BaseBrush,
  Control,
  Intersection,
  Observable,
  Point as Pt,
} from 'fabric'

// Assign to window.fabric — the global namespace canvas.js/whiteboard.js expect.
const fabric = {
  Canvas,
  Rect,
  Group,
  Line,
  Text,
  Path,
  Textbox,
  Circle,
  Ellipse,
  ActiveSelection,
  Shadow,
  Image,
  util,
  filters,
  Point,
  Color,
  Gradient,
  Pattern,
  Object: FabricObject,
  FabricObject,
  IText,
  Polygon,
  Polyline,
  Triangle,
  StaticCanvas,
  PencilBrush,
  PatternBrush,
  SprayBrush,
  CircleBrush,
  BaseBrush,
  Control,
  Intersection,
  Observable,
}

// v5 backwards compat: fabric.Image.filters.* → fabric.filters.*
// (whiteboard.js used `new fabric.Image.filters.HueRotation()` — moved in v6)
// Cast to any because the v6 Image type doesn't have a `filters` static property.
;(fabric.Image as any).filters = filters

// v5 origin compat (Session 28 P0 — "notebook notes are cropped / everything renders
// half-shifted"): fabric ≤5 anchored every object's left/top at its TOP-LEFT corner
// (originX/originY 'left'/'top'); v6/v7 anchor at the CENTER. Both boards were authored
// for the v5 contract — they persist getBoundingRect().top-left and re-create with
// left/top — so under center-origin every text note, stroke and shape reloaded HALF ITS
// SIZE up-and-left (drifting further on every save cycle), and the pinned-width
// textboxes' clipPaths cropped their content. Sites that pass an EXPLICIT origin (the
// comment pins, guides, block badges) are left untouched.
//
// Implementation: wrap the exported shape classes so `new C(...)` flips the freshly
// built object back to top-left anchoring unless the options said otherwise. The
// wrapper keeps the real class's prototype (instanceof) and statics (proto chain), and
// always returns the genuine class instance — `new Wrapped(...)` just re-anchors it.
type Originful = {
  originX?: unknown
  originY?: unknown
  set: (o: Record<string, unknown>) => void
  setCoords?: () => void
}
function topLeftOriginCompat<C extends new (...args: never[]) => Originful>(C: C): C {
  const Wrapped = function (this: unknown, ...args: unknown[]) {
    const opts = args[args.length - 1] as Record<string, unknown> | undefined
    const explicitOrigin =
      !!opts && typeof opts === 'object' && !Array.isArray(opts) && ('originX' in opts || 'originY' in opts)
    const obj = new (C as unknown as new (...args: unknown[]) => Originful)(...args)
    if (!explicitOrigin && obj && typeof obj.set === 'function') {
      obj.set({ originX: 'left', originY: 'top' })
      obj.setCoords?.()
    }
    return obj
  } as unknown as C
  Object.setPrototypeOf(Wrapped, C) // statics resolve through the real class
  Wrapped.prototype = C.prototype // instanceof keeps working for the real class
  return Wrapped
}

for (const key of [
  'Rect',
  'Group',
  'Line',
  'Text',
  'Path',
  'Textbox',
  'Circle',
  'Ellipse',
  'ActiveSelection',
  'Image',
  'IText',
  'Polygon',
  'Polyline',
  'Triangle',
] as const) {
  const C = (fabric as unknown as Record<string, new (...args: never[]) => Originful>)[key]
  if (typeof C === 'function') (fabric as unknown as Record<string, unknown>)[key] = topLeftOriginCompat(C)
}

// v5 backwards compat: Canvas-level methods REMOVED in v6 (2026-09-12 fix — the v6/v7
// security upgrades silently broke every pointer-driven handler on both boards).
// whiteboard.js + canvas.js still call the v5 forms:
//   - canvas.getPointer(e)            → v6 canvas.getScenePoint(e) (28 call sites: note/
//     text/eraser/arrow/shape/sticky-close handlers — without this every drag/click threw
//     "canvas.getPointer is not a function" and no element could be created)
//   - canvas.bringToFront(obj)        → v6 canvas.bringObjectToFront(obj) (11 z-order
//     canvas.sendToBack(obj)          → v6 canvas.sendObjectToBack(obj)   call sites incl.
//     canvas.bringForward(obj)        → v6 canvas.bringObjectForward(obj) frames-under-content
//     canvas.sendBackwards(obj)       → v6 canvas.sendObjectBackwards(obj) on load + moveZ)
//   - canvas.getViewportCenter()      → v6 canvas.getVpCenter() (both call sites guard with
//     a fallback, shimmed anyway so the guard never trips)
// v5 getPointer(e) default semantics = scene coordinates (inverse-viewport-transform);
// no Hibana call site passes the second (ignoreVpt) argument, so getScenePoint is exact.
const canvasProto = Canvas.prototype as unknown as Record<string, unknown>
if (typeof canvasProto.getPointer !== 'function') {
  canvasProto.getPointer = function (this: { getScenePoint: (e: unknown) => unknown }, e: unknown) {
    return this.getScenePoint(e)
  }
}
if (typeof canvasProto.getViewportCenter !== 'function') {
  canvasProto.getViewportCenter = function (this: { getVpCenter: () => unknown }) {
    return this.getVpCenter()
  }
}
const zOrderCompat: Record<string, string> = {
  bringToFront: 'bringObjectToFront',
  sendToBack: 'sendObjectToBack',
  bringForward: 'bringObjectForward',
  sendBackwards: 'sendObjectBackwards',
}
for (const [v5Name, v6Name] of Object.entries(zOrderCompat)) {
  if (typeof canvasProto[v5Name] !== 'function' && typeof canvasProto[v6Name] === 'function') {
    canvasProto[v5Name] = function (this: Record<string, (obj: unknown, ...rest: unknown[]) => unknown>, obj: unknown, ...rest: unknown[]) {
      return this[v6Name](obj, ...rest)
    }
  }
}

// v5 backwards compat: textarea blur → exitEditing. In v5, blurring Fabric's hidden
// textarea exited editing; v6's blur handler only aborts the cursor animation, so after
// the v6/v7 upgrade, typing in a note and then clicking ANY DOM element outside the
// canvas (toolbar button, theme toggle) left the editing twin live on the board with
// isEditing stuck (the commit then depended only on the 2s crash-guard debounce).
// Guard: only exit while still editing — fabric's own exitEditingImpl() blurs the
// textarea during exit, and the app's editing:exited handlers are idempotent.
const iTextProto = IText.prototype as unknown as Record<string, unknown>
const origEnterEditing = iTextProto.enterEditing as (this: { hiddenTextarea?: HTMLTextAreaElement | null; isEditing: boolean; exitEditing: () => unknown }, ...args: unknown[]) => unknown
if (typeof origEnterEditing === 'function') {
  iTextProto.enterEditing = function (this: { hiddenTextarea?: HTMLTextAreaElement | null; isEditing: boolean; exitEditing: () => unknown }, ...args: unknown[]) {
    const result = origEnterEditing.apply(this, args)
    const ta = this.hiddenTextarea
    if (ta && !(ta as HTMLTextAreaElement & { __hibBlurExit?: boolean }).__hibBlurExit) {
      ;(ta as HTMLTextAreaElement & { __hibBlurExit?: boolean }).__hibBlurExit = true
      ta.addEventListener('blur', () => {
        if (this.isEditing) this.exitEditing()
      })
    }
    return result
  }
}

declare global {
  interface Window {
    fabric: typeof fabric
  }
}

window.fabric = fabric

export default fabric
