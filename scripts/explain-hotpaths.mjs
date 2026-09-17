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

// S69: vault + folders + screenshots — the tables behind /api/search's vault group,
// the /api/vault/* archive, and /api/media (gallery). Same busy-solo scale ratios.
const insFolder = db.prepare(
  'INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)',
)
const folderIds = []
for (let i = 0; i < 12; i++) {
  const id = `g${String(i).padStart(7, '0')}-gggg-4ggg-8ggg-gggggggggggg`
  folderIds.push(id)
  insFolder.run(id, U, `Folder ${i}`, i, now, now)
}
const insVault = db.prepare(
  'INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
)
const bodyText = 'A paragraph of curated body knowledge with enough words that a substring filter has real work to do. '
for (let i = 0; i < 2000; i++) {
  insVault.run(
    `h${String(i).padStart(7, '0')}-hhhh-4hhh-8hhh-hhhhhhhhhhhh`, U, folderIds[i % folderIds.length],
    `Vault note ${i}`, Array.from({ length: 6 }, (_, k) => `Section ${k}: ${bodyText}`).join(' ') + ` #tag${i % 20}`,
    i % 5 ? '' : 'ref, design', i % 9 === 0 ? 1 : 0, now, now,
  )
}
const insShot = db.prepare(
  'INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, created_at, resolved, task_id, bytes) VALUES (?, ?, ?, \'image/png\', ?, ?, 0, NULL, ?)',
)
for (let i = 0; i < 300; i++) {
  insShot.run(`i${String(i).padStart(7, '0')}-iiii-4iii-8iii-iiiiiiiiiiii`, projectIds[i % projectIds.length], `${U}/x/screenshots/s${i}.png`, `shot ${i}`, now, 40_000 + i)
}
db.exec('COMMIT')
console.log(`  users=1 projects=500 quick_notes=5000 sadhana_tasks=2000 sadhana_updates=10000 hurdles=2000 canvas=40000 vault_notes=2000 screenshots=300\n`)

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
  // S69 (agenda #1 baselines): the /api/search groups (palette) + vault archive list +
  // the gallery join — the hot paths added since this script was written (0040/0057/S39).
  ['search: projects FTS', 'SELECT p.* FROM projects_fts f JOIN projects p ON p.rowid = f.rowid WHERE p.user_id = ? AND p.deleted_at IS NULL AND projects_fts MATCH ? ORDER BY p.updated_at DESC LIMIT 20', [U, '"Project 12"']],
  ['search: quick_notes FTS', "SELECT n.id, n.title, n.kind, snippet(quick_notes_fts, 1, '', '', '…', 12) AS snippet FROM quick_notes_fts f JOIN quick_notes n ON n.rowid = f.rowid WHERE n.user_id = ? AND n.deleted_at IS NULL AND quick_notes_fts MATCH ? ORDER BY n.updated_at DESC LIMIT 20", [U, '"note body"']],
  ['search: dev_tasks FTS', 'SELECT t.id, t.title, t.quadrant FROM sadhana_tasks_fts f JOIN sadhana_tasks t ON t.rowid = f.rowid WHERE t.user_id = ? AND t.deleted_at IS NULL AND sadhana_tasks_fts MATCH ? LIMIT 20', [U, '"task"']],
  ['search: vault LIKE (S62 group)', "SELECT n.id, n.title, n.content, n.starred, f.name AS folder, n.folder_id FROM vault_notes n LEFT JOIN note_folders f ON f.id = n.folder_id WHERE n.user_id = ? AND n.deleted_at IS NULL AND (n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\') ORDER BY n.updated_at DESC LIMIT 20", [U, '%body%', '%body%']],
  ['vault: archive list (default)', 'SELECT * FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200', [U]],
  ['vault: archive list (q filter)', "SELECT * FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 200", [U, '%body%', '%body%']],
  ['vault: folder counts (bootstrap)', 'SELECT folder_id, COUNT(*) AS n FROM vault_notes WHERE user_id = ? AND deleted_at IS NULL GROUP BY folder_id', [U]],
  ['gallery: /api/media join', 'SELECT s.id, s.project_id, s.github_path, s.mime_type, s.caption, s.created_at, s.resolved, s.task_id, s.bytes, p.title AS project_title, p.deleted_at AS project_deleted, dt.title AS task_title, dt.status AS task_status FROM screenshots s JOIN projects p ON p.id = s.project_id LEFT JOIN dev_tasks dt ON dt.id = s.task_id WHERE p.user_id = ? ORDER BY s.created_at DESC', [U]],
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
