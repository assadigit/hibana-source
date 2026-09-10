#!/usr/bin/env node
// Pillar 1 (perf session, 2026-09-10): EXPLAIN ANALYZE for the hot read paths —
// dashboard load, project page, sadhana board, calendar pins — against a local SQLite
// database seeded at "busy solo scale" (500 projects, 5k quick notes, 2k sadhana tasks,
// 10k journal rows, 40k canvas elements). D1 is SQLite under the hood, so the query
// plans here are representative of prod (same engine, same indexes, same SQL).
//
// Run: npm run perf:explain
// Prints the plan summary (SCAN vs SEARCH + index used) + total timing per query.
// Never connects to Cloudflare; prints no user data (all rows are synthetic).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../src/db/migrate-node.ts'

const dir = mkdtempSync(join(tmpdir(), 'hibana-explain-'))
const dbPath = join(dir, 'perf.db')
applyMigrations(dbPath, join(process.cwd(), 'migrations'))
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')

const now = new Date().toISOString()
const U = '11111111-1111-4111-8111-111111111111'

// ── Seed synthetic busy-solo-scale data ──────────────────────────────────────
console.log('Seeding synthetic data (busy solo scale)...')
db.exec('BEGIN')
db.prepare(
  `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at)
   VALUES (?, 'perf', 'perf@test.dev', 'x', 'owner', 'en', 'gregorian', 'UTC', ?)`,
).run(U, now)

const insProject = db.prepare(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, created_at, updated_at, due_date)
   VALUES (?, ?, ?, 'd', 'personal', ?, ?, 'n', ?, ?, ?)`,
)
const STAGES = ['spark', 'unreviewed', 'investigating', 'awaiting', 'doing', 'halted', 'operational']
const projectIds = []
for (let i = 0; i < 500; i++) {
  const id = `a${String(i).padStart(7, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
  projectIds.push(id)
  insProject.run(id, U, `Project ${i}`, STAGES[i % STAGES.length], i, now, now, i % 30 ? null : '2026-10-01')
}

const insNote = db.prepare(
  `INSERT INTO quick_notes (id, user_id, kind, title, content, sort_order, created_at, updated_at)
   VALUES (?, ?, 'note', '', ?, ?, ?, ?)`,
)
for (let i = 0; i < 5000; i++) {
  insNote.run(`b${String(i).padStart(7, '0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, U, `note body ${i}`, i, now, now)
}

const insTask = db.prepare(
  `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, position, pinned, done, recurring, due_date, created_at, updated_at)
   VALUES (?, ?, ?, 'task', '📌', ?, ?, ?, ?, ?, ?, ?)`,
)
const taskIds = []
for (let i = 0; i < 2000; i++) {
  const id = `c${String(i).padStart(7, '0')}-cccc-4ccc-8ccc-cccccccccccc`
  taskIds.push(id)
  insTask.run(id, U, (i % 4) + 1, i, i % 50 === 0 ? 1 : 0, i % 3 === 0 ? 1 : 0, i % 2, `2026-09-${(i % 28) + 1}`, now, now)
}

const insUpdate = db.prepare(
  'INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)',
)
for (let i = 0; i < 10000; i++) {
  insUpdate.run(`d${String(i).padStart(7, '0')}-dddd-4ddd-8ddd-dddddddddddd`, taskIds[i % taskIds.length], `journal ${i}`, now)
}

const insHurdle = db.prepare(
  'INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
)
for (let i = 0; i < 2000; i++) {
  insHurdle.run(`e${String(i).padStart(7, '0')}-eeee-4eee-8eee-eeeeeeeeeeee`, projectIds[i % projectIds.length], `h ${i}`, i % 2 ? 'open' : 'solved', i, now)
}

const insCanvas = db.prepare(
  `INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, z_index, deleted, board, created_at, updated_at)
   VALUES (?, ?, 'note', ?, ?, 100, 100, '#fff', 'c', ?, 0, 'canvas', ?, ?)`,
)
for (let i = 0; i < 40000; i++) {
  insCanvas.run(`f${String(i).padStart(7, '0')}-ffff-4fff-8fff-ffffffffffff`, U, i % 2000, i % 2000, i, now, now)
}
db.exec('COMMIT')
console.log(`  users=1 projects=500 quick_notes=5000 sadhana_tasks=2000 sadhana_updates=10000 hurdles=2000 canvas=40000\n`)

// ── Hot queries (verbatim from the live routes) ─────────────────────────────
const HOT = [
  ['dashboard: projects by status', 'SELECT status, COUNT(*) AS n FROM projects WHERE user_id = ? AND deleted_at IS NULL GROUP BY status', [U]],
  ['dashboard: recent 10', 'SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 10', [U]],
  ['dashboard: stage boxes (48)', `SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL AND status IN (${['spark', ...STAGES.slice(1)].map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 48`, [U, ...STAGES]],
  ['dashboard: solved this week', 'SELECT COUNT(*) AS n FROM hurdles WHERE solved_at IS NOT NULL AND solved_at >= ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)', [now, U]],
  ['dashboard: notes widget (20)', 'SELECT * FROM quick_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort_order DESC, updated_at DESC LIMIT 20', [U]],
  ['dashboard: todo board (all open)', 'SELECT * FROM sadhana_tasks WHERE user_id = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL ORDER BY pinned DESC, position ASC, updated_at DESC, created_at DESC', [U]],
  ['dashboard: todo journal (feed)', 'SELECT u.id, u.task_id, u.text, u.created_at FROM sadhana_updates u JOIN sadhana_tasks t ON t.id = u.task_id WHERE t.user_id = ? AND t.deleted_at IS NULL ORDER BY u.created_at DESC', [U]],
  ['bot: quadrant page (8)', 'SELECT id, title, emoji FROM sadhana_tasks WHERE user_id = ? AND quadrant = ? AND done = 0 AND deleted_at IS NULL AND cleared_at IS NULL ORDER BY pinned DESC, position ASC, created_at DESC LIMIT 8 OFFSET 0', [U, 2]],
  ['project page: hurdles', 'SELECT * FROM hurdles WHERE project_id = ? ORDER BY sort_order', [projectIds[5]]],
  ['calendar: pins by due date', "SELECT id, title, status, due_date FROM projects WHERE user_id = ? AND deleted_at IS NULL AND due_date BETWEEN '2026-09-01' AND '2026-09-30'", [U]],
  ['canvas: viewport bbox', 'SELECT * FROM canvas_elements WHERE user_id = ? AND board = ? AND deleted = 0 AND x >= ? AND x <= ? AND y >= ? AND y <= ?', [U, 'canvas', 0, 500, 0, 500]],
  ['backup: snapshot (25 tables)', 'SELECT * FROM canvas_elements', []],
]

const summarize = (plan) => {
  const lines = []
  for (const step of plan) {
    if (step.detail) {
      const idx = /(USING INDEX [\w:]+)/.exec(step.detail)
      const cover = /(USING COVERING INDEX [\w:]+)/.exec(step.detail)
      const kind = /SCAN/.test(step.detail) ? 'SCAN ' : 'SEARCH'
      const using = cover ? cover[1] : idx ? idx[1] : ''
      lines.push(`${kind} ${step.table ?? ''} ${using}`.trim())
    }
  }
  return [...new Set(lines)].join(' | ')
}

console.log('═'.repeat(100))
let worst = 0
for (const [label, sql, params] of HOT) {
  const planStmt = db.prepare(`EXPLAIN QUERY PLAN ${sql}`)
  const plan = planStmt.all(...params)
  const t0 = process.hrtime.bigint()
  db.prepare(sql).all(...params)
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  worst = Math.max(worst, ms)
  console.log(`${label}`)
  console.log(`  plan: ${summarize(plan)}`)
  console.log(`  time: ${ms.toFixed(2)} ms`)
}
console.log('═'.repeat(100))
console.log(`worst query: ${worst.toFixed(2)} ms at busy-solo scale`)
console.log('(SQLite in-process; D1 adds ~10-40 ms network RTT per batch regardless of plan quality)')

db.close()
rmSync(dir, { recursive: true, force: true })
