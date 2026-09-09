import { Hono } from 'hono'
import { zipSync, strToU8 } from 'fflate'
import { requireAuth } from '../auth/middleware'
import { buildUserSnapshot } from '../services/backup'
import { buildObsidianVault } from '../services/obsidian-export'
import { clientIp, hitRateLimit, RATE_RULES } from '../services/ratelimit'
import { timeAgo, STATUS_LABEL } from '../lib/html'
import type { Config, ProjectRow, TagRow, UserRow } from '../types'
import type { TaskRow } from '../types'

// Export-everything (spec §5.8): one-click JSON or Markdown download of all data.
// SECURITY (2026-08-28): the JSON branch is USER-SCOPED — buildUserSnapshot() returns only
// the requesting user's rows. It previously called the whole-DB buildSnapshot() (the owner
// backup-cron shape), leaking every other user's data to any authenticated member.
// Rule 8 still applies: password_hash and sessions never appear in any export.
// R4.1: added /tasks.csv — a spreadsheet-friendly CSV of all client tasks.
// Session 15: added /obsidian.zip — the Obsidian vault export (a pack of .md files, one
// folder per app part, zipped). Mirrors the §9 import so the vault round-trips.

// CSV escaping per RFC 4180: wrap in quotes if it contains comma/quote/newline; double inner
// quotes. Formula-injection guard: a leading =, +, - or @ would execute as a formula in
// Excel/Sheets when the user opens their own export — prefix it with a quote (OWASP guidance).
function csvField(s: string | number | null | undefined): string {
  let v = String(s ?? '')
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"'
  return v
}

export function exportRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()
  app.use('*', requireAuth(cfg))

  // R4.1: CSV export of all client tasks — one row per task, joined to its project title.
  // Spreadsheet-friendly: opens directly in Excel/Google Sheets. Zero DB changes.
  app.get('/tasks.csv', async (c) => {
    const user = c.get('user')
    if (await hitRateLimit(cfg.db, RATE_RULES.export, clientIp(c))) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    const tasks = await cfg.db.query<TaskRow & { project_title: string; project_status: string }>(
      `SELECT t.id, t.title, t.done, t.due_date, t.created_at, t.completed_at,
              p.title AS project_title, p.status AS project_status
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE p.user_id = ? AND p.deleted_at IS NULL
       ORDER BY p.title, t.due_date, t.created_at`,
      [user.id],
    )
    const header = ['Project', 'Status', 'Task', 'Done', 'Due date', 'Created', 'Completed']
    const rows = tasks.map((t) => [
      csvField(t.project_title),
      csvField(t.project_status),
      csvField(t.title),
      t.done ? 'yes' : 'no',
      csvField(t.due_date ?? ''),
      csvField(t.created_at),
      csvField(t.completed_at ?? ''),
    ].join(','))
    const csv = header.join(',') + '\n' + rows.join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="hibana-tasks.csv"',
      },
    })
  })

  // Obsidian vault export (session 15, user request): a zip of .md files — one folder
  // per app part (Quick Notes / Projects / Ideas / To-Do Board / Canvas / Telegram
  // Captures) with a Home.md MOC — that the user can drop into a fresh Obsidian vault.
  // Same user-scoping discipline as the branches above; rides the same export rate rule.
  app.get('/obsidian.zip', async (c) => {
    const user = c.get('user')
    if (await hitRateLimit(cfg.db, RATE_RULES.export, clientIp(c))) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    const { files, stats } = await buildObsidianVault(cfg.db, user.id)
    const zipped: Record<string, Uint8Array> = {}
    for (const [path, md] of files) zipped[path] = strToU8(md)
    const zip = zipSync(zipped) // fflate: pure-JS, Worker + Node safe
    const day = new Date().toISOString().slice(0, 10)
    return new Response(zip, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="hibana-vault-${day}.zip"`,
        'X-Hibana-Vault-Files': String(files.size),
        'X-Hibana-Vault-Stats': JSON.stringify(stats),
      },
    })
  })

  app.get('/', async (c) => {
    const user = c.get('user')
    // Heavy-endpoint metering (hardening 2026-08-28): the snapshot runs ~20 queries and
    // serializes the whole account — 10/min per IP is far beyond any human need.
    if (await hitRateLimit(cfg.db, RATE_RULES.export, clientIp(c))) {
      return c.json({ error: 'rate_limited' }, 429)
    }
    const format = c.req.query('format') ?? 'json'
    const snapshot = await buildUserSnapshot(cfg.db, user.id)

    if (format === 'md') {
      // Human-readable Markdown rollup — a read you can actually scan (unlike the JSON).
      const projects = await cfg.db.query<ProjectRow>(
        'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
        [user.id],
      )
      const tags = await cfg.db.query<TagRow>('SELECT * FROM tags WHERE user_id = ?', [user.id])
      const tagNameById = new Map(tags.map((t) => [t.id, t.name]))
      let md = `# Hibana export — ${user.username ?? user.email}\n\n_Exported ${new Date().toISOString()}_\n\n`
      for (const p of projects) {
        const tagNames = snapshot.data.project_tags
          .filter((r) => (r as { project_id: string }).project_id === p.id)
          .map((r) => tagNameById.get((r as { tag_id: string }).tag_id) ?? '?')
        md += `## ${p.title} — ${STATUS_LABEL[p.status]}\n\n`
        md += `${p.description ? p.description + '\n\n' : ''}`
        md += `Updated ${timeAgo(p.updated_at)}\n\n`
        if (p.latest_note) md += `> Where I left off: ${p.latest_note}\n\n`
        if (tagNames.length) md += `Tags: ${tagNames.join(', ')}\n\n`
        md += '---\n\n'
      }
      return new Response(md, {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="hibana-export.md"' },
      })
    }

    const json = JSON.stringify(snapshot, null, 2)
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="hibana-export.json"',
      },
    })
  })

  return app
}