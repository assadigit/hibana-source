#!/usr/bin/env node
// qa/s203-live-verify.mjs — S203 (THE OWNER-ACCEPTED ROUND) live proof.
// The round: SEC-10 __Host-hibana_session (the S201-presented ask — Secure is now
// UNCONDITIONAL, attributes centralized in sessions.ts's two helpers, the disclosed
// one-time cost = every user logs in once more) + @hono/node-server 1→2 (backend-only
// on prod — the Node path is the portability/e2e lane; proven by the FULL 417 e2e
// through the v2 server) + the bebas-note font diet (the §6 follow-up ask — the 6
// legacy .otf/.ttf files deleted, font-face.css woff2-only) + sw v436. The LIVE proof:
//   1. health ok/up/63 (schema unchanged);
//   2. sw.js VERSION = hibana-v436 + the SHELL still precaches the bebas font CSS;
//   3. bebas: the 3 kept woff2 byte-identical + font/woff2; the 6 deleted legacy
//      formats 404; font-face.css byte-identical + every url() ref woff2-only;
//   4. SEC-10 on the live Worker — the REAL end-to-end proof: log in with the owner's
//      designated test account (HIBANA_PROBE_LOGIN/HIBANA_PROBE_PASS env — never
//      committed), assert the Set-Cookie name is __Host-hibana_session= AND the
//      prefix contract holds (Secure present, Path=/, NO Domain attribute, HttpOnly,
//      SameSite=Lax), then round-trip GET /api/auth/me → 200 with that cookie, then
//      LOG OUT (the session row is destroyed — zero residue) and assert the clear
//      cookie carries the same __Host- name + Secure.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const EXPECT_SW = 'hibana-v436'
const EXPECT_SCHEMA = '63'
const VENDOR = join(process.cwd(), 'public', 'vendor', 'bebas-note')
const PROBE_LOGIN = process.env.HIBANA_PROBE_LOGIN
const PROBE_PASS = process.env.HIBANA_PROBE_PASS

const results = []
let fail = false
const note = (ok, label) => { if (!ok) fail = true; results.push(`${ok ? '✓' : '✗'} ${label}`) }

// 1. health — schema stays 63 (no migration this round)
{
  const h = await (await fetch(`${BASE}/api/health`, { cache: 'no-store' })).json()
  note(h.ok === true && h.db === 'up' && String(h.schema_version) === EXPECT_SCHEMA,
    `health ok=${h.ok} db=${h.db} schema_version=${h.schema_version} (expect ok/up/${EXPECT_SCHEMA})`)
}

// 2. sw.js VERSION + the SHELL's bebas font assets
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  note(sw.includes(`const VERSION = "${EXPECT_SW}"`), `sw.js VERSION = ${EXPECT_SW}`)
  note(sw.includes("'/vendor/bebas-note/font-face.css'"), 'sw.js SHELL still precaches the bebas font CSS')
  note(sw.includes("'/vendor/bebas-note/BebasNotes-Regular.woff2'"), 'sw.js SHELL still precaches the Regular woff2')
}

// 3. the bebas diet — kept files byte-identical, deleted formats 404, CSS woff2-only
for (const w of ['Regular', 'Bold', 'Light']) {
  const local = readFileSync(join(VENDOR, `BebasNotes-${w}.woff2`))
  const r = await fetch(`${BASE}/vendor/bebas-note/BebasNotes-${w}.woff2`, { cache: 'no-store' })
  if (!r.ok) { note(false, `BebasNotes-${w}.woff2 HTTP ${r.status}`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  const ctype = r.headers.get('content-type') || ''
  note(buf.equals(local) && /font\/woff2|octet-stream/.test(ctype),
    `BebasNotes-${w}.woff2: ${buf.byteLength} vs ${local.length} bytes ${buf.equals(local) ? 'IDENTICAL' : 'DIFFERS'} · ${ctype}`)
}
for (const p of ['BebasNotes-Regular.otf', 'BebasNotes-Regular.ttf', 'BebasNotes-Bold.otf',
  'BebasNotes-Bold.ttf', 'BebasNotes-Light.otf', 'BebasNotes-Light.ttf']) {
  const r = await fetch(`${BASE}/vendor/bebas-note/${p}`, { cache: 'no-store' })
  note(r.status === 404, `${p} → ${r.status} (expect 404 — deleted by the diet)`)
}
{
  const local = readFileSync(join(VENDOR, 'font-face.css'))
  const r = await fetch(`${BASE}/vendor/bebas-note/font-face.css`, { cache: 'no-store' })
  const text = await r.text()
  note(text === local.toString('utf8'), `font-face.css byte-identical (${text.length} chars)`)
  // Parse the ACTUAL url(...) references — the provenance COMMENT legitimately mentions
  // .otf/.ttf as prose (the S202 lesson); only the url() set matters.
  const urls = [...text.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1])
  note(urls.length === 3 && urls.every((u) => u.endsWith('.woff2')),
    `every url() ref is woff2-only (${urls.length} refs: ${[...new Set(urls.map((u) => u.split('.').pop()))].join(',')})`)
}

// 4. SEC-10 on the live Worker — the real end-to-end cookie proof
if (!PROBE_LOGIN || !PROBE_PASS) {
  note(false, 'SEC-10 login probe: HIBANA_PROBE_LOGIN/HIBANA_PROBE_PASS not set (env-only — never committed)')
} else {
  const hdrs = { 'Content-Type': 'application/json', Origin: BASE }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ login: PROBE_LOGIN, password: PROBE_PASS }),
  })
  if (login.status !== 200) {
    note(false, `SEC-10 login probe: HTTP ${login.status} — cannot verify the live cookie contract`)
  } else {
    const setCookie = login.headers.get('set-cookie') || ''
    note(setCookie.startsWith('__Host-hibana_session='),
      `live Set-Cookie name = ${setCookie.split('=')[0]} (expect __Host-hibana_session)`)
    note(/(?:^|;\s*)Secure(?:;|$)/.test(setCookie), 'live Set-Cookie carries Secure (the __Host- contract)')
    note(/(?:^|;\s*)Path=\/(?:;|$)/.test(setCookie), 'live Set-Cookie carries Path=/ (the __Host- contract)')
    note(!/(?:^|;\s*)Domain=/i.test(setCookie), 'live Set-Cookie carries NO Domain (the __Host- contract)')
    note(/(?:^|;\s*)HttpOnly(?:;|$)/.test(setCookie) && /SameSite=Lax/.test(setCookie),
      'live Set-Cookie keeps HttpOnly + SameSite=Lax')
    // The functional round-trip: the new-name cookie authenticates on the live Worker.
    const token = setCookie.split(';')[0]
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: token }, cache: 'no-store' })
    note(me.status === 200, `GET /api/auth/me with the __Host- cookie → ${me.status} (expect 200)`)
    // Zero residue: destroy the probe session + assert the clear cookie's contract.
    const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { ...hdrs, Cookie: token }, cache: 'no-store' })
    const clear = out.headers.get('set-cookie') || ''
    note(out.status === 200, `logout → ${out.status} (the probe session is destroyed)`)
    note(clear.startsWith('__Host-hibana_session=;') && /(?:^|;\s*)Secure(?:;|$)/.test(clear),
      'the clear cookie carries the __Host- name + Secure (same contract)')
  }
  // Belt: the OLD name must never be emitted by the live Worker.
  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ login: PROBE_LOGIN, password: 'definitely-not-the-password' }),
  })
  note(bad.status === 401 && !(bad.headers.get('set-cookie') || '').includes('hibana_session='),
    `failed-login path emits no session cookie (HTTP ${bad.status})`)
}

console.log(results.join('\n'))
console.log(`\nS203 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
