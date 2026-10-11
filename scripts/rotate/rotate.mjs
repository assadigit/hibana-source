#!/usr/bin/env node
// scripts/rotate/rotate.mjs — the GENERIC docs-rotation entry (S199, HLTH-9/10).
//
// Replaces the 14 write-once rotate-s*.mjs scripts that used to live at repo root
// (120 KB of near-duplicates; only variance = version strings + content blocks —
// git history retains them verbatim). One entry, content from files:
//
//   node scripts/rotate/rotate.mjs --session 199 --version 0.4.1.24 \
//          --body scripts/rotate/content/s199-body.md \
//          --row  scripts/rotate/content/s199-row.md
//
// Worklog rotation mode (S201, HLTH-27 — the worklog was 2,836 lines, monotonic):
//   node scripts/rotate/rotate.mjs --worklog [--keep N]
// Keeps the header + the newest N session sections (anchor: the modern
// `## Session …` marker lines) in worklog.md; everything older moves to
// worklog-archive.md (append, chronological). A rotation note lands in the
// worklog header so a fresh clone knows where the history lives. Default keep=4
// (mirrors §1's 4-block chain).
//
// Prose caps (HLTH-27 "cap row prose"): the §2 timeline row must stay ≤ 2,000
// chars and the §1 body ≤ 8,000 chars — the tool hard-fails past the cap so the
// giant one-liner rows (worst was 7,366) can't regrow. Existing rows are history.
//
// What it does to Changelogs.md:
//   §1 chain (exactly 4 blocks, newest-first):
//     `## 1.` → `## 1-prev.` → `## 1-prev-prev.` → `## 1-prev-prev-prev.`
//     The oldest block DROPS to git history; the new block (from --body, which must
//     start with `## 1. Current state (v<version> …`) is inserted at the top.
//   §2 timeline table (newest-first, rows `| NNN | date | … |`):
//     the new row (from --row) is inserted BEFORE the first existing row.
//
// Safety: aborts untouched on ANY shape surprise (wrong block count, missing
// anchors, body/row shape mismatch). --dry-run prints the plan without writing.
// Paths derive from import.meta.url (HLTH-10) — no sandbox absolutes anywhere.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}
const dryRun = args.includes('--dry-run')
const session = opt('session')
const version = opt('version')
const bodyFile = opt('body')
const rowFile = opt('row')
const worklogMode = args.includes('--worklog')

// HLTH-27 prose caps — the §2 row and §1 body ceilings.
const ROW_MAX = 2000
const BODY_MAX = 8000

if (worklogMode) {
  rotateWorklog()
  process.exit(0) // the §1 chain below is the OTHER mode's job
} else if (!session || !version || !bodyFile || !rowFile) {
  console.error('usage: rotate.mjs --session NNN --version V --body <file> --row <file> [--dry-run]')
  console.error("  --body: file whose content is the new '## 1. Current state (vV — Session NNN …' block")
  console.error('  --row:  file whose content is the new "| NNN | date | … |" timeline row')
  console.error('         (caps: row ≤ 2,000 chars, body ≤ 8,000 chars — HLTH-27)')
  console.error('       OR rotate.mjs --worklog [--keep N] [--dry-run]  (worklog.md → worklog-archive.md)')
  process.exit(2)
}

const f = join(ROOT, 'Changelogs.md')
let md = readFileSync(f, 'utf8')

// ---- worklog rotation mode ------------------------------------------------------
function rotateWorklog() {
  const keep = Math.max(1, parseInt(opt('keep') ?? '4', 10))
  const wlPath = join(ROOT, 'worklog.md')
  const arcPath = join(ROOT, 'worklog-archive.md')
  const wl = readFileSync(wlPath, 'utf8')

  // session markers = modern `## Session …` headings (the canonical format since
  // S197; the older ad-hoc `## Sxxx` / bare `Task ID:` entries predate it and are
  // exactly the bulk the archive should absorb).
  const markers = []
  for (const m of wl.matchAll(/^## Session .*$/gm)) markers.push({ line: m[0], at: m.index })
  if (markers.length === 0) throw new Error('no `## Session …` markers found in worklog.md — rotation aborted, file untouched')

  const headerEnd = wl.indexOf('\n---\n') // title + purpose blockquote + first ---
  if (headerEnd === -1) throw new Error('worklog header shape unexpected (no leading --- separator) — rotation aborted')

  if (markers.length <= keep) {
    console.log(`worklog rotation: ${markers.length} session section(s) ≤ keep=${keep} — nothing to archive, file untouched`)
    return
  }

  // keep the NEWEST `keep` markers (file is oldest-first, append-per-session)
  const cutAt = markers[markers.length - keep].at
  if (cutAt <= headerEnd + 5) throw new Error('cut point inside the header — rotation aborted')
  const header = wl.slice(0, headerEnd + 5) // include the `---` line + newline
  const archived = wl.slice(headerEnd + 5, cutAt).replace(/^\n+/, '')
  const kept = wl.slice(cutAt)
  if (!archived.trim()) throw new Error('archived slice is empty — rotation aborted')

  const note = `\n> **Rotation (HLTH-27):** sessions older than the newest ${keep} live in\n> \`worklog-archive.md\` (and verbatim in git history) — this file is the ACTIVE\n> tail only. Rotate with \`node scripts/rotate/rotate.mjs --worklog\`.\n\n`
  const newHeader = header + note

  if (dryRun) {
    console.log(`DRY RUN OK — would archive ${markers.length - keep} session block(s) before "${markers[markers.length - keep].line}" (${archived.length} chars) to worklog-archive.md; worklog.md ${wl.length} → ${newHeader.length + kept.length} chars`)
    return
  }

  const arcHeader = `# Hibana — Session Worklog ARCHIVE (rotated out of worklog.md; oldest-first, append-only)\n\n> Rotated by scripts/rotate/rotate.mjs --worklog (HLTH-27). The ACTIVE tail lives in\n> worklog.md; everything here is verbatim history (also in git).\n\n---\n\n`
  let arc
  try {
    arc = readFileSync(arcPath, 'utf8')
  } catch {
    arc = arcHeader // first rotation: the archive is born
  }
  if (!arc.startsWith('# Hibana — Session Worklog ARCHIVE')) {
    if (arc.trim()) throw new Error('worklog-archive.md exists but does not carry the archive header — rotation aborted (inspect manually)')
    arc = arcHeader
  }
  writeFileSync(arcPath, arc + (arc.endsWith('\n') ? '' : '\n') + archived.replace(/\n+$/, '') + '\n')
  writeFileSync(wlPath, newHeader + kept)
  console.log(`worklog rotated: ${markers.length - keep} block(s) (${archived.length} chars) → worklog-archive.md; worklog.md ${wl.length} → ${newHeader.length + kept.length} chars (${keep} sessions kept)\n`)
}
// ---- end worklog rotation mode --------------------------------------------------

// ---- §1 chain: discover the four blocks, verify the exact shape -----------------
const HEAD_RE = /^## (1(?:-prev)*)\. Current state \(v([\d.]+) /gm
const blocks = []
let m
while ((m = HEAD_RE.exec(md)) !== null) blocks.push({ label: m[1], version: m[2], head: m[0] })
const EXPECT = ['1', '1-prev', '1-prev-prev', '1-prev-prev-prev']
if (blocks.length !== 4 || blocks.some((b, i) => b.label !== EXPECT[i])) {
  throw new Error(`§1 chain shape unexpected: ${blocks.map((b) => b.label).join(' -> ')} — rotation aborted, file untouched`)
}

// relabel bottom-up, version-pinned (the S156..S197 recipe, now derived not hardcoded)
md = md.replace(`## 1-prev-prev. Current state (v${blocks[2].version}`, `## 1-prev-prev-prev. Current state (v${blocks[2].version}`)
md = md.replace(`## 1-prev. Current state (v${blocks[1].version}`, `## 1-prev-prev. Current state (v${blocks[1].version}`)
md = md.replace(`## 1. Current state (v${blocks[0].version}`, `## 1-prev. Current state (v${blocks[0].version}`)

// drop the OLD 1-prev-prev-prev block (the pre-relabel 4th) — its version is blocks[3].version
const dropHead = `## 1-prev-prev-prev. Current state (v${blocks[3].version}`
const dropStart = md.indexOf(dropHead)
if (dropStart === -1) throw new Error(`old bottom block (v${blocks[3].version}) not found — rotation aborted`)
const nextHead = md.indexOf('\n## ', dropStart + 5)
if (nextHead === -1) throw new Error('no next ## section after the dropped block — rotation aborted')
md = md.slice(0, dropStart) + md.slice(nextHead + 1)

// insert the new block before the relabeled `## 1-prev.` (the previous release)
const body = readFileSync(resolve(process.cwd(), bodyFile), 'utf8').trimEnd() + '\n'
if (!body.startsWith(`## 1. Current state (v${version} `)) {
  throw new Error(`--body must start with '## 1. Current state (v${version} …' — rotation aborted`)
}
if (body.length > BODY_MAX) {
  throw new Error(`--body is ${body.length} chars (cap ${BODY_MAX}) — HLTH-27 row-prose cap; split detail into worklog.md/§4 and retry`)
}
const anchor1 = `## 1-prev. Current state (v${blocks[0].version}`
if (!md.includes(anchor1)) throw new Error('relabeled 1-prev anchor missing — rotation aborted')
md = md.replace(anchor1, body + anchor1)

// ---- §2 timeline row: newest-first table at the top of the file -----------------
const row = readFileSync(resolve(process.cwd(), rowFile), 'utf8').trimEnd() + '\n'
if (!row.startsWith(`| ${session} | `)) {
  throw new Error(`--row must start with '| ${session} | …' — rotation aborted`)
}
if (row.length > ROW_MAX) {
  throw new Error(`--row is ${row.length} chars (cap ${ROW_MAX}) — HLTH-27 row-prose cap; the timeline row is a summary, the §1 body carries the detail`)
}
const ROW_RE = /^\| \d+ \| /m
const firstRow = md.search(ROW_RE)
if (firstRow === -1) throw new Error('§2 timeline table not found — rotation aborted')
md = md.slice(0, firstRow) + row + md.slice(firstRow)

if (dryRun) {
  console.log(`DRY RUN OK — would rotate §1 (drop v${blocks[3].version}, insert v${version}/S${session}) + prepend row ${session}`)
} else {
  writeFileSync(f, md)
  console.log(`S${session} rotation applied: §1 rotated (v${blocks[3].version} dropped to git history), row ${session} prepended (newest-first)`)
}
