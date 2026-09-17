#!/usr/bin/env node
// S69 perf-session seed: deterministic "months of real solo use" dataset for the LOCAL
// e2e DB (/tmp/hibana-e2e.db) so page-load timings measure something real (DOM size,
// JSON payload, DB volume). The explain-hotpaths.mjs script measures QUERY PLANS at
// synthetic busy scale; this one measures PAGE LOADS at realistic scale.
//
// Run: node --import tsx scripts/perf-seed.mjs
//   DB_PATH (default /tmp/hibana-e2e.db), HIBANA_SHOTS_DIR (default /tmp/hibana-e2e-shots)
// Recreates both from scratch — NEVER point at prod. Login: e2e@test.local / e2e-password-123.
//
// Dataset (deterministic — same numbers every run, comparable timings):
//   90 projects (25 sparks across 4 folders, 65 across the 6 stages, 8 client w/ due dates)
//   300 history entries · 180 hurdles · 250 dev tasks (12 boards) · 10 sprints
//   160 quick notes · 7 note folders · 120 vault notes
//   180 sadhana tasks (120 open) · 600 journal updates
//   1200 canvas elements (900 canvas + 300 notebook)
//   70 screenshots with real PNG bytes on the disk store (~40-160 KB each)

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../src/db/migrate-node.ts'

const DB_PATH = process.env.DB_PATH ?? '/tmp/hibana-e2e.db'
const SHOTS = process.env.HIBANA_SHOTS_DIR ?? '/tmp/hibana-e2e-shots'

// ── deterministic UUIDs (stable ids → stable github_paths → stable disk layout) ──
const uuid = (prefix, i) => `${prefix}${String(i).padStart(7, '0')}-0000-4000-8000-${prefix.repeat(4)}${String(i).padStart(8, '0')}`.slice(0, 36)

rmSync(DB_PATH, { force: true })
rmSync(SHOTS, { recursive: true, force: true })
applyMigrations(DB_PATH, join(process.cwd(), 'migrations'))
const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA journal_mode = WAL;')

const U = 'e2e0000-0000-4000-8000-e2etestuser0001'
const DAY = 86_400_000
const now = Date.now()
const iso = (t) => new Date(t).toISOString()
const daysAgo = (n) => iso(now - n * DAY)

// ── user (same PBKDF2 shape as e2e/login.spec.ts) ────────────────────────────
{
  const PASS = 'e2e-password-123'
  const ITER = 100_000
  const salt = Buffer.from('perf-seed-salt-16', 'utf8').subarray(0, 16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256)
  const b64 = (u8) => Buffer.from(u8).toString('base64')
  const hash = `pbkdf2$${ITER}$${b64(salt)}$${b64(new Uint8Array(bits))}`
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
     VALUES (?, 'e2e', 'e2e@test.local', ?, 'owner', 'en', 'gregorian', 'UTC', ?, ?)`,
  ).run(U, hash, daysAgo(120), daysAgo(120))
}

// ── spark folders + projects ─────────────────────────────────────────────────
const STAGES = ['spark', 'unreviewed', 'investigating', 'awaiting', 'doing', 'halted', 'operational']
const folders = []
for (let i = 0; i < 4; i++) {
  const id = uuid('a', i)
  folders.push(id)
  db.prepare('INSERT INTO spark_folders (id, user_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)').run(id, U, `Folder ${i + 1}`, i, daysAgo(100 - i * 7))
}

const projectIds = []
const insProject = db.prepare(
  `INSERT INTO projects (id, user_id, title, description, type, status, sort_order, latest_note, due_date, client_name, folder_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)
let n = 0
for (let i = 0; i < 25; i++) { // sparks (10 filed)
  const id = uuid('b', i)
  projectIds.push(id)
  insProject.run(id, U, `Spark idea ${i + 1}`, `Raw capture ${i} — sketch of a thing worth investigating later`, 'personal', 'spark', i, i % 3 ? '' : 'left off: wrote the hook down', null, null, i < 10 ? folders[i % 4] : null, daysAgo(90 - i), daysAgo(90 - i))
  n++
}
for (let i = 0; i < 65; i++) { // staged work
  const stage = STAGES[1 + (i % 6)]
  const id = uuid('b', 100 + i)
  projectIds.push(id)
  const client = i % 8 === 0
  insProject.run(id, U, `${stage[0].toUpperCase() + stage.slice(1)} project ${i + 1}`, `Description for project ${i + 1} — ${stage} stage, some detail here to give the cards body`, client ? 'client' : 'personal', stage, i, i % 4 ? '' : 'left off: reviewing the plan', client ? `2026-1${(i % 2) + 1}-${String((i % 27) + 1).padStart(2, '0')}` : null, client ? `Client ${(i % 8) + 1}` : null, null, daysAgo(85 - i), daysAgo(85 - i * 0.9))
}
console.log(`projects: ${n}`)

// ── history / hurdles / links / tags ─────────────────────────────────────────
{
  const insH = db.prepare('INSERT INTO project_history_log (id, project_id, note, created_at) VALUES (?, ?, ?, ?)')
  for (let i = 0; i < 300; i++) insH.run(uuid('c', i), projectIds[i % projectIds.length], `log entry ${i} — moved forward on something`, daysAgo(i / 2))
  const insHurdle = db.prepare('INSERT INTO hurdles (id, project_id, text, status, sort_order, created_at, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let i = 0; i < 180; i++) {
    const solved = i % 3 === 0
    insHurdle.run(uuid('d', i), projectIds[i % projectIds.length], `hurdle ${i} — blocker worth tracking`, solved ? 'solved' : 'open', i, daysAgo(80 - i / 3), solved ? daysAgo(Math.max(1, 60 - i / 4)) : null)
  }
  const insLink = db.prepare('INSERT INTO links (id, project_id, label, url, created_at) VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 60; i++) insLink.run(uuid('e', i), projectIds[i % projectIds.length], `Link ${i}`, `https://example.com/r/${i}`, daysAgo(70 - i))
  const insTag = db.prepare('INSERT INTO tags (id, user_id, name, color, usage_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const tagIds = []
  for (let i = 0; i < 8; i++) {
    const id = uuid('f', i)
    tagIds.push(id)
    insTag.run(id, U, ['ui', 'perf', 'idea', 'client', 'infra', 'design', 'research', 'bug'][i], '#f6d365', 0, daysAgo(95))
  }
  const insPT = db.prepare('INSERT INTO project_tags (project_id, tag_id) VALUES (?, ?)')
  for (let i = 0; i < 70; i++) insPT.run(projectIds[i % projectIds.length], tagIds[i % tagIds.length])
}

// ── dev boards (12 doing projects get categories, sprints, tasks) ────────────
const doingProjects = projectIds.filter((id) => {
  const row = db.prepare('SELECT status FROM projects WHERE id = ?').get(id)
  return row && row.status === 'doing'
}).slice(0, 12)
{
  const insCat = db.prepare('INSERT INTO task_categories (id, project_id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
  const insSprint = db.prepare('INSERT INTO sprints (id, project_id, name, started_at, created_at) VALUES (?, ?, ?, ?, ?)')
  const insTask = db.prepare(
    `INSERT INTO dev_tasks (id, project_id, title, status, priority, category_id, sprint_id, sort_order, created_at, done_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const STATUSES = ['idea', 'planned', 'in_progress', 'done']
  let t = 0
  const taskIds = []
  for (let p = 0; p < doingProjects.length; p++) {
    const pid = doingProjects[p]
    const catIds = []
    for (let k = 0; k < 2; k++) {
      const cid = uuid('g', p * 2 + k)
      catIds.push(cid)
      insCat.run(cid, pid, k ? 'UI/UX' : 'Feature Development', k ? '#8AB8F0' : '#f6d365', k, daysAgo(60 - p))
    }
    const sid = uuid('h', p)
    insSprint.run(sid, pid, `Sprint ${p + 1}`, daysAgo(30 - p), daysAgo(30 - p))
    for (let k = 0; k < 20; k++) {
      const id = uuid('i', t)
      taskIds.push(id)
      const status = STATUSES[k % 4]
      insTask.run(id, pid, `Task ${k + 1} for board ${p + 1}`, status, ['low', 'medium', 'high', 'urgent'][k % 4], catIds[k % 2], k % 3 ? sid : null, k, daysAgo(28 - k / 2), status === 'done' ? daysAgo(20 - k / 3) : null)
      t++
    }
  }
  console.log(`dev tasks: ${t}`)
}

// ── client tasks + payments (8 client projects) ─────────────────────────────
{
  const insTask = db.prepare('INSERT INTO tasks (id, project_id, title, done, due_date, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (let i = 0; i < 80; i++) {
    const done = i % 3 === 0
    insTask.run(uuid('j', i), doingProjects[i % doingProjects.length] ?? projectIds[i], `Client task ${i + 1}`, done ? 1 : 0, `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, daysAgo(50 - i / 2), done ? daysAgo(40 - i / 3) : null)
  }
}

// ── quick notes ──────────────────────────────────────────────────────────────
{
  const ins = db.prepare(
    `INSERT INTO quick_notes (id, user_id, kind, title, content, sort_order, color, done, sticky, note_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const COLORS = ['yellow', 'pink', 'blue', 'green', 'purple', 'orange']
  for (let i = 0; i < 160; i++) {
    const isList = i % 4 === 0
    const content = isList
      ? JSON.stringify([{ id: `t${i}1`, t: `step one ${i}`, d: 0 }, { id: `t${i}2`, t: `step two ${i}`, d: 1 }])
      : `quick capture ${i} — thought worth jotting while working, medium length body text to give the widget realistic rows`
    ins.run(uuid('k', i), U, isList ? 'list' : 'note', isList ? `List ${i}` : '', content, 160 - i, COLORS[i % COLORS.length], i % 5 === 0 ? 1 : 0, i % 12 === 0 ? 1 : 0, i % 3 ? null : `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, daysAgo(60 - i / 3), daysAgo(60 - i / 3))
  }
}

// ── notes vault (7 folders, 2 nested; 120 notes) ─────────────────────────────
{
  const insFolder = db.prepare('INSERT INTO note_folders (id, user_id, parent_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const insNote = db.prepare(
    `INSERT INTO vault_notes (id, user_id, folder_id, title, content, tags, starred, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const folderIds = []
  for (let i = 0; i < 7; i++) {
    const id = uuid('l', i)
    folderIds.push(id)
    insFolder.run(id, U, i >= 5 ? folderIds[0] : null, ['Reference', 'Movies', 'Games', 'Knowledge', 'Workflows', 'Sub A', 'Sub B'][i], i, daysAgo(80), daysAgo(80))
  }
  const lorem = 'A paragraph of curated knowledge — enough words to make reading time and search meaningful. '
  for (let i = 0; i < 120; i++) {
    const words = 80 + (i % 12) * 60 // 80..740 words
    const content = Array.from({ length: Math.ceil(words / 16) }, (_, k) => `Section ${k + 1}: ${lorem}`).join('\n\n') + ` #ref${i % 10}`
    insNote.run(uuid('m', i), U, folderIds[i % folderIds.length], `Vault note ${i + 1}`, content, ['ui,design', 'perf', '', 'research,notes', ''][i % 5], i % 9 === 0 ? 1 : 0, daysAgo(75 - i / 2), daysAgo(75 - i / 2))
  }
}

// ── sadhana board ────────────────────────────────────────────────────────────
{
  const ins = db.prepare(
    `INSERT INTO sadhana_tasks (id, user_id, quadrant, title, emoji, due_date, done, deleted_at, pinned, cleared_at, position, progress, note, recurring, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insUpd = db.prepare('INSERT INTO sadhana_updates (id, task_id, text, created_at) VALUES (?, ?, ?, ?)')
  const EMOJI = ['📌', '🎯', '🧠', '⚡', '🌱', '🔧', '📚', '🎨']
  for (let i = 0; i < 180; i++) {
    const done = i >= 120
    const cleared = done && i % 2 === 0
    ins.run(uuid('n', i), U, (i % 4) + 1, `Sadhana task ${i + 1}`, EMOJI[i % EMOJI.length], `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, done ? 1 : 0, null, i % 15 === 0 ? 1 : 0, cleared ? daysAgo(i / 6) : null, i, done ? 'untouched' : (i % 5 === 0 ? 'in_progress' : 'untouched'), i % 6 ? '' : 'note attached', i % 7 === 0 ? 1 : 0, daysAgo(45 - i / 5), daysAgo(45 - i / 6))
  }
  for (let i = 0; i < 600; i++) insUpd.run(uuid('o', i), uuid('n', i % 180), `journal update ${i} — worked a while on it`, daysAgo(40 - i / 20))
}

// ── canvas + notebook ────────────────────────────────────────────────────────
{
  const ins = db.prepare(
    `INSERT INTO canvas_elements (id, user_id, type, x, y, width, height, color, content, z_index, deleted, board, font_size, angle, text_align, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  )
  const COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#f5d0fe']
  let c = 0
  for (let i = 0; i < 900; i++) { ins.run(uuid('p', c), U, 'note', (i % 30) * 140, Math.floor(i / 30) * 160, 120, 120, COLORS[i % COLORS.length], `sticky ${i} — canvas thought`, i, 'canvas', null, 0, null, daysAgo(50 - i / 20), daysAgo(50 - i / 20)); c++ }
  for (let i = 0; i < 300; i++) { ins.run(uuid('p', c), U, 'note', (i % 15) * 160, Math.floor(i / 15) * 180, 140, 140, COLORS[i % COLORS.length], `notebook sticky ${i}`, i, 'notebook', null, 0, null, daysAgo(40 - i / 10), daysAgo(40 - i / 10)); c++ }
  console.log(`canvas elements: ${c}`)
}

// ── screenshots (70 real PNGs on the disk store) ────────────────────────────
const png = (width, height, r, g, b) => {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const px = row + 1 + x * 3
      raw[px] = (r + x * 2) & 0xff
      raw[px + 1] = (g + y) & 0xff
      raw[px + 2] = b & 0xff
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crcTable = []
    for (let n = 0; n < 256; n++) { let cc = n; for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1; crcTable[n] = cc >>> 0 }
    let crc = 0xffffffff
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([len, body, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

{
  const ins = db.prepare(
    `INSERT INTO screenshots (id, project_id, github_path, mime_type, caption, created_at, resolved, task_id, bytes)
     VALUES (?, ?, ?, 'image/png', ?, ?, 0, NULL, ?)`,
  )
  let totalBytes = 0
  for (let i = 0; i < 70; i++) {
    const id = uuid('q', i)
    const pid = projectIds[(i * 3) % projectIds.length]
    const path = `${U}/${pid}/screenshots/${id}-shot-${i}.png`
    const size = 300 + (i % 5) * 60 // 300..540 px wide → ~40-160 KB PNG
    const bytes = png(size, Math.round(size * 0.66), 90 + i, 120, 200 - (i % 60))
    mkdirSync(join(SHOTS, U, pid, 'screenshots'), { recursive: true })
    writeFileSync(join(SHOTS, path), bytes)
    ins.run(id, pid, path, `screenshot ${i} — UI evidence shot`, daysAgo(70 - i), bytes.length)
    totalBytes += bytes.length
  }
  console.log(`screenshots: 70 (${(totalBytes / 1e6).toFixed(1)} MB on the disk store)`)
}

db.close()
console.log(`\nPerf seed ready. DB: ${DB_PATH} · shots: ${SHOTS}`)
console.log('Login: e2e@test.local / e2e-password-123')
