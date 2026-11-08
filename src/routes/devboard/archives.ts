// src/routes/devboard/archives.ts — S257 (the Phase 6 split of the former
// devboard.ts monolith): the project_archives shelf — GET (paged) + restore +
// permanent delete — and the module's OWNED shared snapshot builder (foldTagSnapshots),
// the one link-fold BOTH archive flows use (archive-done in tasks.ts + /finish in
// sprints.ts — the audit's duplicated fold, one home now). Behavior-neutral move.

import { Hono } from 'hono'
import { getOwnedProject } from '../../lib/html'
import { errJson, ErrorCode } from '../../lib/errors'
import type { Config, UserRow } from '../../types'
import { setTaskTags, touchProject, type TaskTagJoin } from '../devboard-helpers'
import { archiveOffsetSchema } from './schemas'

/** S257 (the split's carve — the shared snapshot builder this module owns): fold a
 * flat task-tag join into (a) the per-task snapshot lists the archive INSERTs carry
 * (names + colors, JSON — snapshotted BEFORE the dev_task_tags rows cascade away) and
 * (b) the touched tag-id list whose usage_count needs recomputing after the move.
 * Set-keyed (taskIds) — only the tasks being archived contribute; identical output to
 * the fold archive-done and /finish each carried inline in the monolith. */
export function foldTagSnapshots(links: TaskTagJoin[], taskIds: Set<string>): {
  tagsByTask: Map<string, { name: string; color: string }[]>
  touchedTagIds: string[]
} {
  const tagsByTask = new Map<string, { name: string; color: string }[]>()
  for (const row of links) {
    if (!taskIds.has(row.task_id)) continue // only the tasks being archived carry links
    const list = tagsByTask.get(row.task_id) ?? []
    list.push({ name: row.name, color: row.color })
    tagsByTask.set(row.task_id, list)
  }
  const touchedTagIds = links.filter((l) => taskIds.has(l.task_id)).map((l) => l.id)
  return { tagsByTask, touchedTagIds }
}

export function archiveRoutes(cfg: Config) {
  const app = new Hono<{ Variables: { user: UserRow } }>()

  // GET the archives for a project — the permanent record of archived done tasks.
  // S30 (B1): the rows carry their label snapshots (names + colors) so the archive UI
  // can render the chips exactly as they were the day the task was archived.
  // S243 (spec pack §6 + Screen I): the rows additionally carry their sprint identity —
  // sprint_id + sprint_name_snapshot — so the delete-confirmation modal can count the
  // archived tasks that will keep the "Sprint: <name> (deleted)" snapshot label, and
  // the Sprints page's completed-history Tasks tab can list the tasks archived at
  // finish. Additive fields: old clients (the island included) ignore them.
  app.get('/api/projects/:projectId/archives', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    // S253 (BE-5b — the audit's "archives GET unbounded"): the shelf is now CAPPED at
    // 200 rows per page (prod's biggest project holds 149 — no user impact today) with
    // an ADDITIVE ?offset= for paging deeper history (the quicknotes archive grammar:
    // coerced int, 0 ≤ offset ≤ 100_000; absence = page 0, so every existing client —
    // the island, the desktop mirror — is byte-identically served as before).
    const offsetParsed = archiveOffsetSchema.safeParse(c.req.query())
    if (!offsetParsed.success) return errJson(c, ErrorCode.invalid_input)
    const offset = offsetParsed.data.offset
    type ArchRow = {
      id: string; title: string; priority: string; done_at: string | null
      original_created_at: string; archived_at: string; tags: string
      sprint_id: string | null; sprint_name_snapshot: string | null
    }
    // Lagging-D1 belt (the taskDepsForProject precedent): a pre-0065 database has
    // project_archives without sprint_name_snapshot — the read degrades to the
    // legacy shape (both sprint fields null) instead of 500ing the archive shelf.
    let rows: ArchRow[]
    try {
      rows = await cfg.db.query<ArchRow>(
        `SELECT id, title, priority, done_at, original_created_at, archived_at, tags, sprint_id, sprint_name_snapshot FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC LIMIT 200 OFFSET ?`,
        [p.id, offset],
      )
    } catch {
      rows = (await cfg.db.query<Omit<ArchRow, 'sprint_name_snapshot'>>(
        `SELECT id, title, priority, done_at, original_created_at, archived_at, tags, sprint_id FROM project_archives WHERE project_id = ? ORDER BY archived_at DESC LIMIT 200 OFFSET ?`,
        [p.id, offset],
      )).map((r) => ({ ...r, sprint_name_snapshot: null }))
    }
    let parsed: { name: string; color: string }[][] = rows.map(() => [])
    try {
      parsed = rows.map((r) => {
        const arr = JSON.parse(r.tags || '[]')
        return Array.isArray(arr) ? arr.filter((x) => x && typeof x.name === 'string') : []
      })
    } catch {
      // pre-0051 rows carry '[]' or garbage — parse failures degrade to no labels
    }
    return c.json({ archives: rows.map((r, i) => ({ id: r.id, title: r.title, priority: r.priority, done_at: r.done_at, original_created_at: r.original_created_at, archived_at: r.archived_at, tags: parsed[i], sprint_id: r.sprint_id, sprint_name_snapshot: r.sprint_name_snapshot })) })
  })

  // Restore an archived task back to the dev_tasks table (as 'done' status). The task
  // reappears on the board's Done column. Removes it from project_archives.
  // S30 (B1): the label snapshot rides along — find-or-create by name (setTaskTags),
  // so restore comes back LABELED. Colors: an existing tag keeps its CURRENT color; a
  // name that no longer exists re-creates with the snapshot's color.
  app.post('/api/projects/:projectId/archives/:aid/restore', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    const aid = c.req.param('aid')
    const rows = await cfg.db.query<{
      id: string; title: string; priority: string; category_id: string | null
      sprint_id: string | null; done_at: string | null; original_created_at: string; tags: string
    }>(`SELECT id, title, priority, category_id, sprint_id, done_at, original_created_at, tags FROM project_archives WHERE id = ? AND project_id = ?`, [aid, p.id])
    if (rows.length === 0) return errJson(c, ErrorCode.not_found)
    const a = rows[0]
    const now = new Date().toISOString()
    // Re-insert into dev_tasks (status='done'). sort_order = max+1 to put it at the end.
    // AP-27 belt-and-suspenders: LEGACY archive rows (written before the delete-flow
    // fix) can still carry dangling category/sprint ids — re-inserting those would hit
    // the dev_tasks FKs and 500 forever. Keep only ids that still exist.
    if (a.category_id) {
      const cat = await cfg.db.query('SELECT 1 AS ok FROM categories WHERE id = ?', [a.category_id])
      if (cat.length === 0) a.category_id = null
    }
    if (a.sprint_id) {
      const spr = await cfg.db.query('SELECT 1 AS ok FROM sprints WHERE id = ?', [a.sprint_id])
      if (spr.length === 0) a.sprint_id = null
    }
    const maxOrder = await cfg.db.query<{ m: number | null }>(`SELECT MAX(sort_order) AS m FROM dev_tasks WHERE project_id = ?`, [p.id])
    const nextOrder = (maxOrder[0]?.m ?? -1) + 1
    await cfg.db.execute(
      `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at, updated_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, p.id, a.title, a.priority, a.category_id, a.sprint_id, nextOrder, a.original_created_at, a.done_at ?? now, now],
    )
    // B1 relink: parse the snapshot (tolerating pre-0051 '[]') and set the link set —
    // setTaskTags also refreshes usage + search_tags for the restored task.
    let names: string[] = []
    try {
      const arr = JSON.parse(a.tags || '[]')
      if (Array.isArray(arr)) names = arr.filter((x) => x && typeof x.name === 'string').map((x) => String(x.name).slice(0, 48))
    } catch { /* degraded snapshot — restore without labels */ }
    if (names.length) await setTaskTags(cfg, user.id, a.id, names)
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [aid, p.id])
    await touchProject(cfg, p.id, now) // S257 (BE-16): the one project-stamp helper
    return c.json({ ok: true, tags: names })
  })

  // Permanently delete an archived task (no restore). The "delete from archive" action.
  app.delete('/api/projects/:projectId/archives/:aid', async (c) => {
    const user = c.get('user')
    const p = await getOwnedProject(cfg, user.id, c.req.param('projectId'))
    if (!p) return errJson(c, ErrorCode.not_found)
    await cfg.db.execute('DELETE FROM project_archives WHERE id = ? AND project_id = ?', [c.req.param('aid'), p.id])
    return c.json({ ok: true })
  })

  return app
}
