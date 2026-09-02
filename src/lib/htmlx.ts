// src/lib/htmlx.ts — tiny typed HTML builder (Phase 0).
//
// Why this exists: ~3,000 lines of server HTML across the routes is built with raw
// template-literal concatenation + manual esc(). One missed esc() = an XSS hole, and
// there is no compiler help. This module inverts the safety property:
//
//   - `html` tagged template escapes every interpolated plain string by default.
//   - `raw(s)` / `safe(s)` marks an already-safe HTML fragment so it passes through.
//   - Forgetting to wrap a helper's HTML output in `raw()` produces VISIBLE breakage
//     (SVG renders as escaped text), not a silent security hole.
//
// Zero dependencies, ~75 lines, runs on Workers + Node. Existing helpers in `html.ts`
// (icon, STATUS_BADGE, progressBar, toastHtml) keep returning plain strings; callers
// wrap them with `raw()` when interpolating into an `html` tag. Old-style template
// literals elsewhere keep working unchanged — the migration is incremental.

/** A string known to already be safe HTML. Brand is runtime-visible so `render` can
 *  distinguish it from a plain (untrusted) string without relying on TS types. */
export interface SafeHtml {
  readonly __safeHtml: true
  readonly s: string
}

/** Mark an already-safe HTML string so `html` won't re-escape it. */
export function raw(s: string): SafeHtml {
  return { __safeHtml: true, s }
}
/** Alias for `raw` — same semantics, reads better at call sites. */
export const safe = raw

/** Escape a string for HTML text/attribute contexts. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  )
}

/** Build safe HTML. Plain string interpolations are escaped; `SafeHtml` passes through;
 *  null/undefined/false render empty (so `${cond && html\`...\`}` works); arrays render
 *  their items recursively. The result is itself `SafeHtml` so it composes. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]
    if (i < values.length) out += render(values[i])
  }
  return raw(out)
}

/** Render a single value per the rules above. Exported for callers that need to render
 *  without building a full template (e.g. mapping an array of SafeHtml fragments). */
export function render(v: unknown): string {
  if (v == null || v === false) return '' // null/undefined/false → empty
  if (v === true) return '' // booleans render empty (cond rendering)
  if (typeof v === 'number') return String(v) // numbers are safe (no injection)
  if (typeof v === 'string') return esc(v) // plain string → escape
  if (isSafe(v)) return v.s // SafeHtml → pass through
  if (Array.isArray(v)) return v.map(render).join('')
  return esc(String(v)) // objects/unknown → stringify + escape
}

/** Render any SafeHtml to a plain string for `c.html(...)`. */
export const toString = (h: SafeHtml): string => h.s

function isSafe(v: unknown): v is SafeHtml {
  return typeof v === 'object' && v !== null && (v as { __safeHtml?: true }).__safeHtml === true
}

/** Build an HTML attribute: `attr('href', url)` → ` href="…"`. Falsy values produce
 *  an empty string (attribute omitted); `true` produces a bare name (`disabled`). */
export function attr(name: string, value: unknown): string {
  if (value == null || value === false) return ''
  if (value === true) return ` ${name}`
  return ` ${name}="${esc(value)}"`
}
