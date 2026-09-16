import type { Db } from '../db/types'
import type { ProjectRow, TagRow, HurdleRow, LinkRow, ScreenshotRow, PaymentRow, TaskRow, DevTaskRow, TaskCategory, SprintRow, BacklogDocRow, NoteFolderRow, VaultNoteRow } from '../types'

// Obsidian vault EXPORT (session 15, user request): the mirror of the §9 Obsidian import.
// The import side (src/lib/obsidian.ts + /api/import/obsidian) turns a pack of .md files
// into Ideas; this service turns the account BACK into a pack of .md files — one folder
// per app part — so the zip can be dropped into a fresh Obsidian vault as-is.
//
// Vault layout (folder per part, file per record where records are rich):
//   Hibana-Backup-<date>/Home.md              — MOC: export stamp, per-part counts, note links
//   Hibana-Backup-<date>/Quick Notes.md       — all sticky/list notes (## per note)
//   Hibana-Backup-<date>/Projects/<t>.md      — one note per non-spark project, with its
//                                               hurdles, links, payments, screenshots,
//                                               history, client tasks, dev board, sprints,
//                                               backlog docs inlined as sections
//   Hibana-Backup-<date>/Ideas/<t>.md         — one note per spark (idea) + its history
//   Hibana-Backup-<date>/Notes/<folder>/<t>.md — one file per vault note, mirroring the
//                                               folder tree (0057, S53); unfiled notes
//                                               sit directly under Notes/
//   Hibana-Backup-<date>/To-Do Board.md       — sadhana tasks grouped by quadrant + updates log
//   Hibana-Backup-<date>/Canvas.md            — text-bearing canvas/notebook elements
//   Hibana-Backup-<date>/Telegram Captures.md — the capture inbox
//
// Round-trip contract with the import: every file's first heading is the record's exact
// title, so re-importing this vault into Hibana dedups (title match, case-insensitive)
// instead of duplicating. Soft-deleted rows are excluded (trash is not content).
// Rule 1: every query is scoped to the requesting user — the same discipline the JSON
// export was fixed for in 2026-08-28.

/** path → markdown text. The route UTF-8-encodes + zips this. */
type VaultFiles = Map<string, string>

interface VaultStats {
  projects: number
  ideas: number
  quickNotes: number
  vaultNotes: number
  todoTasks: number
  canvasElements: number
  telegramCaptures: number
}

// --- filename hygiene ------------------------------------------------------------
// Obsidian accepts almost anything, but Windows (where many vaults live) forbids
// \/:*?"<>|, control chars, leading/trailing dots; and '/' can never appear in a zip
// path segment. Cap at 80 chars so long Persian titles stay usable; dedupe via the
// used-set so two projects with the same title never overwrite each other's file.
/** Zip-path segment hygiene (Notes export, 0057): a FOLDER name becomes a path
 *  segment, so it gets the same Windows-illegal + control-char scrub as file names —
 *  minus the dedupe (segments may repeat across different folders) and the .md tail. */
export function safePathSegment(name: string): string {
  const seg = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
  return [...seg].length > 60 ? [...seg].slice(0, 60).join('').trim() : seg || 'Folder'
}

export function safeMdName(title: string, used: Set<string>): string {
  let base = title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[. ]+|[. ]+$/g, '')
  if ([...base].length > 80) base = [...base].slice(0, 80).join('').trim()
  if (!base) base = 'Untitled'
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${n}`
  used.add(name.toLowerCase())
  return `${name}.md`
}

// --- YAML frontmatter ------------------------------------------------------------
// Minimal, Dataview-friendly. JSON.stringify produces a valid quoted YAML scalar for any
// Persian/emoji content; bare scalars stay unquoted for readability. Empty string values
// are omitted (frontmatter stays terse).
const yamlScalar = (v: string | number | boolean): string =>
  typeof v === 'string' && /^[A-Za-z0-9_.-]+$/.test(v) ? v : JSON.stringify(v)

const yamlList = (values: string[]): string =>
  values.length ? `[${values.map(yamlScalar).join(', ')}]` : '[]'

type FmValue = string | number | boolean | string[]

function frontmatter(fields: Array<[string, FmValue]>): string {
  const lines = fields
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? yamlList(v) : yamlScalar(v)}`)
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}

const isoDate = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '')

/** Loose row shapes that types.ts doesn't export. */
interface HistoryRow { project_id: string; note: string; created_at: string }
interface QuickNoteRow { id: string; kind: 'note' | 'list'; title: string; content: string; color: string; note_date: string | null; sticky: 0 | 1; created_at: string; updated_at: string }
interface SadhanaRow { id: string; quadrant: number; title: string; emoji: string; fuzzy: string | null; due_date: string | null; due_time: string | null; done: number; progress: string; note: string; recurring: number; recur_type: string | null; created_at: string; updated_at: string }
interface QuadrantNameRow { quadrant: number; name: string; subtitle: string | null }
interface SadhanaUpdateRow { task_id: string; text: string; created_at: string }
interface CanvasRow { board: string; type: string; x: number; y: number; content: string; created_at: string }
interface CaptureRow { raw_text: string; received_at: string; promoted: number }
interface ListItems { t: string; d: 0 | 1 }

/** Quick-note list content is JSON `[{id, t, d}]` (quicknotes.ts) → markdown checkboxes. */
function noteBody(n: QuickNoteRow): string {
  if (n.kind !== 'list') return n.content.trim()
  try {
    const items = JSON.parse(n.content) as ListItems[]
    if (!Array.isArray(items)) return n.content.trim()
    return items.map((it) => `- [${it.d ? 'x' : ' '}] ${String(it.t ?? '').trim()}`).join('\n')
  } catch {
    return n.content.trim()
  }
}

/** Group helper: children keyed by project_id. */
function groupBy<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const list = map.get(r.project_id)
    if (list) list.push(r)
    else map.set(r.project_id, [r])
  }
  return map
}

/**
 * Build the whole vault for one user. Pure read path — no writes, no secrets
 * (password_hash / sessions never appear; only content tables are touched).
 */
export async function buildObsidianVault(
  db: Db,
  userId: string,
  opts: { now?: Date; vaultName?: string } = {},
): Promise<{ files: VaultFiles; stats: VaultStats; missing: string[] }> {
  const now = opts.now ?? new Date()
  const stamp = now.toISOString()
  const root = opts.vaultName ?? `Hibana-Backup-${stamp.slice(0, 10)}`
  const files: VaultFiles = new Map()
  const stats: VaultStats = { projects: 0, ideas: 0, quickNotes: 0, vaultNotes: 0, todoTasks: 0, canvasElements: 0, telegramCaptures: 0 }

  // Sub-select keeps every child-table query valid even for an empty account (no dynamic
  // "IN ()" placeholder building) and re-applies the user scope + live filter.
  const IN_LIVE_PROJECTS = 'IN (SELECT id FROM projects WHERE user_id = ? AND deleted_at IS NULL)'

  // ---- gather (all user-scoped; soft-deleted rows excluded) ----------------------
  const projects = await db.query<ProjectRow>(
    'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
    [userId],
  )

  const [folders, tags, hurdles, links, shots, payments, history, clientTasks, devTasks, categories, sprints, backlog, projectTagRows] = await Promise.all([
    db.query<{ id: string; name: string }>('SELECT id, name FROM spark_folders WHERE user_id = ?', [userId]),
    db.query<TagRow>('SELECT * FROM tags WHERE user_id = ?', [userId]),
    db.query<HurdleRow>(`SELECT * FROM hurdles WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY sort_order, created_at`, [userId]),
    db.query<LinkRow>(`SELECT * FROM links WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY created_at`, [userId]),
    db.query<ScreenshotRow>(`SELECT * FROM screenshots WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY created_at`, [userId]),
    db.query<PaymentRow>(`SELECT * FROM payments WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY created_at`, [userId]),
    db.query<HistoryRow>(`SELECT project_id, note, created_at FROM project_history_log WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY created_at`, [userId]),
    db.query<TaskRow>(`SELECT * FROM tasks WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY created_at`, [userId]),
    db.query<DevTaskRow>(`SELECT * FROM dev_tasks WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY sort_order, created_at`, [userId]),
    db.query<TaskCategory>(`SELECT * FROM task_categories WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY sort_order`, [userId]),
    db.query<SprintRow>(`SELECT * FROM sprints WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY started_at`, [userId]),
    db.query<BacklogDocRow>(`SELECT * FROM backlog_docs WHERE project_id ${IN_LIVE_PROJECTS} ORDER BY updated_at`, [userId]),
    db.query<{ project_id: string; tag_id: string }>(`SELECT project_id, tag_id FROM project_tags WHERE project_id ${IN_LIVE_PROJECTS}`, [userId]),
  ])

  const quickNotes = await db.query<QuickNoteRow>(
    'SELECT id, kind, title, content, color, note_date, sticky, created_at, updated_at FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at',
    [userId],
  )
  // Notes Vault (0057, S53): the /notes knowledge base exports as real per-note files
  // inside the folder tree — the closest thing to an Obsidian vault inside the backup.
  // S57 schema-race guard (mirrors buildSnapshot's missing_tables discipline): a deployed
  // Worker can be AHEAD of a remote D1's applied migrations (this exact window — code
  // schema 56 shipped while prod/dev D1 sat on 55 — made /api/export/obsidian.zip throw
  // "no such table: note_folders" and the user's backup button returned a 500 with NO
  // file). When the vault tables aren't there yet, the export degrades to "no Notes
  // section" instead of dying: a backup minus one future feature beats no backup at all.
  // Only "no such table" is swallowed — every other error still propagates.
  let noteFolders: NoteFolderRow[] = []
  let vaultNotes: VaultNoteRow[] = []
  const missing: string[] = []
  try {
    ;[noteFolders, vaultNotes] = await Promise.all([
      db.query<NoteFolderRow>('SELECT id, parent_id, name FROM note_folders WHERE user_id = ?', [userId]),
      db.query<VaultNoteRow>(
        'SELECT id, folder_id, title, content, tags, starred, created_at, updated_at FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC',
        [userId],
      ),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/no such table/i.test(msg)) throw err
    missing.push('note_folders', 'vault_notes')
    console.warn(`[obsidian-export] vault tables not migrated yet — exporting without the Notes section (${msg})`)
  }
  const todoTasks = await db.query<SadhanaRow>(
    'SELECT id, quadrant, title, emoji, fuzzy, due_date, due_time, done, progress, note, recurring, recur_type, created_at, updated_at FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL ORDER BY quadrant, position',
    [userId],
  )
  const [quadrantNames, sadhanaUpdates, canvas, captures] = await Promise.all([
    db.query<QuadrantNameRow>('SELECT quadrant, name, subtitle FROM sadhana_quadrant_names WHERE user_id = ?', [userId]),
    db.query<SadhanaUpdateRow>(
      `SELECT task_id, text, created_at FROM sadhana_updates WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL) ORDER BY created_at`,
      [userId],
    ),
    // Text-bearing types only (search.ts discipline): strokes are point paths, images/
    // frames/shapes carry no prose. `deleted` is the 0/1 tombstone on this table.
    db.query<CanvasRow>(
      "SELECT board, type, x, y, content, created_at FROM canvas_elements WHERE user_id = ? AND deleted = 0 AND type IN ('note', 'comment', 'block', 'sticky') AND content != '' ORDER BY board, created_at",
      [userId],
    ),
    db.query<CaptureRow>(
      'SELECT raw_text, received_at, promoted FROM telegram_captures WHERE user_id = ? ORDER BY received_at',
      [userId],
    ),
  ])

  // ---- indexes -------------------------------------------------------------------
  const tagName = new Map(tags.map((t) => [t.id, t.name]))
  const tagsFor = (pid: string): string[] =>
    projectTagRows.filter((r) => r.project_id === pid).map((r) => tagName.get(r.tag_id) ?? '').filter(Boolean)
  const folderName = new Map(folders.map((f) => [f.id, f.name]))

  const hurdlesBy = groupBy(hurdles)
  const linksBy = groupBy(links)
  const shotsBy = groupBy(shots)
  const paymentsBy = groupBy(payments)
  const historyBy = groupBy(history)
  const tasksBy = groupBy(clientTasks)
  const devBy = groupBy(devTasks)
  const catsBy = groupBy(categories)
  const sprintsBy = groupBy(sprints)
  const backlogBy = groupBy(backlog)

  const usedProjectNames = new Set<string>()
  const usedIdeaNames = new Set<string>()

  // ---- per-record note builders ---------------------------------------------------
  const projectNote = (p: ProjectRow): string => {
    const fm = frontmatter([
      ['type', 'project'],
      ['status', p.status],
      ['client', p.type === 'client' ? p.client_name ?? '' : ''],
      ['due', p.due_date ?? ''],
      ['progress', p.progress_percent ?? ''],
      ['archived', p.archived_state === 'offline'],
      ['tags', tagsFor(p.id)],
      ['created', isoDate(p.created_at)],
      ['updated', isoDate(p.updated_at)],
      ['hibana', p.id],
    ])
    const sections: string[] = []
    sections.push(`# ${p.title}\n`)
    if (p.latest_note) sections.push(`> [!note] Where I left off\n> ${p.latest_note.replace(/\n/g, '\n> ')}\n`)
    if (p.description.trim()) sections.push(`${p.description.trim()}\n`)
    const meta: string[] = [`**Status:** ${p.status}`]
    if (p.type === 'client' && p.client_name) meta.push(`**Client:** ${p.client_name}`)
    if (p.due_date) meta.push(`**Due:** ${p.due_date}`)
    if (p.progress_percent != null) meta.push(`**Progress:** ${p.progress_percent}%`)
    if (p.archived_state === 'offline') meta.push('**Archived:** yes')
    sections.push(`${meta.join(' · ')}\n`)

    const h = hurdlesBy.get(p.id)
    if (h?.length) {
      sections.push(`## Hurdles\n\n${h.map((x) => `- [${x.status === 'solved' ? 'x' : ' '}] ${x.text}${x.solved_at ? ` _(${isoDate(x.solved_at)})_` : ''}`).join('\n')}\n`)
    }
    const l = linksBy.get(p.id)
    if (l?.length) sections.push(`## Links\n\n${l.map((x) => `- [${x.label}](${x.url})`).join('\n')}\n`)
    const pay = paymentsBy.get(p.id)
    if (pay?.length) {
      sections.push(`## Payments\n\n${pay.map((x) => `- ${x.label} — ${x.amount} ${x.currency}${x.status === 'paid' ? ` _paid ${isoDate(x.paid_at)}_` : ' _pending_'}`).join('\n')}\n`)
    }
    const sh = shotsBy.get(p.id)
    if (sh?.length) {
      sections.push(`## Screenshots\n\n${sh.map((x) => `- ${x.caption || 'Screenshot'} (${x.mime_type}) — media lives in the Hibana assets repo, not this vault`).join('\n')}\n`)
    }
    const hist = historyBy.get(p.id)
    if (hist?.length) {
      sections.push(`## History\n\n${hist.map((x) => `- **${isoDate(x.created_at)}** — ${x.note}`).join('\n')}\n`)
    }
    const ct = tasksBy.get(p.id)
    if (ct?.length) {
      sections.push(`## Client tasks\n\n${ct.map((x) => `- [${x.done ? 'x' : ' '}] ${x.title}${x.due_date ? ` _due ${x.due_date}_` : ''}`).join('\n')}\n`)
    }
    const dt = devBy.get(p.id)
    if (dt?.length) {
      const cats = catsBy.get(p.id) ?? []
      const catName = new Map(cats.map((c) => [c.id, c.name]))
      const byCat = new Map<string, DevTaskRow[]>()
      for (const t of dt) {
        const key = t.category_id ? catName.get(t.category_id) ?? 'Uncategorized' : 'Uncategorized'
        const list = byCat.get(key)
        if (list) list.push(t)
        else byCat.set(key, [t])
      }
      const catBlocks = [...byCat.entries()].map(([cn, list]) =>
        `### ${cn}\n\n${list.map((t) => `- [${t.status === 'done' ? 'x' : ' '}] ${t.title} _(${t.status}${t.priority !== 'medium' ? `, ${t.priority}` : ''})_`).join('\n')}`,
      )
      sections.push(`## Dev board\n\n${catBlocks.join('\n\n')}\n`)
    }
    const sp = sprintsBy.get(p.id)
    if (sp?.length) {
      sections.push(`## Sprints\n\n${sp.map((x) => `- **${x.name}** — ${isoDate(x.started_at)} → ${x.ended_at ? isoDate(x.ended_at) : 'open'}${x.is_draft ? ' _(draft)_' : ''}`).join('\n')}\n`)
    }
    const bl = backlogBy.get(p.id)
    if (bl?.length) {
      sections.push(`## Backlog notes (برنامه آتی)\n\n${bl.map((x) => `### ${x.title}\n\n${x.content.trim()}\n`).join('')}`)
    }
    return fm + sections.join('\n')
  }

  const ideaNote = (p: ProjectRow): string => {
    const fm = frontmatter([
      ['type', 'idea'],
      ['folder', p.folder_id ? folderName.get(p.folder_id) ?? '' : ''],
      ['tags', tagsFor(p.id)],
      ['created', isoDate(p.created_at)],
      ['updated', isoDate(p.updated_at)],
      ['hibana', p.id],
    ])
    const sections: string[] = []
    sections.push(`# ${p.title}\n`)
    if (p.description.trim()) sections.push(`${p.description.trim()}\n`)
    if (p.latest_note) sections.push(`> [!note] Where I left off\n> ${p.latest_note.replace(/\n/g, '\n> ')}\n`)
    const hist = historyBy.get(p.id)
    if (hist?.length) {
      sections.push(`## History\n\n${hist.map((x) => `- **${isoDate(x.created_at)}** — ${x.note}`).join('\n')}\n`)
    }
    return fm + sections.join('\n')
  }

  // ---- part files -----------------------------------------------------------------
  const projectLinks: string[] = []
  const ideaLinks: string[] = []
  for (const p of projects) {
    if (p.status === 'spark') {
      const fname = safeMdName(p.title, usedIdeaNames)
      files.set(`${root}/Ideas/${fname}`, ideaNote(p))
      ideaLinks.push(`- [[Ideas/${fname.replace(/\.md$/, '')}]]`)
      stats.ideas++
    } else {
      const fname = safeMdName(p.title, usedProjectNames)
      files.set(`${root}/Projects/${fname}`, projectNote(p))
      projectLinks.push(`- [[Projects/${fname.replace(/\.md$/, '')}]]`)
      stats.projects++
    }
  }

  // ---- Notes Vault (0057): one file per note, folder tree mirrored into the path ----
  const noteLinks: string[] = []
  if (vaultNotes.length) {
    stats.vaultNotes = vaultNotes.length
    // folder path builder (cycle-guarded — moves are cycle-checked at the API, but the
    // export must never infinite-loop on any historical shape)
    const folderById = new Map(noteFolders.map((f) => [f.id, f]))
    const pathOf = (folderId: string | null): string => {
      const parts: string[] = []
      const seen = new Set<string>()
      let cur = folderId ? folderById.get(folderId) : undefined
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id)
        parts.unshift(safePathSegment(cur.name))
        cur = cur.parent_id ? folderById.get(cur.parent_id) : undefined
      }
      return parts.join('/')
    }
    // one dedupe set PER folder path — same-titled notes in different folders coexist
    const usedByFolder = new Map<string, Set<string>>()
    for (const n of vaultNotes) {
      const dir = pathOf(n.folder_id)
      const key = dir || '.'
      if (!usedByFolder.has(key)) usedByFolder.set(key, new Set())
      const fname = safeMdName(n.title.trim() || 'Untitled note', usedByFolder.get(key)!)
      const rel = dir ? `Notes/${dir}/${fname}` : `Notes/${fname}`
      const fm = frontmatter([
        ['type', 'note'],
        ['folder', dir.replace(/\//g, ' / ')],
        ['tags', n.tags.split(',').map((t) => t.trim()).filter(Boolean)],
        ['starred', n.starred === 1],
        ['created', isoDate(n.created_at)],
        ['updated', isoDate(n.updated_at)],
        ['hibana', n.id],
      ])
      files.set(`${root}/${rel}`, fm + `# ${n.title.trim() || 'Untitled note'}\n\n${n.content.trim()}\n`)
      noteLinks.push(`- [[${rel.replace(/\.md$/, '')}]]`)
    }
  }

  if (quickNotes.length) {
    stats.quickNotes = quickNotes.length
    const blocks = quickNotes.map((n) => {
      const heading = n.title.trim() || (n.kind === 'list' ? 'List' : (n.content.split('\n')[0] || 'Note').slice(0, 60))
      const meta = [isoDate(n.created_at), n.color !== 'yellow' ? n.color : '', n.kind === 'list' ? 'list' : '', n.sticky ? 'sticky' : ''].filter(Boolean).join(' · ')
      const body = noteBody(n)
      return `## ${heading}\n\n${body}${body ? '\n' : ''}_${meta}_\n`
    })
    files.set(`${root}/Quick Notes.md`, frontmatter([['type', 'quick-notes']]) + `# Quick Notes\n\n` + blocks.join('\n'))
  }

  if (todoTasks.length) {
    stats.todoTasks = todoTasks.length
    const nameByQ = new Map(quadrantNames.map((q) => [q.quadrant, q.name]))
    const defaultQ: Record<number, string> = { 1: 'Daily', 2: 'Strategic', 3: 'Urgent', 4: 'Personal' }
    const byQ = new Map<number, SadhanaRow[]>()
    for (const t of todoTasks) {
      const list = byQ.get(t.quadrant)
      if (list) list.push(t)
      else byQ.set(t.quadrant, [t])
    }
    const qBlocks = [...byQ.entries()].sort((a, b) => a[0] - b[0]).map(([q, list]) => {
      const name = nameByQ.get(q) ?? defaultQ[q] ?? `Q${q}`
      const items = list.map((t) => {
        const bits = [`${t.emoji} ${t.title}`]
        if (t.due_date) bits.push(`_due ${t.due_date}${t.due_time ? ` ${t.due_time}` : ''}_`)
        if (t.progress === 'in_progress') bits.push('_in progress_')
        if (t.progress === 'on_hold') bits.push('_on hold_')
        if (t.recurring) bits.push(`_repeats ${t.recur_type}_`)
        return `- [${t.done ? 'x' : ' '}] ${bits.join(' ')}${t.note ? `\n  - ${t.note}` : ''}`
      })
      return `## ${name}\n\n${items.join('\n')}\n`
    })
    let todoMd = frontmatter([['type', 'todo-board']]) + `# To-Do Board\n\n` + qBlocks.join('\n')
    if (sadhanaUpdates.length) {
      todoMd += `## Updates log\n\n${sadhanaUpdates.map((u) => `- **${isoDate(u.created_at)}** — ${u.text}`).join('\n')}\n`
    }
    files.set(`${root}/To-Do Board.md`, todoMd)
  }

  if (canvas.length) {
    stats.canvasElements = canvas.length
    const items = canvas.map((el) => `- **${el.board}/${el.type}** (${Math.round(el.x)}, ${Math.round(el.y)}): ${el.content.replace(/\n/g, ' ⏎ ')}`)
    files.set(`${root}/Canvas.md`, frontmatter([['type', 'canvas']]) + `# Canvas\n\n${items.join('\n')}\n`)
  }

  if (captures.length) {
    stats.telegramCaptures = captures.length
    const items = captures.map((cap) => `- **${isoDate(cap.received_at)}**${cap.promoted ? ' _(promoted)_' : ''} — ${cap.raw_text.replace(/\n/g, ' ⏎ ')}`)
    files.set(`${root}/Telegram Captures.md`, frontmatter([['type', 'telegram-inbox']]) + `# Telegram Captures\n\n${items.join('\n')}\n`)
  }

  // ---- Home.md (MOC) ---------------------------------------------------------------
  const table = [
    ['Projects', stats.projects],
    ['Ideas', stats.ideas],
    ['Quick notes', stats.quickNotes],
    ['Notes', stats.vaultNotes],
    ['To-Do tasks', stats.todoTasks],
    ['Canvas elements', stats.canvasElements],
    ['Telegram captures', stats.telegramCaptures],
  ].map(([label, n]) => `| ${label} | ${n} |`).join('\n')
  const homeParts: string[] = []
  homeParts.push(`# Hibana Backup\n\n> Exported ${stamp} — drop this folder into an Obsidian vault.\n\n| Part | Items |\n| --- | --- |\n${table}\n`)
  if (projectLinks.length) homeParts.push(`## Projects\n\n${projectLinks.join('\n')}\n`)
  if (ideaLinks.length) homeParts.push(`## Ideas\n\n${ideaLinks.join('\n')}\n`)
  if (noteLinks.length) homeParts.push(`## Notes\n\n${noteLinks.join('\n')}\n`)
  homeParts.push(`## About\n\nRe-import into Hibana via Settings → Obsidian import — files whose title already exists are skipped, so this vault is safe to round-trip.\n`)
  files.set(`${root}/Home.md`, homeParts.join('\n'))

  return { files, stats, missing }
}
