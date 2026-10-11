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

if (!session || !version || !bodyFile || !rowFile) {
  console.error('usage: rotate.mjs --session NNN --version V --body <file> --row <file> [--dry-run]')
  console.error("  --body: file whose content is the new '## 1. Current state (vV — Session NNN …' block")
  console.error('  --row:  file whose content is the new "| NNN | date | … |" timeline row')
  process.exit(2)
}

const f = join(ROOT, 'Changelogs.md')
let md = readFileSync(f, 'utf8')

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
const anchor1 = `## 1-prev. Current state (v${blocks[0].version}`
if (!md.includes(anchor1)) throw new Error('relabeled 1-prev anchor missing — rotation aborted')
md = md.replace(anchor1, body + anchor1)

// ---- §2 timeline row: newest-first table at the top of the file -----------------
const row = readFileSync(resolve(process.cwd(), rowFile), 'utf8').trimEnd() + '\n'
if (!row.startsWith(`| ${session} | `)) {
  throw new Error(`--row must start with '| ${session} | …' — rotation aborted`)
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
