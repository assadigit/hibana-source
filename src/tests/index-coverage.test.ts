import { describe, it, expect } from 'vitest'
import { makeTestDb } from './helpers'

// PERF-16, resolved honestly (S202): the S198 audit's "4 letter-of-rule-9 index misses"
// prescription was DOA — verified against the real migrated schema before shipping:
//
//   1. telegram_note_sessions NO LONGER EXISTS — migration 0048 dropped it (superseded
//      by telegram_bot_sessions). The audit's `CREATE INDEX ... ON telegram_note_
//      sessions(user_id)` would have FAILED on apply against both live D1s.
//   2. The other three access paths are ALREADY index-served by the tables' PRIMARY
//      KEYS — SQLite implements a TEXT/composite PK as sqlite_autoindex_*, and the
//      leftmost-prefix rule serves every user_id/project_id lookup. EXPLAIN QUERY
//      PLAN on the app's real query shapes proves SEARCH-by-(COVERING-)INDEX, never
//      a table SCAN; adding standalone indexes on the same prefix changes nothing
//      (the planner keeps preferring the covering autoindex).
//
// What rule 9 actually wants — user_id/project_id lookups never degrade to table
// scans — is enforced HERE, by machine: the PK structure is pinned per table, the
// planner proof is pinned per query shape, and the dropped table's absence is
// pinned so the audit's dead prescription can never be blindly revived. If a future
// migration restructures any of these PKs, this spec fails and the migration must
// either keep the coverage or add the real index that restores it.
describe('rule-9 index coverage (PERF-16, the honest resolution)', () => {
  it('telegram_note_sessions stays dropped (0048) — the audit’s prescribed index target does not exist', async () => {
    const { db, close } = makeTestDb()
    try {
      const tables = await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_note_sessions'",
      )
      expect(tables).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('the PK leftmost columns ARE the rule-9 columns (structure pin)', async () => {
    const { db, close } = makeTestDb()
    try {
      // PRAGMA table_info rows: { cid, name, type, notnull, dflt_value, pk } — pk is
      // the 1-based position within the primary key (0 = not part of it).
      const expectPk = async (table: string, first: string, second?: string) => {
        const cols = await db.query<{ name: string; pk: number }>(`PRAGMA table_info(${table})`)
        const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name)
        expect(pkCols[0], `${table} PK must lead with ${first} (leftmost-prefix rule-9 coverage)`).toBe(first)
        if (second !== undefined) expect(pkCols[1]).toBe(second)
      }
      await expectPk('project_tags', 'project_id', 'tag_id')
      await expectPk('telegram_bot_sessions', 'user_id')
      await expectPk('sadhana_quadrant_names', 'user_id', 'quadrant')
    } finally {
      close()
    }
  })

  it('the real query shapes are index-served (EXPLAIN QUERY PLAN: SEARCH, never SCAN)', async () => {
    const { db, close } = makeTestDb()
    try {
      // The app's actual query shapes (src/routes + src/services — see the S202 record):
      // each must plan as SEARCH on an index; a SCAN here means rule 9 degraded.
      const shapes: Array<[string, string]> = [
        ['project_tags JOIN by project_id IN (…)', "SELECT t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.project_id IN ('a','b')"],
        ['project_tags exact pair', "SELECT 1 FROM project_tags WHERE project_id = 'a' AND tag_id = 'b'"],
        ['project_tags tags-of-live-projects', "SELECT tag_id FROM project_tags WHERE project_id IN ('a','b')"],
        ['project_tags by tag_id (the real 0003 index)', "SELECT project_id FROM project_tags WHERE tag_id = 'b'"],
        ['telegram_bot_sessions by user', "SELECT state FROM telegram_bot_sessions WHERE user_id = 'u'"],
        ['sadhana_quadrant_names by user', "SELECT quadrant, name FROM sadhana_quadrant_names WHERE user_id = 'u'"],
      ]
      for (const [label, sql] of shapes) {
        const plan = await db.query<{ detail: string }>('EXPLAIN QUERY PLAN ' + sql)
        const details = plan.map((r) => r.detail).join(' | ')
        expect(details, `${label} must be index-served`).toMatch(/^SEARCH/)
        expect(details, `${label} must not table-scan`).not.toContain('SCAN')
      }
    } finally {
      close()
    }
  })
})
