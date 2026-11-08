// S152 — the global task-category library's shared server side (the owner's 9-block
// spec). The 16 fixed pastel pairs are the ONLY colors a category may wear (block 5:
// "Present a fixed set of 16 pastel swatch tiles ... Do not provide a free-form color
// picker or hex input field. A curated swatch guarantees every category stays
// readable and visually distinct"). The same 16 pairs live in variables.css as the
// --cat-sw-* tokens (the design-token law's only other home) — a unit test pins the
// two lists together so they can never drift.

export interface CatPair {
  fill: string
  ink: string
}

// Reading order = the owner's list order (the swatch grid renders this order).
export const CAT_PAIRS: readonly CatPair[] = [
  { fill: '#F0CCCC', ink: '#682727' },
  { fill: '#F0D9CC', ink: '#683F27' },
  { fill: '#F0E7CC', ink: '#685727' },
  { fill: '#ECF0CC', ink: '#5F6827' },
  { fill: '#DEF0CC', ink: '#476827' },
  { fill: '#D0F0CC', ink: '#2F6827' },
  { fill: '#CCF0D5', ink: '#276837' },
  { fill: '#CCF0E2', ink: '#27684F' },
  { fill: '#CCF0F0', ink: '#276868' },
  { fill: '#CCE2F0', ink: '#274F68' },
  { fill: '#CCD5F0', ink: '#273768' },
  { fill: '#D0CCF0', ink: '#2F2768' },
  { fill: '#DECCF0', ink: '#472768' },
  { fill: '#ECCCF0', ink: '#5F2768' },
  { fill: '#F0CCE7', ink: '#682757' },
  { fill: '#F0CCD9', ink: '#68273F' },
] as const

const PAIR_SET = new Set(CAT_PAIRS.map((p) => `${p.fill}/${p.ink}`))

// A pair is valid only when BOTH halves come from the same curated tile — a fill
// from one tile with an ink from another is not a swatch the picker can offer.
export function isValidCatPair(fill: unknown, ink: unknown): boolean {
  if (typeof fill !== 'string' || typeof ink !== 'string') return false
  return PAIR_SET.has(`${fill.toUpperCase()}/${ink.toUpperCase()}`)
}

// Block 3: matching is case-insensitive and ignores leading/trailing whitespace —
// "ui/ux", " UI/UX " and "Ui /Ux "… (trim, then fold) are the same name.
export function normCatName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

export interface CategoryRow {
  id: string
  /** S181 (0064): the library is USER-SCOPED — every row belongs to exactly one
   *  account; absent only on a D1 that has not applied 0064 yet (the deploy-ahead
   *  window the categoriesUserScoped() probe below exists for). */
  user_id: string
  name: string
  color_fill: string
  color_text: string
  is_archived: number
  created_at: string
}

/** S257 (audit BE-11 — the Phase 6 devboard split): the ONE shared categories
 *  payload query — every category row a project's surfaces can see: every ENABLED
 *  category (the picker/toggle set) UNION every category its tasks already reference
 *  (disabled later → the chip still resolves; history intact). `enabled` lets the
 *  client split the picker set from the chip set. Was written byte-identically in
 *  devboard.ts's board GET and projects/detail-helpers.ts's loadDetail; one home now.
 *
 *  Belt (the 0062 lagging-D1 doctrine): a D1 pre-migration has no categories table —
 *  the read degrades to [] (chip-less, not broken). */
export async function categoriesForProject(
  db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> },
  projectId: string,
): Promise<(CategoryRow & { enabled: number })[]> {
  return db
    .query<CategoryRow & { enabled: number }>(
      `SELECT c.*, CASE WHEN c.is_archived = 1 THEN 0 ELSE COALESCE((SELECT 1 FROM project_categories pc WHERE pc.category_id = c.id AND pc.project_id = ?), 0) END AS enabled
       FROM categories c
       -- S152/block 8: archived rows STAY in the payload when a task still references
       -- them (the chip keeps rendering — history visible); they carry enabled = 0
       -- so the pickers and toggles exclude them from NEW selections.
       WHERE c.id IN (SELECT category_id FROM dev_tasks WHERE project_id = ? AND category_id IS NOT NULL)
          OR (c.is_archived = 0 AND c.id IN (SELECT category_id FROM project_categories WHERE project_id = ?))
       ORDER BY c.name COLLATE NOCASE, c.created_at`,
      [projectId, projectId, projectId],
    )
    .catch(() => []) // 0062 belt: a D1 pre-migration has no categories table — chip-less, not broken
}

// S181 (0064): does THIS database's categories table carry user_id yet? The Node
// runner migrates on boot, but a deployed Worker can land minutes before the
// owner's d1-migrate step (the S126 pre-push ritual orders it the safe way —
// still, the 0062 belt lesson applies). Memoized per Db instance: one probe per
// process, branch once, never per request.
const scopedMemo = new WeakMap<object, boolean>()
export async function categoriesUserScoped(db: { query: <T>(sql: string, params?: unknown[]) => Promise<T[]> }): Promise<boolean> {
  const hit = scopedMemo.get(db)
  if (hit !== undefined) return hit
  try {
    await db.query('SELECT user_id FROM categories LIMIT 1')
    scopedMemo.set(db, true)
    return true
  } catch {
    scopedMemo.set(db, false)
    return false
  }
}
