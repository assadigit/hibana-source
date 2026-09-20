#!/usr/bin/env node
// d1-archive-dump.mjs — uploads a pre-migration D1 dump (from d1-dump-tables.mjs)
// plus its evidence files to the GitHub assets repo (hibana-safe) as a durable archive.
//
// WHY: the daily app snapshot (backups/snapshot-*.json) covers user-content tables,
// but a migration-round safety net wants the FULL SQL shape (every real table, exact
// DDL) parked off-platform BEFORE `d1-migrate.mjs` runs. This is that parking step:
//
//   backups/dumps/<label>/<file>  ←  e.g. backups/dumps/pre-0058/hibana-prod-…sql
//
// The Time-Travel bookmark (pre-migrate-bookmark.mjs) remains the PRIMARY recovery
// path (in-place, minute-granularity); this archive is the belt-and-suspenders copy
// for "the whole database was destructed" scenarios (the owner's restore condition).
//
// Usage:
//   node scripts/d1-archive-dump.mjs --label pre-0058 --files a.sql,b.sql,...
//
// Creds: GITHUB_TOKEN (+ GITHUB_OWNER/GITHUB_REPO defaults) from .secrets.env or env.
// Mirrors src/services/github.ts pushFile: SHA-probe → Contents API PUT (base64).
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { secrets } from './lib.mjs'

const args = process.argv.slice(2)
const argOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : null
}
const label = argOf('--label')
const files = (argOf('--files') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (!label || !files.length) {
  console.error('usage: node scripts/d1-archive-dump.mjs --label <pre-0058> --files <file1,file2,…>')
  process.exit(1)
}

const s = secrets()
const TOKEN = process.env.GITHUB_TOKEN ?? s.GITHUB_TOKEN
const OWNER = process.env.GITHUB_OWNER ?? s.GITHUB_OWNER ?? 'assadigit'
const REPO = process.env.GITHUB_REPO ?? s.GITHUB_REPO ?? 'hibana-safe'
if (!TOKEN) {
  console.error('FATAL: GITHUB_TOKEN not set (put it in .secrets.env or export it)')
  process.exit(1)
}

const API = 'https://api.github.com'
const headers = (extra) => ({
  Authorization: `Bearer ${TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  ...extra,
})

async function pushFile(path, contentB64, message) {
  let sha
  try {
    const probe = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
      headers: headers({ Accept: 'application/vnd.github+json' }),
    })
    if (probe.ok) sha = (await probe.json()).sha
  } catch {
    /* new file — no sha needed */
  }
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }),
  })
  if (!res.ok) throw new Error(`GitHub push failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  return data.content.html_url
}

console.log(`archiving ${files.length} file(s) to ${OWNER}/${REPO} under backups/dumps/${label}/ …`)
const pushed = []
for (const file of files) {
  if (!existsSync(file)) {
    console.error(`FATAL: ${file} not found`)
    process.exit(1)
  }
  const buf = readFileSync(file)
  const path = `backups/dumps/${label}/${basename(file)}`
  const url = await pushFile(path, buf.toString('base64'), `Hibana pre-migration archive (${label}): ${basename(file)} (${buf.length} bytes)`)
  pushed.push({ path, url, bytes: buf.length })
  console.log(`  ✓ ${path} (${buf.length} bytes)`)
}
console.log('DONE — archive secured:')
for (const p of pushed) console.log(`  ${p.url}`)
