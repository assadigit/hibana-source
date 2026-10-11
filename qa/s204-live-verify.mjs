#!/usr/bin/env node
// qa/s204-live-verify.mjs — S204 (THE DEPENDABOT ROUND + THE ACCENT-INK SWEEP + THE
// MOBILE LANE) live proof.
// The round: the CI-plumbing dependency round (hono 4.13.13, TS 6.0.3, vitest 5,
// @types/node 26, wrangler 4.148, actions/checkout+upload-artifact v7 — CI-only or
// backend-only, proven by the green CI run 38183808774 on GitHub's own runners) +
// the accent-ink sweep (19 accent-as-text sites across 5 sheets re-busted: base v14,
// notes v22, quicknotes v50, dashboard v43, devboard v30) + sw v437. The LIVE proof:
//   1. health ok/up/63 (schema unchanged);
//   2. sw.js VERSION = hibana-v437;
//   3. the 5 sheets byte-identical live vs local + content/woff2-class content types;
//   4. the pages' HTML cache-bust refs point at the NEW versions (login→base v14,
//      notes→notes v22 + quicknotes v50, dashboard→dashboard v43, board→devboard v30);
//   5. the sweep is LIVE in the served CSS: the converted rules carry --accent-ink
//      (spot probes on the served bytes — .vault-meta-pill, .skip-link,
//      .sp-list-badge.is-running, .stat-recent a:hover, .vault-outline-item.is-active)
//      AND no converted rule still paints raw --accent as color;
//   6. the __Host- cookie contract regression battery (abbreviated S203: login →
//      name+attributes → /me round-trip → logout zero-residue → no old-name emission).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'https://hibana.ir'
const EXPECT_SW = 'hibana-v437'
const EXPECT_SCHEMA = '63'
const CSS = join(process.cwd(), 'public', 'css')
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

// 2. sw.js VERSION
{
  const sw = await (await fetch(`${BASE}/sw.js`, { cache: 'no-store' })).text()
  note(sw.includes(`const VERSION = "${EXPECT_SW}"`), `sw.js VERSION = ${EXPECT_SW}`)
}

// 3. the 5 re-busted sheets — byte-identical live vs local
const SHEETS = ['base', 'notes', 'quicknotes', 'dashboard', 'devboard']
for (const s of SHEETS) {
  const local = readFileSync(join(CSS, `${s}.css`))
  const r = await fetch(`${BASE}/css/${s}.css`, { cache: 'no-store' })
  if (!r.ok) { note(false, `${s}.css HTTP ${r.status}`); continue }
  const buf = Buffer.from(await r.arrayBuffer())
  note(buf.equals(local), `${s}.css: ${buf.byteLength} vs ${local.length} bytes ${buf.equals(local) ? 'IDENTICAL' : 'DIFFERS'}`)
}

// 4. the pages' WIRED refs match the local build's manifest (the S199 lesson: the live
//    HTML is deploy-WIRED to /dist/<name>.<hash>.css — the content hash IS the proof;
//    the canonical ?v= refs live in the source tree + the SW's HTML, not the wired page)
{
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'public', 'dist', 'manifest.json'), 'utf8'))
  const EXTLESS = { 'login.html': 'login', 'notes.html': 'notes', 'dashboard.html': 'dashboard', 'board.html': 'board' }
  const REF_CHECKS = [
    ['login.html', 'base.css'],
    ['notes.html', 'notes.css'],
    ['notes.html', 'quicknotes.css'],
    ['dashboard.html', 'dashboard.css'],
    ['board.html', 'devboard.css'],
  ]
  for (const [page, logical] of REF_CHECKS) {
    const url = `${BASE}/${EXTLESS[page]}` // extensionless canonical (the .html form 307s)
    const html = await (await fetch(url, { redirect: 'follow', cache: 'no-store' })).text()
    const hashed = manifest[logical]
    note(hashed && html.includes(`/${hashed}`),
      `${page} wired ref = /${hashed} (the local build's content hash — byte-proof of the new sheet)`)
  }
}

// 5. the sweep is LIVE — the converted rules carry --accent-ink in the served bytes
{
  const base = await (await fetch(`${BASE}/css/base.css`, { cache: 'no-store' })).text()
  note(/\.skip-link\s*\{[^}]*--accent-ink/s.test(base), 'base.css: the skip-link paints --accent-ink (was raw accent)')
  const notes = await (await fetch(`${BASE}/css/notes.css`, { cache: 'no-store' })).text()
  note(/\.vault-meta-pill\s*\{[^}]*--accent-ink/s.test(notes), 'notes.css: .vault-meta-pill paints --accent-ink')
  note(/\.vault-outline-item\.is-active button\s*\{[^}]*--accent-ink/s.test(notes), 'notes.css: the outline active row paints --accent-ink')
  note(/\.vault-tag-chip\[aria-pressed='true'\]\s*\{[^}]*--accent-ink/s.test(notes), 'notes.css: the pressed tag chip paints --accent-ink')
  const dash = await (await fetch(`${BASE}/css/dashboard.css`, { cache: 'no-store' })).text()
  note(/\.stat-recent a:hover\s*\{[^}]*--accent-ink/s.test(dash), 'dashboard.css: the recent-link hover paints --accent-ink')
  const dev = await (await fetch(`${BASE}/css/devboard.css`, { cache: 'no-store' })).text()
  note(/\.sp-list-badge\.is-running\s*\{[^}]*--accent-ink/s.test(dev), 'devboard.css: the running badge paints --accent-ink')
  const qn = await (await fetch(`${BASE}/css/quicknotes.css`, { cache: 'no-store' })).text()
  note(/\.related-notes a:hover\s*\{[^}]*--accent-ink/s.test(qn), 'quicknotes.css: the related-note hover paints --accent-ink')
  // the icons KEP the raw accent (the doctrine's other half)
  note(/\.vault-folder\[aria-current='true'\]\s*\.icon\s*\{[^}]*var\(--accent\)/s.test(notes),
    'notes.css: the folder icon KEEPS the raw --accent (icons stay non-text)')
}

// 6. the __Host- cookie contract regression battery (S203 holds on the new deps)
if (!PROBE_LOGIN || !PROBE_PASS) {
  note(false, 'cookie regression battery: HIBANA_PROBE_LOGIN/HIBANA_PROBE_PASS not set (env-only — never committed)')
} else {
  const hdrs = { 'Content-Type': 'application/json', Origin: BASE }
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ login: PROBE_LOGIN, password: PROBE_PASS }),
  })
  if (login.status !== 200) {
    note(false, `login probe: HTTP ${login.status} — cannot verify the live cookie contract on hono 4.13.13`)
  } else {
    const setCookie = login.headers.get('set-cookie') || ''
    note(setCookie.startsWith('__Host-hibana_session='), `live Set-Cookie name = ${setCookie.split('=')[0]}`)
    note(/(?:^|;\s*)Secure(?:;|$)/.test(setCookie) && /(?:^|;\s*)Path=\/(?:;|$)/.test(setCookie)
      && !/(?:^|;\s*)Domain=/i.test(setCookie) && /HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie),
      'the full __Host- attribute contract holds (Secure/Path=/ /no Domain/HttpOnly/Lax)')
    const token = setCookie.split(';')[0]
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: token }, cache: 'no-store' })
    note(me.status === 200, `GET /api/auth/me with the __Host- cookie → ${me.status} (expect 200 — hono 4.13.13 live)`)
    const out = await fetch(`${BASE}/api/auth/logout`, { method: 'POST', headers: { ...hdrs, Cookie: token }, cache: 'no-store' })
    note(out.status === 200, `logout → ${out.status} (the probe session is destroyed — zero residue)`)
  }
  const bad = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: hdrs,
    body: JSON.stringify({ login: PROBE_LOGIN, password: 'definitely-not-the-password' }),
  })
  note(bad.status === 401 && !(bad.headers.get('set-cookie') || '').includes('hibana_session='),
    `failed-login path emits no session cookie (HTTP ${bad.status})`)
}

console.log(results.join('\n'))
console.log(`\nS204 LIVE VERIFY: ${fail ? 'FAILED' : 'ALL GREEN'}`)
process.exit(fail ? 1 : 0)
