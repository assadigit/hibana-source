// Core — media routes: screenshots & docs (Phase 4 split from routes/core.ts).
//
// Purpose: the screenshot/doc surface — per-project grid (htmx + JSON), the
// cross-project gallery listing, delete-all, upload (content-sniffed, rated,
// size-capped, thumb best-effort), note/resolve/pin PATCH + self-heal thumb,
// byte serving (private cache, doc download disposition), delete (bytes +
// row + cover clear). Storage precedence KV → R2 → GitHub via shotStoreFor.
//
// Public API: registerCoreMedia(app, cfg) — registered by core/index.ts.
import { z } from 'zod'
import { jsonBody, sniffFileMime, isHtmx, type SniffedFileMime } from '../../lib/http'
import { getOwnedProject, toastHtml } from '../../lib/html'
import { localeOf, trFor } from '../../lib/i18n'
import { uuid } from '../../lib/ids'
import { shotStoreFor } from '../../services/shotstore'
import { clientIp, hitRateLimit, RATE_RULES } from '../../services/ratelimit'
import { uploadScreenshotSchema, uuidSchema } from '../../validation/schemas'
import { errJson, ErrorCode } from '../../lib/errors'
import { shotsGridHtml, shotTaskMap } from './shots-html'
import { ownedProjectId } from './ownership'
import type { Config, ScreenshotRow, UserRow } from '../../types'

export function registerCoreMedia(app: import('hono').Hono<{ Variables: { user: UserRow; reqId?: string } }>, cfg: Config) {
  // Session-9 F1 (2026-09-14): NO leading slash. The GitHub Contents API 422s on
  // `path cannot start with a slash` — the historic `/${user}/…` shape broke EVERY
  // screenshot upload (500 internal_error) and the feature never worked in prod
  // (0 rows ever, 0 error_log entries — it was unreachable in the UI's eyes). Backups
  // and avatars were unaffected: their paths never carried the leading slash.
  const assetPath = (p: { user_id: string; project_id: string }, kind: 'screenshots', filename: string) =>
    `${p.user_id}/${p.project_id}/${kind}/${filename}` // namespaced per user (spec §15)

  // ---- media (screenshots: KV → S3/R2 → GitHub, first configured wins) -------------
  // S38: Cloudflare Workers KV is the default store — free 1 GB on the account the
  // Worker already runs on, no card (R2's tier is payment-gated), values written with
  // NO expirationTtl → pictures never expire unless the user deletes them (the S38
  // requirement). S36's provider-generic S3 adapter stays the upgrade path (B2 10 GB)
  // via R2_* env vars; unset everything = GitHub Contents API exactly as before. The
  // `github_path` column stays (it is the storage key either way).
  // S39: the constructor moved to services/shotstore.ts so the project hard-delete +
  //  the purge cron clean remote bytes through the SAME precedence the routes use.
  const shotStore = shotStoreFor(cfg)

  async function ownedRecord(userId: string, id: string, table: 'screenshots') {
    return ownedProjectId(cfg, userId, table, id)
  }

  app.get('/api/projects/:projectId/screenshots', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const shots = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE project_id = ? ORDER BY created_at DESC', [p.id])
    if (isHtmx(c)) return c.html(shotsGridHtml(shots, localeOf(c), await shotTaskMap(cfg, shots)))
    return c.json({ screenshots: shots })
  })

  // S39 (user request: "archive gallery of pics, similar to wordpress — delete the
  // unneeded files to make up more space"): EVERY picture the user owns, across all
  // projects, in one listing. Joins project title (soft-deleted projects included —
  // their bytes are still real until purged, and the gallery is where you free them)
  // and the pinned task's title + status so each card can say where the picture
  // lives. totalBytes = the gallery's space meter (sum of the 0054 bytes column).
  app.get('/api/media', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<
      ScreenshotRow & {
        project_title: string
        project_deleted: string | null
        task_title: string | null
        task_status: string | null
      }
    >(
      `SELECT s.id, s.project_id, s.github_path, s.mime_type, s.caption, s.created_at, s.resolved, s.task_id, s.bytes, s.filename,
              p.title AS project_title, p.deleted_at AS project_deleted,
              dt.title AS task_title, dt.status AS task_status
       FROM screenshots s
       JOIN projects p ON p.id = s.project_id
       LEFT JOIN dev_tasks dt ON dt.id = s.task_id
       WHERE p.user_id = ?
       ORDER BY s.created_at DESC`,
      [user.id],
    )
    const totalBytes = rows.reduce((n, r) => n + (r.bytes || 0), 0)
    return c.json({ screenshots: rows, count: rows.length, totalBytes })
  })

  // S115 (owner: "we cannot afford to pile up hundreds or thousands of documents on
  // Cloudflare's free host — the gallery must have a Delete All"): ONE call purges
  // EVERY media row the user owns. The scope is EXACTLY the gallery's own listing
  // (the same JOIN as GET /api/media above — including shots of soft-deleted
  // projects, whose bytes are still real until purged); rule 1 honored through the
  // projects join. Byte-cleanup first (best-effort, the per-shot delete's order —
  // the row is the truth either way), then the rows in one statement.
  app.delete('/api/media/screenshots', async (c) => {
    const user = c.get('user')
    const rows = await cfg.db.query<{ id: string; github_path: string; bytes: number }>(
      'SELECT s.id, s.github_path, s.bytes FROM screenshots s JOIN projects p ON p.id = s.project_id WHERE p.user_id = ?',
      [user.id],
    )
    if (rows.length) {
      for (const r of rows) {
        try {
          if (r.github_path) {
            await shotStore.deleteObject(r.github_path)
            await shotStore.deleteObject(`${r.github_path}.thumb`) // the S69 tile rides along — no orphan
          }
        } catch { /* storage hiccup — the row still goes */ }
      }
      await cfg.db.execute('DELETE FROM screenshots WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)', [user.id])
    }
    return c.json({ ok: true, deleted: rows.length, bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0) })
  })

  app.post('/api/projects/:projectId/screenshots', async (c) => {
    // Phase 1 (PLAYBOOK §5 uploads — content sniffing): the declared mimeType must
    // match the sniffed magic bytes of the actual payload. Expectations: binary
    // formats must sniff as their exact container; the text formats (csv/md/txt)
    // have no magic and expect null — but a binary signature inside a declared text
    // file is still rejected. xlsx/docx are Office zips: the sniff proves "is a zip
    // container" — the exact flavor is indistinguishable at this layer and both
    // serve as attachments (S86) anyway. Only the leading ~48 bytes are decoded for
    // the sniff (slice(0, 64) of the base64, 4-aligned so atob never sees a partial
    // quantum) — the same trick the logo route uses.
    const SNIFF_EXPECTED: Record<string, SniffedFileMime | null> = {
      'image/png': 'image/png',
      'image/jpeg': 'image/jpeg',
      'image/webp': 'image/webp',
      'image/gif': 'image/gif',
      'video/webm': 'video/webm',
      'application/pdf': 'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
      'text/csv': null,
      'text/markdown': null,
      'text/plain': null,
    }
    // M8 fix (2026-09-10): wire the upload rate limiter — screenshots push bytes into the
    // storage backend (GitHub repo or R2 bucket), and under open registration (now
    // invite-only) an authed abuser could spam uploads unbounded. 30 req/60s per IP
    // matches the RATE_RULES.upload intent.
    if (await hitRateLimit(cfg.db, RATE_RULES.upload, clientIp(c))) {
      return c.json({ error: ErrorCode.rate_limited, message: 'Too many uploads — wait a minute and try again.' }, 429)
    }
    // P1.1 (F-H1): reject oversized uploads BEFORE jsonBody() buffers the whole body — a
    // 140 MB base64 payload would OOM the Worker. 7 MB Content-Length ceiling sits above
    // the 5 MB base64 Zod cap (which rejects the rest), so legit screenshots never trip it.
    const cl = Number(c.req.header('Content-Length') ?? 0)
    if (cl > 7_000_000) return errJson(c, ErrorCode.file_too_large)
    const body = await jsonBody<z.infer<typeof uploadScreenshotSchema>>(c, uploadScreenshotSchema)
    if (!body) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // Phase 1 (uploads hardening): content-sniff BEFORE any storage write — a
    // mislabeled payload (HTML bytes on an image/png path, a gif labeled png…) dies
    // at the boundary in every tier (disk/KV/R2/GitHub). The Zod allowlist regex
    // already guarantees body.mimeType is a key of SNIFF_EXPECTED (text types map
    // to null — no magic to contradict). Undecodable base64 is invalid_input (it
    // used to surface as a 500 from deep inside the storage tier).
    let head: Uint8Array
    try {
      head = Uint8Array.from(atob(body.dataBase64.slice(0, 64)), (ch) => ch.charCodeAt(0))
    } catch {
      return c.json({ error: ErrorCode.invalid_input, message: 'The file payload is not valid base64.' }, 400)
    }
    const sniffed = sniffFileMime(head)
    if (sniffed !== SNIFF_EXPECTED[body.mimeType]) {
      return c.json({ error: ErrorCode.mime_mismatch, message: 'The file contents do not match its declared type.' }, 400)
    }
    const id = body.id ?? uuid()
    const safeName = body.fileName.replace(/[^\w.\- ]/g, '_')
    const path = assetPath({ user_id: user.id, project_id: p.id }, 'screenshots', `${id}-${safeName}`)
    await shotStore.putObject(path, body.dataBase64, body.mimeType)
    // S69 (perf §10-F1): the grid-tile variant — a ≤320px WebP stored beside the
    // original (same key + '.thumb'). Best-effort: a failed thumb write must never
    // fail the upload itself (the original is the source of truth; the gallery falls
    // back to full-size + client self-heal).
    if (body.thumbBase64) {
      // Phase 1 (uploads hardening): the tile must really be a WebP container — a
      // mismatched or undecodable thumb is DROPPED, not a 400 (the original is the
      // source of truth; the grid falls back to full-size + client self-heal,
      // exactly like a failed thumb write).
      try {
        const thumbSniff = sniffFileMime(Uint8Array.from(atob(body.thumbBase64.slice(0, 64)), (ch) => ch.charCodeAt(0)))
        if (thumbSniff === 'image/webp') {
          await shotStore.putObject(`${path}.thumb`, body.thumbBase64, 'image/webp')
        }
      } catch { /* tile falls back to the original */ }
    }
    // S39 (0054): exact decoded size — base64 without padding × 3/4. Never re-encoded,
    // never estimated: the gallery's space meter sums THIS column.
    const byteLen = Math.floor(body.dataBase64.replace(/=+$/, '').length * 3 / 4)
    // S86 (0059): the ORIGINAL file name rides the row — doc tiles (PDF/XLSX/…) show
    // it; image rows keep it too (the lightbox title can use it later). Sanitized to
    // the same safe-charset as the stored path so it can never smuggle control chars
    // into the Content-Disposition header on serve.
    const displayName = (body.filename || body.fileName || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || safeName
    await cfg.db.execute(
      'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, resolved, task_id, bytes, filename, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)',
      [id, p.id, path, body.mimeType, body.caption, byteLen, displayName, new Date().toISOString()],
    )
    // S161 (spec #3): an image add is a field edit — the idea's updated_at bumps (the
    // newest-upload-is-the-thumb default follows created_at, but the folder's Updated
    // metric + shelf recency ride updated_at).
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [new Date().toISOString(), p.id])
    if (isHtmx(c)) return c.html(toastHtml(body.mimeType.startsWith('image/') ? t('Screenshot uploaded', 'اسکرین‌شات آپلود شد') : t('File uploaded', 'فایل آپلود شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true, id, mimeType: body.mimeType }, 201)
  })

  // S35: the note + the open/fixed state are editable after upload — the note is the
  // "what & where to work" text, resolved flips when the fix lands (and back).
  // S39: taskId sticks the shot to a progress-box item (0054) — uuid = pin, '' or
  // null = unpin. The task must live in the SAME project (a shot can't cross
  // projects) and belong to the caller (rule 1, through the projects join).
  const patchScreenshotSchema = z.object({
    caption: z.string().max(1000).optional(),
    resolved: z.union([z.literal(0), z.literal(1)]).optional(),
    taskId: z.union([uuidSchema, z.literal(''), z.null()]).optional(),
    // S69 self-heal: the gallery generates the ≤320px WebP tile for legacy shots (the
    // ones whose ?variant=thumb fell back with X-Hibana-Thumb: miss) and PUTs it here
    // once — best-effort, capped, and NEVER over DB state (object-store only).
    thumbBase64: z.string().min(1).max(120_000).optional(),
  })
  app.patch('/api/screenshots/:id', async (c) => {
    const body = await jsonBody<z.infer<typeof patchScreenshotSchema>>(c, patchScreenshotSchema)
    if (!body || (body.caption === undefined && body.resolved === undefined && body.taskId === undefined && body.thumbBase64 === undefined)) return errJson(c, ErrorCode.invalid_input)
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return errJson(c, ErrorCode.not_found)
    if (body.taskId !== undefined && body.taskId !== '' && body.taskId !== null) {
      const owned = await cfg.db.query<{ id: string }>(
        'SELECT dt.id FROM dev_tasks dt JOIN projects p ON p.id = dt.project_id WHERE dt.id = ? AND p.user_id = ? AND p.deleted_at IS NULL AND dt.project_id = ?',
        [body.taskId, user.id, projectId],
      )
      if (!owned.length) return errJson(c, ErrorCode.task_not_found)
    }
    const now = new Date().toISOString()
    if (body.caption !== undefined) {
      await cfg.db.execute('UPDATE screenshots SET caption = ? WHERE id = ? AND project_id = ?', [body.caption, c.req.param('id'), projectId])
    }
    if (body.resolved !== undefined) {
      await cfg.db.execute('UPDATE screenshots SET resolved = ? WHERE id = ? AND project_id = ?', [body.resolved, c.req.param('id'), projectId])
    }
    if (body.taskId !== undefined) {
      const target = body.taskId === '' || body.taskId === null ? null : body.taskId
      await cfg.db.execute('UPDATE screenshots SET task_id = ? WHERE id = ? AND project_id = ?', [target, c.req.param('id'), projectId])
    }
    // S69: the self-heal tile write — after the field updates so a bad thumb can never
    // mask a real edit. Object-store only; a failure is silent (the next miss retries).
    if (body.thumbBase64 !== undefined) {
      const row = await cfg.db.query<{ github_path: string }>('SELECT github_path FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
      if (row[0]?.github_path) {
        try { await shotStore.putObject(`${row[0].github_path}.thumb`, body.thumbBase64, 'image/webp') } catch { /* best-effort */ }
      }
    }
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    if (isHtmx(c)) return c.html(toastHtml(t('Saved', 'ذخیره شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })

  app.get('/api/media/screenshots/:id/file', async (c) => {
    const user = c.get('user')
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return errJson(c, ErrorCode.not_found)
    const rec = await cfg.db.query<ScreenshotRow>('SELECT * FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    // S116 (CI evidence): a row whose STORED OBJECT is gone (a purged KV entry, an
    // expired storage backend, a stale local-e2e DB) used to surface as an unhandled
    // ENOENT / storage-HTTP-error 500 via app.onError — the gallery tile got a
    // console error and nothing else. The row is the truth (it 404s above); a missing
    // OBJECT is the same fact one layer deeper, so it degrades to the SAME 404 and
    // the tile renders its alt/empty state instead of blaming the server.
    const getObjectOrNull = async (key: string): Promise<ArrayBuffer | null> => {
      try {
        return await shotStore.getObject(key)
      } catch {
        return null
      }
    }
    // S69 (perf §10-F1): ?variant=thumb serves the ≤320px WebP tile when one exists —
    // the gallery grid no longer transfers full-size originals. A miss (legacy shots,
    // or a failed thumb write) falls back to the original bytes and says so via
    // X-Hibana-Thumb: miss, which the gallery uses to self-heal (generate + PATCH the
    // thumb once, best-effort — every later visit on any device gets the cheap tile).
    const wantThumb = c.req.query('variant') === 'thumb'
    let bytes: ArrayBuffer | null
    let mime = rec[0].mime_type
    let thumbMiss = false
    if (wantThumb) {
      bytes = await getObjectOrNull(`${rec[0].github_path}.thumb`)
      if (bytes) {
        mime = 'image/webp'
      } else {
        bytes = await getObjectOrNull(rec[0].github_path)
        if (!bytes) return errJson(c, ErrorCode.not_found)
        thumbMiss = true
      }
    } else {
      bytes = await getObjectOrNull(rec[0].github_path) // raw bytes — never text-decoded
      if (!bytes) return errJson(c, ErrorCode.not_found)
    }
    if (!bytes) return errJson(c, ErrorCode.not_found) // unreachable — narrows the type
    // S39 self-heal: legacy rows (pre-0054) have bytes=0; the object is ALREADY in
    // hand here, so record its true size once — the gallery's space meter goes honest
    // on the first view. Idempotent (guarded by bytes = 0) + best-effort (a failed
    // write never breaks the picture).
    if (rec[0].bytes === 0 && bytes.byteLength > 0) {
      try { await cfg.db.execute('UPDATE screenshots SET bytes = ? WHERE id = ? AND bytes = 0', [bytes.byteLength, c.req.param('id')]) } catch { /* meter stays 0 — harmless */ }
    }
    const headers: Record<string, string> = { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' }
    if (thumbMiss) headers['X-Hibana-Thumb'] = 'miss'
    // S86: doc uploads (PDF/XLSX/…) download instead of rendering inline — the
    // browser has no inline viewer inside an authed XHR-fetched blob flow, and the
    // display name is the point of a doc tile. Filename falls back to the stored
    // path's basename (legacy rows pre-0059 have no filename column value).
    if (!String(mime).startsWith('image/')) {
      const rec2 = rec[0] as { filename?: string | null; github_path: string }
      const base = (rec2.github_path || '').split('/').pop() || 'file'
      const name = rec2.filename || base.replace(/^[0-9a-f-]{36}-/i, '') || 'file'
      headers['Content-Disposition'] = `attachment; filename="${name.replace(/["\\\r\n]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
    return new Response(bytes, { headers })
  })

  app.delete('/api/screenshots/:id', async (c) => {
    const user = c.get('user')
    const t = trFor(c)
    const projectId = await ownedRecord(user.id, c.req.param('id'), 'screenshots')
    if (!projectId) return errJson(c, ErrorCode.not_found)
    // S35: clean the remote bytes too (best-effort — the row is the truth either way).
    // S69: the .thumb sibling object rides along — a deleted shot leaves no tile orphan.
    const rec = await cfg.db.query<ScreenshotRow>('SELECT github_path FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    try {
      if (rec[0]?.github_path) {
        await shotStore.deleteObject(rec[0].github_path)
        await shotStore.deleteObject(`${rec[0].github_path}.thumb`)
      }
    } catch { /* storage hiccup — the row still goes */ }
    await cfg.db.execute('DELETE FROM screenshots WHERE id = ? AND project_id = ?', [c.req.param('id'), projectId])
    // S161 (spec #4): a deleted image can no longer be anybody's cover — the projects
    // whose cover_shot_id pointed here fall back to their latest upload (NULL clear).
    // And spec #3: the delete itself is a field edit — updated_at bumps.
    // Phase 1 (SC-5, P1-a-3): belt-and-suspenders user scoping on the clear — only the
    // caller's own projects lose their cover. A drift row (some other user's project
    // pointing at this shot via legacy restore/DB tampering) keeps its value; the serve
    // path already degrades a missing shot to the fallback thumb.
    const now = new Date().toISOString()
    await cfg.db.execute('UPDATE projects SET cover_shot_id = NULL WHERE cover_shot_id = ? AND user_id = ?', [c.req.param('id'), user.id])
    await cfg.db.execute('UPDATE projects SET updated_at = ? WHERE id = ?', [now, projectId])
    if (isHtmx(c)) return c.html(toastHtml(t('Screenshot deleted', 'اسکرین‌شات حذف شد'), localeOf(c), undefined, 'ok'))
    return c.json({ ok: true })
  })
}
