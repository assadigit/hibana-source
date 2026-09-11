import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Context } from 'hono'

// Single-origin decision (Q1-A): routes serve JSON to fetch()/the offline queue and
// HTML fragments to htmx. This header is the toggle, so one route covers both consumers.
export const isHtmx = (c: Context): boolean => c.req.header('HX-Request') !== undefined

// The app's own origin as the caller saw it — the canonical base for links we hand out
// (email reset links, Telegram deep links). Derived from the request so it stays correct
// on any deployment (Workers prod/dev, local Node, a self-hosted VPS) instead of a
// hardcoded dev hostname.
export const requestOrigin = (c: Context): string => new URL(c.req.url).origin

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)

// P3 (Focus 2): image mime/extension helpers. Previously logo + avatar uploads stored
// every file as .png regardless of mime, and served with hardcoded Content-Type: image/png
// — a JPEG or WebP upload got the wrong extension + wrong Content-Type. These helpers
// derive the correct values from the actual mime type (upload) and stored path (serve).
export function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  return '.png'
}
export function mimeForPath(path: string): string {
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

export const jsonError = (c: Context, status: ContentfulStatusCode, message: string): Response =>
  c.json({ error: message }, status)

// Zod body parsing for every route (rule 10) — JSON or form-encoded (htmx forms).
// Returns null on parse failure; routes reply 400 consistently.
// The schema type is deliberately input-loose: schemas with .default()/coerce() have
// different input/output types, and we always hand back the *output* (validated) type.
export async function jsonBody<T>(c: Context, schema: import('zod').ZodType<T, any, any>): Promise<T | null> {
  const contentType = c.req.header('Content-Type') ?? ''
  let parsed: unknown
  try {
    if (contentType.includes('application/json')) {
      parsed = await c.req.json()
    } else {
      const form = await c.req.parseBody()
      const obj: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(form)) obj[k] = v
      parsed = obj
    }
  } catch {
    parsed = null
  }
  const result = schema.safeParse(parsed)
  if (!result.success) return null
  return result.data
}

// ETag helper for read endpoints (Phase B1.3). Computes a weak ETag from the response
// body, sets `Cache-Control: private, no-cache` (cacheable by the browser only, must
// revalidate), and returns 304 when the client's `If-None-Match` matches. This saves
// bandwidth + render time on repeat loads where nothing changed (e.g. navigating back
// to the dashboard). The DB cost is the same — the value is payload size + the browser
// skipping the re-render. Per-user content → `private` (never a shared/CDN cache).
//
// Usage in a route: `return etag(c, c.html(fragment))` or `return etag(c, c.json(data))`.
// Wrap the *final* response right before returning it.
export async function etag(c: Context, res: Response): Promise<Response> {
  try {
    const body = await res.clone().text()
    if (!body) return res // empty body — skip
    // FNV-1a 32-bit hash — fast, dependency-free, good enough for a weak validator.
    let h = 0x811c9dc5
    for (let i = 0; i < body.length; i++) {
      h ^= body.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    const tag = `W/"${(h >>> 0).toString(36)}"`
    const inm = c.req.header('If-None-Match')
    if (inm && inm === tag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: tag, 'Cache-Control': 'private, no-cache' },
      })
    }
    const out = res.clone()
    out.headers.set('ETag', tag)
    out.headers.set('Cache-Control', 'private, no-cache')
    return out
  } catch {
    return res // any failure → return the original response unchanged (safe fallback)
  }
}