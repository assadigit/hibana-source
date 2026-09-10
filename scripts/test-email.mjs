#!/usr/bin/env node
// P0 email check through the REAL deployment (ROADMAP): log into the live worker with the
// stored admin credential, POST /api/dev/test-email, and report whether the worker accepted it.
//   node scripts/test-email.mjs        # dev worker
//   node scripts/test-email.mjs --prod # prod worker (https://hibana.ir)
// Credentials (DEV_ADMIN/PROD_ADMIN + pass) come from .admin.secrets in-process; never printed.

import { secrets } from './lib.mjs'

const s = secrets()
const prod = process.argv.includes('--prod')
const base = prod ? 'https://hibana.ir' : 'https://hibana.aliassadi.workers.dev'
const user = prod ? s.PROD_ADMIN : s.DEV_ADMIN
const pass = prod ? s.PROD_ADMIN_PASS : s.DEV_ADMIN_PASS
if (!user || !pass) {
  console.error(`no ${prod ? 'PROD_ADMIN' : 'DEV_ADMIN'} credentials in .admin.secrets`)
  process.exit(1)
}

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ login: user, password: pass }),
})
if (login.status !== 200) {
  console.error(`login failed (${login.status}) on ${base}`)
  process.exit(1)
}
const setCookie = login.headers.get('set-cookie') ?? ''
const cookie = setCookie.split(';')[0]
if (!cookie.startsWith('hibana_session=')) {
  console.error('login OK but no hibana_session cookie returned')
  process.exit(1)
}
console.log(`logged in to ${base} as ${user}`)

const res = await fetch(`${base}/api/dev/test-email`, {
  method: 'POST',
  headers: { Cookie: cookie },
})
const body = await res.json().catch(() => ({}))
console.log(res.ok
  ? `test-email accepted by worker (${res.status}); sent to ${body.to ?? '?'} — confirm it lands in the inbox`
  : `test-email FAILED (${res.status}): ${body.error ?? JSON.stringify(body)}`)
process.exit(res.ok ? 0 : 1)
