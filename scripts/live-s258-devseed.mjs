#!/usr/bin/env node
// scripts/live-s258-devseed.mjs — S258's dev-D1 probe-user seeder/purger (the
// S253 pattern, verbatim): the owner's test account exists on PROD only, so the
// DEV leg of the live verification runs on a seeded probe user that is PURGED
// afterwards (the purge also sweeps the project_archives orphans the
// users-cascade cannot reach — 0046's missing FK, DB-3's bug class).
//
// Usage: node scripts/live-s258-devseed.mjs seed|purge
// Env:   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (the owner's session block)

import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFileSync, rmSync } from 'node:fs'

const mode = process.argv[2]
if (mode !== 'seed' && mode !== 'purge') {
  console.error('usage: node scripts/live-s258-devseed.mjs seed|purge')
  process.exit(1)
}

const EMAIL = 'probe-s258-dev@hibana.local'
const PASS = 'probe-s258-dev-password'

function d1(sql) {
  const file = `/tmp/live-s258-seed-${Date.now()}.sql`
  writeFileSync(file, sql)
  try {
    return execFileSync('npx', ['wrangler', 'd1', 'execute', 'pm-app-dev', '--file', file, '--remote', '-y'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
  } finally {
    rmSync(file, { force: true })
  }
}

const main = async () => {
  if (mode === 'purge') {
    const out = d1(`
      DELETE FROM users WHERE email = '${EMAIL}';
      DELETE FROM project_archives WHERE project_id NOT IN (SELECT id FROM projects);
      SELECT COUNT(*) AS orphans FROM project_archives WHERE project_id NOT IN (SELECT id FROM projects);
    `)
    console.log(out.split('\n').filter((l) => /deleted|rows|orphans|Meta/i.test(l)).join('\n') || 'purged')
    return
  }
  // seed: the app's exact PBKDF2 shape (Workers cap 100k — never raise).
  const salt = randomBytes(16)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  const b64 = (u) => Buffer.from(u).toString('base64')
  const hash = `pbkdf2$100000$${b64(salt)}$${b64(Buffer.from(bits))}`
  const uid = crypto.randomUUID()
  const now = new Date().toISOString()
  d1(`
    DELETE FROM users WHERE email = '${EMAIL}';
    INSERT INTO users (id, username, email, password_hash, role, language_pref, calendar_pref, timezone, created_at, email_verified_at)
      VALUES ('${uid}', 'probe-s258', '${EMAIL}', '${hash.replace(/'/g, "''")}', 'owner', 'en', 'gregorian', 'UTC', '${now}', '${now}');
  `)
  console.log(`seeded ${EMAIL} (owner ${uid}) — purge with: node scripts/live-s258-devseed.mjs purge`)
}

main().catch((err) => { console.error(err); process.exit(1) })
