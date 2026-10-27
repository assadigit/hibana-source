// Sadhana board — data loads (Phase 4 split from routes/sadhana.ts).
//
// Purpose: the board's ONE aggregate query (loadAll — tasks + tags + quadrant
// names/styles + the 20-note-capped journal with honest totals), the quadrant
// ordering helper, and the user-scoped task lookup. Previously closures inside
// sadhanaRoutes; parameterized on db in the Phase 4 split (identical SQL).
//
// Public API: loadAll, ordered, ownedTask, BoardData.
import { legacyTaskNote, type SadhanaTaskNote } from '../../lib/sadhana-task-controls'
import { QUADRANTS, orderedQuadrants, type SadhanaTask, type TagId } from '../../services/sadhana'
import type { Db } from '../../db/types'
import type { UserRow } from '../../types'

export const loadAll = async (db: Db, userId: string) => {
  const tasks = await db.query<SadhanaTask>(
    `SELECT * FROM sadhana_tasks WHERE user_id = ? AND deleted_at IS NULL AND cleared_at IS NULL`,
    [userId],
  )
  const tagRows = await db.query<{ task_id: string; tag: TagId }>('SELECT * FROM sadhana_tags WHERE task_id IN (SELECT id FROM sadhana_tasks WHERE user_id = ?)', [userId])
  const nameRows = await db.query<{ quadrant: number; name: string; subtitle: string | null; icon_id: string | null; accent_color: string | null }>('SELECT quadrant, name, subtitle, icon_id, accent_color FROM sadhana_quadrant_names WHERE user_id = ?', [userId])
  const noteRows = await db.query<{ id: string; task_id: string; text: string; created_at: string; cnt: number }>(
    `WITH ranked AS (
       SELECT u.id, u.task_id, u.text, u.created_at,
              ROW_NUMBER() OVER (PARTITION BY u.task_id ORDER BY u.created_at DESC, u.id DESC) AS rn,
              COUNT(*) OVER (PARTITION BY u.task_id) AS cnt
       FROM sadhana_updates u
       JOIN sadhana_tasks t ON t.id = u.task_id
       WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.cleared_at IS NULL
     )
     SELECT id, task_id, text, created_at, cnt FROM ranked WHERE rn <= 20
     ORDER BY task_id, created_at DESC, id DESC`,
    [userId],
  )
  const tags = new Map<string, TagId[]>()
  for (const r of tagRows) {
    const list = tags.get(r.task_id) ?? []
    list.push(r.tag)
    tags.set(r.task_id, list)
  }
  const names = new Map<number, string>(nameRows.map((r) => [r.quadrant, r.name]))
  const subtitles = new Map<number, string | null>(nameRows.map((r) => [r.quadrant, r.subtitle]))
  const styles = new Map<number, { icon: string | null; accent: string | null }>(nameRows.map((r) => [r.quadrant, { icon: r.icon_id, accent: r.accent_color }]))
  const notes = new Map<string, SadhanaTaskNote[]>()
  // S76 (§10-C, the OTHER unbounded journal feed — the board's, not the dashboard's
  // S69 fix): loadAll used to fetch EVERY sadhana_updates row ever written (all
  // journals, forever) and render them all into the board fragment — measured
  // 1.43MB / 530 note items on the perf seed (600 rows), growing linearly with use.
  // The expand panel is a working surface, not an archive: the LATEST 20 notes per
  // task now ride the board (window-function cap, deterministic tiebreak on id),
  // with the per-task TOTAL kept (cnt) so the badge stays honest and the panel says
  // "showing latest k of n" when truncated. Legacy task-note (the pre-0038 note
  // column) still merges — it is one extra OLDEST entry, and the total counts it.
  const noteTotals = new Map<string, number>()
  for (const note of noteRows) {
    notes.set(note.task_id, [...(notes.get(note.task_id) ?? []), note])
    noteTotals.set(note.task_id, note.cnt)
  }
  for (const task of tasks) {
    const legacy = legacyTaskNote(task)
    if (legacy) {
      notes.set(task.id, [...(notes.get(task.id) ?? []), legacy])
      noteTotals.set(task.id, (noteTotals.get(task.id) ?? 0) + 1)
    }
  }
  return { tasks, tags, names, subtitles, styles, notes, noteTotals }
}

export const ordered = (user: UserRow) => orderedQuadrants(QUADRANTS, user.sadhana_quadrant_order)

export const ownedTask = async (db: Db, userId: string, id: string): Promise<SadhanaTask | null> => {
  const rows = await db.query<SadhanaTask>('SELECT * FROM sadhana_tasks WHERE id = ? AND user_id = ?', [id, userId])
  return rows.length ? rows[0] : null
}

export type BoardData = Awaited<ReturnType<typeof loadAll>>
