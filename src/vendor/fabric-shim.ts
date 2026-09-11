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

declare global {
  interface Window {
    fabric: typeof fabric
  }
}

window.fabric = fabric

export default fabric
